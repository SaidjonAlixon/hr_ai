/**
 * Tayyor qisqa javoblar — AI chaqirilmasdan ishlaydi.
 * Kalitlar o‘zbekcha/lotincha + ruscha variantlar bilan.
 */

export type HelpLocale = "uz" | "ru";

export type HelpFaqLink = {
  label: string;
  url: string;
  hintUz?: string;
  hintRu?: string;
};

export type HelpFaq = {
  id: string;
  titleUz: string;
  titleRu: string;
  keywords: string[];
  answerUz: string;
  answerRu: string;
  links?: HelpFaqLink[];
};

export const HELP_FAQS: HelpFaq[] = [
  {
    id: "face-id-ulash",
    titleUz: "Face ID qanday ulanadi?",
    titleRu: "Как подключить Face ID?",
    keywords: ["face id", "faceid", "yuz", "ulash", "ulan", "kamera", "skan", "biometric", "лицо", "подключ"],
    answerUz:
      "Profil pastidagi «Face ID ni ulash» tugmasini bosing → kamera ruxsatini bering → yuzni oval ichiga joylashtiring → 2–3 marta markaz kadr oling. HTTPS yoki localhost kerak. Ulangandan keyin davomatda Face ID ishlaydi.",
    answerRu:
      "В профиле нажмите «Подключить Face ID» → разрешите камеру → поместите лицо в овал → сделайте 2–3 центральных кадра. Нужен HTTPS или localhost. После подключения Face ID работает в посещаемости.",
  },
  {
    id: "face-id-ishlamaydi",
    titleUz: "Face ID ishlamayapti",
    titleRu: "Face ID не работает",
    keywords: ["face ishlamay", "yuz tanimay", "kamera ochilmay", "face xato", "skan xato", "descriptor", "не работ", "ошибка"],
    answerUz:
      "Tekshiring: 1) HTTPS/localhost 2) kamera ruxsati 3) yaxshi yorug‘lik, bitta yuz 4) Face ID qayta ulang. Bir nechta yuz yoki qorong‘u joyda rad etiladi. Baribir bo‘lmasa xato ekranining skrinshotini yuboring.",
    answerRu:
      "Проверьте: 1) HTTPS/localhost 2) разрешение камеры 3) хорошее освещение, одно лицо 4) переподключите Face ID. Несколько лиц или темнота — отказ. Если не помогло — отправьте скриншот ошибки.",
  },
  {
    id: "davomat-gps",
    titleUz: "Davomat GPS / hudud",
    titleRu: "Посещаемость GPS / зона",
    keywords: ["davomat", "gps", "hudud", "geofence", "uzoq", "filial", "70", "keldim", "ketdim", "outside", "посещаем", "зона"],
    answerUz:
      "Davomat Face ID + GPS bilan. Filial atrofida 70 m, ofisda 100 m ichida bo‘lishingiz kerak. Lokatsiya ruxsatini yoqing, «Yashil hudud» paydo bo‘lgach Keldim/Ketdim qiling.",
    answerRu:
      "Посещаемость через Face ID + GPS. Нужно быть в пределах 70 м от филиала или 100 м от офиса. Включите геолокацию; когда появится «Зелёная зона», отметьте Пришёл/Ушёл.",
  },
  {
    id: "smena-vaqt",
    titleUz: "Smena vaqtlari",
    titleRu: "Время смен",
    keywords: ["smena", "3smena", "3-smena", "1-smena", "2-smena", "ish vaqti", "smena vaqt", "nechida", "смена", "график"],
    answerUz:
      "Apteka (mudir/farmasevt/stajyor): 1-smena 08:00–17:00, 2-smena 17:00–23:45. 3-smena yo‘q. Ofis xodimlari odatda 09:00–18:00. Smena profil/kadr sozlamasida belgilanadi.",
    answerRu:
      "Аптека (управляющий/фармацевт/стажёр): 1-я смена 08:00–17:00, 2-я 17:00–23:45. 3-й смены нет. Офис обычно 09:00–18:00. Смена задаётся в профиле/кадрах.",
  },
  {
    id: "login-parol",
    titleUz: "Login / parol",
    titleRu: "Логин / пароль",
    keywords: ["login", "parol", "kirish", "password", "session", "chiqarib", "akkount", "пароль", "вход"],
    answerUz:
      "Login/parolni kim beradi: farmasevt, stajyor yoki mudir — Koordinator; bo‘lim boshliqlari yoki rahbariyat — Admin; bo‘lim xodimlari — o‘z bo‘lim boshlig‘i. Parolni unutsangiz (kira olsangiz) profil orqali almashtiring yoki shu beruvchidan reset so‘rang. Telegram Mini App orqali ham kirish mumkin.",
    answerRu:
      "Кто выдаёт логин/пароль: фармацевт, стажёр или управляющий — Координатор; руководители отделов или руководство — Админ; сотрудники отдела — руководитель отдела. Если забыли пароль (и можете войти) — смените в профиле или попросите reset у выдавшего. Также возможен вход через Telegram Mini App.",
  },
  {
    id: "oylik-kpi",
    titleUz: "Oylik / KPI",
    titleRu: "Зарплата / KPI",
    keywords: ["oylik", "kpi", "bonus", "fiks", "maosh", "hisob", "зарплат", "оклад"],
    answerUz:
      "Oylik = fiks maosh + bonus. KPI odatda davomat + topshiriq + checklist ulushidan. «Oylik» bo‘limida o‘z natijangizni ko‘ring. Filial savdo oyligi «Hisob-kitob»da.",
    answerRu:
      "Зарплата = фикс + бонус. KPI обычно из посещаемости + задач + чек-листа. Смотрите результат в разделе «Зарплата». Зарплата филиала по продажам — в «Расчёте».",
  },
  {
    id: "hisobkitob",
    titleUz: "Hisob-kitob",
    titleRu: "Расчёт зарплаты",
    keywords: ["hisob-kitob", "hisobkitob", "savdo", "protsent", "filial oylik", "antey", "расчёт", "процент"],
    answerUz:
      "Hisob-kitob filial savdo oyligi: Oylik % = o‘z savdosi × protsent + fiksa + bonus − ayirmalar. Direktor/moliya/admin tahrirlaydi va tasdiqlaydi.",
    answerRu:
      "Расчёт — зарплата филиала по продажам: % = свой оборот × процент + фикс + бонус − удержания. Правит и утверждает директор/финансы/админ.",
  },
  {
    id: "checklist",
    titleUz: "Cheklist / audit",
    titleRu: "Чек-лист / аудит",
    keywords: ["checklist", "cheklist", "audit", "tashrif", "koordinator", "чек-лист", "аудит"],
    answerUz:
      "Cheklist asosan koordinator uchun: filial GPS (70 m) ichida ochiladi, savollar to‘ldiriladi, ball chiqadi. Holat/reyting «Cheklist holati»da.",
    answerRu:
      "Чек-лист в основном для координатора: открывается в GPS-зоне филиала (70 м), заполняются вопросы, ставится балл. Статус/рейтинг — в «Статусе чек-листа».",
  },
  {
    id: "apteka-tarmoq",
    titleUz: "Apteka tarmog‘i",
    titleRu: "Сеть аптек",
    keywords: ["apteka", "filial", "mudir", "farmasevt", "stajyor", "tarmoq", "pharmacy", "аптек", "филиал"],
    answerUz:
      "Aptekalar tarmog‘ida filial, mudir, farmasevt, smena va GPS ko‘rinadi. Koordinator/HR/direktor kadr va holatni boshqaradi. Ehtiyoj alohida bo‘limda.",
    answerRu:
      "В сети аптек видны филиал, управляющий, фармацевт, смена и GPS. Координатор/HR/директор управляют кадрами и статусом. Потребность — в отдельном разделе.",
  },
  {
    id: "menyu-rollar",
    titleUz: "Menyu va rollar",
    titleRu: "Меню и роли",
    keywords: ["menyu", "rol", "huquq", "ko‘rinmay", "ruxsat", "admin", "hr", "mudir", "меню", "роль", "права"],
    answerUz:
      "Har bir rolga qarab menyu ochiladi. Ba’zi bo‘limlar (Foydalanuvchilar, Hisob-kitob va hokazo) faqat ma’lum rollarga. Kerakli bo‘lim ko‘rinmasa — roliingizga ruxsat yo‘q yoki admin sozlashi kerak.",
    answerRu:
      "Меню зависит от роли. Некоторые разделы (Пользователи, Расчёт и т.д.) только для определённых ролей. Если раздела нет — нет прав или нужна настройка админом.",
  },
  {
    id: "chat-topshiriq",
    titleUz: "Chat / topshiriq / eslatma",
    titleRu: "Чат / задачи / напоминания",
    keywords: ["chat", "topshiriq", "vazifa", "eslatma", "bildirishnoma", "чат", "задач", "напомин"],
    answerUz:
      "Chat — xodimlar suhbatlari. Topshiriqlar — berilgan/olingan ishlar. Eslatmalar — shaxsiy muddatli eslatma. Bildirishnomalar qo‘ng‘iroqcha ikonkasida.",
    answerRu:
      "Чат — переписка сотрудников. Задачи — выданные/полученные. Напоминания — личные со сроком. Уведомления — в иконке колокольчика.",
  },
  {
    id: "telegram",
    titleUz: "Telegram",
    titleRu: "Telegram",
    keywords: ["telegram", "bot", "mini app", "tg", "vaksinahr", "kirish", "вход"],
    answerUz:
      "Tizimga ikki xil usulda kirish mumkin:\n• Telegram boti orqali — login/parol yuborganingizdan so‘ng kirish havolasini beradi.\n• Rasmiy sayt orqali.",
    answerRu:
      "Войти в систему можно двумя способами:\n• Через Telegram-бота — после логина/пароля выдаёт ссылку входа.\n• Через официальный сайт.",
    links: [
      {
        label: "@vaksinahrbot",
        url: "https://t.me/vaksinahrbot",
        hintUz: "Telegram bot",
        hintRu: "Telegram-бот",
      },
      {
        label: "vaksinahr.uz",
        url: "https://www.vaksinahr.uz/",
        hintUz: "Veb sayt",
        hintRu: "Веб-сайт",
      },
    ],
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻ`']/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveLocale(raw?: string | null): HelpLocale {
  const s = String(raw || "").toLowerCase();
  if (s.startsWith("ru")) return "ru";
  return "uz";
}

export function faqTitle(faq: HelpFaq, locale: HelpLocale): string {
  return locale === "ru" ? faq.titleRu : faq.titleUz;
}

export function faqAnswer(faq: HelpFaq, locale: HelpLocale): string {
  return locale === "ru" ? faq.answerRu : faq.answerUz;
}

export function faqLinksForLocale(faq: HelpFaq, locale: HelpLocale) {
  return faq.links?.map((l) => ({
    label: l.label,
    url: l.url,
    hint: locale === "ru" ? l.hintRu || l.hintUz : l.hintUz || l.hintRu,
  }));
}

export function matchHelpFaq(question: string): { faq: HelpFaq; score: number } | null {
  const q = normalize(question);
  if (!q) return null;
  let best: { faq: HelpFaq; score: number } | null = null;
  for (const faq of HELP_FAQS) {
    let score = 0;
    for (const kw of faq.keywords) {
      const k = normalize(kw);
      if (!k) continue;
      if (q.includes(k)) score += k.length >= 6 ? 3 : 2;
      else {
        const parts = k.split(" ").filter(Boolean);
        if (parts.length > 1 && parts.every((p) => q.includes(p))) score += 2;
      }
    }
    const titleBits = normalize(`${faq.titleUz} ${faq.titleRu}`)
      .split(" ")
      .filter((w) => w.length > 3);
    for (const w of titleBits) {
      if (q.includes(w)) score += 1;
    }
    if (!best || score > best.score) best = { faq, score };
  }
  if (!best || best.score < 2) return null;
  return best;
}

export function faqCatalogForAi(locale: HelpLocale = "uz"): string {
  return HELP_FAQS.map(
    (f, i) => `${i + 1}. [${f.id}] ${faqTitle(f, locale)}\n${faqAnswer(f, locale)}`,
  ).join("\n\n");
}

export function findFaqById(id: string): HelpFaq | undefined {
  return HELP_FAQS.find((f) => f.id === id);
}
