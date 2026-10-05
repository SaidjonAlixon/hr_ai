import { Router, type IRouter } from "express";
import { loadFilialBranches } from "../lib/filial-bot-data";
import {
  filialNumberLabel,
  matchFilialCatalog,
} from "../lib/filial-catalog";
import { coerceUzbekistanGps } from "../lib/geo-location";
import { sortDistrictNames } from "../lib/filial-districts";

const router: IRouter = Router();

function formatPhone(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
  }
  return String(raw || "").trim();
}

/** Kirishsiz: barcha dorixona filiallari, raqami va joyi. */
router.get("/public/filiallar", async (_req, res): Promise<void> => {
  try {
    const branches = await loadFilialBranches();
    const places = branches.map((b) => {
      const catalog = matchFilialCatalog(b.name);
      const branchNo = b.branchNo ?? catalog?.no ?? null;
      const coord = coerceUzbekistanGps(b.lat, b.lng);
      const official = catalog?.official?.trim() || "";
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
