import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, CalendarX2, Clock3, FileText, Loader2, Lock, MapPin, Scale, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const DISCIPLINE_ROLES = new Set(["mudir", "farmasevt", "stajyor", "stajor"]);
const HR_GROUP_URL = "https://t.me/+rEOvG9FeNHYzMWIy";
const FALLBACK_MESSAGE = "Intizom qoidalari buzilgani sababli bugun platformadan foydalana olmaysiz. Admin yoki HR bilan bog‘laning.";

type LockEvent = {
  n: number;
  date: string;
  weekday: string;
  kind: "late" | "absent";
  kindLabel: string;
  checkIn: string | null;
  branch: string;
  shift: string;
  penalty: string;
  trigger: boolean;
};

type LockDetails = {
  locked: true;
  day: string;
  monthLabel: string;
  strikeN: number;
  lockFrom: number;
  triggerDate: string;
  triggerKind: "late" | "absent";
  late: number;
  absent: number;
  events: LockEvent[];
  rules: string[];
};

function fmtDate(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

/** 5-marta va undan keyingi jarima kuni — butun platforma qotadi, faqat qizil yozuv qoladi */
export function DisciplineLockOverlay() {
  const { user } = useAuth();
  const watched = !!user && DISCIPLINE_ROLES.has(String(user.role || "").toLowerCase());
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<"main" | "reason">("main");
  const [details, setDetails] = useState<LockDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/discipline/my-lock", { credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { locked: boolean; message?: string };
      setMessage(data.locked ? data.message || FALLBACK_MESSAGE : null);
    } catch {
      /* tarmoq xatosi — joriy holat saqlanadi */
    }
  }, []);

  const openReason = useCallback(async () => {
    setView("reason");
    if (details) return;
    setDetailsLoading(true);
    setDetailsError(false);
    try {
      const res = await fetch("/api/discipline/my-lock/details", { credentials: "include", cache: "no-store" });
      const data = res.ok ? ((await res.json()) as LockDetails | { locked: false }) : null;
      if (data?.locked) setDetails(data);
      else setDetailsError(true);
    } catch {
      setDetailsError(true);
    } finally {
      setDetailsLoading(false);
    }
  }, [details]);

  useEffect(() => {
    if (!watched) {
      setMessage(null);
      return;
    }
    void check();
    const onLocked = (ev: Event) => {
      setMessage((ev as CustomEvent<{ message?: string }>).detail?.message || FALLBACK_MESSAGE);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("vaksina-discipline-lock", onLocked);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("vaksina-discipline-lock", onLocked);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watched, check]);

  useEffect(() => {
    if (!watched) return;
    const id = window.setInterval(() => void check(), message ? 30_000 : 60_000);
    return () => window.clearInterval(id);
  }, [watched, message, check]);

  useEffect(() => {
    if (!message) {
      setView("main");
      setDetails(null);
      return;
    }
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    root?.setAttribute("aria-hidden", "true");
    (document.activeElement as HTMLElement | null)?.blur?.();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const block = (e: Event) => {
      if ((e.type === "wheel" || e.type === "touchmove") && (e.target as HTMLElement | null)?.closest?.("[data-lock-scroll]")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const events = ["keydown", "keypress", "keyup", "paste", "contextmenu", "wheel", "touchmove"] as const;
    for (const t of events) window.addEventListener(t, block, { capture: true, passive: false });
    return () => {
      root?.removeAttribute("inert");
      root?.removeAttribute("aria-hidden");
      document.body.style.overflow = prevOverflow;
      for (const t of events) window.removeEventListener(t, block, { capture: true });
    };
  }, [message]);

  if (!message) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="vaksina-lock-title"
      data-lock-scroll
      className="fixed inset-0 z-[2147483647] flex select-none justify-center overflow-y-auto overscroll-contain bg-gradient-to-b from-zinc-950 via-black to-zinc-950 px-5 py-10"
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("a,button")) e.preventDefault();
      }}
    >
      <style>{`@keyframes vaksina-lock-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.45)}50%{box-shadow:0 0 0 18px rgba(239,68,68,0)}}`}</style>
      {view === "main" ? (
        <div className="my-auto w-full max-w-md text-center">
          <div
            className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-600/15 ring-1 ring-red-500/40"
            style={{ animation: "vaksina-lock-pulse 2s ease-in-out infinite" }}
          >
            <Lock className="h-9 w-9 text-red-500" strokeWidth={2.2} />
          </div>

          <h1 id="vaksina-lock-title" className="mt-6 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Bugun tizimga kirish cheklangan
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-300 sm:text-lg">{message}</p>

          <button
            type="button"
            onClick={() => void openReason()}
            className="mt-6 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl border border-red-500/40 bg-red-500/10 text-base font-bold text-red-100 transition hover:bg-red-500/20 active:scale-[.98]"
          >
            <FileText className="h-5 w-5" />
            Bloklanish asosi
          </button>
          <p className="mt-2 text-xs text-zinc-500">Nega bloklanganingiz — sanalar va qoidalar bilan</p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm leading-relaxed text-zinc-400">
            Cheklovni olib tashlash uchun HR guruhiga yozing: ismingiz, filialingiz va vaziyatni qisqacha
            tushuntiring. Admin yoki HR ruxsat bergach, sahifa o‘zi ochiladi.
          </div>

          <HrButton />
        </div>
      ) : (
        <div className="w-full max-w-lg">
          <button
            type="button"
            onClick={() => setView("main")}
            className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Orqaga
          </button>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-600/15 ring-1 ring-red-500/40">
              <FileText className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <h1 id="vaksina-lock-title" className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                Bloklanish asosi
              </h1>
              <p className="text-sm text-zinc-400">Nega bugun tizim siz uchun yopiq</p>
            </div>
          </div>

          {detailsLoading ? (
            <p className="mt-10 flex items-center justify-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </p>
          ) : detailsError || !details ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-zinc-300">
              Tafsilotlarni hozir yuklab bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring yoki HR guruhiga yozing.
              <button
                type="button"
                onClick={() => {
                  setDetails(null);
                  setDetailsError(false);
                  void openReason();
                }}
                className="mt-3 block rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
              >
                Qayta urinish
              </button>
            </div>
          ) : (
            <ReasonBody details={details} />
          )}

          <HrButton />
        </div>
      )}
    </div>,
    document.body,
  );
}

function ReasonBody({ details }: { details: LockDetails }) {
  const total = details.events.length;
  const trigger = details.events.find((e) => e.trigger);
  const parts = [
    details.late ? `${details.late} marta kech kelgansiz` : "",
    details.absent ? `${details.absent} marta ishga kelmagansiz` : "",
  ].filter(Boolean);

  return (
    <>
      <div className="mt-6 rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-950/70 to-red-900/20 p-4 text-[15px] leading-relaxed text-red-50">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-red-300">
          <AlertTriangle className="h-4 w-4" /> Qisqacha
        </p>
        <p className="mt-2">
          <b>{details.monthLabel}</b> oyida davomat qoidasi <b>{total} marta</b> buzilgan
          {parts.length ? <> — {parts.join(", ")}</> : null}.
        </p>
        <p className="mt-2 text-red-100/90">
          Qoidaga ko‘ra oy davomida <b>{details.lockFrom}-marta va undan keyingi</b> har bir buzilish qayd etilgan kuni
          platforma to‘liq yopiladi.
          {trigger ? (
            <>
              {" "}Sizning <b>{trigger.n}-buzilishingiz</b> {fmtDate(trigger.date)} ({trigger.weekday}) kuni qayd etildi —{" "}
              <b>{trigger.kindLabel.toLowerCase()}</b>. Shuning uchun bugun ({fmtDate(details.day)}) tizim yopiq.
            </>
          ) : null}
        </p>
      </div>

      <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Buzilishlar ro‘yxati</p>
      <ol className="space-y-2">
        {details.events.map((ev) => (
          <li
            key={ev.n}
            className={
              ev.trigger
                ? "rounded-2xl border border-red-500/50 bg-red-500/10 p-3.5 ring-1 ring-red-500/20"
                : "rounded-2xl border border-white/10 bg-white/[0.04] p-3.5"
            }
          >
            <div className="flex items-start gap-3">
              <span
                className={
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold " +
                  (ev.n >= details.lockFrom
                    ? "bg-red-600 text-white"
                    : ev.n >= 3
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-white/10 text-zinc-300")
                }
              >
                {ev.n}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-bold text-white">{fmtDate(ev.date)}</span>
                  <span className="text-sm text-zinc-400">{ev.weekday}</span>
                  {ev.trigger ? (
                    <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Bloklash sababi
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
                  {ev.kind === "late" ? (
                    <Clock3 className="h-4 w-4 text-amber-400" />
                  ) : (
                    <CalendarX2 className="h-4 w-4 text-red-400" />
                  )}
                  {ev.kind === "late"
                    ? `Kech keldi${ev.checkIn ? ` — ${ev.checkIn} da «Keldim» bosilgan` : ""}`
                    : "Kelmadi — shu kuni davomat belgilanmagan"}
                </p>
                {ev.branch || ev.shift ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                    <MapPin className="h-3.5 w-3.5" />
                    {[ev.branch, ev.shift].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                <p className="mt-1.5 text-xs text-zinc-400">
                  Oqibati: <span className="text-zinc-200">{ev.penalty}</span>
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
          <Scale className="h-4 w-4" /> Davomat qoidasi (oy bo‘yicha)
        </p>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-zinc-300">
          {details.rules.map((rule) => (
            <li key={rule} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
              {rule}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-4 text-sm leading-relaxed text-zinc-300">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-300">Endi nima qilish kerak</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>Pastdagi tugma orqali HR guruhiga yozing: ismingiz, filialingiz va qaysi sana nima bo‘lganini.</li>
          <li>Uzrli sabab bo‘lgan bo‘lsa (kasallik, oilaviy holat va h.k.) — hujjat yoki dalilni ham yuboring.</li>
          <li>Admin yoki HR tekshiradi. Blok ochilsa yoki kun uzrli deb topilsa, sahifa o‘zi ochiladi.</li>
        </ol>
      </div>
    </>
  );
}

function HrButton() {
  return (
    <>
      <a
        href={HR_GROUP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#229ED9] text-base font-bold text-white shadow-lg shadow-sky-900/40 transition hover:bg-[#1c8cc2] active:scale-[.98]"
      >
        <Send className="h-5 w-5" />
        HR guruhiga yozish
      </a>
      <p className="mt-3 text-center text-xs text-zinc-500">Telegram · VAKSINA HR Jamoasi</p>
    </>
  );
}
