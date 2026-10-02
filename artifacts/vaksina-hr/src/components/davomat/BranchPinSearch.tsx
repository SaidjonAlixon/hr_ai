import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { foldScript } from "@/lib/script-fold";
import { OFFICE_MAP_PLACE } from "@/components/davomat/MobileRouteMap";
import type { PharmacyMapPin } from "@/lib/mobile-attendance-api";

const OFFICE_PIN: PharmacyMapPin = {
  id: OFFICE_MAP_PLACE.id,
  name: OFFICE_MAP_PLACE.name,
  lat: OFFICE_MAP_PLACE.lat,
  lng: OFFICE_MAP_PLACE.lng,
  mudirName: "",
  coordinatorName: "",
  phone: "",
  hours: OFFICE_MAP_PLACE.hours,
};

export function BranchPinSearch({
  pins,
  onPick,
}: {
  pins: PharmacyMapPin[];
  onPick: (pin: PharmacyMapPin) => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const needle = foldScript(q.trim());
    if (!needle) return [];
    const list = [OFFICE_PIN, ...pins];
    return list.filter((p) => foldScript(p.name).includes(needle)).slice(0, 12);
  }, [pins, q]);

  return (
    <div className="relative">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Filial qidirish
      </label>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            onPick(hits[0]);
            setQ("");
          }
        }}
        placeholder="Nom — krill yoki lotin"
        className="mt-1.5 rounded-xl"
      />
      {q.trim() ? (
        <div className="absolute left-0 right-0 z-[1200] mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          {hits.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Bunday filial topilmadi</p>
          ) : (
            hits.map((p) => (
              <button
                key={p.id}
                type="button"
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => {
                  onPick(p);
                  setQ("");
                }}
              >
                <span className="font-semibold">{p.name}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
