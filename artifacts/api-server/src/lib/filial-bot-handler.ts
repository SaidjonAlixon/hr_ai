import {
  buildLokatsiyaUsersExcel,
  buildLokatsiyaUsersTextReport,
  isBlockedSendError,
} from "./filial-bot-admin";
import {
  findFilialBranch,
  loadFilialBranches,
  type FilialBranchCard,
} from "./filial-bot-data";
import {
  isFilialBotAdmin,
  listLokatsiyaBroadcastTargets,
  markLokatsiyaUserBlocked,
  upsertLokatsiyaBotUser,
} from "./filial-bot-users";
import {
  filialAnswerCallback,
  filialEditMessageText,
  filialSendDocument,
  filialSendLocation,
  filialSendMessage,
  type FilialInlineButton,
  type FilialTelegramUpdate,
  type FilialTelegramUser,
} from "./telegram-filial";

const PAGE_SIZE = 10;

const BTN_USERS = "👥 Foydalanuvchilar";
const BTN_BROADCAST = "📢 Xabar yuborish";
const BTN_BRANCHES = "🏢 Filiallar";
const BTN_NEAREST = "📍 Eng yaqin filial";
const BTN_SEND_LOCATION = "📍 Joyimni yuborish";
const BTN_CANCEL_BROADCAST = "❌ Bekor qilish";
const BTN_CANCEL_NEAREST = "❌ Bekor";

/** Admin kutayotgan broadcast matni */
const pendingBroadcast = new Map<number, { text: string; at: number }>();
const awaitingBroadcastText = new Set<number>();
/** Foydalanuvchi oxirgi yuborgan joyi — masofa hisoblash uchun */
const userLastGeo = new Map<number, { lat: number; lng: number; at: number }>();
const awaitingUserLocation = new Set<number>();

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Aniq km: 0.85 km, 12.34 km; 100 m dan kam — metrada */
export function formatDistanceExact(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 100) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function displayName(u?: FilialTelegramUser): string {
  if (!u) return "mehmon";
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return n || u.username || "mehmon";
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "⚠️ <i>kiritilmagan</i>";
  return `<code>${esc(phone)}</code>`;
}

function openLabel(status: FilialBranchCard["openStatus"]): string {
  if (status === "open") return "🟢 <b>Hozir ochiq</b>";
  if (status === "closed") return "🔴 <b>Hozir yopiq</b>";
  return "⚪ <b>Ish vaqti belgilanmagan</b>";
}

function hoursLabel(b: FilialBranchCard): string {
  if (b.contactFromHm && b.contactToHm) {
    return `${esc(b.contactFromHm)} — ${esc(b.contactToHm)}`;
  }
  return "⚠️ <i>belgilanmagan</i>";
}

export function formatBranchCard(
  b: FilialBranchCard,
  opts?: { distanceMeters?: number },
): string {
  const lines: string[] = [
    `🏢 <b>${esc(b.name)}</b>`,
    "",
  ];

  if (opts?.distanceMeters != null && Number.isFinite(opts.distanceMeters)) {
    lines.push(
      `📏 <b>Sizdan masofa:</b> ${esc(formatDistanceExact(opts.distanceMeters))}`,
      "",
    );
  }

  lines.push(
    `👤 <b>Koordinator:</b> ${b.coordinatorName ? esc(b.coordinatorName) : "⚠️ <i>biriktirilmagan</i>"}`,
    `📞 <b>Koordinator raqami:</b> ${formatPhone(b.coordinatorPhone)}`,
    "",
    `🧑‍💼 <b>Zavedushiy (mudir):</b> ${esc(b.mudirName)}`,
    `📱 <b>Mudir shaxsiy:</b> ${formatPhone(b.mudirPhone)}`,
    "",
    `☎️ <b>Filial raqami (Bog‘lanish):</b> ${
      b.hasPrimaryPhone
        ? formatPhone(b.primaryPhone)
        : "⚠️ <i>kiritilmagan — mudir Bog‘lanish bo‘limida yozishi kerak</i>"
    }`,
  );

  if (b.extraPhones.length) {
    lines.push(
      `➕ <b>Qo‘shimcha:</b> ${b.extraPhones.map((p) => `<code>${esc(p)}</code>`).join(", ")}`,
    );
  }
  if (b.telegramNick) {
    lines.push(`✈️ <b>Telegram:</b> ${esc(b.telegramNick)}`);
  }

  lines.push("", `🕐 <b>Bog‘lanish vaqti:</b> ${hoursLabel(b)}`, openLabel(b.openStatus), "");

  if (b.hasGps && b.lat != null && b.lng != null) {
    lines.push(
      "📍 <b>Lokatsiya:</b> tizimdagi aniq nuqta pastda yuboriladi — ochib navigatsiya qilishingiz mumkin.",
    );
  } else {
    lines.push(
      "📍 <b>Lokatsiya:</b> ⚠️ <i>tizimda yo‘q — GPS qo‘shish kerak</i> (Aptekalar tarmog‘i / filial GPS).",
    );
  }

  lines.push("", "<i>Mijoz va xodimlar uchun: filialga qo‘ng‘iroq qilish va yo‘l topish</i>");
  return lines.join("\n");
}

function listKeyboard(branches: FilialBranchCard[], page: number): FilialInlineButton[][] {
  const totalPages = Math.max(1, Math.ceil(branches.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = branches.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const rows: FilialInlineButton[][] = slice.map((b) => [
    { text: `🏢 ${b.name}`.slice(0, 64), callback_data: `fb:${b.id}` },
  ]);

  const nav: FilialInlineButton[] = [];
  if (p > 0) nav.push({ text: "◀️ Orqaga", callback_data: `fp:${p - 1}` });
  nav.push({ text: `${p + 1}/${totalPages}`, callback_data: `fp:${p}` });
  if (p < totalPages - 1) nav.push({ text: "Oldinga ▶️", callback_data: `fp:${p + 1}` });
  if (nav.length) rows.push(nav);

  rows.push([{ text: "🔄 Yangilash", callback_data: "fp:0" }]);
  return rows;
}

function listText(branches: FilialBranchCard[], page: number, firstName: string): string {
  const totalPages = Math.max(1, Math.ceil(branches.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  return [
    `👋 <b>Xush kelibsiz, ${esc(firstName)}!</b>`,
    "",
    "🏢 <b>Vaksina lokatsiya</b> — filiallar, bog‘lanish va lokatsiya.",
    "",
    "Filialingizni tanlang:",
    `<i>Sahifa ${p + 1}/${totalPages} · jami ${branches.length} ta filial</i>`,
  ].join("\n");
}

function backKeyboard(): FilialInlineButton[][] {
  return [[{ text: "⬅️ Filiallar ro‘yxati", callback_data: "fp:0" }]];
}

function userMainKeyboard(admin: boolean) {
  if (admin) {
    return {
      keyboard: [
        [{ text: BTN_NEAREST }, { text: BTN_BRANCHES }],
        [{ text: BTN_USERS }, { text: BTN_BROADCAST }],
      ],
      resize_keyboard: true,
    };
  }
  return {
    keyboard: [[{ text: BTN_NEAREST }, { text: BTN_BRANCHES }]],
    resize_keyboard: true,
  };
}

function adminReplyKeyboard() {
  return userMainKeyboard(true);
}

function locationRequestKeyboard() {
  return {
    keyboard: [
      [{ text: BTN_SEND_LOCATION, request_location: true as const }],
      [{ text: BTN_CANCEL_NEAREST }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function adminBroadcastCancelKeyboard() {
  return {
    keyboard: [[{ text: BTN_CANCEL_BROADCAST }], [{ text: BTN_BRANCHES }]],
    resize_keyboard: true,
  };
}

async function trackUser(
  user: FilialTelegramUser | undefined,
  chatId: number,
  opts?: { isStart?: boolean; action?: string; branchView?: boolean },
) {
  if (!user?.id) return;
  try {
    await upsertLokatsiyaBotUser(user, chatId, opts);
  } catch (err) {
    console.error("[lokatsiya-bot] upsert user", err);
  }
}

async function sendBranchList(chatId: number, user: FilialTelegramUser | undefined, page = 0) {
  const name = displayName(user);
  const branches = await loadFilialBranches(true);
  const admin = isFilialBotAdmin(user?.id);
  if (!branches.length) {
    await filialSendMessage(
      chatId,
      `👋 <b>Xush kelibsiz, ${esc(name)}!</b>\n\nHozircha tizimda faol filial topilmadi.`,
      { reply_markup: userMainKeyboard(admin) },
    );
    return;
  }
  await filialSendMessage(chatId, listText(branches, page, name), {
    reply_markup: { inline_keyboard: listKeyboard(branches, page) },
  });
  await filialSendMessage(
    chatId,
    admin
      ? "Pastdagi tugmalar: eng yaqin filial · ro‘yxat · admin"
      : "Pastdagi tugmalar: <b>Eng yaqin filial</b> yoki <b>Filiallar</b>",
    { reply_markup: userMainKeyboard(admin) },
  );
}

async function askForUserLocation(chatId: number, userId: number) {
  awaitingUserLocation.add(userId);
  await filialSendMessage(
    chatId,
    [
      "📍 <b>Eng yaqin filial</b>",
      "",
      "O‘zingiz turgan joyning <b>aniq lokatsiyasini</b> yuboring.",
      "",
      "Pastdagi <b>«Joyimni yuborish»</b> tugmasini bosing yoki Telegram orqali joylashuvni ulashing.",
      "Shundan so‘ng sizga eng yaqin <b>3 ta filial</b> chiqadi (masofa km bilan).",
    ].join("\n"),
    { reply_markup: locationRequestKeyboard() },
  );
}

async function handleUserLocation(
  chatId: number,
  user: FilialTelegramUser | undefined,
  lat: number,
  lng: number,
) {
  if (user?.id) {
    userLastGeo.set(user.id, { lat, lng, at: Date.now() });
    awaitingUserLocation.delete(user.id);
  }
  await trackUser(user, chatId, { action: "nearest_geo" });

  const branches = await loadFilialBranches(true);
  const withGps = branches.filter((b) => b.hasGps && b.lat != null && b.lng != null);
  if (!withGps.length) {
    await filialSendMessage(
      chatId,
      "⚠️ Tizimda GPS qo‘yilgan filial topilmadi. Keyinroq urinib ko‘ring.",
      { reply_markup: userMainKeyboard(isFilialBotAdmin(user?.id)) },
    );
    return;
  }

  const ranked = withGps
    .map((b) => ({
      branch: b,
      meters: haversineMeters(lat, lng, b.lat!, b.lng!),
    }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 3);

  const medals = ["1️⃣", "2️⃣", "3️⃣"];
  const lines = [
    "📍 <b>Sizga eng yaqin 3 ta filial</b>",
    `<i>Sizning joy: ${lat.toFixed(5)}, ${lng.toFixed(5)}</i>`,
    "",
  ];
  ranked.forEach((r, i) => {
    lines.push(
      `${medals[i]} <b>${esc(r.branch.name)}</b>`,
      `   📏 ${esc(formatDistanceExact(r.meters))} · ${r.branch.openStatus === "open" ? "🟢 ochiq" : r.branch.openStatus === "closed" ? "🔴 yopiq" : "⚪ vaqt yo‘q"}`,
      "",
    );
  });
  lines.push("Filialni tanlang — to‘liq ma’lumot, masofa va lokatsiya chiqadi:");

  await filialSendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: ranked.map((r, i) => [
        {
          text: `${medals[i]} ${r.branch.name} · ${formatDistanceExact(r.meters)}`.slice(0, 64),
          callback_data: `fn:${r.branch.id}`,
        },
      ]),
    },
  });
  await filialSendMessage(chatId, "Asosiy menyu:", {
    reply_markup: userMainKeyboard(isFilialBotAdmin(user?.id)),
  });
}

async function sendBranchDetails(
  chatId: number,
  branchId: number,
  user?: FilialTelegramUser,
) {
  await trackUser(user, chatId, { action: "branch_view", branchView: true });
  const branches = await loadFilialBranches();
  const b = findFilialBranch(branches, branchId);
  if (!b) {
    await filialSendMessage(chatId, "Filial topilmadi. /start bosing.");
    return;
  }

  let distanceMeters: number | undefined;
  const geo = user?.id ? userLastGeo.get(user.id) : undefined;
  if (geo && b.lat != null && b.lng != null) {
    distanceMeters = haversineMeters(geo.lat, geo.lng, b.lat, b.lng);
  }

  await filialSendMessage(chatId, formatBranchCard(b, { distanceMeters }), {
    reply_markup: { inline_keyboard: backKeyboard() },
  });

  if (b.hasGps && b.lat != null && b.lng != null) {
    try {
      await filialSendLocation(chatId, b.lat, b.lng);
    } catch (err) {
      console.error("[filial-bot] sendLocation", err);
      await filialSendMessage(
        chatId,
        `📍 Lokatsiyani yuborib bo‘lmadi. Koordinatalar: <code>${b.lat}, ${b.lng}</code>`,
      );
    }
  }
}

async function handleAdminUsers(chatId: number) {
  await filialSendMessage(chatId, "⏳ Foydalanuvchilar hisoboti tayyorlanmoqda…");
  try {
    const text = await buildLokatsiyaUsersTextReport();
    await filialSendMessage(chatId, text);

    const { buffer, count, filename, stats } = await buildLokatsiyaUsersExcel();
    await filialSendDocument(chatId, buffer, filename, {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      caption: `📊 Excel · jami ${count} · aktiv ${stats.active} · blok ${stats.blocked}`,
    });
  } catch (err) {
    console.error("[lokatsiya-bot] users report", err);
    await filialSendMessage(
      chatId,
      `❌ Hisobot xato: ${esc((err as Error).message || "noma’lum")}`,
    );
  }
}

async function startBroadcastPrompt(chatId: number, adminId: number) {
  awaitingBroadcastText.add(adminId);
  pendingBroadcast.delete(adminId);
  const targets = await listLokatsiyaBroadcastTargets();
  await filialSendMessage(
    chatId,
    [
      "📢 <b>Ommaviy xabar</b>",
      "",
      `Yuboriladi: <b>${targets.length}</b> ta aktiv foydalanuvchi`,
      "(bloklaganlar chiqarib tashlanadi)",
      "",
      "Xabar matnini yozing (HTML oddiy matn).",
      "Bekor qilish uchun pastdagi tugma.",
    ].join("\n"),
    { reply_markup: adminBroadcastCancelKeyboard() },
  );
}

async function runBroadcast(chatId: number, adminId: number, text: string) {
  const targets = await listLokatsiyaBroadcastTargets();
  if (!targets.length) {
    await filialSendMessage(chatId, "Aktiv foydalanuvchi yo‘q.", {
      reply_markup: adminReplyKeyboard(),
    });
    return;
  }

  await filialSendMessage(
    chatId,
    `⏳ Yuborilmoqda… <b>0/${targets.length}</b>`,
  );

  let ok = 0;
  let fail = 0;
  let blocked = 0;
  const failSamples: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    try {
      await filialSendMessage(t.chat_id, text, { parse_mode: "HTML" });
      ok += 1;
    } catch (err) {
      fail += 1;
      const msg = (err as Error).message || "xato";
      if (isBlockedSendError(msg)) {
        blocked += 1;
        await markLokatsiyaUserBlocked(t.telegram_user_id).catch(() => undefined);
      }
      if (failSamples.length < 8) {
        failSamples.push(`${t.name} (${t.telegram_user_id}): ${msg}`);
      }
    }
    // Telegram flood limitcha biroz kutish
    if (i > 0 && i % 20 === 0) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  const lines = [
    "✅ <b>Xabar yuborish yakunlandi</b>",
    "",
    `📬 <b>Yetdi:</b> ${ok}`,
    `❌ <b>Yetmadi:</b> ${fail}`,
    `🚫 <b>Blok / yopiq chat:</b> ${blocked}`,
    `👥 <b>Jami urinish:</b> ${targets.length}`,
  ];
  if (failSamples.length) {
    lines.push("", "<b>Namuna xatolar:</b>");
    for (const s of failSamples) lines.push(`• <i>${esc(s)}</i>`);
  }

  await filialSendMessage(chatId, lines.join("\n"), {
    reply_markup: adminReplyKeyboard(),
  });
  pendingBroadcast.delete(adminId);
  awaitingBroadcastText.delete(adminId);
}

export async function handleFilialBotUpdate(update: FilialTelegramUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data || "";
      const chatId = cq.message?.chat.id;
      const messageId = cq.message?.message_id;
      await filialAnswerCallback(cq.id).catch(() => undefined);
      if (!chatId) return;

      await trackUser(cq.from, chatId, { action: `cb:${data.slice(0, 24)}` });

      if (data.startsWith("fp:")) {
        const page = Number(data.slice(3));
        const branches = await loadFilialBranches(true);
        const text = listText(branches, Number.isFinite(page) ? page : 0, displayName(cq.from));
        const markup = {
          inline_keyboard: listKeyboard(branches, Number.isFinite(page) ? page : 0),
        };
        if (messageId) {
          try {
            await filialEditMessageText(chatId, messageId, text, { reply_markup: markup });
          } catch {
            await filialSendMessage(chatId, text, { reply_markup: markup });
          }
        } else {
          await filialSendMessage(chatId, text, { reply_markup: markup });
        }
        return;
      }

      if (data.startsWith("fb:")) {
        const id = Number(data.slice(3));
        if (Number.isFinite(id)) await sendBranchDetails(chatId, id, cq.from);
        return;
      }

      if (data.startsWith("fn:")) {
        const id = Number(data.slice(3));
        if (Number.isFinite(id)) await sendBranchDetails(chatId, id, cq.from);
        return;
      }

      if (data.startsWith("bc:")) {
        if (!isFilialBotAdmin(cq.from.id)) {
          await filialSendMessage(chatId, "⛔ Faqat admin uchun.");
          return;
        }
        if (data === "bc:cancel") {
          pendingBroadcast.delete(cq.from.id);
          awaitingBroadcastText.delete(cq.from.id);
          await filialSendMessage(chatId, "Bekor qilindi.", {
            reply_markup: adminReplyKeyboard(),
          });
          return;
        }
        if (data === "bc:send") {
          const pending = pendingBroadcast.get(cq.from.id);
          if (!pending?.text) {
            await filialSendMessage(chatId, "Xabar topilmadi. Qaytadan /admin → Xabar yuborish.");
            return;
          }
          await runBroadcast(chatId, cq.from.id, pending.text);
          return;
        }
      }
      return;
    }

    const msg = update.message;
    if (!msg?.chat?.id) return;
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    const user = msg.from;
    const name = displayName(user);
    const admin = isFilialBotAdmin(user?.id);
    const cmd = text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() || "";

    // Lokatsiya yuborilganda — eng yaqin 3 ta
    if (msg.location && Number.isFinite(msg.location.latitude) && Number.isFinite(msg.location.longitude)) {
      await handleUserLocation(chatId, user, msg.location.latitude, msg.location.longitude);
      return;
    }

    // Barcha foydalanuvchilar: eng yaqin / filiallar
    if (text === BTN_NEAREST || cmd === "/yaqin" || cmd === "/nearest") {
      if (!user?.id) return;
      await trackUser(user, chatId, { action: "nearest_ask" });
      await askForUserLocation(chatId, user.id);
      return;
    }
    if (text === BTN_CANCEL_NEAREST) {
      if (user?.id) awaitingUserLocation.delete(user.id);
      await filialSendMessage(chatId, "Bekor qilindi.", {
        reply_markup: userMainKeyboard(admin),
      });
      return;
    }
    if (text === BTN_BRANCHES) {
      await trackUser(user, chatId, { isStart: true, action: "branches_btn" });
      await sendBranchList(chatId, user, 0);
      return;
    }

    // Admin tugmalari
    if (admin && text === BTN_USERS) {
      await trackUser(user, chatId, { action: "admin_users" });
      await handleAdminUsers(chatId);
      return;
    }
    if (admin && text === BTN_BROADCAST) {
      await trackUser(user, chatId, { action: "admin_broadcast" });
      await startBroadcastPrompt(chatId, user!.id);
      return;
    }
    if (admin && text === BTN_CANCEL_BROADCAST) {
      awaitingBroadcastText.delete(user!.id);
      pendingBroadcast.delete(user!.id);
      await filialSendMessage(chatId, "Bekor qilindi.", {
        reply_markup: adminReplyKeyboard(),
      });
      return;
    }

    // Admin broadcast matn kutilmoqda
    if (admin && user?.id && awaitingBroadcastText.has(user.id) && text && !text.startsWith("/")) {
      pendingBroadcast.set(user.id, { text, at: Date.now() });
      awaitingBroadcastText.delete(user.id);
      const targets = await listLokatsiyaBroadcastTargets();
      await filialSendMessage(
        chatId,
        [
          "📝 <b>Xabar tayyor</b>",
          "",
          text.slice(0, 3500),
          "",
          `Qabul qiluvchilar: <b>${targets.length}</b> ta`,
          "Yuborilsinmi?",
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Hammaga yuborish", callback_data: "bc:send" },
                { text: "❌ Bekor", callback_data: "bc:cancel" },
              ],
            ],
          },
        },
      );
      return;
    }

    if (cmd === "/start" || cmd === "/filiallar" || cmd === "/branches") {
      await trackUser(user, chatId, { isStart: true, action: "start" });
      await sendBranchList(chatId, user, 0);
      return;
    }

    if (cmd === "/admin") {
      if (!admin) {
        await filialSendMessage(chatId, "⛔ Bu buyruq faqat admin uchun.");
        return;
      }
      await trackUser(user, chatId, { action: "admin" });
      await filialSendMessage(
        chatId,
        [
          "🛠 <b>Vaksina lokatsiya — Admin</b>",
          "",
          "Pastdagi tugmalar:",
          `• ${BTN_USERS} — jonli matn + Excel`,
          `• ${BTN_BROADCAST} — hammaga xabar`,
          `• ${BTN_BRANCHES} — filiallar`,
          "",
          `Sizning Telegram ID: <code>${user?.id}</code>`,
        ].join("\n"),
        { reply_markup: adminReplyKeyboard() },
      );
      return;
    }

    if (cmd === "/yordam" || cmd === "/help") {
      await trackUser(user, chatId, { action: "help" });
      const lines = [
        "ℹ️ <b>Vaksina lokatsiya bot</b>",
        "",
        "• /start — filiallar ro‘yxati",
        "• 📍 Eng yaqin filial — joyingizni yuboring, eng yaqin 3 ta chiqadi",
        "• Filialni tanlang — mudir, koordinator, telefon, ish vaqti",
        "• Lokatsiya bo‘lsa — xarita nuqtasi yuboriladi",
        `• Telegram ID: <code>${user?.id ?? "—"}</code>`,
        "",
        "Bu bot faqat filial lokatsiyasi va bog‘lanish uchun. HR / davomat — alohida Vaksina HR botda.",
      ];
      if (admin) {
        lines.push("", "Admin: /admin");
      }
      await filialSendMessage(chatId, lines.join("\n"));
      return;
    }

    if (cmd === "/id" || cmd === "/meningid") {
      await filialSendMessage(
        chatId,
        `🆔 Sizning Telegram ID: <code>${user?.id ?? "—"}</code>\nAdmin uchun .env dagi <code>TELEGRAM_FILIAL_ADMIN_IDS</code> ga yoziladi.`,
      );
      return;
    }

    // matn orqali qidiruv
    if (text.length >= 2 && !text.startsWith("/")) {
      await trackUser(user, chatId, { action: "search" });
      const branches = await loadFilialBranches();
      const q = text.toLowerCase();
      const hits = branches.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 10);
      if (!hits.length) {
        await filialSendMessage(
          chatId,
          `«${esc(text)}» bo‘yicha filial topilmadi.\n/start — to‘liq ro‘yxat.`,
        );
        return;
      }
      if (hits.length === 1) {
        await sendBranchDetails(chatId, hits[0]!.id, user);
        return;
      }
      await filialSendMessage(chatId, `🔍 Topilgan filiallar (${hits.length}):`, {
        reply_markup: {
          inline_keyboard: hits.map((b) => [
            { text: `🏢 ${b.name}`.slice(0, 64), callback_data: `fb:${b.id}` },
          ]),
        },
      });
      return;
    }

    await trackUser(user, chatId, { action: "other" });
    await filialSendMessage(chatId, "Filiallar uchun /start bosing.");
  } catch (err) {
    console.error("[filial-bot] handleUpdate", err);
  }
}
