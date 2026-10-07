import { useEffect, useState } from "react";
import {
  CalendarX2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileDown,
  FileSignature,
  Loader2,
  Lock,
  LockOpen,
  PenLine,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  downloadLetterPdf,
  fmtLetterDate,
  useCreateTestLetter,
  useDeleteTestLetters,
  useLetterGate,
  useLetterUserOptions,
  useTestLetters,
  type ExplanationLetter,
  type LetterKind,
  type LetterUserOption,
} from "@/lib/explanation-letters-api";
import { ExplanationLetterDialog, StatusChip } from "./ExplanationLetterDialog";

const STRIKES = [
  { n: 1, note: "Ogoh\u00ADlantirish" },
  { n: 2, note: "Kunlik 30%" },
  { n: 3, note: "Kunlik 30%" },
  { n: 4, note: "Kunlik 100%" },
  { n: 5, note: "Oylik 50%" },
  { n: 6, note: "Oxirgi xat" },
] as const;

const FLOW = [
  "Test xat yaratiladi — xodimga bildirishnoma boradi, platformaga kirganda xat o‘zi ochiladi.",
  "Xodim davomatda «Keldim» bossa (Face ID / QR / barmoq izi) — rad etiladi va xat oynasi ochiladi.",
  "Xodim sababni qo‘lda yozadi (6-holatda ishdan bo‘shatishga rozilikni ham belgilaydi) → «Tasdiqlash» → QR qo‘yiladi → imzo chizadi.",
  "Admin xatni ochib «Rahbariyat qarori»da tasdiqlaydi yoki izoh bilan bekor qiladi.",
  "Imzodan so‘ng davomat ochiladi. Xatdagi QR skaner qilinsa — «Hujjat haqiqiy» va PDF yuklab olish.",
  "Test tugagach xatni o‘chiring. Test xatlar oylik va jarimaga ta’sir qilmaydi.",
];

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
}

/** Admin «Test» bo‘limi: tushuntirish xati oqimini real foydalanuvchida sinash */
export function LetterTestCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const me = user ? { id: Number(user.id), fullName: String(user.fullName || "Men"), role: String(user.role || ""), branch: null } : null;

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<LetterUserOption | null>(null);
  const [kind, setKind] = useState<LetterKind>("late");
  const [strikeN, setStrikeN] = useState(1);
  const [eventDate, setEventDate] = useState(todayYmd);
  const [lateMinutes, setLateMinutes] = useState(25);
  const [open, setOpen] = useState<{ id: number; mode: "employee" | "admin" } | null>(null);
  const [pdfId, setPdfId] = useState<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const users = useLetterUserOptions(debounced, !picked && debounced.length >= 2);
  const tests = useTestLetters(true);
  const gate = useLetterGate(picked?.id ?? null);
  const create = useCreateTestLetter();
  const remove = useDeleteTestLetters();
  const items = tests.data?.items ?? [];

  const doCreate = () => {
    if (!picked) return;
    create.mutate(
      { userId: picked.id, kind, strikeN, eventDate, lateMinutes: kind === "late" ? lateMinutes : null },
      {
        onSuccess: (l) => {
          toast({
            title: "Test xat yaratildi",
            description: `${l.fullName} · ${l.letterNo}. Endi «Keldim» bloklanadi — xat imzolanmaguncha.`,
          });
          if (picked.id === me?.id) setOpen({ id: l.id, mode: "employee" });
        },
        onError: (e) => toast({ title: "Yaratilmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const doDelete = (ids?: number[]) =>
    remove.mutate(ids, {
      onSuccess: (r) => toast({ title: "O‘chirildi", description: `${r.deleted} ta test xat o‘chirildi.` }),
      onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
    });

  const pdf = async (l: ExplanationLetter) => {
    setPdfId(l.id);
    try {
      await downloadLetterPdf(l);
    } catch (e) {
      toast({ title: "PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPdfId(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-sky-50 via-white to-white pb-3 dark:border-white/10 dark:from-sky-500/10 dark:via-transparent dark:to-transparent">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0b3a5c] text-white">
            <FileSignature className="h-4 w-4" />
          </span>
          Tushuntirish xati — real test
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Haqiqiy oqim: xat → davomat bloki → sabab va imzo → QR tekshiruv → PDF. Faqat tanlangan xodimga ta’sir qiladi.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <ol className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">
          {FLOW.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0b3a5c] text-[10px] font-bold text-white">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">1. Xodim</p>
          {picked ? (
            <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-500/30 dark:bg-sky-500/10">
              <UserRound className="h-4 w-4 shrink-0 text-sky-700" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {picked.fullName}
                  {picked.id === me?.id ? " (o‘zim)" : ""}
                </p>
                <p className="truncate text-[11px] text-slate-500">{[picked.role, picked.branch].filter(Boolean).join(" · ")}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" className="h-8 rounded-lg text-xs" onClick={() => setPicked(null)}>
                O‘zgartirish
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Ism yoki login (kamida 2 harf)…"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                  />
                </label>
                {me ? (
                  <Button type="button" variant="outline" className="h-10 shrink-0 rounded-xl" onClick={() => setPicked(me)}>
                    O‘zim
                  </Button>
                ) : null}
              </div>
              {debounced.length >= 2 ? (
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
                  {users.isLoading ? (
                    <li className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Qidirilmoqda…
                    </li>
                  ) : !(users.data?.items ?? []).length ? (
                    <li className="px-3 py-2 text-xs text-slate-500">Topilmadi</li>
                  ) : (
                    users.data!.items.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPicked(u);
                            setSearch("");
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sky-50 dark:hover:bg-white/5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">{u.fullName}</span>
                            <span className="block truncate text-[11px] text-slate-500">{[u.role, u.branch].filter(Boolean).join(" · ")}</span>
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          )}
          {picked ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-xl px-3 py-2 text-xs ring-1",
                gate.data?.blocked
                  ? "bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/30"
                  : "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30",
              )}
            >
              {gate.isLoading ? (
                <Loader2 className="mt-px h-4 w-4 shrink-0 animate-spin" />
              ) : gate.data?.blocked ? (
                <Lock className="mt-px h-4 w-4 shrink-0" />
              ) : (
                <LockOpen className="mt-px h-4 w-4 shrink-0" />
              )}
              <span>
                <b>Davomat «Keldim»: {gate.data?.blocked ? "BLOKLANGAN" : "ochiq"}</b>
                {gate.data?.block ? ` — ${gate.data.block.error}` : gate.data ? " — imzolanmagan xat yo‘q." : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">2. Holat</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
              {(
                [
                  ["late", "Kechikish", Clock3],
                  ["absent", "Kelmagan", CalendarX2],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold",
                    kind === k ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1 text-[11px] text-slate-500">
                Sana
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value || todayYmd())}
                  className="mt-0.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
              </label>
              {kind === "late" ? (
                <label className="w-28 shrink-0 text-[11px] text-slate-500">
                  Kechikish, daq
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={lateMinutes}
                    onChange={(e) => setLateMinutes(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
                    className="mt-0.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm tabular-nums text-slate-900 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                  />
                </label>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">3. Nechanchi buzilish</p>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {STRIKES.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => setStrikeN(s.n)}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-1 py-2 text-center transition",
                    strikeN === s.n
                      ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200",
                  )}
                >
                  <span className="text-base font-extrabold leading-none">{s.n}</span>
                  <span className={cn("mt-1 max-w-full text-[9px] font-semibold leading-tight [hyphens:manual]", strikeN === s.n ? "text-white/80" : "text-slate-500")}>{s.note}</span>
                </button>
              ))}
            </div>
            <Button
              type="button"
              className="h-11 w-full gap-1.5 rounded-xl bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]/90"
              disabled={!picked || create.isPending}
              onClick={doCreate}
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Test xat yaratish
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Test xatlari ({items.length})</p>
            {items.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1 rounded-lg text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={remove.isPending}
                onClick={() => doDelete()}
              >
                <Trash2 className="h-3.5 w-3.5" /> Hammasini o‘chirish
              </Button>
            ) : null}
          </div>
          {tests.isLoading ? (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Yuklanmoqda…
            </p>
          ) : !items.length ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 dark:border-white/10">
              Hozircha test xat yo‘q.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((l) => {
                const mine = l.userId === me?.id;
                return (
                  <li key={l.id} className="rounded-xl border border-slate-200 p-2.5 dark:border-white/10">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{l.fullName}</p>
                      <StatusChip status={l.status} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {l.kind === "late" ? `Kechikish${l.lateMinutes ? ` ${l.lateMinutes} daq.` : ""}` : "Kelmagan"} · {fmtLetterDate(l.eventDate)} · {l.strikeN}-marta · №{" "}
                      {l.letterNo}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {mine && l.status !== "signed" ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 gap-1 rounded-lg bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                          onClick={() => setOpen({ id: l.id, mode: "employee" })}
                        >
                          <PenLine className="h-3.5 w-3.5" /> To‘ldirish va imzolash
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-xs" onClick={() => setOpen({ id: l.id, mode: "admin" })}>
                          <FileSignature className="h-3.5 w-3.5" /> Ko‘rish
                        </Button>
                      )}
                      {l.status === "signed" ? (
                        <>
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-xs" disabled={pdfId === l.id} onClick={() => void pdf(l)}>
                            {pdfId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} PDF
                          </Button>
                          {l.verifyToken ? (
                            <Button asChild type="button" size="sm" variant="outline" className="h-8 gap-1 rounded-lg text-xs">
                              <a href={`/tx/${l.verifyToken}`} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-3.5 w-3.5" /> QR tekshiruv
                              </a>
                            </Button>
                          ) : null}
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Davomat ochildi
                          </span>
                        </>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-8 w-8 rounded-lg p-0 text-red-600 hover:bg-red-50"
                        title="O‘chirish"
                        disabled={remove.isPending}
                        onClick={() => doDelete([l.id])}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
      <ExplanationLetterDialog letterId={open?.id ?? null} mode={open?.mode ?? "admin"} onClose={() => setOpen(null)} />
    </Card>
  );
}
