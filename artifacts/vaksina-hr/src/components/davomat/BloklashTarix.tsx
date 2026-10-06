import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Fingerprint, History, Loader2, MapPin, ScanFace, Search, ShieldCheck, Unlock, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { userRoleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  fetchAccessAudit,
  type AccessAuditAction,
  type AccessAuditEditor,
  type AccessAuditItem,
  type AccessAuditResponse,
} from "@/lib/davomat-api";

const TZ = "Asia/Tashkent";
const PAGE = 50;
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

type Tone = "good" | "bad" | "neutral";

const FIELDS: Record<string, { label: string; fmt: (v: unknown) => string; tone: (v: unknown) => Tone }> = {
  face: { label: "Face ID", fmt: (v) => (v ? "Ruxsat bor" : "Yopiq"), tone: (v) => (v ? "good" : "bad") },
  qr: { label: "QR kod", fmt: (v) => (v ? "Ruxsat bor" : "Yopiq"), tone: (v) => (v ? "good" : "bad") },
  finger: { label: "Barmoq izi", fmt: (v) => (v ? "Yoqilgan" : "Yopiq"), tone: (v) => (v ? "good" : "neutral") },
  enrolled: { label: "Barmoq izi ro‘yxati", fmt: (v) => (v ? "Ro‘yxatda" : "Yo‘q"), tone: (v) => (v ? "good" : "bad") },
  device: { label: "Qurilma", fmt: (v) => String(v || "—"), tone: () => "neutral" },
  enabled: { label: "Yashil hudud tasdiqi", fmt: (v) => (v ? "Yoqilgan" : "O‘chiq"), tone: () => "neutral" },
  intervalHours: { label: "Har necha soatda", fmt: (v) => `${v} soat`, tone: () => "neutral" },
  windowMinutes: { label: "Tasdiqlash oynasi", fmt: (v) => `${v} daqiqa`, tone: () => "neutral" },
  method: { label: "Tasdiq usuli", fmt: (v) => (v === "QR" ? "QR kod" : "Face ID"), tone: () => "neutral" },
  blocked: { label: "Bugungi blok", fmt: (v) => (v ? "Bloklangan" : "Ochildi"), tone: (v) => (v ? "bad" : "good") },
};

const FIELD_ORDER = ["face", "qr", "finger", "enrolled", "device", "enabled", "method", "intervalHours", "windowMinutes", "blocked"];

const ACTION_META: Record<AccessAuditAction, { label: string; icon: React.ElementType; cls: string }> = {
  method: { label: "Davomat usuli", icon: ScanFace, cls: "bg-sky-50 text-sky-700 ring-sky-100" },
  zone: { label: "Hudud tasdiqi", icon: MapPin, cls: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  zone_unlock: { label: "Blokdan chiqarildi", icon: Unlock, cls: "bg-amber-50 text-amber-700 ring-amber-100" },
  finger_enroll: { label: "Barmoq izi ro‘yxatdan o‘tdi", icon: Fingerprint, cls: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  finger_reset: { label: "Barmoq izi o‘chirildi", icon: Fingerprint, cls: "bg-rose-50 text-rose-700 ring-rose-100" },
};

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

function dayLabel(key: string) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const [y, m, d] = key.split("-").map(Number);
  const text = `${d}-${MONTHS[m - 1]}, ${y}`;
  if (key === today) return `Bugun · ${text}`;
  if (key === yesterday) return `Kecha · ${text}`;
  return text;
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dateTimeOf(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function changesOf(item: AccessAuditItem) {
  const before = item.before ?? {};
  const after = item.after ?? {};
  return FIELD_ORDER.filter((key) => key in after && before[key] !== after[key] && FIELDS[key]).map((key) => ({
    key,
    label: FIELDS[key].label,
    from: key in before ? FIELDS[key].fmt(before[key]) : "—",
    to: FIELDS[key].fmt(after[key]),
    tone: FIELDS[key].tone(after[key]),
  }));
}

function outcomeOf(item: AccessAuditItem): { text: string; tone: Tone } | null {
  const after = item.after ?? {};
  if (item.action === "finger_enroll") {
    return { text: "Natija: faqat shu qurilmada barmoq izi bilan davomat qiladi", tone: "good" };
  }
  if (item.action === "finger_reset") {
    return { text: "Natija: xodim yangi qurilmadan qayta ro‘yxatdan o‘tkazadi", tone: "neutral" };
  }
  if (item.action === "method") {
    const before = item.before ?? {};
    if ("finger" in after && before.finger !== after.finger && before.face === after.face && before.qr === after.qr) {
      return after.finger
        ? { text: "Natija: davomat oynasida «Barmoq izi» paydo bo‘ladi", tone: "good" }
        : { text: "Natija: «Barmoq izi» xodimga ko‘rinmaydi", tone: "neutral" };
    }
    if (after.face === false && after.qr === false) {
      return after.finger
        ? { text: "Natija: faqat barmoq izi bilan davomat qiladi", tone: "neutral" }
        : { text: "Natija: davomat qila olmaydi", tone: "bad" };
    }
    if (after.face && after.qr) return { text: "Natija: Face ID va QR bilan davomat qila oladi", tone: "good" };
    if (after.face) return { text: "Natija: faqat Face ID bilan davomat qiladi", tone: "neutral" };
    return { text: "Natija: faqat QR bilan davomat qiladi", tone: "neutral" };
  }
  if (item.action === "zone") {
    if (!after.enabled) return { text: "Natija: hudud tasdiqi so‘ralmaydi", tone: "neutral" };
    const method = after.method === "QR" ? "QR kod" : "Face ID";
    return {
      text: `Natija: har ${after.intervalHours} soatda ${after.windowMinutes} daqiqa ichida ${method} bilan tasdiqlaydi`,
      tone: "neutral",
    };
  }
  return { text: "Natija: bugun Keldim va Ketdim yana ochiq", tone: "good" };
}

const TONE_CLS: Record<Tone, string> = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200",
  neutral: "bg-sky-50 text-sky-700 ring-sky-200",
};

export default function BloklashTarix() {
  const { toast } = useToast();
  const [data, setData] = useState<AccessAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [actorUserId, setActorUserId] = useState<number | null>(null);
  const [action, setAction] = useState<AccessAuditAction | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const filters = useMemo(
    () => ({ q: qDebounced, actorUserId, action, from, to }),
    [qDebounced, actorUserId, action, from, to],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAccessAudit({ ...filters, limit: PAGE, offset: 0 }));
    } catch (err) {
      toast({ title: "Tarix yuklanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [filters, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!data) return;
    setLoadingMore(true);
    try {
      const next = await fetchAccessAudit({ ...filters, limit: PAGE, offset: data.items.length });
      setData({ ...next, items: [...data.items, ...next.items] });
    } catch (err) {
      toast({ title: "Yuklanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoadingMore(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, AccessAuditItem[]>();
    for (const item of data?.items ?? []) {
      const key = dayKey(item.createdAt);
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [data]);

  const hasFilters = Boolean(q || actorUserId || action || from || to);
  const clearFilters = () => {
    setQ("");
    setActorUserId(null);
    setAction("");
    setFrom("");
    setTo("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl border border-[#0b3a5c]/15 bg-[#0b3a5c]/[0.04] px-4 py-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0b3a5c]" />
        <div className="text-sm text-slate-600">
          <p className="font-semibold text-[#0f2744]">Bloklash oynasi tarixi — faqat bosh admin ko‘radi</p>
          <p className="mt-0.5">
            Face ID, QR, yashil hudud tasdiqi va blokdan chiqarish bo‘yicha har bir o‘zgarish shu yerga yoziladi:
            kim, qachon, qaysi xodimga, nima edi va nima bo‘ldi. Yozuvlarni hech kim o‘zgartira yoki o‘chira olmaydi.
          </p>
        </div>
      </div>

      <EditorsCard editors={data?.editors ?? []} loading={loading && !data} onPick={(id) => setActorUserId(id)} activeId={actorUserId} />

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-2 md:grid-cols-[1fr_200px_190px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim, filial yoki o‘zgartirgan odam" className="h-10 pl-9" />
          </div>
          <select
            value={actorUserId ?? ""}
            onChange={(e) => setActorUserId(e.target.value ? Number(e.target.value) : null)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="">Kim o‘zgartirdi — hammasi</option>
            {(data?.actors ?? []).filter((a) => a.userId != null).map((a) => (
              <option key={a.userId!} value={a.userId!}>{a.name} · {a.changes}</option>
            ))}
          </select>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as AccessAuditAction | "")}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="">Barcha amallar</option>
            <option value="method">Face ID / QR</option>
            <option value="zone">Hudud tasdiqi</option>
            <option value="zone_unlock">Blokdan chiqarish</option>
            <option value="finger_enroll">Barmoq izi ro‘yxati</option>
            <option value="finger_reset">Barmoq izi o‘chirilishi</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 text-slate-500">
            Dan
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[160px]" />
          </label>
          <label className="flex items-center gap-2 text-slate-500">
            Gacha
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-[160px]" />
          </label>
          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" className="h-9 text-slate-600" onClick={clearFilters}>
              <X className="mr-1 h-4 w-4" /> Filtrni tozalash
            </Button>
          ) : null}
          <span className="ml-auto text-xs text-slate-500">
            {data ? `${data.total} ta o‘zgarish` : ""}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="flex items-center gap-2 px-4 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </p>
        ) : !groups.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <History className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">
              {hasFilters ? "Bu filtr bo‘yicha o‘zgarish topilmadi" : "Hozircha o‘zgarish yo‘q"}
            </p>
            <p className="max-w-sm text-xs text-slate-400">
              Bloklash oynasida kimdir Face ID, QR yoki hudud tasdiqini o‘zgartirsa — shu zahoti shu yerda chiqadi.
            </p>
          </div>
        ) : (
          groups.map(([key, items]) => (
            <section key={key}>
              <h3 className="sticky top-0 z-[1] border-b border-slate-100 bg-slate-50/95 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
                {dayLabel(key)} <span className="font-normal normal-case text-slate-400">· {items.length} ta</span>
              </h3>
              <ul>
                {items.map((item) => (
                  <AuditRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))
        )}
        {data && data.items.length < data.total ? (
          <div className="border-t border-slate-100 px-4 py-3 text-center">
            <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Yana ko‘rsatish ({data.total - data.items.length} qoldi)
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AuditRow({ item }: { item: AccessAuditItem }) {
  const meta = ACTION_META[item.action] ?? ACTION_META.method;
  const Icon = meta.icon;
  const changes = changesOf(item);
  const outcome = outcomeOf(item);
  const role = item.actorRole ? userRoleLabel(item.actorRole) : "";
  return (
    <li className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[84px_1fr]">
      <div className="flex items-center gap-2 sm:block">
        <p className="font-semibold tabular-nums text-[#0f2744]">{timeOf(item.createdAt)}</p>
        <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", meta.cls)}>
          <Icon className="h-3 w-3" /> {meta.label}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-semibold text-[#0f2744]">{item.targetName}</span>
          {item.targetPosition || item.targetLocation ? (
            <span className="text-xs text-slate-500">
              {" · "}
              {[item.targetPosition, item.targetLocation].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </p>

        <div className="mt-1.5 flex flex-col gap-1">
          {changes.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="w-[150px] shrink-0 text-slate-500">{c.label}</span>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-500 line-through decoration-slate-400">{c.from}</span>
              <span className="text-slate-400">→</span>
              <span className={cn("rounded-md px-1.5 py-0.5 font-semibold ring-1", TONE_CLS[c.tone])}>{c.to}</span>
            </div>
          ))}
        </div>

        {outcome ? (
          <p className={cn("mt-1.5 text-xs font-medium", outcome.tone === "bad" ? "text-rose-700" : outcome.tone === "good" ? "text-emerald-700" : "text-slate-600")}>
            {outcome.text}
          </p>
        ) : null}

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          <span>
            O‘zgartirdi: <span className="font-semibold text-slate-700">{item.actorName}</span>
            {role ? ` (${role})` : ""}
            {item.actorLogin ? <span className="text-slate-400"> · {item.actorLogin}</span> : null}
          </span>
          {item.batchSize && item.batchSize > 1 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">
              <Users className="h-3 w-3" /> Ommaviy: {item.batchSize} xodim birga
            </span>
          ) : null}
          {item.ipAddress ? <span className="text-slate-400">IP {item.ipAddress}</span> : null}
        </p>
      </div>
    </li>
  );
}

function EditorsCard({
  editors,
  loading,
  activeId,
  onPick,
}: {
  editors: AccessAuditEditor[];
  loading: boolean;
  activeId: number | null;
  onPick: (id: number | null) => void;
}) {
  const active = editors.filter((e) => e.status === "active" || e.status === "on_leave");
  const inactive = editors.filter((e) => !(e.status === "active" || e.status === "on_leave"));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[#0f2744]">Bu oynada o‘zgartirish huquqi borlar</p>
          <p className="text-xs text-slate-500">
            Admin, asoschi va direktor rollari. Ismni bossangiz — faqat o‘sha odamning o‘zgarishlari chiqadi.
          </p>
        </div>
        <span className="text-xs text-slate-500">{active.length} kishi</span>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Kim</th>
                <th className="px-4 py-2">Rol</th>
                <th className="px-4 py-2">Login</th>
                <th className="px-4 py-2 text-right">O‘zgarishlar</th>
                <th className="px-4 py-2">Oxirgi o‘zgarish</th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...inactive].map((e) => {
                const isActive = activeId === e.id;
                const off = !(e.status === "active" || e.status === "on_leave");
                return (
                  <tr
                    key={e.id}
                    onClick={() => onPick(isActive ? null : e.id)}
                    className={cn(
                      "cursor-pointer border-t border-slate-100 hover:bg-slate-50",
                      isActive && "bg-[#0b3a5c]/5",
                      off && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-2">
                      <span className="font-semibold text-[#0f2744]">{e.fullName}</span>
                      {e.isBoshAdmin ? (
                        <span className="ml-2 rounded-full bg-[#0b3a5c] px-2 py-0.5 text-[10px] font-semibold text-white">Bosh admin</span>
                      ) : null}
                      {off ? <span className="ml-2 text-[11px] text-slate-500">(faol emas)</span> : null}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{userRoleLabel(e.role)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{e.login}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-[#0f2744]">{e.changes}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{e.lastAt ? dateTimeOf(e.lastAt) : "O‘zgartirmagan"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        <History className="h-3 w-3" /> Tarix yangi o‘zgarishlardan boshlab yoziladi — oldingi o‘zgarishlar saqlanmagan.
      </p>
    </div>
  );
}
