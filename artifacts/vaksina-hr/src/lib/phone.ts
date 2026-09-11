/** O‘zbekiston mobil: +998 XX XXX XX XX (998 + 9 raqam = 12 raqam) */

const UZ_PREFIX = "998";
const UZ_TOTAL_DIGITS = 12; // 998 + 9

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Har qanday paste/yozuvdan 998 + 9 raqamni ajratib oladi.
 * +998…, 998…, 8…, 90…, 00998… — hammasi qo‘llab-quvvatlanadi.
 */
export function parseUzPhoneDigits(raw: string): string {
  let digits = digitsOnly(raw);
  if (!digits) return "";

  if (digits.startsWith("00")) digits = digits.slice(2);

  const idx998 = digits.indexOf(UZ_PREFIX);
  if (idx998 >= 0) {
    return digits.slice(idx998, idx998 + UZ_TOTAL_DIGITS);
  }

  // Eski 8XXXXXXXXX (10 raqam)
  if (digits.startsWith("8") && digits.length >= 10) {
    return (UZ_PREFIX + digits.slice(1)).slice(0, UZ_TOTAL_DIGITS);
  }

  // Faqat lokal 9 raqam (90 123 45 67)
  if (digits.length <= 9) {
    return (UZ_PREFIX + digits).slice(0, UZ_TOTAL_DIGITS);
  }

  return (UZ_PREFIX + digits).slice(0, UZ_TOTAL_DIGITS);
}

/** Inputdan faqat o‘zbek formatiga mos maska */
export function formatUzPhoneInput(raw: string): string {
  const digits = parseUzPhoneDigits(raw);
  if (!digits) return "";

  const a = digits.slice(0, 3); // 998
  const b = digits.slice(3, 5);
  const c = digits.slice(5, 8);
  const d = digits.slice(8, 10);
  const e = digits.slice(10, 12);

  let out = `+${a}`;
  if (b) out += ` ${b}`;
  if (c) out += ` ${c}`;
  if (d) out += ` ${d}`;
  if (e) out += ` ${e}`;
  return out;
}

/** Faqat koddan keyingi qism: "90 123 45 67" */
export function formatUzPhoneLocalPart(raw: string): string {
  const digits = parseUzPhoneDigits(raw);
  if (!digits || digits === UZ_PREFIX) return "";
  const rest = digits.slice(3);
  const b = rest.slice(0, 2);
  const c = rest.slice(2, 5);
  const d = rest.slice(5, 7);
  const e = rest.slice(7, 9);
  let out = b;
  if (c) out += ` ${c}`;
  if (d) out += ` ${d}`;
  if (e) out += ` ${e}`;
  return out;
}

export function isCompleteUzPhone(value: string): boolean {
  const d = parseUzPhoneDigits(value);
  return d.length === UZ_TOTAL_DIGITS && d.startsWith(UZ_PREFIX);
}

/** Bo‘sh yoki to‘liq raqam — ixtiyoriy maydonlar uchun */
export function isOptionalUzPhoneValid(value: string): boolean {
  const d = parseUzPhoneDigits(value);
  if (!d || d === UZ_PREFIX) return true;
  return isCompleteUzPhone(value);
}

/** Saqlash uchun: +998901234567 yoki bo‘sh */
export function normalizeUzPhone(value: string): string {
  const d = parseUzPhoneDigits(value);
  if (!d || d === UZ_PREFIX) return "";
  if (d.length !== UZ_TOTAL_DIGITS) return `+${d}`;
  return `+${d}`;
}

export const UZ_PHONE_PLACEHOLDER = "90 123 45 67";
export const UZ_PHONE_HINT = "Format: +998 XX XXX XX XX (9 raqam)";
export const UZ_PHONE_PREFIX_DISPLAY = "+998";
