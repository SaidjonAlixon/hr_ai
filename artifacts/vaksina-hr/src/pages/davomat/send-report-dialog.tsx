import { useEffect, useMemo, useState } from "react";
import { Crown, Loader2, MessagesSquare, Send, UserRound, Users } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useToast } from "../../hooks/use-toast";
import {
  fetchSendReportOptions,
  sendCoordinatorReports,
  type ReportListKind,
  type ReportSendMode,
  type SendReportOptions,
} from "../../lib/davomat-api";
import { cn } from "../../lib/utils";

const LISTS: { key: ReportListKind; label: string; hint: string; tone: string }[] = [
  { key: "absent", label: "Kelmaganlar", hint: "bugun kelmagan", tone: "text-rose-600" },
  { key: "late", label: "Kechikkanlar", hint: "kech kelgan", tone: "text-amber-600" },
  { key: "present", label: "Kelganlar", hint: "o‘z vaqtida kelgan", tone: "text-emerald-600" },
];

type SendTarget = "personal" | "group" | "both";

const TARGETS: { key: SendTarget; icon: typeof Send; title: string; sub: string }[] = [
  { key: "personal", icon: UserRound, title: "Shaxsiyga", sub: "Telegram + platforma" },
  { key: "group", icon: MessagesSquare, title: "Guruhga", sub: "nik bilan belgilab" },
  { key: "both", icon: Send, title: "Ikkalasiga", sub: "shaxsiy va guruh" },
];

export function SendReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [options, setOptions] = useState<SendReportOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<ReportSendMode>("coordinators");
  const [lists, setLists] = useState<ReportListKind[]>(["absent", "late", "present"]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<SendTarget>("both");
  const toPersonal = target !== "group";
  const toGroup = target !== "personal";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    fetchSendReportOptions()
      .then((o) => {
        if (!alive) return;
        setOptions(o);
        setPicked(new Set(o.coordinators.map((c) => c.id)));
      })
      .catch((err) => toast({ title: "Ma’lumot yuklanmadi", description: (err as Error).message, variant: "destructive" }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, toast]);

  const coordinators = options?.coordinators ?? [];
  const allPicked = coordinators.length > 0 && picked.size === coordinators.length;
  const pickedStaff = useMemo(
    () => coordinators.filter((c) => picked.has(c.id)).reduce((n, c) => n + c.staff, 0),
    [coordinators, picked],
  );

  const toggleList = (key: ReportListKind) =>
    setLists((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const toggleCoord = (id: number) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const blocker = !lists.length
    ? "Kamida bitta holatni tanlang"
    : !picked.size
      ? "Kamida bitta koordinatorni tanlang"
      : target === "group" && options && !options.group
        ? "Guruh hali belgilanmagan"
        : mode === "director" && options && !options.directors.length
          ? "Faol direktor topilmadi"
          : null;

  const onSend = async () => {
    if (sending || blocker) return;
    setSending(true);
    try {
      const r = await sendCoordinatorReports({
        mode,
        lists,
        coordinatorIds: allPicked ? [] : [...picked],
        toPersonal,
        toGroup,
      });
      const who = r.mode === "director" ? `Direktor: ${r.recipients} ta` : `Koordinatorlar: ${r.coordinators} ta`;
      const lines = [
        `${who}, xodimlar: ${r.people} ta.`,
        toPersonal ? `Shaxsiy chatga: ${r.personal}.` : null,
        toGroup ? `Guruhga: ${r.groupReady ? r.group : "guruh hali belgilanmagan"}.` : null,
        r.notInBot.length ? `Botga kirmagan: ${r.notInBot.join(", ")}.` : null,
        r.failed.length ? `Xato: ${r.failed.join("; ")}.` : null,
      ].filter(Boolean);
      toast({
        title: r.people ? "Hisobot yuborildi" : "Tanlangan holatda xodim yo‘q",
        description: lines.join("\n"),
        variant: r.failed.length ? "destructive" : undefined,
      });
      if (r.people) onOpenChange(false);
    } catch (err) {
      toast({ title: "Hisobot yuborilmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const section = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Davomat hisobotini yuborish</DialogTitle>
          <DialogDescription>Shu daqiqadagi holat bo‘yicha PDF jadval tayyorlanadi.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className={section}>Kimga</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: "coordinators", icon: Users, title: "Koordinatorlarga", sub: "har biriga o‘z xodimlari" },
                  { key: "director", icon: Crown, title: "Direktorga", sub: "bitta to‘liq hisobot" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-3 text-left transition",
                    mode === m.key ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40" : "hover:bg-muted/50",
                  )}
                >
                  <m.icon className={cn("mt-0.5 h-4 w-4", mode === m.key ? "text-sky-600" : "text-muted-foreground")} />
                  <span>
                    <span className="block text-sm font-semibold">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">{m.sub}</span>
                  </span>
                </button>
              ))}
            </div>
            {mode === "director" && options ? (
              <p className="text-xs text-muted-foreground">
                {options.directors.length
                  ? options.directors.map((d) => `${d.name}${d.hasTelegram ? "" : " (botga kirmagan)"}`).join(", ")
                  : "Faol direktor topilmadi"}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className={section}>Qaysi xodimlar</div>
            <div className="grid grid-cols-3 gap-2">
              {LISTS.map((l) => (
                <label
                  key={l.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5",
                    lists.includes(l.key) ? "bg-muted/40" : "opacity-70",
                  )}
                >
                  <Checkbox checked={lists.includes(l.key)} onCheckedChange={() => toggleList(l.key)} className="mt-0.5" />
                  <span>
                    <span className={cn("block text-sm font-semibold", l.tone)}>{l.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{l.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className={section}>
                Koordinatorlar {coordinators.length ? `· ${picked.size}/${coordinators.length}` : ""}
              </div>
              {coordinators.length ? (
                <button
                  type="button"
                  className="text-xs font-medium text-sky-600 hover:underline"
                  onClick={() => setPicked(allPicked ? new Set() : new Set(coordinators.map((c) => c.id)))}
                >
                  {allPicked ? "Hammasini olib tashlash" : "Hammasini tanlash"}
                </button>
              ) : null}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
                </div>
              ) : coordinators.length ? (
                coordinators.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
                  >
                    <Checkbox checked={picked.has(c.id)} onCheckedChange={() => toggleCoord(c.id)} />
                    <span className="flex-1 truncate font-medium">{c.name}</span>
                    {!c.hasTelegram ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        botga kirmagan
                      </span>
                    ) : null}
                    <span className="w-14 text-right text-xs text-muted-foreground">{c.staff} xodim</span>
                  </label>
                ))
              ) : (
                <div className="p-3 text-sm text-muted-foreground">Koordinator topilmadi</div>
              )}
            </div>
            {options?.withoutCoordinator ? (
              <p className="text-xs text-muted-foreground">
                Koordinatori biriktirilmagan {options.withoutCoordinator} xodim hisobotga kirmaydi.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className={section}>Qayerga</div>
            <div className="grid grid-cols-3 gap-2">
              {TARGETS.map((tg) => (
                <button
                  key={tg.key}
                  type="button"
                  onClick={() => setTarget(tg.key)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition",
                    target === tg.key ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40" : "hover:bg-muted/50",
                  )}
                >
                  <tg.icon className={cn("h-4 w-4", target === tg.key ? "text-sky-600" : "text-muted-foreground")} />
                  <span className="text-sm font-semibold">{tg.title}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{tg.sub}</span>
                </button>
              ))}
            </div>
            {toGroup ? (
              <p className={cn("text-xs", options?.group ? "text-muted-foreground" : "text-amber-600")}>
                {options?.group
                  ? `Guruh: ${options.group.title}${options.group.topic ? ` · ${options.group.topic}` : ""} (har biri nik bilan belgilanadi)`
                  : "Guruh hali belgilanmagan: «Koordinatorlar» mavzusida /hisobot_guruh deb yozing"}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {blocker ?? `${picked.size} koordinator · ${pickedStaff} xodim`}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
              Bekor qilish
            </Button>
            <Button type="button" className="gap-2" disabled={sending || loading || !!blocker} onClick={() => void onSend()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Yuborish
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
