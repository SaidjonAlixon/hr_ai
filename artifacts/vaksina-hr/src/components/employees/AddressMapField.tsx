import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ExternalLink, Loader2, MapPin, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { yandexPointUrl } from "@/lib/external-maps";
import type { AddressInfo } from "@/lib/employee-dossier-api";
import { geocodeUzbekistan, reverseGeocodeUz } from "@/lib/uz-geocode";

const TASHKENT: L.LatLngExpression = [41.3111, 69.2797];

type Props = {
  label: string;
  value: AddressInfo;
  disabled?: boolean;
  onChange: (next: AddressInfo) => void;
  onClear?: () => void;
};

export function AddressMapField({ label, value, disabled, onChange, onClear }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;

    const hasPoint =
      value.lat != null && value.lng != null && Number.isFinite(value.lat) && Number.isFinite(value.lng);
    const center: L.LatLngExpression = hasPoint ? [value.lat!, value.lng!] : TASHKENT;

    const map = L.map(mapEl.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView(center, hasPoint ? 16 : 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    const icon = L.divIcon({
      className: "",
      html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#0f766e;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });

    const marker = L.marker(center, { draggable: !disabled, icon }).addTo(map);
    markerRef.current = marker;
    mapRef.current = map;

    const applyPoint = async (lat: number, lng: number) => {
      marker.setLatLng([lat, lng]);
      map.panTo([lat, lng]);
      setBusy(true);
      try {
        const text = await reverseGeocodeUz(lat, lng);
        onChangeRef.current({ text, lat, lng });
        setHint(null);
      } finally {
        setBusy(false);
      }
    };

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (disabled) return;
      void applyPoint(e.latlng.lat, e.latlng.lng);
    });

    marker.on("dragend", () => {
      if (disabled) return;
      const ll = marker.getLatLng();
      void applyPoint(ll.lat, ll.lng);
    });

    const t1 = window.setTimeout(() => map.invalidateSize(), 100);
    const t2 = window.setTimeout(() => map.invalidateSize(), 400);
    const ro =
      typeof ResizeObserver !== "undefined" && mapEl.current
        ? new ResizeObserver(() => map.invalidateSize())
        : null;
    if (mapEl.current && ro) ro.observe(mapEl.current);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map once
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (value.lat != null && value.lng != null) {
      const ll = L.latLng(value.lat, value.lng);
      if (!marker.getLatLng().equals(ll)) {
        marker.setLatLng(ll);
        map.setView(ll, Math.max(map.getZoom(), 14));
      }
    }
    marker.dragging?.[disabled ? "disable" : "enable"]();
  }, [value.lat, value.lng, disabled]);

  const findOnMap = async () => {
    const q = value.text.trim();
    if (q.length < 3) {
      setHint("Manzilni yozing (kamida 3 belgi)");
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const hit = await geocodeUzbekistan(q);
      if (!hit) {
        setHint("Topilmadi — xaritada belgini qo‘lda bosing");
        return;
      }

      const zoom = hit.precision === "full" ? 16 : hit.precision === "area" ? 13 : 12;
      markerRef.current?.setLatLng([hit.lat, hit.lng]);
      mapRef.current?.setView([hit.lat, hit.lng], zoom);

      // Foydalanuvchi yozgan matn saqlanadi; faqat koordinata qo‘yiladi
      onChange({
        text: q,
        lat: hit.lat,
        lng: hit.lng,
      });

      if (hit.precision === "full") {
        setHint(`Topildi: ${hit.label}`);
      } else if (hit.precision === "area") {
        setHint(
          `Tuman/shahar topildi (${hit.label}). MFY aniq emas — belgini kerak joyga sudrab qo‘ying.`,
        );
      } else {
        setHint(
          `Yaqin joy: ${hit.label}. Aniq nuqtani xaritada belgilang yoki belgini sudrang.`,
        );
      }
    } catch {
      setHint("Qidiruv xatosi — internetni tekshiring yoki qo‘lda belgilang");
    } finally {
      setBusy(false);
    }
  };

  const hasCoords = value.lat != null && value.lng != null;

  return (
    <div className="space-y-2 rounded-xl border border-teal-900/10 bg-gradient-to-b from-teal-50/40 to-background p-3 dark:from-teal-950/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-teal-700 dark:text-teal-400" />
          <Label className="text-sm font-medium">{label}</Label>
        </div>
        {!disabled && onClear && (value.text || value.lat != null) ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={onClear}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Tozalash
          </Button>
        ) : null}
      </div>

      <Textarea
        value={value.text}
        disabled={disabled}
        placeholder="Masalan: Muborak tumani, Istiqlol MFY…"
        className="min-h-[72px] resize-y bg-background/80 text-sm"
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !disabled) {
            e.preventDefault();
            void findOnMap();
          }
        }}
      />

      <div className="flex flex-wrap gap-2">
        {!disabled ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void findOnMap()}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
            Xaritadan topish
          </Button>
        ) : null}
        {hasCoords ? (
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={yandexPointUrl(value.lat!, value.lng!, value.text)} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Yandexda ochish
            </a>
          </Button>
        ) : null}
        {hasCoords ? (
          <span className="self-center text-[11px] tabular-nums text-muted-foreground">
            {value.lat!.toFixed(5)}, {value.lng!.toFixed(5)}
          </span>
        ) : (
          <span className="self-center text-[11px] text-muted-foreground">
            Qidiruv yoki xaritada nuqta tanlang
          </span>
        )}
      </div>

      {hint ? (
        <p
          className={cn(
            "text-[11px]",
            hint.startsWith("Topildi")
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400",
          )}
        >
          {hint}
        </p>
      ) : null}

      <div
        ref={mapEl}
        className={cn(
          "h-[200px] w-full overflow-hidden rounded-lg border border-border/60 bg-muted",
          disabled && "pointer-events-none opacity-80",
        )}
      />
    </div>
  );
}
