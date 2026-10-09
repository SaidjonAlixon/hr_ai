import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, Crown, Download, Loader2, LogIn, LogOut, MessageSquare, Timer, Trash2, UserX, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CallAvatar } from "@/components/calls/CallLayer";
import {
  conferenceApi,
  formatDate,
  formatSpan,
  hhmmOf,
  type AttendanceRow,
  type ConferenceHistory,
} from "@/lib/conference/api";

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-base font-bold tabular-nums sm:text-lg">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function roleText(r: AttendanceRow["role"]) {
  return r === "host" ? "Tashkilotchi" : r === "cohost" ? "Yordamchi" : null;
}

function AttendanceItem({ a, total }: { a: AttendanceRow; total: number }) {
  const share = total > 0 ? Math.min(100, Math.round((a.seconds / total) * 100)) : 0;
  const role = roleText(a.role);
  return (
    <div className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-muted/50">
      <CallAvatar id={a.userId} name={a.fullName} className="h-10 w-10 shrink-0 text-xs" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="text-sm font-semibold">{a.fullName}</p>
          {role ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Crown className="h-3 w-3" /> {role}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {a.position ? <span className="truncate">{a.position}</span> : null}
          {a.firstJoin ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <LogIn className="h-3 w-3" /> {hhmmOf(a.firstJoin)}
              {a.lastLeave ? (
                <>
                  <LogOut className="ml-1 h-3 w-3" /> {hhmmOf(a.lastLeave)}
                </>
              ) : null}
            </span>
          ) : null}
          {a.sessions > 1 ? <span>{a.sessions} marta kirgan</span> : null}
        </p>
        {total > 0 && a.seconds > 0 ? (
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500" style={{ width: `${Math.max(3, share)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums">{a.seconds > 0 ? formatSpan(a.seconds) : "—"}</p>
        {total > 0 && a.seconds > 0 ? <p className="text-[11px] text-muted-foreground">{share}%</p> : null}
      </div>
    </div>
  );
}

function buildReport(h: ConferenceHistory): string {
  const c = h.conference;
  const lines: string[] = [];
  lines.push(`Konferensiya: ${c.title}`);
  lines.push(`Tashkilotchi: ${c.host.fullName}`);
  lines.push(`Sana: ${formatDate(h.actualStart ?? c.scheduledAt, { weekday: true })}`);
  if (h.actualStart) lines.push(`Boshlandi: ${hhmmOf(h.actualStart)}`);
  if (h.actualEnd) lines.push(`Tugadi: ${hhmmOf(h.actualEnd)}`);
  lines.push(`Davomiyligi: ${h.actualSeconds ? formatSpan(h.actualSeconds) : "—"}`);
  lines.push(`Qatnashdi: ${h.attendedCount} / ${h.invitedCount} taklif`);
  lines.push("");
  lines.push("QATNASHUVCHILAR");
  for (const a of h.attendance.filter((x) => x.firstJoin)) {
    lines.push(
      `- ${a.fullName}${a.position ? ` (${a.position})` : ""}: ${hhmmOf(a.firstJoin!)}–${a.lastLeave ? hhmmOf(a.lastLeave) : "…"}, ${formatSpan(a.seconds)}${a.sessions > 1 ? `, ${a.sessions} marta kirgan` : ""}`,
    );
  }
  const absent = h.attendance.filter((x) => !x.firstJoin && x.invited);
  if (absent.length) {
    lines.push("");
    lines.push("KIRMAGANLAR");
    for (const a of absent) lines.push(`- ${a.fullName}${a.position ? ` (${a.position})` : ""}`);
  }
  if (h.messages.length) {
    lines.push("");
    lines.push("CHAT");
    for (const m of h.messages) lines.push(`[${hhmmOf(m.at)}] ${m.name}: ${m.text}`);
  }
  return lines.join("\n");
}

function download(name: string, text: string) {
  const blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ConferenceHistoryDialog({
  code,
  open,
  onOpenChange,
  onDeleted,
}: {
  code: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"people" | "chat">("people");
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const q = useQuery({
    queryKey: ["conference-history", code],
    queryFn: () => conferenceApi.history(code!),
    enabled: open && Boolean(code),
    staleTime: 10_000,
  });
  const h = q.data;
  const joined = h?.attendance.filter((a) => a.firstJoin) ?? [];
  const absent = h?.attendance.filter((a) => !a.firstJoin && a.invited) ?? [];
  const c = h?.conference;

  const doDelete = async () => {
    if (!code) return;
    setDeleting(true);
    try {
      await conferenceApi.purge(code);
      toast({ title: "Konferensiya va uning tarixi o‘chirildi" });
      setConfirm(false);
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast({ title: "O‘chirilmadi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl p-0">
          <DialogHeader className="shrink-0 border-b px-5 pb-4 pt-5 text-left">
            <DialogTitle className="pr-8 text-lg">{c?.title ?? "Konferensiya tarixi"}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {c ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(h?.actualStart ?? c.scheduledAt, { weekday: true })}
                  </span>
                  <span>Tashkilotchi: {c.host.fullName}</span>
                  <span>
                    Reja: {hhmmOf(c.scheduledAt)} – {hhmmOf(new Date(new Date(c.scheduledAt).getTime() + c.durationMin * 60_000))}
                  </span>
                </>
              ) : (
                "Yuklanmoqda…"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
            {q.isLoading ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 rounded-2xl" />
                  ))}
                </div>
                <Skeleton className="h-14 rounded-2xl" />
                <Skeleton className="h-14 rounded-2xl" />
              </div>
            ) : q.isError ? (
              <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{(q.error as Error).message}</p>
            ) : h && c ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat icon={<Clock className="h-3.5 w-3.5" />} label="Boshlandi" value={h.actualStart ? hhmmOf(h.actualStart) : "—"} />
                  <Stat
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Tugadi"
                    value={c.status === "live" ? "Davom etmoqda" : h.actualEnd ? hhmmOf(h.actualEnd) : "—"}
                  />
                  <Stat icon={<Timer className="h-3.5 w-3.5" />} label="Gaplashildi" value={h.actualSeconds ? formatSpan(h.actualSeconds) : "—"} />
                  <Stat
                    icon={<Users className="h-3.5 w-3.5" />}
                    label="Qatnashdi"
                    value={`${h.attendedCount} kishi`}
                    hint={h.invitedCount ? `${h.invitedCount} ta taklifdan` : undefined}
                  />
                </div>

                <div className="flex gap-1 rounded-2xl bg-muted p-1">
                  {(
                    [
                      ["people", `Qatnashuvchilar · ${joined.length}`, <Users key="i" className="h-4 w-4" />],
                      ["chat", `Chat · ${h.messages.length}`, <MessageSquare key="i" className="h-4 w-4" />],
                    ] as const
                  ).map(([id, label, icon]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition sm:text-sm",
                        tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>

                {tab === "people" ? (
                  <div className="space-y-4">
                    {joined.length ? (
                      <div className="-mx-2">
                        {joined.map((a) => (
                          <AttendanceItem key={a.userId} a={a} total={h.actualSeconds} />
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">Hech kim kirmagan</p>
                    )}
                    {absent.length ? (
                      <div>
                        <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-red-500">
                          <UserX className="h-3.5 w-3.5" /> Kirmaganlar · {absent.length}
                        </p>
                        <div className="-mx-2">
                          {absent.map((a) => (
                            <div key={a.userId} className="flex items-center gap-3 rounded-2xl px-2 py-2 opacity-75">
                              <CallAvatar id={a.userId} name={a.fullName} className="h-9 w-9 shrink-0 text-xs grayscale" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{a.fullName}</p>
                                {a.position ? <p className="truncate text-[11px] text-muted-foreground">{a.position}</p> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : h.messages.length ? (
                  <div className="space-y-3">
                    {h.messages.map((m) => (
                      <div key={m.id} className="flex gap-2.5">
                        <CallAvatar id={m.userId} name={m.name} className="h-8 w-8 shrink-0 text-[11px]" />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[13px] font-semibold">{m.name}</span>
                            <span className="text-[11px] tabular-nums text-muted-foreground">{hhmmOf(m.at)}</span>
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{m.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">Chatda xabar yozilmagan</p>
                )}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
            {h?.canDelete ? (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" /> O‘chirish
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {h ? (
                <button
                  type="button"
                  onClick={() => download(`konferensiya-${h.conference.code}.txt`, buildReport(h))}
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition hover:bg-muted"
                >
                  <Download className="h-4 w-4" /> Hisobot
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Yopish
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={(v) => !deleting && setConfirm(v)}>
        <AlertDialogContent className="max-w-md rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Konferensiya o‘chirilsinmi?</AlertDialogTitle>
            <AlertDialogDescription>
              «{c?.title}» va uning butun tarixi — qatnashuv va chat xabarlari — butunlay o‘chiriladi. Buni qaytarib bo‘lmaydi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              O‘chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
