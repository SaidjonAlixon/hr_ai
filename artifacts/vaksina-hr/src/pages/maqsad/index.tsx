import React, { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import { useToast } from "../../hooks/use-toast";
import {
  localWorkDate,
  useGoalsMe,
  useSaveGoal,
  useSubmitDailyGoal,
} from "../../lib/maqsad-api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Target,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Lock,
  PencilLine,
  Sparkles,
  ArrowDown,
} from "lucide-react";

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

function formatWorkDate(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} · ${WEEKDAYS[d.getDay()]}`;
}

function StepBadge({
  n,
  active,
  done,
}: {
  n: number;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        done
          ? "bg-emerald-600 text-white"
          : active
            ? "bg-[#0b3a5c] text-white"
            : "bg-slate-200 text-slate-500",
      )}
    >
      {done ? <CheckCircle2 className="h-4 w-4" /> : n}
    </span>
  );
}

export default function MaqsadPage() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useGoalsMe();
  const saveGoal = useSaveGoal();
  const submitDaily = useSubmitDailyGoal();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [todayContent, setTodayContent] = useState("");
  const [editingGoal, setEditingGoal] = useState(false);

  useEffect(() => {
    if (data?.goal) {
      setTitle(data.goal.title);
      setDescription(data.goal.description || "");
      setEditingGoal(false);
    } else {
      setEditingGoal(true);
    }
    if (data?.todayLog) {
      setTodayContent(data.todayLog.content);
    }
  }, [data]);

  const hasGoal = !!data?.goal;
  const todayDone = !!data?.todaySubmitted;
  const activeStep = !hasGoal ? 1 : !todayDone ? 2 : 3;

  const progress = useMemo(() => {
    let p = 0;
    if (hasGoal) p += 50;
    if (todayDone) p += 50;
    return p;
  }, [hasGoal, todayDone]);

  async function onSaveGoal() {
    if (!title.trim()) {
      toast({ title: "1-qadam: maqsad sarlavhasini yozing", variant: "destructive" });
      return;
    }
    try {
      await saveGoal.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
      });
      await refetch();
      toast({ title: "Oliy maqsad saqlandi", description: "Endi 2-qadam: bugungi natija" });
    } catch (e: any) {
      toast({ title: "Xato", description: e.message, variant: "destructive" });
    }
  }

  async function onSaveToday() {
    if (!todayContent.trim()) {
      toast({ title: "2-qadam: bugun nima qilganingizni yozing", variant: "destructive" });
      return;
    }
    try {
      await submitDaily.mutateAsync({
        content: todayContent.trim(),
        workDate: localWorkDate(),
      });
      await refetch();
      toast({ title: "Bugungi natija saqlandi" });
    } catch (e: any) {
      toast({ title: "Xato", description: e.message, variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0b3a5c] via-[#0f4a73] to-[#163a55] p-5 text-white shadow-md sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Target className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100/90">
                Kunlik intizom
              </p>
              <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Maqsad</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-sky-50/90">
                Avval <strong className="font-semibold text-white">oliy maqsad</strong>ni yozing.
                Har kuni ish yakunida (17:55) tizim sizdan shu maqsad bo‘yicha{" "}
                <strong className="font-semibold text-white">bugun nima qildingiz</strong> deb so‘raydi.
                Barcha kunlar tarixda saqlanadi.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {[
              { n: 1, t: "Oliy maqsad", d: "Bir marta aniq yozing", done: hasGoal },
              { n: 2, t: "Bugungi natija", d: "Har kuni 17:55", done: todayDone },
              { n: 3, t: "Tarix", d: "Barcha kunlar", done: hasGoal && todayDone },
            ].map((s) => (
              <div
                key={s.n}
                className={cn(
                  "rounded-xl border px-3 py-2.5",
                  activeStep === s.n
                    ? "border-white/40 bg-white/15"
                    : "border-white/10 bg-white/5",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                      s.done ? "bg-emerald-400 text-emerald-950" : "bg-white/20 text-white",
                    )}
                  >
                    {s.done ? "✓" : s.n}
                  </span>
                  <p className="text-sm font-semibold">{s.t}</p>
                </div>
                <p className="mt-1 pl-8 text-[11px] text-sky-100/80">{s.d}</p>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-sky-100/80">
              <span>Bugungi holat</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Step 1 */}
      <section
        className={cn(
          "rounded-2xl border bg-white p-4 shadow-sm sm:p-5",
          activeStep === 1 ? "border-[#0b3a5c]/40 ring-2 ring-[#0b3a5c]/15" : "border-slate-200",
        )}
      >
        <div className="flex items-start gap-3">
          <StepBadge n={1} active={activeStep === 1} done={hasGoal && !editingGoal} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Oliy maqsadni belgilang</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Bo‘limingiz / ishingiz uchun asosiy, o‘lchash mumkin bo‘lgan maqsad.
                </p>
              </div>
              {hasGoal && !editingGoal && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setEditingGoal(true)}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Tahrirlash
                </Button>
              )}
            </div>

            {hasGoal && !editingGoal ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                  Faol oliy maqsad
                </p>
                <p className="mt-1 text-base font-semibold text-slate-900">{data!.goal!.title}</p>
                {data!.goal!.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                    {data!.goal!.description}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Sarlavha *
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Masalan: 3 oyda filiallar KPI ni 20% oshirish"
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Aniq izoh (ixtiyoriy)
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Qanday o‘lchaysiz? Nima natija kutasiz?"
                    rows={3}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={onSaveGoal}
                    disabled={saveGoal.isPending}
                    className="bg-[#0b3a5c] hover:bg-[#0a314d]"
                  >
                    {hasGoal ? "O‘zgarishni saqlash" : "1-qadamni yakunlash"}
                  </Button>
                  {hasGoal && (
                    <Button type="button" variant="ghost" onClick={() => setEditingGoal(false)}>
                      Bekor
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="flex justify-center text-slate-300">
        <ArrowDown className="h-5 w-5" />
      </div>

      {/* Step 2 */}
      <section
        className={cn(
          "rounded-2xl border bg-white p-4 shadow-sm sm:p-5",
          !hasGoal
            ? "border-slate-200 opacity-80"
            : activeStep === 2
              ? "border-amber-300 ring-2 ring-amber-200/60"
              : "border-slate-200",
        )}
      >
        <div className="flex items-start gap-3">
          <StepBadge n={2} active={activeStep === 2} done={todayDone} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Bugun shu maqsad uchun nima qildingiz?
                </h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                  <span>{formatWorkDate(data?.workDate || localWorkDate())}</span>
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    17:55 da majburiy so‘raladi
                  </span>
                </p>
              </div>
              {todayDone ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Bugun yozilgan
                </span>
              ) : hasGoal ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                  Hali yozilmagan
                </span>
              ) : null}
            </div>

            {!hasGoal ? (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p>
                  Avval <strong>1-qadam</strong>ni yakunlang — oliy maqsad saqlang. Keyin shu
                  yerga bugungi natijani yozasiz.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-[#0b3a5c]/15 bg-[#0b3a5c]/5 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0b3a5c]">
                    Bugungi yozuv shu maqsadga bog‘lanadi
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900">{data!.goal!.title}</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Bugungi aniq ishlar *
                  </label>
                  <Textarea
                    value={todayContent}
                    onChange={(e) => setTodayContent(e.target.value)}
                    placeholder={
                      "Masalan:\n• 3 ta filialni tekshirdim\n• KPI hisobotini tayyorladim\n• Xodim bilan suhbat o‘tkazdim"
                    }
                    rows={6}
                    className="min-h-[140px]"
                  />
                </div>
                <Button
                  onClick={onSaveToday}
                  disabled={submitDaily.isPending}
                  className="bg-[#0b3a5c] hover:bg-[#0a314d]"
                >
                  {todayDone ? "Bugungi yozuvni yangilash" : "2-qadamni saqlash"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="flex justify-center text-slate-300">
        <ArrowDown className="h-5 w-5" />
      </div>

      {/* Step 3 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <StepBadge n={3} active={activeStep === 3} done={(data?.logs?.length ?? 0) > 0} />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              Kunlik tarix
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Har bir kunning natijasi ketma-ket saqlanadi — 1-kun, 2-kun, …
            </p>

            {!data?.logs?.length ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <Sparkles className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  Hali yozuv yo‘q. Birinchi kunlik natijani saqlang — shu yerda chiqadi.
                </p>
              </div>
            ) : (
              <ol className="relative mt-5 space-y-0 border-l-2 border-slate-200 pl-5">
                {data.logs.map((log, idx) => (
                  <li key={log.id} className="relative pb-5 last:pb-0">
                    <span
                      className={cn(
                        "absolute -left-[27px] top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-white",
                        idx === 0
                          ? "bg-[#0b3a5c] text-white"
                          : "bg-slate-300 text-slate-700",
                      )}
                    >
                      {data.logs.length - idx}
                    </span>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3.5 py-3">
                      <p className="text-xs font-semibold text-slate-500">
                        {formatWorkDate(String(log.workDate))}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                        {log.content}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
