import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  CalendarRange,
  Clock,
  Download,
  History,
  KeyRound,
  MapPin,
  RefreshCw,
  Repeat,
  Search,
  SlidersHorizontal,
  UserRound,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { userRoleLabel } from "@/lib/roles";
import {
  fetchSmenaHistory,
  todayTashkentYmd,
  type SmenaHistoryItem,
  type SmenaLogAction,
} from "@/lib/smena-api";

const ACTION_META: Record<SmenaLogAction, { label: string; tone: string; icon: React.ElementType }> = {
  rotation_create: {
    label: "Rotatsiya qo‘yildi",
    tone: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
    icon: Repeat,
  },
  rotation_cancel: {
    label: "Rotatsiya bekor qilindi",
    tone: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
    icon: XCircle,
  },
  slot_shift_change: {
    label: "Rotatsiya smenasi o‘zgardi",
    tone: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    icon: Clock,
  },
  shift_change: {
    label: "Asosiy smena o‘zgardi",
    tone: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    icon: Clock,
  },
  shift_override: {
    label: "Haftalik smena almashtirildi",
    tone: "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200",
    icon: CalendarRange,
  },
  legacy_assign: {
    label: "Filial / smena biriktirildi",
    tone: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
    icon: MapPin,
  },
  legacy_day_rotation: {
    label: "Kunlik rotatsiya",
    tone: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    icon: CalendarRange,
  },
  legacy_day_rotation_cancel: {
    label: "Kunlik rotatsiya bekor qilindi",
    tone: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
    icon: XCircle,
  },
  perm_change: {
    label: "Ruxsat o‘zgartirildi",
    tone: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200",
    icon: KeyRound,
  },
};

const MODE_UZ: Record<string, string> = {
  permanent: "Doimiy",
  period: "Muddatli",
  weekly: "Haftalik",
  days: "Kunlik",
};

const WEEKDAY_SHORT = ["", "Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

function orgUz(org: string | null) {
  if (org === "pharmacist") return "Farmasevt";
  if (org === "intern") return "Stajyor";
  if (org === "manager") return "Mudir";
  if (org === "supervisor") return "Boshqaruvchi";
  return "Xodim";
}

function shiftUz(key: string | null) {
  if (!key) return "—";
  return key
    .split(",")
    .map((k) => {
      const s = k.trim();
      if (s === "one") return "1-smena";
      if (s === "two") return "2-smena";
      if (s === "three") return "3-smena";
      if (s === "one+two") return "1+2 smena";
      if (s === "two+three") return "2+3 smena";
      return s;
    })
    .join(" / ");
}

function ymdUz(ymd: string | null) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

function tashkentParts(iso: string) {
  const d = new Date(iso);
  const ymd = d.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const time = d.toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return { ymd, time };
}

function dayHeading(ymd: string) {
  const today = todayTashkentYmd();
  const y = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  if (ymd === today) return `Bugun · ${ymdUz(ymd)}`;
  if (ymd === y) return `Kecha · ${ymdUz(ymd)}`;
  return ymdUz(ymd);
}

function periodUz(it: SmenaHistoryItem) {
  if (!it.mode) return "";
  if (it.mode === "permanent") return it.validFrom ? `${ymdUz(it.validFrom)} dan` : "";
  if (it.mode === "period") return `${ymdUz(it.validFrom)} — ${it.validTo ? ymdUz(it.validTo) : "cheksiz"}`;
  if (it.mode === "weekly") return `Har hafta: ${(it.weekdays || []).map((d) => WEEKDAY_SHORT[d] || d).join(", ")}`;
  if (it.mode === "days") return `${(it.workDates || []).length} kun: ${(it.workDates || []).map(ymdUz).join(", ")}`;
  return "";
}

function shiftYmd(days: number) {
  return new Date(Date.now() - days * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Range = "today" | "7" | "30" | "all" | "custom";

export default function SmenaHistoryPanel({
  initialActorUserId,
  showPermChanges,
}: {
  initialActorUserId?: number | null;
  showPermChanges: boolean;
}) {
  const [actorUserId, setActorUserId] = useState<number | null>(initialActorUserId ?? null);
  const [action, setAction] = useState<string>("");
  const [range, setRange] = useState<Range>("30");
  const [from, setFrom] = useState(shiftYmd(29));
  const [to, setTo] = useState(todayTashkentYmd());
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");

  useEffect(() => {
    setActorUserId(initialActorUserId ?? null);
  }, [initialActorUserId]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  function applyRange(r: Range) {
    setRange(r);
    const today = todayTashkentYmd();
    if (r === "today") {
      setFrom(today);
      setTo(today);
    } else if (r === "7") {
      setFrom(shiftYmd(6));
      setTo(today);
    } else if (r === "30") {
      setFrom(shiftYmd(29));
      setTo(today);
    } else if (r === "all") {
      setFrom("");
      setTo("");
    }
  }

  const histQ = useQuery({
    queryKey: ["smena-history", actorUserId, action, from, to, qDebounced],
    queryFn: () =>
      fetchSmenaHistory({ actorUserId, action: action || null, from: from || null, to: to || null, q: qDebounced || null, limit: 1000 }),
  });

  const items = histQ.data?.items ?? [];
  const actors = histQ.data?.actors ?? [];

  const stats = useMemo(() => {
    const rot = items.filter((i) => ["rotation_create", "legacy_assign", "legacy_day_rotation"].includes(i.action)).length;
    const cancel = items.filter((i) => i.action.endsWith("cancel")).length;
    const shift = items.filter((i) => ["shift_change", "shift_override", "slot_shift_change"].includes(i.action)).length;
    const people = new Set(items.filter((i) => i.employeeId).map((i) => i.employeeId)).size;
    return { total: items.length, rot, cancel, shift, people };
  }, [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, SmenaHistoryItem[]>();
    for (const it of items) {
      const { ymd } = tashkentParts(it.createdAt);
      const arr = map.get(ymd) || [];
      arr.push(it);
      map.set(ymd, arr);
    }
    return [...map.entries()];
  }, [items]);

  const actorName = actors.find((a) => a.userId === actorUserId)?.name;

  function exportCsv() {
    const head = [
      "Sana",
      "Vaqt",
      "Amal",
      "Kim qildi",
      "Lavozimi",
      "Xodim",
      "Xodim lavozimi",
      "Qayerdan (filial)",
      "Qayerga (filial)",
      "Smena (oldin)",
      "Smena (keyin)",
      "Rejim",
      "Muddat",
      "Izoh",
      "Tavsif",
    ];
    const rows = items.map((it) => {
      const { ymd, time } = tashkentParts(it.createdAt);
      return [
        ymdUz(ymd),
        time,
        ACTION_META[it.action]?.label || it.action,
        it.actorName || "",
        userRoleLabel(it.actorRole),
        it.employeeName || "",
        it.employeeName ? orgUz(it.employeeOrgRole) : "",
        it.fromBranchLabel || "",
        it.toBranchLabel || "",
        shiftUz(it.fromShift),
        shiftUz(it.toShift),
        it.mode ? MODE_UZ[it.mode] || it.mode : "",
        periodUz(it),
        it.note || "",
        it.summary,
      ];
    });
    const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `smena-tarixi-${todayTashkentYmd()}${actorName ? `-${actorName.replace(/\s+/g, "_")}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5">
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                <History className="h-4 w-4 text-primary" />
                Rotatsiya va smena o‘zgarishlari tarixi
              </CardTitle>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Har bir amal o‘chirilmaydigan jurnalga yoziladi: <strong>kim</strong> qilgan, <strong>kimni</strong>,{" "}
                <strong>qachon</strong> (soniyasigacha, Toshkent vaqti), <strong>qaysi filialdan qaysi filialga</strong>,
                smena oldin va keyin, rejim va muddat. Koordinatorni tanlasangiz faqat uning amallari chiqadi.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => void histQ.refetch()} disabled={histQ.isFetching}>
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", histQ.isFetching && "animate-spin")} />
                Yangilash
              </Button>
              <Button size="sm" onClick={exportCsv} disabled={!items.length}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Excel (CSV)
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <UserRound className="h-3 w-3" /> Kim qilgan
              </span>
              <select
                value={actorUserId ?? ""}
                onChange={(e) => setActorUserId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">Barcha bajaruvchilar</option>
                {actors.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name || `#${a.userId}`} · {userRoleLabel(a.role)}
                    {a.total ? ` (${a.total})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <SlidersHorizontal className="h-3 w-3" /> Amal turi
              </span>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">Barcha amallar</option>
                <option value="rotation">Rotatsiyalar (qo‘yish va bekor qilish)</option>
                <option value="shift">Smena o‘zgarishlari</option>
                <option value="rotation_create">— faqat rotatsiya qo‘yilgan</option>
                <option value="rotation_cancel">— faqat rotatsiya bekor qilingan</option>
                <option value="shift_change">— faqat asosiy smena</option>
                <option value="shift_override">— faqat haftalik smena</option>
                {showPermChanges && <option value="perm_change">Koordinator ruxsatlari o‘zgarishi</option>}
              </select>
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Search className="h-3 w-3" /> Qidiruv
              </span>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Xodim, filial yoki bajaruvchi ismi…"
                className="h-9"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["today", "Bugun"],
                ["7", "7 kun"],
                ["30", "30 kun"],
                ["all", "Butun davr"],
                ["custom", "Sana tanlash"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => applyRange(k)}
                className={cn(
                  "h-8 rounded-lg border px-3 text-xs font-semibold transition",
                  range === k
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
            {range === "custom" && (
              <div className="flex items-center gap-1.5">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px] text-xs" />
                <span className="text-xs text-muted-foreground">—</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px] text-xs" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Jami amallar", stats.total, "text-foreground"],
              ["Rotatsiya qo‘yilgan", stats.rot, "text-blue-600 dark:text-blue-400"],
              ["Bekor qilingan", stats.cancel, "text-rose-600 dark:text-rose-400"],
              ["Smena o‘zgarishi", stats.shift, "text-amber-600 dark:text-amber-400"],
              ["Xodimlar", stats.people, "text-emerald-600 dark:text-emerald-400"],
            ].map(([label, val, tone]) => (
              <div key={label as string} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={cn("mt-0.5 text-xl font-bold tabular-nums", tone as string)}>{val}</p>
              </div>
            ))}
          </div>

          {actorUserId && (
            <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span>
                <strong>{actorName || `#${actorUserId}`}</strong> bajargan amallar ko‘rsatilmoqda
              </span>
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setActorUserId(null)}>
                Filtrni olib tashlash
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {histQ.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
          ))}
        </div>
      ) : histQ.isError ? (
        <Card className="border-rose-300 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/20">
          <CardContent className="py-6 text-center text-sm text-rose-700 dark:text-rose-300">
            {(histQ.error as Error).message}
          </CardContent>
        </Card>
      ) : !items.length ? (
        <Card className="border-dashed">
          <CardContent className="space-y-1 py-10 text-center">
            <History className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">Tanlangan filtr bo‘yicha yozuv yo‘q</p>
            <p className="text-xs text-muted-foreground">Sana oralig‘ini kengaytiring yoki boshqa bajaruvchini tanlang.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([ymd, dayItems]) => (
            <section key={ymd} className="space-y-2">
              <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-background/90 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground backdrop-blur">
                <CalendarRange className="h-3.5 w-3.5" />
                {dayHeading(ymd)}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal">
                  {dayItems.length} ta amal
                </span>
              </h3>
              <div className="space-y-2">
                {dayItems.map((it) => (
                  <HistoryRow key={it.id} it={it} onPickActor={setActorUserId} />
                ))}
              </div>
            </section>
          ))}
          {items.length >= 1000 && (
            <p className="text-center text-xs text-muted-foreground">
              Faqat oxirgi 1000 ta yozuv ko‘rsatildi — aniqroq filtr tanlang.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ it, onPickActor }: { it: SmenaHistoryItem; onPickActor: (id: number) => void }) {
  const meta = ACTION_META[it.action] || ACTION_META.rotation_create;
  const Icon = meta.icon;
  const { time } = tashkentParts(it.createdAt);
  const branchChanged = Boolean(it.toBranchLabel) && it.fromBranchLabel !== it.toBranchLabel;
  const shiftChanged = Boolean(it.toShift) && it.fromShift !== it.toShift;
  const period = periodUz(it);

  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs transition hover:shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex shrink-0 items-center gap-2 sm:w-24 sm:flex-col sm:items-start sm:gap-1">
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">{time}</span>
          {it.source === "legacy" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground" title="Jurnal yuritilishidan oldingi yozuv — «qayerdan» ma’lumoti saqlanmagan">
              arxiv
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", meta.tone)}>
              <Icon className="h-3 w-3" />
              {meta.label}
            </span>
            {it.mode && it.action !== "perm_change" && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                {MODE_UZ[it.mode] || it.mode}
              </span>
            )}
          </div>

          {it.employeeName && (
            <p className="text-sm">
              <span className="font-bold text-foreground">{it.employeeName}</span>
              <span className="ml-1.5 text-xs text-muted-foreground">· {orgUz(it.employeeOrgRole)}</span>
            </p>
          )}

          {it.action !== "perm_change" && (it.fromBranchLabel || it.toBranchLabel) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              {branchChanged ? (
                <>
                  <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-muted-foreground line-through decoration-muted-foreground/40">
                    {it.fromBranchLabel || "noma’lum"}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-primary" />
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                    {it.toBranchLabel}
                  </span>
                </>
              ) : (
                <span className="font-medium text-foreground">{it.toBranchLabel || it.fromBranchLabel}</span>
              )}
            </div>
          )}

          {it.action !== "perm_change" && (it.fromShift || it.toShift) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {shiftChanged && it.fromShift ? (
                <>
                  <span className="text-muted-foreground">{shiftUz(it.fromShift)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-amber-600" />
                  <span className="font-semibold text-foreground">{shiftUz(it.toShift)}</span>
                </>
              ) : (
                <span className="font-medium text-foreground">{shiftUz(it.toShift || it.fromShift)}</span>
              )}
              {period && <span className="text-muted-foreground">· {period}</span>}
            </div>
          )}

          {it.action === "perm_change" && <p className="text-xs text-foreground">{it.summary}</p>}
          {it.note && it.action !== "perm_change" && (
            <p className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs italic text-muted-foreground">Izoh: {it.note}</p>
          )}
        </div>

        <div className="shrink-0 border-t border-border/60 pt-2 text-xs sm:w-48 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Bajardi</p>
          {it.actorUserId ? (
            <button
              type="button"
              onClick={() => onPickActor(it.actorUserId!)}
              className="text-left font-semibold text-foreground hover:text-primary hover:underline"
              title="Faqat shu bajaruvchining amallarini ko‘rsatish"
            >
              {it.actorName || `#${it.actorUserId}`}
            </button>
          ) : (
            <p className="font-semibold text-muted-foreground">Noma’lum</p>
          )}
          <p className="text-[11px] text-muted-foreground">{userRoleLabel(it.actorRole)}</p>
        </div>
      </div>
    </div>
  );
}
