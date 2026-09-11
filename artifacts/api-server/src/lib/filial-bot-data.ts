import { eq, inArray } from "drizzle-orm";
import { db, employeesTable, usersTable, pool } from "@workspace/db";
import { dedupeActiveBranches } from "./branch-dedupe";
import { displayBranchName, gpsFromLocationField, stripGpsSuffix } from "./geo-location";

export type FilialBranchCard = {
  id: number;
  name: string;
  mudirName: string;
  mudirPhone: string | null;
  coordinatorName: string | null;
  coordinatorPhone: string | null;
  primaryPhone: string | null;
  extraPhones: string[];
  telegramNick: string | null;
  contactFromHm: string | null;
  contactToHm: string | null;
  openStatus: "open" | "closed" | "unknown";
  lat: number | null;
  lng: number | null;
  hasGps: boolean;
  hasPrimaryPhone: boolean;
};

type ContactRow = {
  branch_employee_id: number;
  primary_phone: string;
  extra_phones: unknown;
  telegram_nick: string | null;
  contact_from_hm: string | null;
  contact_to_hm: string | null;
};

function branchName(location: string | null, fullName: string): string {
  const fromLoc = displayBranchName(location) || stripGpsSuffix(location);
  const generic = !fromLoc || /^(filial|apteka|branch|dorixona)\s*\d*$/i.test(fromLoc);
  return (generic ? fullName : fromLoc).trim() || fullName;
}

function extrasFromDb(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x || "")).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((x) => String(x || "")).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function tashkentHmNow(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function hmToMinutes(hm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function contactOpenStatus(
  fromHm: string | null | undefined,
  toHm: string | null | undefined,
): "open" | "closed" | "unknown" {
  if (!fromHm || !toHm) return "unknown";
  const from = hmToMinutes(fromHm);
  const to = hmToMinutes(toHm);
  const now = hmToMinutes(tashkentHmNow());
  if (from == null || to == null || now == null) return "unknown";
  if (from === to) return "open";
  if (from < to) return now >= from && now < to ? "open" : "closed";
  // kechasi orqali (masalan 22:00–06:00)
  return now >= from || now < to ? "open" : "closed";
}

function resolveGps(
  lat: number | null | undefined,
  lng: number | null | undefined,
  location: string | null | undefined,
): { lat: number; lng: number } | null {
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) {
    return { lat, lng };
  }
  return gpsFromLocationField(location);
}

let cache: { at: number; items: FilialBranchCard[] } | null = null;
const CACHE_MS = 45_000;

export async function loadFilialBranches(force = false): Promise<FilialBranchCard[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.items;

  const managers = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      userId: employeesTable.userId,
      reportsToId: employeesTable.reportsToId,
      employmentStatus: employeesTable.employmentStatus,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
    })
    .from(employeesTable)
    .where(eq(employeesTable.orgRole, "manager"));

  const active = dedupeActiveBranches(
    managers.filter((m) => m.employmentStatus !== "dismissed" && m.employmentStatus !== "closed"),
  );

  const coordIds = [
    ...new Set(active.map((m) => m.reportsToId).filter((id): id is number => id != null)),
  ];
  const coords = coordIds.length
    ? await db
        .select({
          id: employeesTable.id,
          fullName: employeesTable.fullName,
          userId: employeesTable.userId,
        })
        .from(employeesTable)
        .where(inArray(employeesTable.id, coordIds))
    : [];
  const coordById = new Map(coords.map((c) => [c.id, c]));

  const userIds = [
    ...new Set(
      [
        ...active.map((m) => m.userId),
        ...coords.map((c) => c.userId),
      ].filter((id): id is number => id != null),
    ),
  ];
  const users = userIds.length
    ? await db
        .select({ id: usersTable.id, phone: usersTable.phone })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  const phoneByUser = new Map(users.map((u) => [u.id, (u.phone || "").trim() || null]));

  const branchIds = active.map((m) => m.id);
  const contactMap = new Map<number, ContactRow>();
  if (branchIds.length) {
    const { rows } = await pool.query<ContactRow>(
      `SELECT branch_employee_id, primary_phone, extra_phones, telegram_nick,
              contact_from_hm, contact_to_hm
       FROM branch_contacts
       WHERE branch_employee_id = ANY($1::int[])`,
      [branchIds],
    );
    for (const row of rows) contactMap.set(row.branch_employee_id, row);
  }

  const items: FilialBranchCard[] = active
    .map((m) => {
      const contact = contactMap.get(m.id);
      const primary = (contact?.primary_phone || "").trim() || null;
      const gps = resolveGps(m.latitude, m.longitude, m.location);
      const coord = m.reportsToId != null ? coordById.get(m.reportsToId) : undefined;
      const fromHm = contact?.contact_from_hm || null;
      const toHm = contact?.contact_to_hm || null;
      return {
        id: m.id,
        name: branchName(m.location, m.fullName),
        mudirName: m.fullName,
        mudirPhone: m.userId != null ? phoneByUser.get(m.userId) ?? null : null,
        coordinatorName: coord?.fullName ?? null,
        coordinatorPhone: coord?.userId != null ? phoneByUser.get(coord.userId) ?? null : null,
        primaryPhone: primary,
        extraPhones: extrasFromDb(contact?.extra_phones),
        telegramNick: contact?.telegram_nick || null,
        contactFromHm: fromHm,
        contactToHm: toHm,
        openStatus: contactOpenStatus(fromHm, toHm),
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
        hasGps: !!gps,
        hasPrimaryPhone: !!(primary && primary.length >= 12),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uz"));

  cache = { at: Date.now(), items };
  return items;
}

export function findFilialBranch(items: FilialBranchCard[], id: number): FilialBranchCard | undefined {
  return items.find((b) => b.id === id);
}

export function invalidateFilialBranchCache() {
  cache = null;
}
