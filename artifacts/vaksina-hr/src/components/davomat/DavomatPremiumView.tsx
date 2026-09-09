import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  LogIn,
  LogOut,
  QrCode,
  ScanFace,
  Banknote,
} from "lucide-react";
import { Link } from "wouter";
import { DavomatZoneMap } from "@/components/davomat/DavomatZoneMap";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { DavomatDayMetrics } from "@/lib/davomat-api";

export type PremiumMethod = "FACE_ID" | "QR";

type Props = {
  firstName: string;
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
  gpsSharing: boolean;
  methodsReady: boolean;
  showMethodPicker: boolean;
  selectedMethod: PremiumMethod;
  onSelectMethod: (m: PremiumMethod) => void;
  /** Tanlash + darhol shu usulni ochish */
  onPickMethod: (m: PremiumMethod) => void;
  canOpenFace: boolean;
  canOpenQr: boolean;
  /** GPS bor, lekin zona tashqarisida */
  outsideZone?: boolean;
  outsideWarn?: string | null;
  methodReady: boolean;
  faceRegistered: boolean | null;
  busy: boolean;
  working: boolean;
  elapsedLabel: string;
  ctaLabel: string;
  ctaSub: string;
  ctaDisabled: boolean;
  /** perm | go | warn | in | out | done */
  ctaTone?: "perm" | "go" | "warn" | "in" | "out" | "done";
  onContinue: () => void;
  onEnableGps: () => void;
  backHref: string;
  canManageQr: boolean;
  canReport: boolean;
  isTgMiniApp: boolean;
  isAuthenticated: boolean;
  salary?: {
    monthLabel: string;
    fixedSalary: number;
    kpiPercent: number;
    bonusAmount: number;
    totalAmount: number;
  } | null;
  formatSom: (n: number) => string;
  historyDays: DavomatDayMetrics[];
  historyRange: "day" | "week" | "month";
  onHistoryRange: (r: "day" | "week" | "month") => void;
  historyRows: ReactNode;
  t: (key: string) => string;
};

export function DavomatPremiumView(p: Props) {
  const { toast } = useToast();
  const inDone = Boolean(p.hasIn || (p.checkInLabel && p.checkInLabel !== "—"));
  const outDone = Boolean(p.done || (p.checkOutLabel && p.checkOutLabel !== "—"));
  /** Joriy soat 19:00+ → kechasi.png (clockLabel Toshkent) */
  const nightHero = (() => {
    const h = Number(String(p.clockLabel).split(":")[0]);
    return Number.isFinite(h) && h >= 19;
  })();

  const hintInfoOnly = () => {
    toast({
      title: "Bu yer bosilmaydi",
      description: "Bu yerda keldi–ketdi vaqtingiz ko‘rsatiladi",
    });
  };

  return (
    <div className="davomat-face-page dv-premium">
      <div className="mx-auto max-w-lg px-3 pb-28 pt-0 sm:px-4">
        {/* Manzara / kechasi: header → soat → Keladi/Ketadi pastigacha */}
        <div
          className={cn(
            "dv-hero-banner -mx-3 px-3 pb-3.5 pt-4 sm:-mx-4 sm:px-4",
            nightHero && "dv-hero-banner-night",
          )}
        >
          <header className="relative z-[1] flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={p.backHref}
                className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Orqaga
              </Link>
              <p className="text-[15px] text-white/85 drop-shadow-sm">Assalomu alaykum</p>
              <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-white drop-shadow-sm">
                {p.firstName}
              </h1>
              <p className="mt-0.5 truncate text-sm text-white/70">{p.roleLine}</p>
            </div>
            <div className="dv-date-badge shrink-0">
              {p.dateWeekday ? (
                <>
                  <p className="dv-date-badge-week">{p.dateWeekday}</p>
                  <p className="dv-date-badge-day">
                    {p.dateDayMonth}
                    {p.dateYear ? <span className="dv-date-badge-year"> {p.dateYear}</span> : null}
                  </p>
                </>
              ) : (
                <p className="dv-date-badge-week">{p.dateLabel}</p>
              )}
            </div>
          </header>

          {/* Clock — faqat ma'lumot */}
          <button
            type="button"
            className="dv-clock-card relative z-[1] mt-4 w-full cursor-default px-3 py-3 text-left sm:px-4 sm:py-4"
            onClick={hintInfoOnly}
          >
            <div className="relative z-[1] flex items-center gap-2.5 sm:gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white shadow-inner sm:h-14 sm:w-14">
                <Clock3 className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white/70">Joriy vaqt</p>
                <p className="font-mono text-[1.55rem] font-bold leading-none tracking-tight text-white tabular-nums sm:text-[1.85rem]">
                  {p.clockLabel}
                </p>
                <p className="mt-1 text-[11px] text-white/65 sm:text-xs">Bugun ham ajoyib kun!</p>
              </div>
              <div className="dv-worked-card shrink-0 text-center">
                <p className="text-[9px] font-semibold leading-tight tracking-wide text-white/70 sm:text-[10px]">
                  Bugun ishlagan
                  <br />
                  vaqtingiz
                </p>
                <p
                  className={cn(
                    "mt-1.5 font-mono text-lg font-bold leading-none tabular-nums sm:text-xl",
                    p.working || p.done ? "text-emerald-300" : "text-white",
                  )}
                >
                  {p.elapsedLabel}
                </p>
                <p className="mt-1 text-[9px] font-medium text-white/55">
                  {p.working ? "Davom etmoqda" : p.done ? "Yakunlandi" : "Hali boshlanmagan"}
                </p>
              </div>
            </div>
          </button>

          {/* Keldi / Ketadi — faqat ma'lumot */}
          <section className="relative z-[1] mt-3 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              className="dv-status-in relative flex w-full cursor-default items-center gap-2 px-3 py-2 text-left"
              onClick={hintInfoOnly}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[11px] font-medium leading-none text-white/80">
                  {inDone ? "Keldi" : "Keladi"}
                  {inDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-200" />
                  ) : (
                    <Clock3 className="h-3.5 w-3.5 shrink-0 text-white/70" />
                  )}
                </p>
                <p className="mt-1 font-mono text-lg font-bold leading-none tabular-nums text-white">
                  {p.checkInLabel}
                </p>
                {p.planIn ? (
                  <p className="mt-1 text-[10px] leading-none text-white/65">Rejada: {p.planIn}</p>
                ) : null}
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/15 text-white">
                <LogIn className="h-5 w-5" />
              </div>
            </button>
            <button
              type="button"
              className="dv-status-out relative flex w-full cursor-default items-center gap-2 px-3 py-2 text-left"
              onClick={hintInfoOnly}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[11px] font-medium leading-none text-white/80">
                  {outDone ? "Ketdi" : "Ketadi"}
                  {outDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-rose-100" />
                  ) : (
                    <Clock3 className="h-3.5 w-3.5 shrink-0 text-white/70" />
                  )}
                </p>
                <p className="mt-1 font-mono text-lg font-bold leading-none tabular-nums text-white">
                  {p.checkOutLabel}
                </p>
                {p.planOut ? (
                  <p className="mt-1 text-[10px] leading-none text-white/65">Rejada: {p.planOut}</p>
                ) : null}
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/15 text-white">
                <LogOut className="h-5 w-5" />
              </div>
            </button>
          </section>
        </div>

        {/* Map */}
        <section className="mt-3">
          <DavomatZoneMap
            siteLat={p.siteLat}
            siteLng={p.siteLng}
            userLat={p.userLat}
            userLng={p.userLng}
            headingDeg={p.headingDeg}
            accuracyMeters={p.accuracyMeters}
            inside={p.inside}
            allowedMeters={p.allowedMeters}
            label={p.workplaceTitle}
            addressHint={p.addressHint}
            distanceMeters={p.distance}
            needsGps={p.needsGps}
            gpsDenied={p.gpsDenied}
            baseTag="Asos"
            onEnableGps={p.onEnableGps}
          />
        </section>

        {/* Methods */}
        {p.methodsReady && p.showMethodPicker ? (
          <section className="mt-4" id="dv-coach-methods">
            <h2 className="text-base font-semibold text-white">Davomat usulini tanlang</h2>
            <p className="mt-0.5 text-xs text-white/50">
              Istaganingizni tanlang — Face ID yoki QR
            </p>
            {p.outsideZone ? (
              <p className="mt-2 text-center text-xs font-semibold leading-snug text-rose-400">
                {p.outsideWarn || "Hududdan tashqaridasiz — Face ID / QR ochilmaydi"}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                id="dv-coach-face"
                disabled={p.outsideZone || !p.canOpenFace || p.busy}
                onClick={() => p.onPickMethod("FACE_ID")}
                className={cn(
                  "dv-method-card relative px-3 py-2.5 text-left",
                  p.selectedMethod === "FACE_ID" && !p.outsideZone && "dv-method-card-on",
                  (p.outsideZone || !p.canOpenFace) && "dv-method-card-locked",
                )}
              >
                {p.selectedMethod === "FACE_ID" && !p.outsideZone ? (
                  <span className="absolute right-2 top-2 text-sky-300">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                ) : null}
                <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
                  <ScanFace className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold leading-tight text-white">Face ID</p>
                <p
                  className={cn(
                    "mt-0.5 text-[10px] leading-snug",
                    p.outsideZone ? "font-semibold text-rose-400" : "text-white/50",
                  )}
                >
                  {p.outsideZone
                    ? "Hududga kiring"
                    : p.faceRegistered === false
                      ? "Avval yuzni ro‘yxatdan o‘tkazing"
                      : "Rasmga olish orqali tasdiqlash"}
                </p>
              </button>
              <button
                type="button"
                id="dv-coach-qr"
                disabled={p.outsideZone || !p.canOpenQr || p.busy}
                onClick={() => p.onPickMethod("QR")}
                className={cn(
                  "dv-method-card relative px-3 py-2.5 text-left",
                  p.selectedMethod === "QR" && !p.outsideZone && "dv-method-card-on",
                  (p.outsideZone || !p.canOpenQr) && "dv-method-card-locked",
                )}
              >
                {p.selectedMethod === "QR" && !p.outsideZone ? (
                  <span className="absolute right-2 top-2 text-sky-300">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                ) : null}
                <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/20 text-violet-300">
                  <QrCode className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold leading-tight text-white">QR Scanner</p>
                <p
                  className={cn(
                    "mt-0.5 text-[10px] leading-snug",
                    p.outsideZone ? "font-semibold text-rose-400" : "text-white/50",
                  )}
                >
                  {p.outsideZone ? "Hududga kiring" : "QR kodni skaner qiling"}
                </p>
              </button>
            </div>
          </section>
        ) : null}

        {p.methodReady && !p.done ? (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Tasdiqlandi — endi {p.hasIn ? "Ketdim" : "Keldim"} ni bosing
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
            disabled={p.ctaDisabled || p.busy || !p.methodsReady || Boolean(p.outsideZone)}
            onClick={p.onContinue}
          >
            <span
              className={cn(
                "inline-flex items-center gap-2 text-base font-bold",
                p.ctaTone === "warn" && "text-rose-100",
              )}
            >
              {p.busy || p.gpsSharing ? (
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

        {/* History */}
        <section className="dv-panel mt-5">
          <div className="dv-panel-head">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="dv-panel-icon dv-panel-icon-sky">
                <History className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-white">{p.t("davomat.myToday")}</h2>
                <p className="text-[10px] text-white/45">Davomat tarixi</p>
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
            <div className="dv-panel-head">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="dv-panel-icon dv-panel-icon-emerald">
                  <Banknote className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-white">{p.t("davomat.mySalary")}</h2>
                  <p className="text-[10px] text-white/45">{p.salary.monthLabel}</p>
                </div>
              </div>
              <Link
                href="/oylik"
                className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-sky-300"
              >
                Batafsil
              </Link>
            </div>
            <div className="dv-panel-body">
              <div className="grid grid-cols-2 gap-2">
                <div className="dv-salary-cell">
                  <p className="dv-salary-label">{p.t("davomat.fixedPay")}</p>
                  <p className="dv-salary-value">{p.formatSom(p.salary.fixedSalary)}</p>
                </div>
                <div className="dv-salary-cell">
                  <p className="dv-salary-label">KPI</p>
                  <p className="dv-salary-value">{p.salary.kpiPercent}%</p>
                </div>
                <div className="dv-salary-cell">
                  <p className="dv-salary-label">{p.t("davomat.bonus")}</p>
                  <p className="dv-salary-value">{p.formatSom(p.salary.bonusAmount)}</p>
                </div>
                <div className="dv-salary-cell dv-salary-cell-total">
                  <p className="dv-salary-label">{p.t("davomat.totalPay")}</p>
                  <p className="dv-salary-value text-sky-300">{p.formatSom(p.salary.totalAmount)}</p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="mt-4 flex justify-center gap-4 text-sm">
          {!p.isTgMiniApp ? (
            <Link href="/login" className="text-sky-300/90 underline-offset-2 hover:underline">
              {p.t("davomat.loginLink")}
            </Link>
          ) : null}
          {p.isAuthenticated && p.canReport ? (
            <Link
              href="/davomat"
              className="rounded-full border border-sky-400/25 bg-sky-500/10 px-3.5 py-1.5 text-xs font-semibold text-sky-300"
            >
              {p.t("davomat.report")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
