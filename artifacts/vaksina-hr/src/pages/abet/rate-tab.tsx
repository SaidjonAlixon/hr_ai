import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CheckCircle2, ChevronRight, Clock3, Loader2, Lock, PartyPopper, QrCode, ScanLine, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QrScanDialog } from "@/components/QrScanDialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  SCORE_EMOJI,
  SCORE_LABEL,
  checkAbetQr,
  fmtDay,
  fmtTime,
  useRateAbet,
  type AbetToday,
  type Criterion,
} from "@/lib/abet-api";
import { StarInput, StarsView } from "./stars";

const POSITIVE_TAGS = new Set(["Mazali", "Issiq edi", "Porsiya yetarli", "Toza va ozoda", "Xizmat yaxshi"]);

const CRITERIA_EMOJI: Record<string, string> = {
  taste: "😋",
  portion: "🍽",
  temperature: "🌡",
  cleanliness: "✨",
  service: "🤝",
};

const FACE_TONE: Record<number, string> = {
  1: "from-red-500 to-rose-500 shadow-red-500/30",
  2: "from-orange-500 to-amber-500 shadow-orange-500/30",
  3: "from-amber-400 to-yellow-400 shadow-amber-400/30",
  4: "from-lime-500 to-emerald-500 shadow-lime-500/30",
  5: "from-emerald-500 to-teal-500 shadow-emerald-500/30",
};

function minutesUntil(now: string, target: string): number {
  const [h1, m1] = now.split(":").map(Number);
  const [h2, m2] = target.split(":").map(Number);
  return h2! * 60 + m2! - (h1! * 60 + m1!);
}

function fmtWait(min: number): string {
  if (min <= 0) return "hozir";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} soat ${m} daqiqa` : `${m} daqiqa`;
}

export function MenuCard({ data }: { data: AbetToday }) {
  const menu = data.menu;
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-orange-400 to-amber-400 p-[1px] shadow-lg shadow-orange-500/15">
      <div className="rounded-[23px] bg-white/95 p-4 sm:p-5 dark:bg-slate-900/95">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-2xl">🍽</span>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white">Bugungi menyu</h3>
            <p className="text-xs text-slate-500 dark:text-white/50">{fmtDay(data.window.day)}</p>
          </div>
          {menu?.status === "draft" ? (
            <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">Qoralama · xodimlarga ko‘rinmaydi</span>
          ) : null}
        </div>
        {menu?.items.length ? (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {menu.items.map((it) => (
                <li key={it.name} className="flex items-center gap-3 rounded-2xl bg-orange-50/80 px-3 py-2.5 dark:bg-white/5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-xl shadow-sm dark:bg-white/10">
                    {CATEGORY_EMOJI[it.category]}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900 dark:text-white">{it.name}</span>
                    {it.category !== "boshqa" ? <span className="block text-xs text-orange-700/80 dark:text-orange-300/80">{CATEGORY_LABEL[it.category]}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {menu.note ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">📝 {menu.note}</p> : null}
          </>
        ) : (
          <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-white/5 dark:text-white/50">
            <p className="font-medium text-slate-700 dark:text-white/80">Bugungi menyu hali e’lon qilinmagan</p>
            <p className="mt-1 text-xs">
              Menyu har kuni soat {data.window.menuDeadline} gacha shu yerda va Telegram bot orqali e’lon qilinadi.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white dark:bg-white dark:text-slate-900">{n}</span>
      <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h4>
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </div>
  );
}

export function RateTab({ data, initialQr }: { data: AbetToday; initialQr: string | null }) {
  const { toast } = useToast();
  const rate = useRateAbet();
  const win = data.window;
  const mine = data.myRating;

  const [qr, setQr] = useState<string | null>(null);
  const [qrChecking, setQrChecking] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const [overall, setOverall] = useState<number | undefined>(mine?.overall);
  const [criteria, setCriteria] = useState<Partial<Record<Criterion, number>>>(mine?.criteria ?? {});
  const [dishes, setDishes] = useState<Record<string, number>>(mine?.dishes ?? {});
  const [tags, setTags] = useState<string[]>(mine?.tags ?? []);
  const [comment, setComment] = useState(mine?.comment ?? "");

  useEffect(() => {
    if (!mine) return;
    setOverall(mine.overall);
    setCriteria(mine.criteria);
    setDishes(mine.dishes);
    setTags(mine.tags);
    setComment(mine.comment ?? "");
  }, [mine?.id, mine?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const verifyQr = async (payload: string) => {
    setQrChecking(true);
    try {
      const r = await checkAbetQr(payload);
      if (!r.valid) {
        toast({ title: "QR kod noto‘g‘ri", description: "Oshxonaga yopishtirilgan Abet QR kodini skaner qiling", variant: "destructive" });
        return false;
      }
      setQr(payload);
      setFormOpen(true);
      toast({ title: "QR tasdiqlandi ✅", description: "Endi bugungi abetni baholang" });
      return true;
    } catch (e) {
      toast({ title: "QR", description: (e as Error).message, variant: "destructive" });
      return false;
    } finally {
      setQrChecking(false);
    }
  };

  useEffect(() => {
    if (initialQr) void verifyQr(initialQr);
  }, [initialQr]); // eslint-disable-line react-hooks/exhaustive-deps

  const dishItems = useMemo(() => (data.menu?.status === "approved" ? data.menu.items : []), [data.menu]);
  const positiveTags = data.tags.filter((t) => POSITIVE_TAGS.has(t));
  const negativeTags = data.tags.filter((t) => !POSITIVE_TAGS.has(t));
  const filledExtras = Object.keys(dishes).length + Object.values(criteria).filter(Boolean).length + tags.length + (comment.trim() ? 1 : 0);

  const submit = async () => {
    if (!overall) {
      toast({ title: "Umumiy bahoni tanlang", description: "Yuqoridagi yuzchalardan birini bosing", variant: "destructive" });
      return;
    }
    try {
      await rate.mutateAsync({ day: win.day, overall, criteria, dishes, tags, comment, qr });
      setFormOpen(false);
      setJustSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast({ title: "Baho saqlanmadi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const toggleTag = (t: string) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  if (!data.canRate) {
    return (
      <div className="space-y-4">
        <MenuCard data={data} />
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
          Abetni baholash faqat ofis xodimlari uchun.
        </p>
      </div>
    );
  }

  const tagButton = (t: string, positive: boolean) => {
    const on = tags.includes(t);
    return (
      <button
        key={t}
        type="button"
        onClick={() => toggleTag(t)}
        className={cn(
          "rounded-full border px-3.5 py-2 text-sm font-medium transition active:scale-95",
          on
            ? positive
              ? "border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
              : "border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-500/30"
            : positive
              ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 hover:border-emerald-400 dark:border-emerald-400/20 dark:bg-emerald-500/5 dark:text-emerald-200"
              : "border-rose-200 bg-rose-50/60 text-rose-800 hover:border-rose-400 dark:border-rose-400/20 dark:bg-rose-500/5 dark:text-rose-200",
        )}
      >
        {t}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <WindowBanner data={data} />

      {justSent && mine && !formOpen ? (
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-center text-white shadow-lg shadow-emerald-600/20">
          <PartyPopper className="mx-auto h-10 w-10" />
          <p className="mt-2 text-xl font-bold">Rahmat! Bahoyingiz qabul qilindi</p>
          <p className="mt-1 text-sm text-white/85">Fikringiz oshxona ishini yanada yaxshilashga yordam beradi</p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm">
            <span className="text-lg">{SCORE_EMOJI[mine.overall]}</span> {SCORE_LABEL[mine.overall]}
          </div>
        </div>
      ) : null}

      {!formOpen ? <MenuCard data={data} /> : null}

      {mine && !formOpen && !justSent ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">{SCORE_EMOJI[mine.overall]}</span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4" /> Bugungi abetni baholadingiz
            </p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-emerald-800/80 dark:text-emerald-300/70">
              <StarsView value={mine.overall} /> {fmtTime(mine.updatedAt)} · {mine.source === "qr" ? "QR orqali" : "Ilovada"}
            </p>
            {mine.comment ? <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-100/80">“{mine.comment}”</p> : null}
          </div>
          {win.state === "open" ? (
            <Button variant="outline" className="w-full rounded-xl sm:w-auto" onClick={() => setFormOpen(true)}>
              O‘zgartirish
            </Button>
          ) : null}
        </div>
      ) : null}

      {win.state === "open" && !formOpen && !mine ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            disabled={qrChecking}
            className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-emerald-500 p-5 text-left text-white shadow-lg shadow-teal-600/25 transition active:scale-[.98] sm:hover:-translate-y-0.5"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              {qrChecking ? <Loader2 className="h-7 w-7 animate-spin" /> : <ScanLine className="h-7 w-7" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold">QR skaner</span>
              <span className="block text-sm text-white/85">Oshxonadagi QR kod orqali</span>
            </span>
            <ChevronRight className="h-5 w-5 opacity-70 transition group-hover:translate-x-0.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setQr(null);
              setFormOpen(true);
            }}
            className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 to-amber-400 p-5 text-left text-white shadow-lg shadow-orange-500/25 transition active:scale-[.98] sm:hover:-translate-y-0.5"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <CalendarCheck2 className="h-7 w-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold">Bugun</span>
              <span className="block text-sm text-white/85">{fmtDay(win.day)} abetini baholash</span>
            </span>
            <ChevronRight className="h-5 w-5 opacity-70 transition group-hover:translate-x-0.5" />
          </button>
        </div>
      ) : null}

      {win.state === "open" && formOpen ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3 sm:px-6 dark:border-white/10 dark:from-white/5 dark:to-transparent">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Bugungi abetga baho</h3>
              <p className="text-xs text-slate-500 dark:text-white/50">{fmtDay(win.day)}</p>
            </div>
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                qr ? "bg-teal-100 text-teal-800" : "bg-orange-100 text-orange-800",
              )}
            >
              {qr ? <QrCode className="h-3.5 w-3.5" /> : <CalendarCheck2 className="h-3.5 w-3.5" />}
              {qr ? "QR orqali" : "Bugun tanlandi"}
            </span>
          </div>

          <div className="space-y-6 p-4 sm:p-6">
            <section>
              <SectionTitle n={1} title="Umumiy taassurot" hint="majburiy" />
              <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
                {[1, 2, 3, 4, 5].map((s) => {
                  const on = overall === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setOverall(s)}
                      aria-pressed={on}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-2xl border-2 px-1 py-3 transition active:scale-95 sm:py-4",
                        on
                          ? cn("border-transparent bg-gradient-to-br text-white shadow-lg", FACE_TONE[s])
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/5",
                      )}
                    >
                      <span className={cn("text-3xl transition sm:text-4xl", on ? "scale-110" : overall ? "opacity-50 grayscale" : "")}>{SCORE_EMOJI[s]}</span>
                      <span className={cn("text-[10px] font-semibold leading-tight sm:text-xs", on ? "text-white" : "text-slate-500 dark:text-white/60")}>
                        {SCORE_LABEL[s]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {dishItems.length ? (
              <section>
                <SectionTitle n={2} title="Taomlar" hint="ixtiyoriy" />
                <div className="space-y-2">
                  {dishItems.map((it) => (
                    <div
                      key={it.name}
                      className={cn(
                        "flex flex-col gap-2 rounded-2xl border px-3 py-2.5 transition sm:flex-row sm:items-center sm:justify-between",
                        dishes[it.name] ? "border-amber-200 bg-amber-50/60 dark:border-amber-400/20 dark:bg-amber-500/5" : "border-slate-200 dark:border-white/10",
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-xl">{CATEGORY_EMOJI[it.category]}</span>
                        <span>
                          <span className="block text-sm font-semibold text-slate-900 dark:text-white">{it.name}</span>
                          {it.category !== "boshqa" ? <span className="block text-[11px] text-slate-400">{CATEGORY_LABEL[it.category]}</span> : null}
                        </span>
                      </span>
                      <StarInput
                        value={dishes[it.name]}
                        onChange={(v) =>
                          setDishes((p) => {
                            const next = { ...p };
                            if (v) next[it.name] = v;
                            else delete next[it.name];
                            return next;
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <SectionTitle n={dishItems.length ? 3 : 2} title="Mezonlar" hint="ixtiyoriy" />
              <div className="grid gap-2 sm:grid-cols-2">
                {data.criteria.map((c) => (
                  <div
                    key={c.key}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-2xl border px-3 py-2",
                      criteria[c.key] ? "border-amber-200 bg-amber-50/60 dark:border-amber-400/20 dark:bg-amber-500/5" : "border-slate-200 dark:border-white/10",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-white/80">
                      <span className="text-lg">{CRITERIA_EMOJI[c.key]}</span>
                      {c.label}
                    </span>
                    <StarInput value={criteria[c.key]} onChange={(v) => setCriteria((p) => ({ ...p, [c.key]: v }))} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle n={dishItems.length ? 4 : 3} title="Nima yoqdi / yoqmadi?" hint="bir nechtasi" />
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    <ThumbsUp className="h-3.5 w-3.5" /> Yoqdi
                  </p>
                  <div className="flex flex-wrap gap-2">{positiveTags.map((t) => tagButton(t, true))}</div>
                </div>
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                    <ThumbsDown className="h-3.5 w-3.5" /> Yaxshilash kerak
                  </p>
                  <div className="flex flex-wrap gap-2">{negativeTags.map((t) => tagButton(t, false))}</div>
                </div>
              </div>
            </section>

            <section>
              <SectionTitle n={dishItems.length ? 5 : 4} title="Izoh yoki taklif" hint="ixtiyoriy" />
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                placeholder="Masalan: sho‘rva juda mazali edi, non yumshoqroq bo‘lsa yaxshi bo‘lardi…"
                rows={3}
                className="rounded-2xl text-[15px]"
              />
              <p className="mt-1 text-right text-xs text-slate-400">{comment.length}/500</p>
            </section>
          </div>

          <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-end sm:px-6 dark:border-white/10 dark:bg-slate-900/95">
            <span className="hidden text-xs text-slate-400 sm:mr-auto sm:block">
              {overall ? `${SCORE_EMOJI[overall]} ${SCORE_LABEL[overall]}` : "Umumiy bahoni tanlang"}
              {filledExtras ? ` · +${filledExtras} qo‘shimcha` : ""}
            </span>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={rate.isPending} className="h-11 rounded-xl">
              Bekor qilish
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={rate.isPending || !overall}
              className="h-12 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-500 text-base font-semibold shadow-lg shadow-teal-600/25 hover:from-teal-700 hover:to-emerald-600 sm:h-11 sm:px-6 sm:text-sm"
            >
              {rate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {mine ? "Bahoni yangilash" : "Baho yuborish"}
            </Button>
          </div>
        </div>
      ) : null}

      <QrScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Abet QR kodi"
        description="Oshxonaga yopishtirilgan QR kodni kameraga tuting"
        onDetected={async (payload) => {
          const ok = await verifyQr(payload);
          if (ok) setScanOpen(false);
        }}
      />
    </div>
  );
}

function WindowBanner({ data }: { data: AbetToday }) {
  const win = data.window;
  if (win.state === "open") {
    const left = minutesUntil(win.now, win.closesAt);
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <span>
          <b>Baholash ochiq</b> · {win.opensAt}–{win.closesAt}
          <span className="block text-xs opacity-80">Yopilishiga {fmtWait(left)} qoldi</span>
        </span>
      </div>
    );
  }
  if (win.state === "before") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200">
        <Clock3 className="h-5 w-5 shrink-0" />
        <span>
          <b>Baholash {win.opensAt} da ochiladi</b>
          <span className="block text-xs opacity-80">
            {fmtWait(minutesUntil(win.now, win.opensAt))} qoldi · faqat bugungi abet, {win.opensAt}–{win.closesAt}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/70">
      <Lock className="h-5 w-5 shrink-0" />
      <span>
        <b>Bugungi baholash yakunlandi</b>
        <span className="block text-xs opacity-80">Har kuni faqat {win.opensAt}–{win.closesAt} oralig‘ida, o‘sha kunning abeti uchun</span>
      </span>
    </div>
  );
}
