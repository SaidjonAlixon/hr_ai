import { isItRole as isItUserRole } from "./roles";

export function isItRole(role?: string | null) {
  return isItUserRole(role);
}

export function isTexnikRole(role?: string | null) {
  return role === "texnik" || role === "texnik_rahbar";
}

export function canViewOpsDept(dept: "it" | "texnik", role?: string | null) {
  if (role === "admin" || role === "director") return true;
  if (role === "mudir" || role === "koordinator") return true;
  if (dept === "it") return isItRole(role);
  return isTexnikRole(role);
}

export function canManageOpsDept(dept: "it" | "texnik", role?: string | null) {
  if (role === "admin") return true;
  if (dept === "it") return isItRole(role);
  return isTexnikRole(role);
}

export const IT_CATEGORIES = [
  { value: "access", label: "Kirish / login / huquq" },
  { value: "pos", label: "POS / kassa dasturi" },
  { value: "pc", label: "Kompyuter / printer" },
  { value: "network", label: "Internet / tarmoq" },
  { value: "camera", label: "Kamera / server" },
  { value: "software", label: "Dastur / 1C" },
  { value: "backup", label: "Zaxira nusxa" },
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
  { value: "assigned", label: "Biriktirilgan" },
  { value: "in_progress", label: "Bajarilmoqda" },
  { value: "waiting_parts", label: "Ehtiyot qism" },
  { value: "done", label: "Bajarildi" },
  { value: "closed", label: "Yopilgan" },
] as const;
