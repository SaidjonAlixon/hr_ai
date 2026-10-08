import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import { db, staffNeedRequestsTable } from "@workspace/db";
import { loadFilialBranches, type FilialBranchCard } from "../lib/filial-bot-data";
import {
  filialNumberLabel,
  matchFilialCatalog,
} from "../lib/filial-catalog";
import { coerceUzbekistanGps, displayBranchName, stripGpsSuffix } from "../lib/geo-location";
import { sortDistrictNames } from "../lib/filial-districts";
import { formatShiftLabel } from "../lib/filial-staffing-monitor";

const router: IRouter = Router();

const OPEN_NEED_STATUSES = ["open", "pending_hr", "approved", "searching"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type PublicNeed = {
  role: string;
  count: number;
  shift: string;
  openedAt: string;
  daysOpen: number;
  neededBy: string | null;
};

function formatPhone(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
  }
  return String(raw || "").trim();
}

function needRoleLabel(roleNeeded: string, positionText: string | null): string {
  if (roleNeeded === "custom" && positionText?.trim()) return positionText.trim();
  if (roleNeeded === "mudir") return "Mudir";
  if (roleNeeded === "stajyor") return "Stajyor";
  return "Farmasevt";
}

/** «Xodim kerak» ochiq arizalari filial bo‘yicha (ofis arizalari kirmaydi) */
async function loadOpenNeedsByBranch(branches: FilialBranchCard[]): Promise<Map<number, PublicNeed[]>> {
  const rows = await db
    .select({
      managerEmployeeId: staffNeedRequestsTable.managerEmployeeId,
      branchLocation: staffNeedRequestsTable.branchLocation,
      sourceType: staffNeedRequestsTable.sourceType,
      roleNeeded: staffNeedRequestsTable.roleNeeded,
      positionText: staffNeedRequestsTable.positionText,
      shiftType: staffNeedRequestsTable.shiftType,
      shiftLabel: staffNeedRequestsTable.shiftLabel,
      count: staffNeedRequestsTable.count,
      neededBy: staffNeedRequestsTable.neededBy,
      createdAt: staffNeedRequestsTable.createdAt,
    })
    .from(staffNeedRequestsTable)
    .where(inArray(staffNeedRequestsTable.status, [...OPEN_NEED_STATUSES]));

  const byId = new Map(branches.map((b) => [b.id, b.id]));
  const byName = new Map(branches.map((b) => [b.name.trim().toLowerCase(), b.id]));
  const now = Date.now();
  const out = new Map<number, PublicNeed[]>();
  for (const r of rows) {
    if (r.sourceType === "office") continue;
    const name = (displayBranchName(r.branchLocation) || stripGpsSuffix(r.branchLocation) || "").trim().toLowerCase();
    const branchId =
      (r.managerEmployeeId != null ? byId.get(r.managerEmployeeId) : undefined) ?? (name ? byName.get(name) : undefined);
    if (branchId == null) continue;
    const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
    const list = out.get(branchId) ?? [];
    list.push({
      role: needRoleLabel(r.roleNeeded, r.positionText),
      count: Math.max(1, r.count || 1),
      shift: formatShiftLabel(r.shiftLabel, r.shiftType),
      openedAt: created.toISOString(),
      daysOpen: Math.max(0, Math.floor((now - created.getTime()) / DAY_MS)),
      neededBy: r.neededBy?.trim() || null,
    });
    out.set(branchId, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.daysOpen - a.daysOpen);
  return out;
}

/** Kirishsiz: barcha dorixona filiallari, raqami, joyi va ochiq «Xodim kerak» arizalari. */
router.get("/public/filiallar", async (_req, res): Promise<void> => {
  try {
    const branches = await loadFilialBranches();
    const needsByBranch = await loadOpenNeedsByBranch(branches).catch((err) => {
      console.error("GET /public/filiallar needs", err);
      return new Map<number, PublicNeed[]>();
    });
    const places = branches.map((b) => {
      const catalog = matchFilialCatalog(b.name);
      const branchNo = b.branchNo ?? catalog?.no ?? null;
      const coord = coerceUzbekistanGps(b.lat, b.lng);
      const official = catalog?.official?.trim() || "";
      const needs = needsByBranch.get(b.id) ?? [];
      return {
        id: b.id,
        branchNo,
        numberLabel: filialNumberLabel(branchNo),
        name: b.name,
        officialName: official && official !== b.name ? official : null,
        district: b.district,
        lat: coord?.lat ?? null,
        lng: coord?.lng ?? null,
        hours:
          b.contactFromHm && b.contactToHm ? `${b.contactFromHm}–${b.contactToHm}` : "Belgilanmagan",
        phone: formatPhone(b.primaryPhone) || "Raqam kiritilmagan",
        mudirName: b.mudirName?.trim() || "Zavedushi tayinlanmagan",
        coordinatorName: b.coordinatorName?.trim() || "Tayinlanmagan",
        coordinatorPhone: formatPhone(b.coordinatorPhone) || "Raqam kiritilmagan",
        needs,
        needCount: needs.reduce((s, n) => s + n.count, 0),
      };
    });
    places.sort((a, b) => {
      const an = a.branchNo == null ? 10_000 : a.branchNo;
      const bn = b.branchNo == null ? 10_000 : b.branchNo;
      if (an !== bn) return an - bn;
      return a.name.localeCompare(b.name, "uz");
    });
    const districts = sortDistrictNames([...new Set(places.map((p) => p.district).filter(Boolean))]);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json({ places, districts, total: places.length });
  } catch (err) {
    console.error("GET /public/filiallar", err);
    res.status(503).json({ error: "Filial xaritasi yuklanmadi", detail: (err as Error)?.message });
  }
});

export default router;
