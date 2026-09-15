import { isItRole as isItUserRole, isDirectorRole, hasFullPlatformAccess } from "./roles";

export function isItRole(role?: string | null) {
  return isItUserRole(role);
}

export function isTexnikRole(_role?: string | null) {
  return false;
}

/** AyTi zayavka — barcha autentifikatsiyalangan foydalanuvchilar */
export function canCreateOpsTicket(dept: "it" | "texnik", role?: string | null) {
  if (!role) return false;
  return dept === "it";
}

/** Sahifani ochish: zayavka yozish / o‘z arizalarini ko‘rish */
export function canViewOpsDept(dept: "it" | "texnik", role?: string | null) {
  return canCreateOpsTicket(dept, role);
}

/** Holat / qabul / bajarish — faqat AyTi yoki admin/asoschi */
export function canManageOpsDept(dept: "it" | "texnik", role?: string | null) {
  if (dept !== "it") return false;
  if (hasFullPlatformAccess(role) || isDirectorRole(role)) return true;
  return isItRole(role);
}

/** Barcha arizalarni ko‘rish (doska) */
export function canViewAllOpsTickets(dept: "it" | "texnik", role?: string | null) {
  return canManageOpsDept(dept, role);
}

export const IT_CATEGORIES = [
  { value: "access", label: "Kirish / login / huquq" },
  { value: "pos", label: "POS / kassa dasturi" },
  { value: "pc", label: "Kompyuter / printer" },
  { value: "network", label: "Internet / tarmoq" },
  { value: "camera", label: "Kamera / server" },
  { value: "software", label: "Dastur / 1C" },
  { value: "backup", label: "Zaxira nusxa" },
  { value: "other", label: "Boshqa muammo" },
] as const;

export const TEXNIK_CATEGORIES = [
  { value: "fridge", label: "Sovitgich / muzlatgich" },
  { value: "electric", label: "Elektrika" },
  { value: "climate", label: "Konditsioner / isitish" },
  { value: "plumbing", label: "Santexnika" },
  { value: "furniture", label: "Javon / mebel" },
  { value: "other_repair", label: "Boshqa ta’mir" },
] as const;

export const TICKET_STATUS = [
  { value: "new", label: "Yangi" },
  { value: "accepted", label: "Qabul qilindi" },
  { value: "in_progress", label: "Bajarilmoqda" },
  { value: "waiting_parts", label: "Ehtiyot qism" },
  { value: "done", label: "Bajarildi" },
  { value: "verified", label: "Tasdiqlangan" },
  { value: "closed", label: "Yopilgan" },
] as const;

export const ACCEPT_STATUSES = new Set(["accepted", "in_progress", "waiting_parts"]);
export const DONE_STATUSES = new Set(["done", "verified", "closed"]);
export const VERIFY_STATUSES = new Set(["verified", "closed"]);
