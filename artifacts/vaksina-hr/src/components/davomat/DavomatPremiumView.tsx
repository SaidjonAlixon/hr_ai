import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Bot,
  Clock3,
  Fingerprint,
  History,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  QrCode,
  ScanFace,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Banknote,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { useTheme } from "next-themes";
import { DavomatZoneMap } from "@/components/davomat/DavomatZoneMap";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatShortUz } from "@/lib/oylik-period";
import type { DavomatDayMetrics } from "@/lib/davomat-api";

export type PremiumMethod = "FACE_ID" | "QR" | "FINGERPRINT";

type Props = {
  /** To‘liq ism familiya (birinchi so‘z emas) */
  personName: string;
  roleLine: string;
  dateLabel: string;
  dateWeekday?: string;
  dateDayMonth?: string;
  dateYear?: string;
  clockLabel: string;
  checkInLabel: string;
  checkOutLabel: string;
  planIn?: string | null;
  planOut?: string | null;
  hasIn: boolean;
  done: boolean;
  inside: boolean;
  distance: number | null;
  allowedMeters: number;
  siteLat: number;
  siteLng: number;
  userLat?: number | null;
  userLng?: number | null;
  headingDeg?: number | null;
  accuracyMeters?: number | null;
  workplaceTitle: string;
  addressHint?: string | null;
  needsGps: boolean;
  gpsDenied?: boolean;
  /** GPS o‘chiq yoki nuqta eskirgan — «tashqaridasiz» emas */
  gpsOff?: boolean;
  gpsFresh?: boolean;
  gpsSharing: boolean;
  methodsReady: boolean;
  /** Admin ko‘chma ruxsat — istalgan joydan davomat */
  mobileAnywhere?: boolean;
  showMethodPicker: boolean;
  onDismissMethods?: () => void;
  selectedMethod: PremiumMethod;
  onSelectMethod: (m: PremiumMethod) => void;
  /** Tanlash + darhol shu usulni ochish */
  onPickMethod: (m: PremiumMethod) => void;
  canOpenFace: boolean;
  canOpenQr: boolean;
  /** Admin o‘chirgan usul kartasi umuman chizilmaydi */
  showFace: boolean;
  showQr: boolean;
  /** Faqat admin yoqqan xodimda true — aks holda karta umuman chizilmaydi */
  showFinger?: boolean;
  canOpenFinger?: boolean;
  fingerHint?: string;
  /** GPS bor, lekin zona tashqarisida */
  outsideZone?: boolean;
  outsideWarn?: string | null;
  methodReady: boolean;
  faceRegistered: boolean | null;
  busy: boolean;
  working: boolean;
  elapsedLabel: string;
  /** Koordinator ofis vaqti — «Yakunlandi» o‘rniga */
  workedCaption?: string;
  ctaLabel: string;
  ctaSub: string;
  ctaDisabled: boolean;
  /** perm | go | warn | in | out | done */
  ctaTone?: "perm" | "go" | "warn" | "in" | "out" | "done";
  /** Kun yopilganda AI / qoidalar izohi — faqat o‘z smenasi */
  closedExplain?: {
    title: string;
    body: string;
    bullets: string[];
    rules?: string[];
    source?: "gemini" | "rules";
    loading?: boolean;
  } | null;
  /** Muammo / agent chat */
  onOpenAgentChat?: () => void;
  onContinue: () => void;
  onEnableGps: () => void;
  backHref: string;
  canManageQr: boolean;
  canReport: boolean;
  isTgMiniApp: boolean;
  isAuthenticated: boolean;
  salary?: {
    periodLabel: string;
    periodSalary: number;
    periodJarima: number;
    lines: Array<{ date: string; jarima: number; note: string }>;
  } | null;
  formatSom: (n: number) => string;
  historyDays: DavomatDayMetrics[];
  historyRange: "day" | "week" | "month";
  onHistoryRange: (r: "day" | "week" | "month") => void;
  historyRows: ReactNode;
  t: (key: string) => string;
};

/** Toshkent soati bo‘yicha: 18:00–06:00 → kechki rasm va binafsha mavzu */
function isNightClock(clockLabel: string): boolean {
  const h = Number(String(clockLabel).split(":")[0]);
  return Number.isFinite(h) && (h >= 18 || h < 6);
}

export function DavomatPremiumView(p: Props) {
  const { toast } = useToast();
  const [salaryOpen, setSalaryOpen] = useState(false);
  const inDone = Boolean(p.hasIn || p.done);
  /** Haqiqiy ketish vaqti bor — «—» bilan yopilgan kun «Ketdi» deb chalkashtirilmasin */
  const outPunched = Boolean(p.checkOutLabel && p.checkOutLabel !== "—");
  const outDone = Boolean(p.done && outPunched);
  const methodNames = [
    p.showFace ? "Face ID" : null,
    p.showQr ? "QR" : null,
    p.showFinger ? "barmoq izi" : null,
  ].filter((n): n is string => Boolean(n));
  const methodCount = methodNames.length;
  const { resolvedTheme } = useTheme();
  /** Tungi ko‘rinish: ilovada qorong‘u rejim tanlangan YOKI soat 18:00–06:00 */
  const night = resolvedTheme === "dark" || isNightClock(p.clockLabel);
  const methodLayout = methodCount >= 3 ? "is-col" : "is-row";

  const hintInfoOnly = () => {
    toast({
      title: "Bu yer bosilmaydi",
      description: "Bu yerda keldi–ketdi vaqtingiz ko‘rsatiladi",
    });
  };

  /** Xarita kartasi sarlavhasidagi holat belgisi */
  const zone: { tone: "ok" | "bad" | "warn"; label: string; Icon: typeof ShieldCheck } = (() => {
    if (p.needsGps || p.gpsDenied) return { tone: "warn", label: "GPS kerak", Icon: Navigation };
    if (p.gpsOff) return { tone: "warn", label: "GPS yoqing", Icon: Navigation };
    if (p.mobileAnywhere) return { tone: "ok", label: "Ko‘chma ruxsat", Icon: ShieldCheck };
    if (p.outsideZone) return { tone: "bad", label: "Hududdan tashqarida", Icon: TriangleAlert };
    if (p.inside) return { tone: "ok", label: "Ruxsat etilgan hudud", Icon: ShieldCheck };
    return { tone: "warn", label: "Aniqlanmoqda…", Icon: Navigation };
  })();

  const methodCard = (opts: {
    id: string;
    on: boolean;
    locked: boolean;
    tone: "t-face" | "t-qr" | "t-finger";
    icon: ReactNode;
    title: string;
    sub: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      id={opts.id}
      disabled={p.busy}
      onClick={opts.onClick}
      className={cn(
        "dvx-method",
        methodLayout,
        opts.on && !p.outsideZone && "is-on",
        (p.outsideZone || opts.locked) && "is-locked",
      )}
    >
      {opts.on && !p.outsideZone ? (
        <span className="absolute right-2.5 top-2.5 text-white">
          <CheckCircle2 className="h-4 w-4" />
        </span>
      ) : null}
      <span className={cn("dvx-method-ico", opts.tone)}>{opts.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="dvx-method-title block">{opts.title}</span>
        <span className="dvx-method-sub block">{p.outsideZone ? "Hududga kiring" : opts.sub}</span>
      </span>
    </button>
  );

  return (
    <div className={cn("davomat-face-page dv-premium", night ? "dv-night" : "dv-day")}>
      <div className="mx-auto max-w-lg px-3 pb-28 pt-0 sm:px-4">
        {/* Hero: kun/tun rasmi + salomlashuv + soat */}
        <div className="dvx-hero -mx-3 sm:-mx-4">
          <div className="dvx-hero-img dvx-hero-img-day" aria-hidden />
          <div className="dvx-hero-img dvx-hero-img-night" aria-hidden />
          <div className="dvx-hero-shade" aria-hidden />

          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={p.backHref} className="dvx-back mb-2.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Orqaga
              </Link>
              <div className="dvx-greet mt-7">
                <p className="text-[13.5px] font-semibold dvx-t2">Assalomu alaykum,</p>
                {p.personName ? (
                  <h1 className="mt-1 text-[1.5rem] font-extrabold leading-tight tracking-tight dvx-t1 sm:text-[1.65rem]">
                    {p.personName}
                  </h1>
                ) : null}
                {p.roleLine ? (
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13px] font-semibold dvx-t2">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{p.roleLine}</span>
                  </p>
                ) : null}
              </div>
            </div>
            <div className="dvx-date shrink-0">
              {p.dateWeekday ? (
                <>
                  <p className="dvx-date-week">{p.dateWeekday}</p>
                  <p className="dvx-date-day">
                    {p.dateDayMonth}
                    {p.dateYear ? <span> {p.dateYear}</span> : null}
                  </p>
                </>
              ) : (
                <p className="dvx-date-week">{p.dateLabel}</p>
              )}
            </div>
          </header>

          {/* Soat — faqat ma'lumot */}
          <button
            type="button"
            className="dvx-clock mt-6 w-full cursor-default text-left"
            onClick={hintInfoOnly}
          >
            <div className="relative z-[1] flex items-center gap-3">
              <div className="dvx-clock-icon">
                <Clock3 className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-white/95">Joriy vaqt</p>
                <p className="font-mono text-[1.7rem] font-extrabold leading-none tracking-tight tabular-nums sm:text-[1.95rem]">
                  {p.clockLabel}
                </p>
                <p className="mt-1 text-[11px] font-medium text-white/90">Bugun ham ajoyib kun!</p>
              </div>
              <div className="dvx-clock-split" />
              <div className="shrink-0 text-center">
                <p className="flex items-center justify-center gap-1 text-[10px] font-semibold leading-tight text-white/80">
                  <Timer className="h-3 w-3" />
                  Bugun ishlagan vaqt
                </p>
                <p
                  className={cn(
                    "mt-1.5 font-mono text-[1.35rem] font-extrabold leading-none tabular-nums",
                    p.working || p.done ? "text-emerald-200" : "text-white",
                  )}
                >
                  {p.elapsedLabel}
                </p>
                <span className={cn("dvx-pill mt-1.5", p.working && "is-live")}>
                  {p.workedCaption ??
                    (p.working ? "Davom etmoqda" : p.done ? "Yakunlandi" : "Hali boshlanmagan")}
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Keladi / Ketadi — faqat ma'lumot */}
        <section className="mt-3 grid grid-cols-2 gap-2.5">
          <button type="button" className="dvx-stat dvx-stat-in" onClick={hintInfoOnly}>
            <span className="dvx-stat-icon">
              <LogIn className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-bold leading-none">
                {inDone ? "Keldi" : "Keladi"}
                {inDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-100" />
                ) : (
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-white/75" />
                )}
              </span>
              <span className="mt-1 block font-mono text-[1.05rem] font-extrabold leading-none tabular-nums">
                {p.checkInLabel}
              </span>
              {p.planIn ? (
                <span className="mt-1 block text-[10px] leading-none text-white/80">Rejada: {p.planIn}</span>
              ) : null}
            </span>
          </button>
          <button type="button" className="dvx-stat dvx-stat-out" onClick={hintInfoOnly}>
            <span className="dvx-stat-icon">
              <LogOut className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-bold leading-none">
                {outDone ? "Ketdi" : p.done ? "Ketmadi" : "Ketadi"}
                {outDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-rose-100" />
                ) : p.done ? (
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-200" />
                ) : (
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-white/75" />
                )}
              </span>
              <span className="mt-1 block font-mono text-[1.05rem] font-extrabold leading-none tabular-nums">
                {p.checkOutLabel}
              </span>
              {p.planOut ? (
                <span className="mt-1 block text-[10px] leading-none text-white/80">Rejada: {p.planOut}</span>
              ) : null}
            </span>
          </button>
        </section>

        {/* Ish joyi hududi + xarita */}
        <section className="dvx-card mt-3">
          <div className="dvx-card-head">
            <span className="dvx-ico">
              <MapPin className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-extrabold leading-tight dvx-t1">Ish joyi hududi</h2>
              <p className="truncate text-[11.5px] font-medium dvx-t3">{p.workplaceTitle}</p>
            </div>
            <span className={cn("dvx-zone", `is-${zone.tone}`)}>
              <zone.Icon className="h-3.5 w-3.5" />
              {zone.label}
            </span>
          </div>
          <div className="px-2.5 pb-2.5">
            <DavomatZoneMap
              siteLat={p.siteLat}
              siteLng={p.siteLng}
              userLat={p.userLat}
              userLng={p.userLng}
              headingDeg={p.headingDeg}
              accuracyMeters={p.accuracyMeters}
              inside={p.inside}
              mobileAnywhere={Boolean(p.mobileAnywhere)}
              allowedMeters={p.allowedMeters}
              label={p.workplaceTitle}
              addressHint={p.addressHint}
              distanceMeters={p.distance}
              needsGps={p.needsGps}
              gpsDenied={p.gpsDenied}
              gpsFresh={p.gpsFresh !== false}
              baseTag="Asos"
              onEnableGps={p.onEnableGps}
            />
          </div>
          {p.outsideZone && methodCount > 0 ? (
            <p className="px-4 pb-3 text-center text-xs font-semibold leading-snug text-rose-500">
              {p.outsideWarn || "Hududdan tashqaridasiz — davomat ochilmaydi"}
            </p>
          ) : null}
        </section>

        {/* Usullar */}
        {p.methodsReady && p.showMethodPicker ? (
          <section className="mt-4" id="dv-coach-methods">
            <div className="flex items-center gap-3">
              <span className="dvx-ico h-11 w-11">
                <Fingerprint className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15.5px] font-extrabold leading-tight dvx-t1">Davomat usulini tanlang</h2>
                <p className="mt-0.5 text-xs dvx-t3">
                  {methodCount === 0
                    ? "Siz uchun davomat usullari yopilgan"
                    : methodCount === 1
                      ? `Davomat usuli — ${methodNames[0]}`
                      : `Ish joyingizni tasdiqlang — ${methodNames.slice(0, -1).join(", ")} yoki ${methodNames[methodNames.length - 1]}`}
                </p>
              </div>
              {p.onDismissMethods ? (
                <button
                  type="button"
                  aria-label="Yopish"
                  onClick={p.onDismissMethods}
                  className="dvx-link-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:scale-95 md:hidden"
                >
                  <X className="h-5 w-5" />
                </button>
              ) : null}
            </div>

            {methodCount === 0 ? (
              <div className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-3 text-center text-xs font-semibold leading-snug text-rose-500">
                Hozircha siz uchun davomat usuli ochilmagan. Rahbaringizga murojaat qiling.
              </div>
            ) : (
              <div
                className={cn(
                  "mt-3 grid gap-2.5",
                  methodCount === 3 ? "grid-cols-3 gap-2" : methodCount === 2 ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                {p.showFace
                  ? methodCard({
                      id: "dv-coach-face",
                      on: p.selectedMethod === "FACE_ID",
                      locked: !p.canOpenFace,
                      tone: "t-face",
                      icon: <ScanFace className="h-6 w-6" />,
                      title: "Face ID",
                      sub:
                        p.faceRegistered === false
                          ? "Avval yuzni ro‘yxatdan o‘tkazing"
                          : "Yuz orqali tasdiqlash",
                      onClick: () => p.onPickMethod("FACE_ID"),
                    })
                  : null}
                {p.showQr
                  ? methodCard({
                      id: "dv-coach-qr",
                      on: p.selectedMethod === "QR",
                      locked: !p.canOpenQr,
                      tone: "t-qr",
                      icon: <QrCode className="h-6 w-6" />,
                      title: "QR Scanner",
                      sub: "QR kodni skaner qiling",
                      onClick: () => p.onPickMethod("QR"),
                    })
                  : null}
                {p.showFinger
                  ? methodCard({
                      id: "dv-coach-finger",
                      on: p.selectedMethod === "FINGERPRINT",
                      locked: !p.canOpenFinger,
                      tone: "t-finger",
                      icon: <Fingerprint className="h-6 w-6" />,
                      title: "Barmoq izi",
                      sub: p.fingerHint || "Barmoqni skanerga qo‘ying",
                      onClick: () => p.onPickMethod("FINGERPRINT"),
                    })
                  : null}
              </div>
            )}
          </section>
        ) : null}

        {p.methodReady && !p.done ? (
          <div
            className={cn(
              "mt-3 flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-medium",
              p.gpsOff
                ? "border-rose-400/30 bg-rose-500/10 text-rose-600"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            )}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {p.gpsOff
              ? "GPS yoqing, so‘ng qayta kiring"
              : `Tasdiqlandi — endi ${p.hasIn ? "Ketdim" : "Keldim"} ni bosing`}
          </div>
        ) : null}

        {/* CTA */}
        <div className="mt-4">
          <button
            type="button"
            className={cn(
              "dv-cta flex w-full flex-col items-center justify-center gap-0.5 px-4 py-3.5 disabled:cursor-not-allowed",
              p.ctaTone === "in" && "dv-cta-in",
              p.ctaTone === "out" && "dv-cta-out",
              p.ctaTone === "done" && "dv-cta-done",
              p.ctaTone === "warn" && "dv-cta-warn",
            )}
            disabled={
              p.ctaDisabled ||
              p.busy ||
              (!p.gpsOff && !p.methodsReady) ||
              Boolean(p.outsideZone)
            }
            onClick={p.onContinue}
          >
            <span
              className={cn(
                "inline-flex items-center gap-2 text-base font-bold",
                p.ctaTone === "warn" && "text-rose-100",
              )}
            >
              {p.busy || (p.gpsSharing && p.ctaTone === "perm") ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : p.ctaTone === "in" ? (
                <LogIn className="h-5 w-5" />
              ) : p.ctaTone === "out" ? (
                <LogOut className="h-5 w-5" />
              ) : (
                <ArrowRight className="h-5 w-5" />
              )}
              {p.ctaLabel}
            </span>
            {p.ctaSub ? (
              <span
                className={cn(
                  "text-[11px] font-medium",
                  p.ctaTone === "warn" ? "font-semibold text-rose-200" : "text-white/85",
                )}
              >
                {p.ctaSub}
              </span>
            ) : null}
          </button>
        </div>

        {/* Kun yopilgan — faqat o‘z smenasi, ixcham */}
        {p.done && p.closedExplain ? (
          <section
            className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5"
            aria-live="polite"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-100">
                {p.closedExplain.loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Bot className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[12.5px] font-extrabold leading-tight text-amber-50">
                  {p.closedExplain.title}
                </h3>
                <p className="mt-1 text-[12px] leading-snug text-white/90">
                  {p.closedExplain.body}
                </p>
                {p.closedExplain.bullets?.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.closedExplain.bullets.map((b) => (
                      <span
                        key={b}
                        className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-emerald-100/95"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {/* Muammo — agent chat */}
        {p.onOpenAgentChat ? (
          <button
            type="button"
            onClick={p.onOpenAgentChat}
            className="dvx-agent-btn mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-bold transition active:scale-[0.99]"
          >
            <Bot className="h-4 w-4" />
            Muammo bo‘lsa yozing
          </button>
        ) : null}

        {/* Tarix */}
        <section className="dv-panel mt-5">
          <div className="dv-panel-head">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="dv-panel-icon dv-panel-icon-sky">
                <History className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold dvx-t1">{p.t("davomat.myToday")}</h2>
                <p className="text-[10px] dvx-t3">Davomat tarixi</p>
              </div>
            </div>
            <div className="dv-range-tabs shrink-0">
              {(["day", "week", "month"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => p.onHistoryRange(r)}
                  className={cn("dv-range-tab", p.historyRange === r && "dv-range-tab-on")}
                >
                  {r === "day" ? "Kun" : r === "week" ? "Hafta" : "Oy"}
                </button>
              ))}
            </div>
          </div>
          <div className="dv-panel-body">{p.historyRows}</div>
        </section>

        {p.isAuthenticated && p.salary ? (
          <section className="dv-panel dv-panel-salary mt-3">
            <button
              type="button"
              className="dv-panel-head w-full border-0 bg-transparent text-left"
              onClick={() => setSalaryOpen((open) => !open)}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="dv-panel-icon dv-panel-icon-emerald">
                  <Banknote className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold dvx-t1">{p.t("davomat.mySalary")}</h2>
                  <p className="text-[10px] dvx-t3">{p.salary.periodLabel}</p>
                </div>
              </div>
              <span className="dvx-link-chip shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold">
                {salaryOpen ? "Yopish" : "Batafsil"}
              </span>
            </button>
            <div className="dv-panel-body">
              <div className="grid grid-cols-2 gap-2">
                <div className="dv-salary-cell">
                  <p className="dv-salary-label">Fiksa</p>
                  <p className="dv-salary-value">{p.formatSom(p.salary.periodSalary)}</p>
                </div>
                <div className="dv-salary-cell">
                  <p className="dv-salary-label">Jarima</p>
                  <p className={cn("dv-salary-value", p.salary.periodJarima > 0 && "!text-rose-500")}>
                    {p.formatSom(p.salary.periodJarima)}
                  </p>
                </div>
                <div className="dv-salary-cell dv-salary-cell-total col-span-2">
                  <p className="dv-salary-label">Qoladi</p>
                  <p className="dv-salary-value !text-emerald-600 dark:!text-emerald-300">
                    {p.formatSom(p.salary.periodSalary - p.salary.periodJarima)}
                  </p>
                </div>
              </div>
              {salaryOpen ? (
                <div className="mt-2 space-y-1.5">
                  {p.salary.lines.length ? (
                    p.salary.lines.map((line) => (
                      <div
                        key={line.date}
                        className="dv-salary-cell flex items-center justify-between gap-3 !py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold dvx-t1">{formatShortUz(line.date)}</p>
                          <p className="truncate text-[10px] dvx-t3">{line.note || "Jarima"}</p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-rose-500">
                          −{p.formatSom(line.jarima)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="dv-salary-cell text-xs dvx-t3">Bu davrda jarima yo‘q.</p>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="mt-4 flex justify-center gap-4 text-sm">
          {!p.isTgMiniApp ? (
            <Link href="/login" className="dvx-link underline-offset-2 hover:underline">
              {p.t("davomat.loginLink")}
            </Link>
          ) : null}
          {p.isAuthenticated && p.canReport ? (
            <Link href="/davomat" className="dvx-link-chip rounded-full px-3.5 py-1.5 text-xs font-semibold">
              {p.t("davomat.report")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
