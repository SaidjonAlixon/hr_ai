import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Clock,
  History,
  Info,
  KeyRound,
  Repeat,
  Search,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { scriptIncludes } from "@/lib/script-search";
import { fetchCoordAccess, saveCoordAccess, type CoordAccessItem, type SmenaScope } from "@/lib/smena-api";

function dateTimeUz(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Filter = "all" | "granted" | "none";

export default function CoordinatorPermissionsPanel({ onOpenHistory }: { onOpenHistory: (userId: number) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const listQ = useQuery({ queryKey: ["smena-coord-access"], queryFn: fetchCoordAccess });
  const items = listQ.data?.items ?? [];

  const save = useMutation({
    mutationFn: (v: { item: CoordAccessItem; canRotate: boolean; canShift: boolean; scope: SmenaScope }) =>
      saveCoordAccess(v.item.userId, { canRotate: v.canRotate, canShift: v.canShift, scope: v.scope }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["smena-coord-access"] });
      const prev = qc.getQueryData<{ items: CoordAccessItem[] }>(["smena-coord-access"]);
      qc.setQueryData<{ items: CoordAccessItem[] }>(["smena-coord-access"], (old) =>
        old
          ? {
              items: old.items.map((i) =>
                i.userId === v.item.userId ? { ...i, canRotate: v.canRotate, canShift: v.canShift, scope: v.scope } : i,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["smena-coord-access"], ctx.prev);
      toast({ title: "Ruxsat saqlanmadi", description: err.message, variant: "destructive" });
    },
    onSuccess: (_r, v) => {
      const parts = [v.canRotate && "rotatsiya", v.canShift && "smena o‘zgartirish"].filter(Boolean);
      toast({
        title: parts.length ? `${v.item.fullName}: ruxsat yangilandi` : `${v.item.fullName}: ruxsatlar olib qo‘yildi`,
        description: parts.length
          ? `${parts.join(" va ")} · ${v.scope === "all" ? "barcha filiallar" : "faqat o‘z filiallari"}. Koordinatorga bildirishnoma yuborildi.`
          : "«Smena va filial» bo‘limi unga endi ko‘rinmaydi.",
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["smena-coord-access"] });
    },
  });

  const stats = useMemo(
    () => ({
      total: items.length,
      rotate: items.filter((i) => i.canRotate).length,
      shift: items.filter((i) => i.canShift).length,
      none: items.filter((i) => !i.canRotate && !i.canShift).length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    const s = q.trim();
    return items.filter((i) => {
      if (filter === "granted" && !i.canRotate && !i.canShift) return false;
      if (filter === "none" && (i.canRotate || i.canShift)) return false;
      if (!s) return true;
      return scriptIncludes(`${i.fullName} ${i.branchNames.join(" ")}`, s);
    });
  }, [items, q, filter]);

  function update(item: CoordAccessItem, patch: Partial<{ canRotate: boolean; canShift: boolean; scope: SmenaScope }>) {
    save.mutate({
      item,
      canRotate: patch.canRotate ?? item.canRotate,
      canShift: patch.canShift ?? item.canShift,
      scope: patch.scope ?? item.scope,
    });
  }

  return (
    <div className="space-y-5">
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <KeyRound className="h-4 w-4 text-primary" />
            Koordinatorlarga ruxsat berish
          </CardTitle>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Har bir koordinatorga ikkita ruxsat <strong>alohida</strong> beriladi. Ruxsati bo‘lmagan koordinatorga
            «Smena va filial» bo‘limi menyuda <strong>umuman ko‘rinmaydi</strong>, to‘g‘ridan-to‘g‘ri havola orqali ham
            ochilmaydi. Har bir o‘zgarish tarixga yoziladi va koordinatorga bildirishnoma boradi.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
            <div className="flex gap-2.5 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="text-xs">
                <p className="font-bold text-blue-950 dark:text-blue-100">Rotatsiya qilish</p>
                <p className="mt-0.5 leading-relaxed text-blue-900/80 dark:text-blue-200/80">
                  Farmasevt, stajyor va mudirni boshqa filialga muddatli, haftalik yoki kunlik o‘tkazish (farmasevt va
                  stajyorni doimiy ham). Rotatsiyani bekor qilish ham shu ruxsatga kiradi.
                </p>
              </div>
            </div>
            <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-xs">
                <p className="font-bold text-amber-950 dark:text-amber-100">Smena o‘zgartirish</p>
                <p className="mt-0.5 leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                  Filialni o‘zgartirmasdan xodimning asosiy smenasini yoki haftaning ayrim kunlaridagi smenasini
                  almashtirish.
                </p>
              </div>
            </div>
            <div className="flex gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="text-xs">
                <p className="font-bold text-emerald-950 dark:text-emerald-100">Doira</p>
                <p className="mt-0.5 leading-relaxed text-emerald-900/80 dark:text-emerald-200/80">
                  <strong>O‘z xodimlari</strong> — faqat unga biriktirilgan filiallardagi xodimlar.{" "}
                  <strong>Barcha xodimlar</strong> — butun tarmoqdagi istalgan farmasevt, stajyor va mudir.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Koordinatorlar", stats.total, "text-foreground"],
              ["Rotatsiya ruxsati", stats.rotate, "text-blue-600 dark:text-blue-400"],
              ["Smena ruxsati", stats.shift, "text-amber-600 dark:text-amber-400"],
              ["Ruxsatsiz", stats.none, "text-muted-foreground"],
            ].map(([label, val, tone]) => (
              <div key={label as string} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={cn("mt-0.5 text-xl font-bold tabular-nums", tone as string)}>{val}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Koordinator yoki filial nomi…" className="pl-9" />
            </div>
            <div className="flex rounded-xl border border-border bg-muted/40 p-1">
              {(
                [
                  ["all", "Hammasi"],
                  ["granted", "Ruxsati bor"],
                  ["none", "Ruxsatsiz"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    filter === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {listQ.isLoading ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl border border-border bg-muted/40" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card className="border-rose-300 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/20">
          <CardContent className="py-6 text-center text-sm text-rose-700 dark:text-rose-300">
            {(listQ.error as Error).message}
          </CardContent>
        </Card>
      ) : !visible.length ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {items.length ? "Filtrga mos koordinator topilmadi." : "Tizimda «koordinator» rolidagi foydalanuvchi yo‘q."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visible.map((c) => (
            <CoordinatorCard
              key={c.userId}
              c={c}
              busy={save.isPending && save.variables?.item.userId === c.userId}
              onChange={(patch) => update(c, patch)}
              onOpenHistory={() => onOpenHistory(c.userId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CoordinatorCard({
  c,
  busy,
  onChange,
  onOpenHistory,
}: {
  c: CoordAccessItem;
  busy: boolean;
  onChange: (patch: Partial<{ canRotate: boolean; canShift: boolean; scope: SmenaScope }>) => void;
  onOpenHistory: () => void;
}) {
  const granted = c.canRotate || c.canShift;
  const [showBranches, setShowBranches] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-4 shadow-xs transition",
        granted ? "border-emerald-300/70 dark:border-emerald-800/60" : "border-border",
        busy && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
              granted ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
            )}
          >
            {c.fullName.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-bold text-foreground">{c.fullName}</p>
            <p className="text-xs text-muted-foreground">
              {c.branchCount} filial · {c.staffCount} farmasevt/stajyor · {c.mudirCount} mudir
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
            granted
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          {granted ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
          {granted ? "Bo‘lim ochiq" : "Bo‘lim yopiq"}
        </span>
      </div>

      {!c.hasCard && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50/70 p-2 text-[11px] text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Xodim kartochkasi yo‘q — «o‘z xodimlari» doirasida unga hech kim ko‘rinmaydi. Kerak bo‘lsa «Barcha xodimlar»
          ni tanlang.
        </div>
      )}

      <div className="mt-4 space-y-2">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Repeat className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Rotatsiya qilish
          </span>
          <Switch checked={c.canRotate} disabled={busy} onCheckedChange={(v) => onChange({ canRotate: v })} />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Smena o‘zgartirish
          </span>
          <Switch checked={c.canShift} disabled={busy} onCheckedChange={(v) => onChange({ canShift: v })} />
        </label>
        <div className={cn("rounded-xl border border-border px-3 py-2.5", !granted && "opacity-50")}>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Kimlar ustidan
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["own", "O‘z xodimlari"],
                ["all", "Barcha xodimlar"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                disabled={!granted || busy}
                onClick={() => onChange({ scope: k })}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-xs font-semibold transition",
                  c.scope === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {c.branchNames.length > 0 && (
        <div className="mt-3 text-[11px]">
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setShowBranches((v) => !v)}>
            {showBranches ? "Filiallarni yashirish" : `Biriktirilgan filiallar (${c.branchCount})`}
          </button>
          {showBranches && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {c.branchNames.map((b) => (
                <span key={b} className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto pt-4">
      <div className="flex flex-wrap items-end justify-between gap-2 border-t border-border/60 pt-3">
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <p>
            Amallar: <strong className="text-foreground">{c.actionsTotal}</strong> jami ·{" "}
            <strong className="text-foreground">{c.actions30d}</strong> oxirgi 30 kunda
          </p>
          <p>Oxirgi amal: {dateTimeUz(c.lastActionAt)}</p>
          {c.grantedByName && granted && (
            <p className="flex items-center gap-1">
              <Info className="h-3 w-3" />
              Ruxsat bergan: {c.grantedByName}, {dateTimeUz(c.grantedAt)}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onOpenHistory}>
          <History className="mr-1.5 h-3.5 w-3.5" />
          Tarixini ko‘rish
        </Button>
      </div>
      </div>
    </div>
  );
}
