import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CheckCircle2, Clock3, Loader2, Lock, QrCode, ScanLine, Send, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QrScanDialog } from "@/components/QrScanDialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  checkAbetQr,
  fmtDay,
  fmtTime,
  useRateAbet,
  type AbetToday,
  type Criterion,
} from "@/lib/abet-api";
import { StarInput, StarsView } from "./stars";

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
    <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-4 dark:border-orange-400/20 dark:from-orange-500/10 dark:to-amber-500/5">
      <div className="mb-3 flex items-center gap-2">
        <UtensilsCrossed className="h-5 w-5 text-orange-600" />
        <h3 className="font-semibold text-slate-900 dark:text-white">Bugungi menyu</h3>
        {menu?.status === "draft" ? (
          <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">Qoralama · xodimlarga ko‘rinmaydi</span>
        ) : null}
      </div>
      {menu?.items.length ? (
        <>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {menu.items.map((it) => (
              <li key={it.name} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-white/5">
                <span className="font-medium text-slate-900 dark:text-white">{it.name}</span>
                {it.category !== "boshqa" ? (
                  <span className="ml-auto rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                    {CATEGORY_LABEL[it.category]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {menu.note ? <p className="mt-2 text-sm text-slate-600 dark:text-white/60">📝 {menu.note}</p> : null}
        </>
      ) : (
        <p className="text-sm text-slate-500 dark:text-white/50">Bugungi menyu hali oshpaz tomonidan kiritilmagan. Umumiy baho berishingiz mumkin.</p>
      )}
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
      toast({ title: "QR tasdiqlandi", description: "Endi bugungi abetni baholang" });
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

  const submit = async () => {
    if (!overall) {
      toast({ title: "Umumiy bahoni tanlang", description: "1 dan 5 gacha yulduz", variant: "destructive" });
      return;
    }
    try {
      await rate.mutateAsync({ day: win.day, overall, criteria, dishes, tags, comment, qr });
      toast({ title: mine ? "Baho yangilandi" : "Rahmat! Bahoyingiz qabul qilindi", description: "Fikringiz oshxona ishini yaxshilashga yordam beradi" });
      setFormOpen(false);
    } catch (e) {
      toast({ title: "Baho saqlanmadi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const toggleTag = (t: string) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  if (!data.canRate) {
    return (
      <div className="space-y-4">
        <MenuCard data={data} />
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
          Abetni baholash faqat ofis xodimlari uchun.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WindowBanner data={data} />
      <MenuCard data={data} />

      {mine && !formOpen ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="font-semibold text-emerald-900 dark:text-emerald-200">Siz bugungi abetni baholadingiz</span>
            <StarsView value={mine.overall} className="ml-1" />
            <span className="text-xs text-emerald-700/80 dark:text-emerald-300/70">
              {fmtTime(mine.updatedAt)} · {mine.source === "qr" ? "QR orqali" : "Ilovada"}
            </span>
          </div>
          {mine.comment ? <p className="mt-2 text-sm text-emerald-900/80 dark:text-emerald-100/80">“{mine.comment}”</p> : null}
          {win.state === "open" ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setFormOpen(true)}>
              Bahoni o‘zgartirish
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
            className="group flex items-center gap-4 rounded-2xl border-2 border-teal-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-400 hover:shadow-md dark:border-teal-400/20 dark:bg-white/5"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal-600 text-white shadow">
              {qrChecking ? <Loader2 className="h-7 w-7 animate-spin" /> : <ScanLine className="h-7 w-7" />}
            </span>
            <span>
              <span className="block text-base font-semibold text-slate-900 dark:text-white">QR kodni skaner qilish</span>
              <span className="block text-sm text-slate-500 dark:text-white/50">Oshxonadagi QR kod orqali baholang</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setQr(null);
              setFormOpen(true);
            }}
            className="group flex items-center gap-4 rounded-2xl border-2 border-orange-200 bg-white p-5 text-left shadow-sm transition hover:border-orange-400 hover:shadow-md dark:border-orange-400/20 dark:bg-white/5"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white shadow">
              <CalendarCheck2 className="h-7 w-7" />
            </span>
            <span>
              <span className="block text-base font-semibold text-slate-900 dark:text-white">Bugun — {fmtDay(win.day)}</span>
              <span className="block text-sm text-slate-500 dark:text-white/50">Bugungi abetni ilovada baholang</span>
            </span>
          </button>
        </div>
      ) : null}

      {win.state === "open" && formOpen ? (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Bugungi abetga baho</h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                qr ? "bg-teal-100 text-teal-800" : "bg-orange-100 text-orange-800",
              )}
            >
              {qr ? <QrCode className="h-3.5 w-3.5" /> : <CalendarCheck2 className="h-3.5 w-3.5" />}
              {qr ? "QR orqali" : "Bugun tanlandi"}
            </span>
            <span className="ml-auto text-xs text-slate-500 dark:text-white/50">{fmtDay(win.day)}</span>
          </div>

          <section className="rounded-xl bg-amber-50 p-4 text-center dark:bg-amber-500/10">
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-white/80">Umumiy taassurot *</p>
            <div className="flex justify-center">
              <StarInput value={overall} onChange={setOverall} size="lg" showLabel />
            </div>
          </section>

          {dishItems.length ? (
            <section>
              <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-white/90">
                Taomlar <span className="font-normal text-slate-500">(ixtiyoriy)</span>
              </p>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
                {dishItems.map((it) => (
                  <div key={it.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm text-slate-800 dark:text-white/90">
                      {it.name}
                      {it.category !== "boshqa" ? <span className="ml-1.5 text-xs text-slate-400">· {CATEGORY_LABEL[it.category]}</span> : null}
                    </span>
                    <StarInput value={dishes[it.name]} onChange={(v) => setDishes((p) => {
                      const next = { ...p };
                      if (v) next[it.name] = v;
                      else delete next[it.name];
                      return next;
                    })} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-white/90">
              Mezonlar <span className="font-normal text-slate-500">(ixtiyoriy)</span>
            </p>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {data.criteria.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-700 dark:text-white/80">{c.label}</span>
                  <StarInput value={criteria[c.key]} onChange={(v) => setCriteria((p) => ({ ...p, [c.key]: v }))} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-white/90">
              Belgilar <span className="font-normal text-slate-500">(bir nechtasini tanlash mumkin)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {data.tags.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition",
                      on
                        ? "border-teal-600 bg-teal-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-teal-400 dark:border-white/15 dark:bg-white/5 dark:text-white/80",
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-white/90">
              Izoh / taklif <span className="font-normal text-slate-500">(ixtiyoriy)</span>
            </p>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 500))}
              placeholder="Masalan: sho‘rva juda mazali edi, non yumshoq bo‘lsa yaxshi bo‘lardi…"
              rows={3}
            />
            <p className="mt-1 text-right text-xs text-slate-400">{comment.length}/500</p>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={rate.isPending}>
              Bekor qilish
            </Button>
            <Button onClick={() => void submit()} disabled={rate.isPending || !overall} className="bg-teal-600 hover:bg-teal-700">
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
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <b>Baholash ochiq</b>
        <span>
          {win.opensAt}–{win.closesAt} · yopilishiga {fmtWait(left)} qoldi
        </span>
      </div>
    );
  }
  if (win.state === "before") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200">
        <Clock3 className="h-4 w-4" />
        <b>Baholash {win.opensAt} da ochiladi</b>
        <span>· {fmtWait(minutesUntil(win.now, win.opensAt))} qoldi. Faqat bugungi abet, {win.opensAt}–{win.closesAt} oralig‘ida.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/70">
      <Lock className="h-4 w-4" />
      <b>Bugungi baholash yakunlandi</b>
      <span>· Baholash har kuni faqat {win.opensAt}–{win.closesAt} oralig‘ida, o‘sha kunning abeti uchun ochiq.</span>
    </div>
  );
}
