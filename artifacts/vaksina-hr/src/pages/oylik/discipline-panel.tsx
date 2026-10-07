import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarX2,
  ChevronRight,
  Clock3,
  FileDown,
  Loader2,
  Lock,
  LockOpen,
  MapPin,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  downloadDisciplinePdf,
  useClearDisciplineLock,
  useDisciplineLockDetails,
  useDisciplineSummary,
  useSetJarimaEnabled,
  type DisciplineLockRow,
} from "@/lib/discipline-api";

function fmtYmd(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("uz-UZ", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", hour12: false });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const kindText = (kind: string) => (kind === "late" ? "kech keldi" : "kelmadi");

const LEVELS = [
  { key: "level3", label: "3 marta", note: "Kunlikning 30%", tone: "text-amber-700 bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30" },
  { key: "level4", label: "4 marta", note: "1 kunlik 100%", tone: "text-orange-700 bg-orange-50 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-200 dark:ring-orange-500/30" },
  { key: "level5", label: "5+ marta", note: "Oylik 50% · blok", tone: "text-red-700 bg-red-50 ring-red-200 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/30" },
] as const;

type Tab = "blocked" | "cleared";

/** Admin/HR: jarima eskalatsiyasi, bugungi bloklar va yig‘ma PDF */
export function DisciplinePanel({ month }: { month: string }) {
  const { toast } = useToast();
  const summary = useDisciplineSummary(month, true);
  const clear = useClearDisciplineLock();
  const setJarima = useSetJarimaEnabled();
  const [downloading, setDownloading] = useState(false);
  const [tab, setTab] = useState<Tab>("blocked");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const data = summary.data;

  const activeLocks = useMemo(() => data?.locks.filter((l) => !l.clearedAt) ?? [], [data]);
  const clearedLocks = useMemo(
    () =>
      [...(data?.locks.filter((l) => l.clearedAt) ?? [])].sort(
        (a, b) => new Date(b.clearedAt!).getTime() - new Date(a.clearedAt!).getTime(),
      ),
    [data],
  );
  const list = useMemo(() => {
    const base = tab === "blocked" ? activeLocks : clearedLocks;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((l) => `${l.fullName} ${l.branch ?? ""} ${l.position ?? ""}`.toLowerCase().includes(q));
  }, [tab, activeLocks, clearedLocks, query]);

  const pdf = async () => {
    setDownloading(true);
    try {
      await downloadDisciplinePdf(month);
    } catch (e) {
      toast({ title: "Intizom PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const unlock = (id: number, name: string, ask = true) => {
    if (ask && !window.confirm(`${name} — bugun platformaga kirishga ruxsat berilsinmi?`)) return;
    clear.mutate(id, {
      onSuccess: () =>
        toast({
          title: "Ruxsat berildi",
          description: `${name} bugun platformadan foydalana oladi. «Ruxsat berilganlar» bo‘limiga o‘tdi.`,
        }),
      onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
    });
  };

  const noLocks = !activeLocks.length && !clearedLocks.length;
  const jarimaOn = data?.jarima?.enabled ?? true;

  const toggleJarima = (next: boolean) => {
    const ask = next
      ? "Jarima tizimi yoqilsinmi? Bugundan boshlab kechikish va kelmasliklar uchun jarima, tushuntirish xati va blok hammaga ishlaydi."
      : "Jarima tizimi o‘chirilsinmi? Hech kimga jarima yozilmaydi, tushuntirish xati so‘ralmaydi va hech kim bloklanmaydi. Davomat odatdagidek ishlayveradi.";
    if (!window.confirm(ask)) return;
    setJarima.mutate(next, {
      onSuccess: (s) =>
        toast({
          title: s.enabled ? "Jarima yoqildi" : "Jarima o‘chirildi",
          description: s.enabled
            ? "Jarima, tushuntirish xati va bloklar hammaga ishlaydi."
            : "Jarima, tushuntirish xati va bloklar hech kimda ishlamaydi.",
        }),
      onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-red-50 via-white to-white px-4 py-3 dark:border-white/5 dark:from-red-500/10 dark:via-slate-900 dark:to-slate-900">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-sm shadow-red-600/30">
            <ShieldAlert className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Intizom nazorati</h2>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              3-martadan PDF ogohlantirish · 5-martada o‘sha kuni platforma yopiladi
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs font-bold ring-1 transition",
              jarimaOn
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30"
                : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
            )}
          >
            {setJarima.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Jarima {jarimaOn ? "yoqiq" : "o‘chiq"}
            <Switch
              checked={jarimaOn}
              disabled={summary.isLoading || setJarima.isPending}
              onCheckedChange={toggleJarima}
              className="data-[state=checked]:bg-emerald-600"
              aria-label="Jarima tizimini yoqish yoki o‘chirish"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
            disabled={downloading}
            onClick={() => void pdf()}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Intizom PDF
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {!jarimaOn ? (
          <div className="flex items-start gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-xs leading-relaxed text-slate-700 dark:bg-white/5 dark:text-slate-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span>
              <b>Jarima tizimi o‘chiq.</b> Hech kimga jarima yozilmaydi, tushuntirish xati so‘ralmaydi va hech kim bloklanmaydi —
              kech kelsa ham, kelmasa ham davomat odatdagidek ishlaydi.
              {data?.jarima?.updatedByName ? ` O‘chirgan: ${data.jarima.updatedByName}.` : ""}
            </span>
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          {LEVELS.map((lv) => (
            <div key={lv.key} className={cn("flex items-center justify-between gap-2 rounded-xl px-3 py-2 ring-1", lv.tone)}>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide">{lv.label}</p>
                <p className="truncate text-[10px] opacity-75">{lv.note}</p>
              </div>
              <span className="text-xl font-extrabold tabular-nums">{summary.isLoading ? "…" : data?.[lv.key] ?? 0}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-white/5">
            <TabButton active={tab === "blocked"} onClick={() => setTab("blocked")} tone="red" count={activeLocks.length}>
              <Lock className="h-3.5 w-3.5" /> Bloklangan
            </TabButton>
            <TabButton active={tab === "cleared"} onClick={() => setTab("cleared")} tone="green" count={clearedLocks.length}>
              <LockOpen className="h-3.5 w-3.5" /> Ruxsat berilgan
            </TabButton>
          </div>
          <label className="relative ml-auto min-w-[10rem] flex-1 sm:max-w-[16rem]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ism yoki filial…"
              className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-red-500/20"
            />
          </label>
        </div>

        {summary.isError ? (
          <p className="text-xs text-red-600">{(summary.error as Error).message}</p>
        ) : noLocks ? (
          <EmptyState icon={ShieldCheck} text="Bugun bloklangan xodim yo‘q." />
        ) : !list.length ? (
          <EmptyState
            icon={tab === "blocked" ? ShieldCheck : LockOpen}
            text={
              query.trim()
                ? "Qidiruv bo‘yicha hech kim topilmadi."
                : tab === "blocked"
                  ? "Hozir bloklangan xodim qolmadi — barchasiga ruxsat berilgan."
                  : "Hali hech kimga ruxsat berilmagan."
            }
          />
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
            {list.map((l) => (
              <LockRow
                key={l.id}
                lock={l}
                busy={clear.isPending && clear.variables === l.id}
                onOpen={() => setOpenId(l.id)}
                onUnlock={() => unlock(l.id, l.fullName)}
              />
            ))}
          </ul>
        )}
      </div>

      <LockDetailsDialog
        id={openId}
        onClose={() => setOpenId(null)}
        busy={clear.isPending}
        onUnlock={(id, name) => unlock(id, name, false)}
      />
    </section>
  );
}

function TabButton({
  active,
  onClick,
  tone,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone: "red" | "green";
  count: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white",
      )}
    >
      {children}
      <span
        className={cn(
          "min-w-[1.25rem] rounded-full px-1.5 text-[10px] font-bold tabular-nums",
          tone === "red"
            ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof ShieldCheck; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
      <Icon className="h-4 w-4 shrink-0 text-emerald-600" />
      {text}
    </div>
  );
}

function LockRow({
  lock: l,
  busy,
  onOpen,
  onUnlock,
}: {
  lock: DisciplineLockRow;
  busy: boolean;
  onOpen: () => void;
  onUnlock: () => void;
}) {
  const cleared = Boolean(l.clearedAt);
  const sub = [l.position, l.branch].filter(Boolean).join(" · ");
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition hover:shadow-sm",
          cleared
            ? "border-emerald-100 bg-emerald-50/40 hover:border-emerald-200 dark:border-emerald-500/15 dark:bg-emerald-500/5"
            : "border-slate-200 bg-white hover:border-red-200 dark:border-white/10 dark:bg-slate-900 dark:hover:border-red-500/30",
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            cleared
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
              : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
          )}
        >
          {initials(l.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{l.fullName}</p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            <span className={cn("font-semibold", cleared ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300")}>
              {l.strikeN}-marta
            </span>{" "}
            · {kindText(l.kind)} {fmtYmd(l.eventDate)}
            {sub ? ` · ${sub}` : ""}
          </p>
        </div>
        {cleared ? (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 sm:inline-flex dark:bg-emerald-500/15 dark:text-emerald-300">
            <LockOpen className="h-3 w-3" />
            {l.clearedByName || "Ochildi"}
            {fmtTime(l.clearedAt) ? ` · ${fmtTime(l.clearedAt)}` : ""}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onUnlock();
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
            Ruxsat berish
          </Button>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>
    </li>
  );
}

function LockDetailsDialog({
  id,
  onClose,
  busy,
  onUnlock,
}: {
  id: number | null;
  onClose: () => void;
  busy: boolean;
  onUnlock: (id: number, name: string) => void;
}) {
  const q = useDisciplineLockDetails(id);
  const d = q.data;
  const cleared = Boolean(d?.clearedAt);
  const sub = d ? [d.position, d.branch, d.shift].filter(Boolean).join(" · ") : "";

  return (
    <Dialog open={id != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-slate-100 px-5 pb-3 pt-5 text-left dark:border-white/10">
          <DialogTitle className="flex items-center gap-2 pr-6 text-base">
            {d ? d.fullName : "Asoslar"}
            {d ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-bold",
                  cleared
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
                    : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
                )}
              >
                {d.strikeN}-marta
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {d ? sub || d.monthLabel : "Bloklanish sabablari"}
            {d?.coordinator ? ` · koord.: ${d.coordinator}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(88vh-9rem)] space-y-3 overflow-y-auto px-5 py-4">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : q.isError ? (
            <p className="text-sm text-red-600">{(q.error as Error).message}</p>
          ) : d ? (
            <>
              <div
                className={cn(
                  "flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed",
                  cleared
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200",
                )}
              >
                {cleared ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>
                  {cleared ? (
                    <>
                      Ruxsat berilgan — bugun platformadan foydalanmoqda.{" "}
                      <b>{d.clearedByName || "Admin"}</b>
                      {fmtTime(d.clearedAt) ? `, ${fmtTime(d.clearedAt)}` : ""}.
                    </>
                  ) : (
                    <>
                      {d.monthLabel}da {d.strikeN}-marta buzilish ({kindText(d.triggerKind)} {fmtYmd(d.triggerDate)}) — bugun
                      platforma yopiq.
                    </>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Jami" value={d.events.length} />
                <Stat label="Kech keldi" value={d.late} icon={Clock3} />
                <Stat label="Kelmadi" value={d.absent} icon={CalendarX2} />
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Asoslar — {d.monthLabel}</p>
                <ol className="space-y-1.5">
                  {d.events.map((e) => (
                    <li
                      key={e.n}
                      className={cn(
                        "flex gap-3 rounded-xl border px-3 py-2",
                        e.trigger
                          ? "border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10"
                          : "border-slate-200 dark:border-white/10",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                          e.trigger ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
                        )}
                      >
                        {e.n}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-slate-900 dark:text-white">
                          {fmtYmd(e.date)}
                          <span className="font-normal text-slate-500">{e.weekday}</span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-px text-[10px] font-bold",
                              e.kind === "late"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
                                : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
                            )}
                          >
                            {e.kindLabel}
                            {e.checkIn ? ` · ${e.checkIn}` : ""}
                          </span>
                          {e.trigger ? <span className="text-[10px] font-bold text-red-600">Blokga sabab</span> : null}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                          {e.branch ? (
                            <span className="inline-flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" />
                              {e.branch}
                            </span>
                          ) : null}
                          {e.shift ? <span>{e.shift}</span> : null}
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">{e.penalty}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <details className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-white/5 dark:text-slate-300">
                <summary className="cursor-pointer font-semibold">Qoidalar</summary>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {d.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : null}
        </div>

        {d && !cleared ? (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-white/10">
            <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={onClose}>
              Yopish
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy}
              onClick={() => onUnlock(d.id, d.fullName)}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
              Ruxsat berish
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon?: typeof Clock3 }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2 dark:bg-white/5">
      <p className="text-lg font-extrabold tabular-nums text-slate-900 dark:text-white">{value}</p>
      <p className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </p>
    </div>
  );
}
