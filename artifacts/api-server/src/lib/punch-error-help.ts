/** Davomat xatolik kodlari — oddiy izoh + yechim (filtr chip + jadval) */
export type PunchErrorHelp = {
  code: string;
  /** Filtr kartasi uchun qisqa nom */
  title: string;
  meaning: string;
  fix: string;
  severity: "high" | "medium" | "low";
};

const HELP: Record<string, Omit<PunchErrorHelp, "code">> = {
  no_assignment_today: {
    title: "Bugun filial yo‘q",
    meaning:
      "Xodimda bugungi kun uchun alohida reja (rotatsiya/slot) yo‘q va doimiy filial ham aniqlanmadi.",
    fix: "Smena va filial → doimiy filial + smena saqlang. Boshqa filialga borishi kerak bo‘lsa — kunlik rotatsiya qo‘shing.",
    severity: "high",
  },
  branch_unassigned: {
    title: "Filial biriktirilmagan",
    meaning: "Xodimga hali doimiy filial belgilanmagan.",
    fix: "Smena va filial bo‘limida xodimni tanlab, doimiy filialni saqlang.",
    severity: "high",
  },
  qr_wrong_branch: {
    title: "Boshqa filial QR",
    meaning: "Skaner qilingan QR belgilangan (yoki bugungi) filialga tegishli emas.",
    fix: "Faqat o‘z filial QR ini skanerlang. Boshqa joy uchun avval rotatsiya kerak.",
    severity: "medium",
  },
  wrong_branch: {
    title: "Boshqa filial",
    meaning: "QR yoki urinish boshqa filialga tegishli.",
    fix: "O‘z filialingiz QR/GPS zonasi da davomat qiling.",
    severity: "medium",
  },
  role_not_allowed: {
    title: "QR roli mos emas",
    meaning: "Ofis xodimi filial QR bilan urinmoqda yoki filial biriktirilmagan.",
    fix: "Ofis — bo‘lim/Ofis QR. Dorixona xodimi — avval filial biriktirilsin.",
    severity: "medium",
  },
  office_qr_pharmacy: {
    title: "Apteka ≠ Ofis QR",
    meaning: "Dorixona xodimi Ofis QR dan foydalana olmaydi.",
    fix: "O‘z filialingiz QR ini skanerlang.",
    severity: "medium",
  },
  outside_geofence: {
    title: "Hududdan tashqarida",
    meaning: "GPS bo‘yicha xodim filialning ruxsat etilgan zonasidan uzoqda.",
    fix: "Filial binosi yoniga keling. Joyda turib xato bersa — filial GPS ni tekshiring.",
    severity: "medium",
  },
  outside_office_geofence: {
    title: "Ofis zonasidan tashqari",
    meaning: "GPS ofis yashil zonasidan uzoqda.",
    fix: "Ofis binosi yoniga keling yoki ofis GPS ni tekshiring.",
    severity: "medium",
  },
  gps_required: {
    title: "GPS o‘chiq",
    meaning: "Telefon lokatsiyasiga ruxsat berilmagan yoki GPS yuborilmagan.",
    fix: "Sozlamalar → Joylashuv → Ilova uchun yoqing, sahifani yangilang.",
    severity: "high",
  },
  gps_unavailable: {
    title: "GPS topilmadi",
    meaning: "Lokatsiyani aniqlab bo‘lmadi.",
    fix: "GPS ni yoqing, ochiq joyga chiqing, qayta urinib ko‘ring.",
    severity: "high",
  },
  gps_invalid: {
    title: "GPS noto‘g‘ri",
    meaning: "Yuborilgan koordinatalar yaroqsiz.",
    fix: "Sahifani yangilab, lokatsiyaga ruxsat bering.",
    severity: "medium",
  },
  branch_gps_missing: {
    title: "Filial GPS yo‘q",
    meaning: "Filial kartasida kenglik/uzunlik kiritilmagan.",
    fix: "Koordinator/admin filial lokatsiyasini kiritsin.",
    severity: "high",
  },
  user_inactive: {
    title: "Profil faol emas",
    meaning: "Foydalanuvchi statusi active emas.",
    fix: "Admin: Foydalanuvchilar → statusni Faol qiling.",
    severity: "high",
  },
  already_in: {
    title: "Allaqachon kelgan",
    meaning: "Bugun «Keldim» allaqachon qayd etilgan.",
    fix: "Ketish uchun «Ketdim» bosing. Yangi kelish kerak bo‘lsa admin tuzatsin.",
    severity: "low",
  },
  already_complete: {
    title: "Kun yopilgan",
    meaning: "Bugungi davomat allaqachon yakunlangan.",
    fix: "Qayta ochish kerak bo‘lsa admin/koordinatorga murojaat qiling.",
    severity: "low",
  },
  need_check_in: {
    title: "Avval Keldim",
    meaning: "«Ketdim» uchun avval «Keldim» bo‘lishi kerak.",
    fix: "Avval Keldim qiling, keyin Ketdim.",
    severity: "medium",
  },
  checkout_window_closed: {
    title: "Ketdim muddati o‘tgan",
    meaning: "«Ketdim» oynasi yopilgan.",
    fix: "Smena qoidasiga qarang yoki admin tuzatsin.",
    severity: "medium",
  },
  early_leave_note_required: {
    title: "Erta ketish izohi",
    meaning: "Smena tugashidan oldin ketishda sabab yozilmagan.",
    fix: "«Nega bugungi vaqtdan oldin ketayapsiz?» savoliga qisqa izoh yozing, keyin Ketdim.",
    severity: "medium",
  },
  face_ai_mismatch: {
    title: "Yuz mos kelmadi",
    meaning: "Face ID ro‘yxatdagi yuz bilan mos kelmadi.",
    fix: "Yaxshi yoritilgan joyda qayta skanerlang yoki Face ID ni qayta ro‘yxatdan o‘tkazing.",
    severity: "high",
  },
  face_ai_low_confidence: {
    title: "Yuz aniq emas",
    meaning: "Face ID ishonchi past — yuz aniqlanmadi.",
    fix: "Kamerani to‘g‘rilang, qayta urinib ko‘ring.",
    severity: "medium",
  },
  face_not_registered: {
    title: "Face ID yo‘q",
    meaning: "Yuz hali ro‘yxatdan o‘tmagan.",
    fix: "Profil / Face ID bo‘limida yuzni ro‘yxatdan o‘tkazing.",
    severity: "high",
  },
  face_already_taken: {
    title: "Yuz band",
    meaning: "Bu yuz boshqa profilga biriktirilgan.",
    fix: "Admin tekshirsin — boshqa akkauntdagi Face ID ni olib tashlash kerak.",
    severity: "high",
  },
  use_face_punch: {
    title: "Face ID kerak",
    meaning: "Bu urinish uchun Face ID majburiy.",
    fix: "Face ID orqali davomat qiling.",
    severity: "medium",
  },
  qr_invalid: {
    title: "QR formati xato",
    meaning: "QR kod noto‘g‘ri formatda.",
    fix: "Filialdagi yangi QR ni skanerlang.",
    severity: "medium",
  },
  qr_unknown: {
    title: "QR topilmadi",
    meaning: "Bu QR tizimda yo‘q.",
    fix: "Hozirgi amaldagi filial/ofis QR ini oling.",
    severity: "medium",
  },
  qr_revoked: {
    title: "QR bekor qilingan",
    meaning: "Bu QR kod o‘chirilgan.",
    fix: "Yangi QR yarating yoki ekrandagi yangisini skanerlang.",
    severity: "medium",
  },
  qr_expired: {
    title: "QR muddati tugagan",
    meaning: "QR kod eskirgan.",
    fix: "Yangi QR ni skanerlang.",
    severity: "medium",
  },
  qr_token_mismatch: {
    title: "QR token xato",
    meaning: "QR ichidagi token mos kelmadi.",
    fix: "Ekrandagi eng so‘nggi QR ni qayta skanerlang.",
    severity: "medium",
  },
  qr_required: {
    title: "QR kerak",
    meaning: "QR payload yuborilmagan.",
    fix: "QR ni qayta skanerlang.",
    severity: "medium",
  },
  qr_forbidden: {
    title: "QR ruxsati yo‘q",
    meaning: "Bu QR ni ko‘rish/ishlatishga ruxsat yo‘q.",
    fix: "O‘z filial/bo‘limingiz QR idan foydalaning.",
    severity: "medium",
  },
  dept_qr_disabled: {
    title: "Bo‘lim QR o‘chiq",
    meaning: "Bo‘lim QR vaqtincha o‘chirilgan.",
    fix: "Admin yoqsin yoki filial QR ishlating.",
    severity: "medium",
  },
  action_required: {
    title: "Keldim/Ketdim yo‘q",
    meaning: "action (in/out) yuborilmagan.",
    fix: "Keldim yoki Ketdim tugmasini bosing.",
    severity: "low",
  },
  server_error: {
    title: "Server xatosi",
    meaning: "Serverda kutilmagan xato.",
    fix: "Bir ozdan keyin qayta urinib ko‘ring. Davom etsa admin tekshirsin.",
    severity: "high",
  },
  denied: {
    title: "Rad etildi",
    meaning: "Davomat urinishi rad etildi (aniq kod yozilmagan).",
    fix: "Smena, filial va GPS ni tekshiring.",
    severity: "medium",
  },
  geofence: {
    title: "Hududdan tashqarida",
    meaning: "GPS geofence tekshiruvi o‘tmadi.",
    fix: "Filial yoniga keling.",
    severity: "medium",
  },
  fail: {
    title: "GPS/Face muvaffaqiyatsiz",
    meaning: "Tekshiruv natijasi fail.",
    fix: "GPS va Face ID ni qayta tekshiring.",
    severity: "medium",
  },
  ok: {
    title: "Boshqa sabab",
    meaning: "QR/GPS ok deb yozilgan, lekin yakuniy natija rad.",
    fix: "failureReason va meta ni tekshiring.",
    severity: "low",
  },
};

/** Erkin matn / eski yozuvlar uchun kalit so‘z → kod */
const TEXT_HINTS: Array<{ re: RegExp; code: string }> = [
  { re: /ofis\s*qr|apteka\s*xodimi\s*ofis|office_qr_pharmacy/i, code: "office_qr_pharmacy" },
  { re: /wrong[_\s-]?branch|noto[‘']?g[‘']?ri\s*filial|boshqa\s*filial|ruxsat\s*etilgan\s*filial/i, code: "qr_wrong_branch" },
  { re: /no[_\s-]?assignment|bugun\s*filial|biriktirilmagan|smena\s*topilmadi|filial\/smena/i, code: "no_assignment_today" },
  { re: /branch[_\s-]?unassigned|filial\s*belgilanmagan/i, code: "branch_unassigned" },
  { re: /outside[_\s-]?office|ofis\s*zona/i, code: "outside_office_geofence" },
  { re: /outside[_\s-]?geofence|hududdan\s*tashqari|zonasidan\s*uzoq|70\s*m/i, code: "outside_geofence" },
  { re: /gps[_\s-]?required|gps\s*majburiy|lokatsiyaga\s*ruxsat|joylashuv/i, code: "gps_required" },
  { re: /branch[_\s-]?gps|filial\s*gps|koordinata\s*kiritilmagan/i, code: "branch_gps_missing" },
  { re: /face[_\s-]?ai[_\s-]?mismatch|yuz\s*mos\s*kelmadi|yuz\s*tanilmadi/i, code: "face_ai_mismatch" },
  { re: /face[_\s-]?not[_\s-]?regist|yuz\s*ro[‘']?yxat/i, code: "face_not_registered" },
  { re: /face[_\s-]?ai[_\s-]?low|ishonch\s*past|aniq\s*emas/i, code: "face_ai_low_confidence" },
  { re: /already[_\s-]?in|allaqachon\s*kel/i, code: "already_in" },
  { re: /already[_\s-]?complete|kun\s*yopil/i, code: "already_complete" },
  { re: /need[_\s-]?check[_\s-]?in|avval\s*keldim/i, code: "need_check_in" },
  { re: /checkout[_\s-]?window|ketdim\s*muddat/i, code: "checkout_window_closed" },
  { re: /user[_\s-]?inactive|profil\s*faol\s*emas/i, code: "user_inactive" },
  { re: /role[_\s-]?not[_\s-]?allowed|ruxsat\s*yo[‘']?q.*qr|filial\s*qr\s*ruxsat/i, code: "role_not_allowed" },
  { re: /qr[_\s-]?expired|muddati\s*tugagan/i, code: "qr_expired" },
  { re: /qr[_\s-]?revoked|bekor\s*qilingan/i, code: "qr_revoked" },
  { re: /qr[_\s-]?unknown|qr\s*topilmadi/i, code: "qr_unknown" },
  { re: /qr[_\s-]?invalid|noto[‘']?g[‘']?ri\s*format/i, code: "qr_invalid" },
  { re: /server[_\s-]?error|ichki\s*xato/i, code: "server_error" },
];

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[''`´]/g, "'")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");
}

function titleFromFreeText(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Noma’lum xato";
  if (cleaned.length <= 36) return cleaned;
  return `${cleaned.slice(0, 34)}…`;
}

export function punchErrorHelp(codeOrReason?: string | null): PunchErrorHelp {
  const raw = String(codeOrReason || "").trim();
  if (!raw) {
    return {
      code: "unknown",
      title: "Noma’lum xato",
      meaning: "Sabab yozilmagan.",
      fix: "Smena/filial va GPS ni tekshiring.",
      severity: "medium",
    };
  }

  const norm = normalizeKey(raw);
  if (HELP[norm]) return { code: norm, ...HELP[norm] };
  if (HELP[raw]) return { code: raw, ...HELP[raw] };

  for (const { re, code } of TEXT_HINTS) {
    if (re.test(raw) || re.test(norm)) {
      const known = HELP[code];
      if (known) return { code, ...known };
    }
  }

  // snake_case kod, lekin HELP da yo‘q — kodning o‘zini qisqa nom qilamiz
  if (/^[a-z][a-z0-9_]{1,48}$/i.test(raw) && !raw.includes(" ")) {
    const pretty = raw
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return {
      code: norm,
      title: pretty.slice(0, 36),
      meaning: `Kod: ${raw}`,
      fix: "Smena/filial, QR va GPS ni tekshiring. Muammo qolsa admin/koordinatorga murojaat qiling.",
      severity: "medium",
    };
  }

  // Erkin matn — har bir xabar o‘z nomi bilan (bir xil «Davomat xatosi» emas)
  return {
    code: norm.slice(0, 64) || "unknown",
    title: titleFromFreeText(raw),
    meaning: raw,
    fix: "Smena/filial va GPS ni tekshiring. Muammo qolsa admin yoki koordinatorga murojaat qiling.",
    severity: "medium",
  };
}

/** Bir nechta maydondan eng aniq kodni tanlash */
export function resolvePunchErrorCode(parts: {
  metaCode?: unknown;
  failureReason?: string | null;
  qrResult?: string | null;
  gpsResult?: string | null;
  faceResult?: string | null;
}): string {
  const candidates = [
    parts.metaCode != null ? String(parts.metaCode) : "",
    parts.failureReason || "",
    parts.qrResult || "",
    parts.gpsResult || "",
    parts.faceResult || "",
  ]
    .map((s) => String(s).trim())
    .filter(Boolean);

  for (const c of candidates) {
    const h = punchErrorHelp(c);
    if (h.code !== "unknown" && h.title !== "Noma’lum xato" && HELP[h.code]) {
      return h.code;
    }
  }
  return candidates[0] || "unknown";
}

export function listKnownPunchErrorCodes(): string[] {
  return Object.keys(HELP);
}
