import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  MapPin,
  ScanFace,
  Loader2,
  CheckCircle2,
  Lock,
  LogIn,
  LogOut,
  ShieldCheck,
  Clock3,
  CalendarDays,
  XCircle,
  History,
  ArrowDown,
  ArrowLeft,
  Banknote,
  QrCode,
  ChevronDown,
  SwitchCamera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { FaceScanDialog } from "@/components/FaceScanDialog";
import { QrScanDialog, openScanCamera } from "@/components/QrScanDialog";
import { DavomatPremiumView, type PremiumMethod } from "@/components/davomat/DavomatPremiumView";
import { useToast } from "@/hooks/use-toast";
import { enrollFace, fetchFaceIdStatus, isFaceIdSupported } from "@/lib/face-id";
import { deviceHeadingFromOrientation } from "@/lib/device-compass";
import {
  DAVOMAT_GEOFENCE_METERS,
  DAVOMAT_OFFICE_GEOFENCE_METERS,
  DAVOMAT_SITE_LABEL,
  DAVOMAT_SITE_LAT,
  DAVOMAT_SITE_LNG,
  DavomatApiError,
  facePunchDavomat,
  faceVerifyDavomat,
  fetchDavomatMethods,
  fetchDavomatSite,
  fetchMyDavomat,
  fetchMyWorkplace,
  haversineMeters,
  qrPunchDavomat,
  type DavomatDayMetrics,
  type DavomatEmployee,
  type DavomatSite,
  type WorkplaceInfo,
} from "@/lib/davomat-api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/i18n/I18nProvider";
import type { User } from "@workspace/api-client-react";
import { canViewDavomat } from "@/lib/roles";
import { roleLabel } from "@/lib/candidate-access";
import { useTelegramMiniAppChrome } from "@/pages/tg-entry";
import { formatSom, useOylikMe } from "@/lib/oylik-api";
import { workShiftForUserRole, workplaceDisplayTitle } from "@/lib/work-schedule";
import {
  queryCameraPermission,
  requestDavomatPermissions,
} from "@/lib/davomat-permissions";

const FACE_SNAP_KEY = "davomat-face-snap";

type Translate = (key: string, fallback?: string) => string;

function tr(t: Translate, key: string, vars?: Record<string, string | number>): string {
  let s = t(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

type Gps = {
  lat: number;
  lng: number;
  accuracy: number;
  heading?: number | null;
  speed?: number | null;
};
type Verified = {
  descriptor: number[];
  fullName: string;
  nextAction: "in" | "out" | "done";
  checkIn: string;
  checkOut: string;
  checkInAt: string | null;
  checkOutAt?: string | null;
  faceImage?: string;
  liveness?: { blinked?: boolean; poses?: string[]; motion?: number; score?: number };
  /** QR skan tasdiqlangan — Keldim/Ketdim bosilganda punch */
  qrPayload?: string;
};

type GuideStep = "enroll" | "permission" | "zone" | "face" | "keldim" | "ketdim" | "done";

function tashkentHour(now: number): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "numeric",
    hour12: false,
  }).format(new Date(now));
  return Number(raw);
}

/** Toshkent vaqti smena tugashiga yetganmi (HH:MM). */
function isAtOrAfterHm(now: number, hm: string): boolean {
  const endMin = hmToMinutes(hm);
  if (endMin == null) return tashkentHour(now) >= 18;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(now));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute >= endMin;
}

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Smena tugagach Ketdim uchun 2 soatlik oyna (backend CHECKOUT_GRACE_MS bilan bir xil) */
const CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;

function addYmdDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** workDate + endHm → smena tugashi (Toshkent, UTC+5) */
function shiftEndMs(workDateYmd: string, endHm: string, overnight?: boolean): number {
  const endDay = overnight ? addYmdDays(workDateYmd, 1) : workDateYmd;
  const hm = /^\d{1,2}:\d{2}$/.test(endHm) ? endHm : "18:00";
  return new Date(`${endDay}T${hm}:00+05:00`).getTime();
}

function formatHours(mins: number, t: Translate): string {
  const n = Math.max(0, Math.round(mins));
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hour = t("davomat.hourShort");
  const min = t("davomat.minShort");
  if (h === 0) return `${m} ${min}`;
  if (m === 0) return `${h} ${hour}`;
  return `${h} ${hour} ${m} ${min}`;
}

function punchPlanLabelI18n(kind: "in" | "out", time: string, t: Translate): string {
  return tr(t, kind === "in" ? "davomat.planIn" : "davomat.planOut", { time });
}

function hmToMinutes(hm: string): number | null {
  if (!hm || hm === "—") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function workedMinutesFromPunch(params: {
  checkIn: string;
  checkOut: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
}): number | null {
  if (params.checkInAt && params.checkOutAt) {
    return Math.max(
      0,
      Math.round(
        (new Date(params.checkOutAt).getTime() - new Date(params.checkInAt).getTime()) / 60000,
      ),
    );
  }
  const a = hmToMinutes(params.checkIn);
  const b = hmToMinutes(params.checkOut);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const STATUS_KEYS: Record<string, string> = {
  present: "davomat.arrived",
  late: "davomat.lateShort",
  incomplete: "davomat.noOut",
  absent: "davomat.absent",
  leave: "davomat.leaveShort",
};

const STATUS_STYLE: Record<string, string> = {
  present: "bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  late: "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  incomplete: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  absent: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  leave: "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
};

const MONTH_KEYS = [
  "month.1",
  "month.2",
  "month.3",
  "month.4",
  "month.5",
  "month.6",
  "month.7",
  "month.8",
  "month.9",
  "month.10",
  "month.11",
  "month.12",
] as const;

const WD_KEYS = [
  "davomat.wd.0",
  "davomat.wd.1",
  "davomat.wd.2",
  "davomat.wd.3",
  "davomat.wd.4",
  "davomat.wd.5",
  "davomat.wd.6",
] as const;

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function weekdayIndex(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function splitDay(ymd: string, t: Translate): { date: string; weekday: string } {
  const p = parseYmd(ymd);
  if (!p) return { date: ymd, weekday: "" };
  const week = t(WD_KEYS[weekdayIndex(p.y, p.m, p.d)]!);
  const month = t(MONTH_KEYS[p.m - 1]!);
  return {
    date: `${p.d}-${month}`,
    weekday: `${week[0]!.toUpperCase()}${week.slice(1)}`,
  };
}

function formatLongDate(ms: number, t: Translate): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const week = t(WD_KEYS[weekdayIndex(p.y, p.m, p.d)]!);
  const month = t(MONTH_KEYS[p.m - 1]!);
  return `${week[0]!.toUpperCase()}${week.slice(1)}, ${p.d}-${month} ${p.y}`;
}

function formatDistanceParts(meters: number, t: Translate): { value: string; unit: string } {
  if (!Number.isFinite(meters)) return { value: "—", unit: "" };
  if (Math.abs(meters) >= 1000) {
    const km = meters / 1000;
    const raw = km >= 10 ? km.toFixed(1) : km.toFixed(2);
    const value = raw.replace(/\.0$/, "").replace(/(\.\d)0$/, "$1");
    return { value, unit: "km" };
  }
  const steps = Math.max(1, Math.round(Math.abs(meters) / 0.75));
  return { value: String(steps), unit: t("davomat.stepsUnit") };
}

function formatDistance(meters: number | null | undefined, t: Translate): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  const p = formatDistanceParts(meters, t);
  return `${p.value} ${p.unit}`;
}

function formatApproach(remain: number | null | undefined, t: Translate): string {
  if (remain == null || !Number.isFinite(remain) || remain <= 0) return t("davomat.inZone");
  if (remain >= 1000) return tr(t, "davomat.approachFar", { dist: formatDistance(remain, t) });
  return tr(t, "davomat.approachSteps", { n: formatDistanceParts(remain, t).value });
}

function sortDaysDesc(days: DavomatDayMetrics[]): DavomatDayMetrics[] {
  return [...days].sort((a, b) => b.date.localeCompare(a.date));
}

function MobileStepHint({
  step,
  label,
  tone = "amber",
}: {
  step: number;
  label: string;
  tone?: "amber" | "rose" | "emerald";
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "dv-step-hint border-l-[3px]",
        tone === "amber" && "border-l-primary",
        tone === "rose" && "border-l-rose-500",
        tone === "emerald" && "border-l-teal-500",
      )}
    >
      <span
        className={cn(
          "dv-step-badge",
          tone === "amber" && "dv-step-badge-warn",
          tone === "rose" && "dv-step-badge-danger",
          tone === "emerald" && "dv-step-badge-success",
        )}
      >
        {step}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tr(t, "davomat.stepLabel", { n: step })}
        </p>
        <p className="text-sm font-medium leading-snug text-foreground">{label}</p>
      </div>
      <ArrowDown className="h-4 w-4 shrink-0 animate-bounce text-muted-foreground" aria-hidden />
    </div>
  );
}

function ScrollDownHint({ label }: { label: string }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const onScroll = () => {
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
      setShow(!nearBottom);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollBy({ top: Math.min(420, window.innerHeight * 0.55), behavior: "smooth" })}
      className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-semibold text-foreground shadow-lg backdrop-blur md:hidden"
    >
      <ChevronDown className="h-4 w-4 animate-bounce" />
      {label}
    </button>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center py-1 text-muted-foreground" aria-hidden>
      <ArrowDown className="h-5 w-5 animate-bounce" />
    </div>
  );
}

function GuideBoard({
  active,
  faceRegistered,
  inside,
  hasGps,
  cameraGranted,
  adminAnywhere,
  hasIn,
  afterShiftEnd,
  done,
  pharmacyStaff,
  canOpenFace,
  canOpenQr,
  onOpenFace,
  onOpenQr,
  methodsBusy,
}: {
  active: GuideStep;
  faceRegistered: boolean | null;
  inside: boolean;
  hasGps: boolean;
  cameraGranted: boolean;
  adminAnywhere?: boolean;
  hasIn: boolean;
  afterShiftEnd: boolean;
  done: boolean;
  pharmacyStaff: boolean;
  canOpenFace?: boolean;
  canOpenQr?: boolean;
  onOpenFace?: () => void;
  onOpenQr?: () => void;
  methodsBusy?: boolean;
}) {
  const { t } = useI18n();

  if (pharmacyStaff) {
    const permOk = cameraGranted && (adminAnywhere || hasGps);
    const zoneOk = adminAnywhere || (hasGps && inside);
    const steps = [
      {
        id: "permission" as const,
        n: 1,
        title: t("davomat.grantPermission"),
        detail: t("davomat.permissionDetail"),
      },
      {
        id: "zone" as const,
        n: 2,
        title: t("davomat.enterZone"),
        detail: t("davomat.zoneDetail"),
      },
      {
        id: "face" as const,
        n: 3,
        title: t("davomat.pickMethodTitle"),
        detail: t("davomat.pickMethodDetail"),
      },
      {
        id: (hasIn ? "ketdim" : "keldim") as GuideStep,
        n: 4,
        title: hasIn ? t("davomat.pressOut") : t("davomat.pressIn"),
        detail: hasIn ? t("davomat.ketdimDetailMixed") : t("davomat.keldimDetailMixed"),
      },
    ];

    return (
      <section className="dv-card">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("davomat.guideTitle")}
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-foreground">{t("davomat.guideSteps")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("davomat.guideHintPharmacy")}</p>
          </div>
          {done ? (
            <span className="dv-tone-emerald rounded-full border px-2.5 py-1 text-[11px] font-semibold">
              {t("davomat.todayDone")}
            </span>
          ) : null}
        </div>

        <ol className="space-y-0">
          {steps.map((it, idx) => {
            const isActive =
              (it.n === 1 && active === "permission") ||
              (it.n === 2 && active === "zone") ||
              (it.n === 3 && active === "face") ||
              (it.n === 4 && (active === "keldim" || active === "ketdim"));
            const methodReady = Boolean(hasIn || (active === "keldim" && !done));
            const passed =
              done ||
              (it.n === 1 && permOk) ||
              (it.n === 2 && zoneOk) ||
              (it.n === 3 && methodReady) ||
              (it.n === 4 && done);

            return (
              <li key={`${it.id}-${it.n}`}>
                {idx > 0 ? <FlowArrow /> : null}
                <div
                  className={cn(
                    "flex gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
                    isActive && !passed && it.id !== "zone" && "dv-guide-active",
                    passed && "dv-guide-passed",
                    !isActive && !passed && "dv-guide-idle",
                    it.id === "zone" && isActive && "dv-guide-danger",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      passed && "dv-step-badge-success",
                      isActive && !passed && it.id === "zone" && "dv-step-badge-danger",
                      isActive && !passed && it.id !== "zone" && "dv-step-badge-warn",
                      !isActive && !passed && "bg-muted text-muted-foreground",
                    )}
                  >
                    {passed ? "✓" : it.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {tr(t, "davomat.stepLabel", { n: it.n })}: {it.title}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-xs leading-snug",
                        it.id === "zone" && isActive
                          ? "font-medium text-rose-700 dark:text-rose-300"
                          : "text-muted-foreground",
                      )}
                    >
                      {it.detail}
                    </p>
                    {it.n === 3 && !done ? (
                      <div className="mt-3 flex items-stretch justify-center gap-2.5">
                        <Button
                          type="button"
                          size="sm"
                          className="h-auto min-h-[3.5rem] w-[7.75rem] shrink-0 flex-col gap-0.5 rounded-2xl px-2.5 py-2.5 text-primary-foreground shadow-sm"
                          disabled={!canOpenFace || methodsBusy}
                          onClick={() => onOpenFace?.()}
                        >
                          <span className="flex items-center justify-center gap-1 text-[11px] font-bold leading-none">
                            <ScanFace className="h-3.5 w-3.5 shrink-0" />
                            Face ID
                          </span>
                          <span className="text-center text-[10px] font-normal leading-tight opacity-90">
                            {t("davomat.frontCam")}
                          </span>
                        </Button>
                        <span className="self-center shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("davomat.orWord")}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          className="h-auto min-h-[3.5rem] w-[7.75rem] shrink-0 flex-col gap-0.5 rounded-2xl px-2.5 py-2.5 text-primary-foreground shadow-sm"
                          disabled={!canOpenQr || methodsBusy}
                          onClick={() => onOpenQr?.()}
                        >
                          <span className="flex items-center justify-center gap-1 text-[11px] font-bold leading-none">
                            <QrCode className="h-3.5 w-3.5 shrink-0" />
                            {t("davomat.qrScanner")}
                          </span>
                          <span className="text-center text-[10px] font-normal leading-tight opacity-90">
                            {t("davomat.rearCam")}
                          </span>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {active === "zone" ? (
          <p className="dv-tone-rose mt-3 rounded-xl border px-3 py-2 text-center text-sm font-semibold">
            {t("davomat.zoneWarnBanner")}
          </p>
        ) : null}
        {(active === "ketdim" || (hasIn && !done && afterShiftEnd)) ? (
          <p className="dv-tone-rose mt-3 rounded-xl border px-3 py-2 text-center text-sm font-semibold">
            {t("davomat.step4OutBanner")}
          </p>
        ) : null}
      </section>
    );
  }

  const items: Array<{
    id: GuideStep;
    n: number;
    title: string;
    detail: string;
  }> = [
    {
      id: "enroll",
      n: 0,
      title: t("davomat.enrollFace"),
      detail: t("davomat.enrollDetail"),
    },
    {
      id: "permission",
      n: 1,
      title: t("davomat.grantPermission"),
      detail: t("davomat.permissionDetail"),
    },
    {
      id: "zone",
      n: 1,
      title: t("davomat.enterZone"),
      detail: t("davomat.zoneDetail"),
    },
    {
      id: "face",
      n: 2,
      title: t("davomat.pressFace"),
      detail: t("davomat.faceDetail"),
    },
    {
      id: "keldim",
      n: 3,
      title: t("davomat.pressIn"),
      detail: t("davomat.keldimDetail"),
    },
    {
      id: "ketdim",
      n: 4,
      title: t("davomat.pressOut"),
      detail: t("davomat.ketdimDetail"),
    },
  ];

  const visible = items.filter((it) => {
    if (it.id === "enroll") return faceRegistered === false;
    if (it.id === "zone") return faceRegistered !== false && hasGps && !inside && !hasIn && !done;
    if (it.id === "permission") return faceRegistered !== false && (!hasGps || !inside) && !hasIn && !done;
    if (it.id === "face") return faceRegistered !== false;
    if (it.id === "keldim") return faceRegistered !== false;
    if (it.id === "ketdim") return faceRegistered !== false && (hasIn || afterShiftEnd || done);
    return true;
  });

  const board = (() => {
    const out: typeof items = [];
    const seen = new Set<number>();
    for (const it of visible) {
      if (it.id === "enroll") {
        out.push(it);
        continue;
      }
      if (it.id === "permission" || it.id === "zone") {
        if (seen.has(1)) continue;
        seen.add(1);
        out.push(
          !hasGps
            ? items.find((x) => x.id === "permission")!
            : inside
              ? items.find((x) => x.id === "permission")!
              : items.find((x) => x.id === "zone")!,
        );
        continue;
      }
      if (seen.has(it.n)) continue;
      seen.add(it.n);
      out.push(it);
    }
    return out;
  })();

  return (
    <section className="dv-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("davomat.guideTitle")}
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-foreground">{t("davomat.guideSteps")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("davomat.guideHint")}</p>
        </div>
        {done ? (
          <span className="dv-tone-emerald rounded-full border px-2.5 py-1 text-[11px] font-semibold">
            {t("davomat.todayDone")}
          </span>
        ) : null}
      </div>
      <ol className="space-y-0">
        {board.map((it, idx) => {
          const isActive =
            active === it.id ||
            (active === "zone" && it.id === "zone") ||
            (active === "permission" && it.id === "permission");
          const passed =
            done ||
            (it.id === "enroll" && faceRegistered) ||
            (it.n === 1 && hasGps && inside) ||
            (it.id === "face" && (Boolean(hasIn) || active === "keldim" || active === "ketdim")) ||
            (it.id === "keldim" && hasIn) ||
            (it.id === "ketdim" && done);

          return (
            <li key={`${it.id}-${it.n}`}>
              {idx > 0 ? <FlowArrow /> : null}
              <div
                className={cn(
                  "flex gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
                  isActive && !passed && it.id !== "zone" && "dv-guide-active",
                  passed && "dv-guide-passed",
                  !isActive && !passed && "dv-guide-idle",
                  it.id === "zone" && isActive && "dv-guide-danger",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    passed && "dv-step-badge-success",
                    isActive && !passed && it.id === "zone" && "dv-step-badge-danger",
                    isActive && !passed && it.id !== "zone" && "dv-step-badge-warn",
                    !isActive && !passed && "bg-muted text-muted-foreground",
                  )}
                >
                  {passed ? "✓" : it.n === 0 ? "!" : it.n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {it.n === 0 ? t("davomat.stepFirst") : tr(t, "davomat.stepLabel", { n: it.n })}: {it.title}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xs leading-snug",
                      it.id === "zone" && isActive
                        ? "font-medium text-rose-700 dark:text-rose-300"
                        : "text-muted-foreground",
                    )}
                  >
                    {it.detail}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {active === "zone" ? (
        <p className="dv-tone-rose mt-3 rounded-xl border px-3 py-2 text-center text-sm font-semibold">
          {t("davomat.zoneWarnBanner")}
        </p>
      ) : null}
      {active === "ketdim" ? (
        <p className="dv-tone-rose mt-3 rounded-xl border px-3 py-2 text-center text-sm font-semibold">
          {t("davomat.step4OutBanner")}
        </p>
      ) : null}
    </section>
  );
}

function isTelegramMiniAppContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.Telegram?.WebApp) return true;
  try {
    return new URL(window.location.href).searchParams.get("tg") === "1";
  } catch {
    return false;
  }
}

export default function DavomatFacePage() {
  const { user, isAuthenticated, switchToUser } = useAuth();
  const { t, locale } = useI18n();
  const [, setLocation] = useLocation();
  const oylikMe = useOylikMe();
  const isTgMiniApp = useMemo(() => isTelegramMiniAppContext(), []);
  useTelegramMiniAppChrome();
  const { toast } = useToast();
  const canReport = canViewDavomat(user?.role);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsSharing, setGpsSharing] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [site, setSite] = useState<DavomatSite>({
    allowedMeters: DAVOMAT_OFFICE_GEOFENCE_METERS,
    label: DAVOMAT_SITE_LABEL,
    latitude: DAVOMAT_SITE_LAT,
    longitude: DAVOMAT_SITE_LNG,
    kind: "office",
  });
  const [workplace, setWorkplace] = useState<WorkplaceInfo | null>(null);
  const [historyDays, setHistoryDays] = useState<DavomatDayMetrics[]>([]);
  const [historyRange, setHistoryRange] = useState<"day" | "week" | "month">("week");
  const [faceRegistered, setFaceRegistered] = useState<boolean | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [pharmacyStaff, setPharmacyStaff] = useState(false);
  const [officeStaff, setOfficeStaff] = useState(false);
  const [adminQrAnywhere, setAdminQrAnywhere] = useState(false);
  const [methodsReady, setMethodsReady] = useState(false);
  const [canManageQr, setCanManageQr] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrStream, setQrStream] = useState<MediaStream | null>(null);
  const [methodHint, setMethodHint] = useState<"FACE_ID" | "QR" | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PremiumMethod>("FACE_ID");

  useEffect(() => {
    if (qrOpen) return;
    setQrStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, [qrOpen]);
  const [faceImage, setFaceImage] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(FACE_SNAP_KEY);
    } catch {
      return null;
    }
  });
  const watchRef = useRef<number | null>(null);
  const compassRef = useRef<number | null>(null);
  const lastCompassRef = useRef<number | null>(null);
  const hasAbsoluteCompassRef = useRef(false);
  const punchLockRef = useRef(false);
  const tgBootRef = useRef(false);
  const tgScanRef = useRef(false);
  const pharmacyGateRef = useRef(false);

  const applyHistory = useCallback((emp?: DavomatEmployee | null) => {
    if (!emp?.days?.length) return;
    setHistoryDays(sortDaysDesc(emp.days));
  }, []);

  const refreshFaceStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setFaceRegistered(null);
      return;
    }
    try {
      const s = await fetchFaceIdStatus();
      setFaceRegistered(s.registered);
    } catch {
      setFaceRegistered(null);
    }
  }, [isAuthenticated]);

  const loadWorkplace = useCallback(async () => {
    if (!isAuthenticated) {
      setWorkplace(null);
      return;
    }
    try {
      const w = await fetchMyWorkplace();
      setWorkplace(w);
    } catch {
      setWorkplace(null);
    }
  }, [isAuthenticated]);

  const loadHistory = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const mine = await fetchMyDavomat();
      applyHistory(mine.employee);
    } catch {
      /* Face ID dan keyin ham keladi */
    }
  }, [isAuthenticated, applyHistory]);

  useEffect(() => {
    void fetchDavomatSite().then(setSite);
  }, []);

  useEffect(() => {
    if (!workplace?.site) return;
    if (
      typeof workplace.site.latitude !== "number" ||
      typeof workplace.site.longitude !== "number"
    ) {
      return;
    }
    setSite({
      allowedMeters: workplace.allowedMeters || DAVOMAT_GEOFENCE_METERS,
      label: workplace.site.label,
      latitude: workplace.site.latitude,
      longitude: workplace.site.longitude,
    });
  }, [workplace]);

  useEffect(() => {
    void loadWorkplace();
  }, [loadWorkplace]);

  /** Telefon OS bildirishnomasi ruxsati — Ketdim eslatmalari uchun */
  useEffect(() => {
    if (!isAuthenticated) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    void Notification.requestPermission();
  }, [isAuthenticated]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void refreshFaceStatus();
  }, [refreshFaceStatus]);

  useEffect(() => {
    if (!isAuthenticated) {
      setPharmacyStaff(false);
      setAdminQrAnywhere(false);
      setCanManageQr(false);
      setMethodsReady(true);
      pharmacyGateRef.current = false;
      return;
    }
    setMethodsReady(false);
    pharmacyGateRef.current = false;
    void fetchDavomatMethods()
      .then((m) => {
        setPharmacyStaff(m.pharmacyStaff);
        setOfficeStaff(Boolean(m.officeStaff) || (m.methods.includes("QR") && !m.pharmacyStaff && !m.adminQrAnywhere));
        setAdminQrAnywhere(Boolean(m.adminQrAnywhere));
        setCanManageQr(m.canManageQr);
      })
      .catch(() => {
        setPharmacyStaff(false);
        setOfficeStaff(false);
        setAdminQrAnywhere(false);
        setCanManageQr(false);
      })
      .finally(() => {
        setMethodsReady(true);
      });
  }, [isAuthenticated]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const applyGps = (pos: GeolocationPosition) => {
    const gpsHeadingRaw = pos.coords.heading;
    const gpsHeading =
      typeof gpsHeadingRaw === "number" && Number.isFinite(gpsHeadingRaw) && gpsHeadingRaw >= 0
        ? gpsHeadingRaw
        : null;
    const speed =
      typeof pos.coords.speed === "number" && Number.isFinite(pos.coords.speed)
        ? pos.coords.speed
        : null;
    const movingFast = speed != null && speed > 1.8;

    setGps((prev) => {
      // Asosiy: kompas (telefon oldi). GPS heading faqat tez harakat + kompas yo‘q.
      let nextHeading = lastCompassRef.current;
      if (nextHeading == null && movingFast && gpsHeading != null) {
        nextHeading = gpsHeading;
      }
      if (nextHeading == null && prev) {
        const dLat = Math.abs(pos.coords.latitude - prev.lat);
        const dLng = Math.abs(pos.coords.longitude - prev.lng);
        if (dLat > 1.2e-6 || dLng > 1.2e-6) {
          const toRad = (d: number) => (d * Math.PI) / 180;
          const φ1 = toRad(prev.lat);
          const φ2 = toRad(pos.coords.latitude);
          const Δλ = toRad(pos.coords.longitude - prev.lng);
          const y = Math.sin(Δλ) * Math.cos(φ2);
          const x =
            Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
          nextHeading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
        } else {
          nextHeading = prev.heading ?? null;
        }
      }

      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy || 0),
        heading: nextHeading,
        speed,
      };
    });
    setGpsError(null);
  };

  const onCompass = useCallback((ev: DeviceOrientationEvent) => {
    // Absolute bor bo‘lsa, relative eventlarni e’tiborsiz qoldiramiz
    if (ev.type === "deviceorientationabsolute") {
      hasAbsoluteCompassRef.current = true;
    } else if (hasAbsoluteCompassRef.current && ev.type === "deviceorientation") {
      return;
    }
    const deg = deviceHeadingFromOrientation(ev);
    if (deg == null) return;
    lastCompassRef.current = deg;
    setGps((prev) => {
      if (!prev) return prev;
      if (prev.heading != null) {
        const delta = Math.abs(((prev.heading - deg) + 540) % 360 - 180);
        if (delta < 1) return prev;
      }
      return { ...prev, heading: deg };
    });
  }, []);

  const startCompass = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (compassRef.current) return;
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied" | "default">;
    };
    try {
      if (typeof DOE.requestPermission === "function") {
        const p = await DOE.requestPermission();
        if (p !== "granted") return;
      }
    } catch {
      /* ignore */
    }

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.removeEventListener("deviceorientationabsolute", onCompass as EventListener, true);
    window.removeEventListener("deviceorientation", onCompass as EventListener, true);
    // Absolute birinchi (Android Chrome)
    window.addEventListener("deviceorientationabsolute", onCompass as EventListener, opts);
    window.addEventListener("deviceorientation", onCompass as EventListener, opts);
    compassRef.current = 1;
  }, [onCompass]);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) return;
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      applyGps,
      (err) => {
        setGpsError(
          err.code === 1
            ? t("davomat.gpsDenied")
            : t("davomat.gpsFailed"),
        );
      },
      { enableHighAccuracy: true, maximumAge: 500, timeout: 12_000 },
    );
    void startCompass();
  }, [t, startCompass]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError(t("davomat.gpsUnsupported"));
    }
    void queryCameraPermission().then((state) => {
      if (state === "granted") setCameraGranted(true);
    });
    // GPS allaqachon bo‘lsa — kompasni ham yoqamiz
    void startCompass();
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      window.removeEventListener("deviceorientationabsolute", onCompass as EventListener, true);
      window.removeEventListener("deviceorientation", onCompass as EventListener, true);
      compassRef.current = null;
    };
  }, [t, onCompass, startCompass]);

  const requestLocationPermission = async () => {
    setGpsSharing(true);
    try {
      const result = await requestDavomatPermissions();

      if (result.camera) {
        setCameraGranted(true);
      } else {
        setCameraGranted(false);
      }

      if (result.gps) {
        applyGps(result.gps);
        startWatch();
        setGpsError(null);
      } else if (result.gpsError === "gps_unsupported") {
        setGpsError(t("davomat.gpsUnsupported"));
      } else if (result.gpsError === "gps_denied") {
        setGpsError(t("davomat.gpsDenied"));
      } else if (result.gpsError) {
        setGpsError(t("davomat.gpsFailed"));
      }

      if (result.gps && result.camera) {
        toast({
          title: t("davomat.gpsGrantedTitle"),
          description: tr(t, "davomat.gpsGrantedDesc", {
            m: Math.round(result.gps.coords.accuracy || 0),
          }),
        });
      } else if (result.camera && !result.gps && adminQrAnywhere) {
        toast({
          title: t("davomat.gpsGrantedTitle"),
          description: t("davomat.permsAllOk"),
        });
      } else if (result.gps && !result.camera) {
        toast({
          title: t("davomat.permsCamBlockedTitle"),
          description:
            result.cameraError === "camera_missing"
              ? t("davomat.permsCamMissing")
              : t("davomat.permsCamDenied"),
          variant: "destructive",
        });
      } else if (!result.gps && result.camera) {
        toast({
          title: t("davomat.gpsNotGranted"),
          description: result.gpsError === "gps_denied" ? t("davomat.gpsAskAgain") : t("davomat.gpsFailed"),
          variant: "destructive",
        });
      } else {
        const camMsg =
          result.cameraError === "camera_missing"
            ? t("davomat.permsCamMissing")
            : result.cameraError === "camera_denied"
              ? t("davomat.permsCamDenied")
              : null;
        toast({
          title: t("davomat.gpsNotGranted"),
          description:
            camMsg ||
            (result.gpsError === "gps_denied" ? t("davomat.gpsAskAgain") : t("davomat.gpsFailed")),
          variant: "destructive",
        });
      }
    } finally {
      setGpsSharing(false);
    }
  };

  const checkInAtIso = verified?.checkInAt || workplace?.today.checkInAt || null;
  const checkOutAtIso = verified?.checkOutAt || workplace?.today.checkOutAt || null;
  const dayStatus = workplace?.today.status || null;
  const working =
    Boolean(checkInAtIso) &&
    dayStatus !== "absent" &&
    dayStatus !== "leave" &&
    !(verified?.nextAction === "done" || workplace?.today.complete);

  const workDateYmd =
    workplace?.workDate ||
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowTick));

  const elapsedLabel = useMemo(() => {
    if (!checkInAtIso) return "0:00:00";
    const start = new Date(checkInAtIso).getTime();
    const shiftEnd =
      workplace?.shift?.end ||
      (user?.role ? workShiftForUserRole(user.role).end : null) ||
      "18:00";
    const overnight =
      workplace?.shift?.overnight ??
      (user?.role ? Boolean(workShiftForUserRole(user.role).overnight) : false);
    const graceCap = shiftEndMs(workDateYmd, shiftEnd, overnight) + CHECKOUT_GRACE_MS;
    const rawEnd = checkOutAtIso
      ? new Date(checkOutAtIso).getTime()
      : Math.min(nowTick, graceCap);
    return formatElapsed(Math.max(0, rawEnd - start));
  }, [
    checkInAtIso,
    checkOutAtIso,
    nowTick,
    workDateYmd,
    workplace?.shift?.end,
    workplace?.shift?.overnight,
    dayStatus,
    user?.role,
  ]);

  const clockLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
        timeZone: "Asia/Tashkent",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(nowTick),
    [nowTick, locale],
  );

  const dateParts = useMemo(() => {
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowTick));
    const p = parseYmd(ymd);
    if (!p) {
      return { weekday: "", dayMonth: ymd, year: "", label: ymd };
    }
    const week = t(WD_KEYS[weekdayIndex(p.y, p.m, p.d)]!);
    const month = t(MONTH_KEYS[p.m - 1]!);
    const weekday = `${week[0]!.toUpperCase()}${week.slice(1)}`;
    const dayMonth = `${p.d} ${month}`;
    return {
      weekday,
      dayMonth,
      year: String(p.y),
      label: `${weekday}, ${dayMonth} ${p.y}`,
    };
  }, [nowTick, t]);
  const dateLabel = dateParts.label;

  const distance = useMemo(() => {
    if (!gps) return null;
    return haversineMeters(gps.lat, gps.lng, site.latitude, site.longitude);
  }, [gps, site.latitude, site.longitude]);

  const allowedMeters = workplace?.allowedMeters || site.allowedMeters || DAVOMAT_GEOFENCE_METERS;
  const remain = distance != null ? Math.max(0, distance - allowedMeters) : null;
  /** Filial GPS yo‘q bo‘lsa ofis nuqtasiga tushib «Hududdasiz» deb yolg‘on yashil ko‘rsatilmasin */
  const workplaceGpsMissing = workplace?.employee.hasGps === false;
  const inside =
    !workplaceGpsMissing && distance != null ? distance <= allowedMeters : false;

  const nextAction = verified?.nextAction || workplace?.today.nextAction || "in";
  const done = nextAction === "done" || workplace?.today.complete;
  const hasIn = nextAction === "out" || done || Boolean(checkInAtIso);
  const shiftEndHm =
    workplace?.shift?.end ||
    (user?.role ? workShiftForUserRole(user.role).end : null) ||
    "18:00";
  /** Smena tugaganmi — 1-smena 17:00, ofis 18:00, 2-smena 23:45 */
  const afterShiftEnd = isAtOrAfterHm(nowTick, shiftEndHm);

  /**
   * Face ID skani davomat profilini aniqlaydi (tizim login emas).
   * faceRegistered === false kutish — status 401 bo‘lsa tugma abadiy yopiq qolardi.
   */
  /** Face ID: barcha xodimlar — enroll bo‘lmasa ham tugma ochilsin */
  const canOpenFace =
    methodsReady &&
    cameraGranted &&
    Boolean(gps) &&
    !gpsError &&
    isFaceIdSupported() &&
    inside &&
    !done;

  /** QR: barcha xodimlar — GPS + zona; admin — lokatsiya shartsiz */
  const canOpenQr =
    methodsReady &&
    cameraGranted &&
    !done &&
    (adminQrAnywhere || (Boolean(gps) && !gpsError && inside));

  /** Face ID | QR — ofis, farmasevt va barcha rollar */
  const showDualMethods = methodsReady;

  const faceVerifiedReady = Boolean(verified?.descriptor && verified.descriptor.length > 0);
  const qrVerifiedReady = Boolean(verified?.qrPayload);
  const methodReady = faceVerifiedReady || qrVerifiedReady;

  const openFaceMethod = useCallback(() => {
    if (busy || qrVerifiedReady) return;
    if (!canOpenFace) return;
    setMethodHint(null);
    setQrOpen(false);
    if (faceRegistered === false) setEnrollOpen(true);
    else setScanOpen(true);
  }, [canOpenFace, busy, faceRegistered, qrVerifiedReady]);

  const openQrMethod = useCallback(() => {
    if (busy || faceVerifiedReady) {
      if (!cameraGranted && !faceVerifiedReady) {
        toast({
          title: t("davomat.permsCamBlockedTitle"),
          description: t("davomat.permsNeedBtn"),
          variant: "destructive",
        });
      }
      return;
    }
    if (!canOpenQr) return;
    setMethodHint(null);
    setScanOpen(false);
    setEnrollOpen(false);
    void (async () => {
      try {
        const stream = await openScanCamera();
        setCameraGranted(true);
        setQrStream((prev) => {
          prev?.getTracks().forEach((t) => t.stop());
          return stream;
        });
        setQrOpen(true);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        const msg =
          name === "NotFoundError" || name === "DevicesNotFoundError"
            ? t("davomat.permsCamMissing")
            : t("davomat.permsCamDenied");
        setCameraGranted(false);
        toast({
          title: t("davomat.permsCamBlockedTitle"),
          description: msg,
          variant: "destructive",
        });
      }
    })();
  }, [canOpenQr, busy, faceVerifiedReady, cameraGranted, toast, t]);

  const guideStep = useMemo((): GuideStep => {
    if (done) return "done";
    if (!showDualMethods && faceRegistered === false) return "enroll";
    // Face/QR uchun kamera majburiy (admin ham)
    if (showDualMethods && !cameraGranted) return "permission";
    if (!adminQrAnywhere && (!gps || gpsError)) return "permission";
    if (!adminQrAnywhere && !inside) return "zone";
    if (showDualMethods) {
      // Apteka/ofis/admin: avval Face ID yoki QR; tasdiqdan keyin Keldim/Ketdim
      if (!hasIn && !methodReady) return "face";
      if (!hasIn) return "keldim";
      return "ketdim";
    }
    if (!gps || gpsError) return "permission";
    if (!inside) return "zone";
    if (!verified) return "face";
    if (!hasIn) return "keldim";
    return "ketdim";
  }, [
    done,
    faceRegistered,
    gps,
    gpsError,
    inside,
    verified,
    hasIn,
    showDualMethods,
    adminQrAnywhere,
    methodReady,
    cameraGranted,
  ]);

  /** Mobil: doim aktiv qadamni ko‘rsat; desktopda ham panel ochiq */
  const showGuide = guideStep !== "done";

  const todayStatus = done
    ? "complete"
    : hasIn
      ? workplace?.today.status || "present"
      : gpsError
        ? "no_gps"
        : !gps
          ? "waiting_gps"
          : inside
            ? "inside"
            : "outside";

  const holatLabel =
    todayStatus === "complete"
      ? t("davomat.closedToday")
      : hasIn
        ? t(STATUS_KEYS[workplace?.today.status || "present"] || "davomat.arrived")
        : todayStatus === "inside"
          ? t("davomat.inside")
          : todayStatus === "outside"
            ? t("davomat.outside")
            : todayStatus === "no_gps"
              ? t("davomat.noLocation")
              : t("davomat.waitingGps");

  const faceLockedReason = useMemo(() => {
    if (faceRegistered === false) return t("davomat.needFace");
    if (gpsError) return gpsError;
    if (!gps) return t("davomat.step1Grant");
    if (!isFaceIdSupported()) return t("davomat.faceUnsupported");
    if (workplaceGpsMissing) {
      return (
        workplace?.gpsError ||
        t("davomat.branchGpsMissingHint")
      );
    }
    if (remain != null && remain > 0) {
      return tr(t, "davomat.notInZoneDetail", {
        dist: formatDistance(distance, t),
        approach: formatApproach(remain, t),
      });
    }
    return null;
  }, [faceRegistered, gps, gpsError, remain, distance, workplaceGpsMissing, workplace?.gpsError, t]);

  useEffect(() => {
    if (!isTgMiniApp || tgBootRef.current) return;
    tgBootRef.current = true;
    void requestLocationPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTgMiniApp]);

  /** Faqat ofis (Face-only): TG da avtomatik Face ochilsin. Apteka/admin dual — hech qachon. */
  useEffect(() => {
    if (!isTgMiniApp || !methodsReady || showDualMethods) return;
    if (tgScanRef.current || done || verified || faceRegistered === false) return;
    if (canOpenFace) {
      tgScanRef.current = true;
      setScanOpen(true);
    }
  }, [isTgMiniApp, methodsReady, showDualMethods, canOpenFace, done, verified, faceRegistered]);

  /** Dual method: avvalgi ofis/TG Face auto-open qolmasin (bir marta). */
  useEffect(() => {
    if (!methodsReady || !showDualMethods || pharmacyGateRef.current) return;
    pharmacyGateRef.current = true;
    setScanOpen(false);
    setEnrollOpen(false);
    setQrOpen(false);
  }, [methodsReady, showDualMethods]);

  const geoPayload = () => {
    if (!gps) throw new Error(t("davomat.gpsMissing"));
    return { latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracy };
  };

  const saveFaceImage = (snap?: string) => {
    if (!snap) return;
    setFaceImage(snap);
    try {
      sessionStorage.setItem(FACE_SNAP_KEY, snap);
    } catch {
      /* ignore quota */
    }
  };

  const adoptRecognizedProfile = useCallback(
    (sessionUser: User | null | undefined, fullName: string) => {
      if (!sessionUser?.id) return;
      switchToUser(sessionUser as User);
      toast({
        title: fullName || sessionUser.fullName,
        description: t("davomat.faceRecognized"),
      });
    },
    [switchToUser, toast, t],
  );

  const onCaptured = async (
    descriptor: number[] | number[][],
    snapshot?: string,
    liveness?: { blinked?: boolean; poses?: string[]; motion?: number; score?: number },
  ) => {
    if (!gps) throw new Error(t("davomat.gpsMissing"));
    if (!inside) {
      throw new Error(
        tr(t, "davomat.outsideThrow", {
          dist: formatDistance(distance, t),
          remain: formatDistance(remain, t),
        }),
      );
    }
    try {
      const list = (Array.isArray(descriptor[0]) ? descriptor : [descriptor]) as number[][];
      const vec = list[0]!;
      const result = await faceVerifyDavomat({
        descriptor: vec,
        descriptors: list,
        snapshot,
        liveness,
        ...geoPayload(),
      });
      saveFaceImage(snapshot);
      setMethodHint("FACE_ID");
      setScanOpen(false);
      setQrOpen(false);
      setVerified({
        descriptor: vec,
        fullName: result.fullName,
        nextAction: result.nextAction,
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        checkInAt: result.checkInAt,
        checkOutAt: result.checkOutAt,
        faceImage: snapshot,
        liveness,
      });
      applyHistory(result.employee);
      if (result.user) {
        if (result.ownerVerified) {
          toast({
            title: result.fullName,
            description: t("davomat.faceOwnerOk"),
          });
          void loadWorkplace();
          void loadHistory();
        } else {
          adoptRecognizedProfile(result.user as User, result.fullName);
          void loadWorkplace();
          void loadHistory();
        }
      } else {
        toast({
          title: result.fullName,
          description:
            result.nextAction === "done"
              ? t("davomat.alreadyBoth")
              : result.nextAction === "out"
                ? t("davomat.alreadyInOnlyOut")
                : t("davomat.faceOkPressIn"),
        });
      }
      return { fullName: result.fullName };
    } catch (err) {
      if (err instanceof DavomatApiError && err.code === "face_not_owner") {
        const msg =
          err.message ||
          (err.fullName
            ? tr(t, "davomat.notPerson", { name: err.fullName })
            : t("davomat.faceNotOwner"));
        toast({ title: t("davomat.wrongPerson"), description: msg, variant: "destructive" });
        throw new Error(msg);
      }
      if (err instanceof DavomatApiError && err.code === "outside_geofence") {
        if (
          err.workplace &&
          typeof err.workplace.latitude === "number" &&
          typeof err.workplace.longitude === "number"
        ) {
          setSite({
            allowedMeters: err.allowedMeters || DAVOMAT_GEOFENCE_METERS,
            label: err.workplace.location || site.label,
            latitude: err.workplace.latitude,
            longitude: err.workplace.longitude,
          });
        }
        const text =
          err.remainMeters != null && err.remainMeters < 1000
            ? formatApproach(err.remainMeters, t)
            : err.distanceMeters != null
              ? tr(t, "davomat.outsideFar", {
                  dist: formatDistance(err.distanceMeters, t),
                  approach: formatApproach(err.remainMeters, t),
                })
              : err.message || t("davomat.outsideTitle");
        toast({ title: t("davomat.outsideTitle"), description: text, variant: "destructive" });
        throw new Error(text);
      }
      if (err instanceof DavomatApiError && err.code === "branch_gps_missing") {
        toast({ title: t("davomat.needGps"), description: err.message, variant: "destructive" });
        throw err;
      }
      throw err;
    }
  };

  const punch = async (action: "in" | "out") => {
    if (!verified) return;
    const usingQr = Boolean(verified.qrPayload) || methodHint === "QR";
    if (!usingQr && !gps) return;
    if (!adminQrAnywhere && usingQr && !gps) return;
    if (punchLockRef.current || busy) return;
    punchLockRef.current = true;
    setBusy(true);
    try {
      if (usingQr && verified.qrPayload) {
        const result = await qrPunchDavomat({
          payload: verified.qrPayload,
          ...(gps
            ? { latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracy }
            : {}),
          action,
        });
        setMethodHint("QR");
        setScanOpen(false);
        setQrOpen(false);
        setVerified({
          ...verified,
          descriptor: [],
          qrPayload: verified.qrPayload,
          nextAction: action === "in" ? "out" : "done",
          checkIn: result.checkIn,
          checkOut: result.checkOut,
          checkInAt: result.checkInAt ?? verified.checkInAt,
          checkOutAt: result.checkOutAt ?? verified.checkOutAt,
        });
        toast({
          title: action === "in" ? "✓ Keldim (QR)" : "✓ Ketdim (QR)",
          description: result.branchLabel
            ? `${result.message || "Qabul qilindi"} · ${result.branchLabel}`
            : result.message || "Davomat qayd etildi",
        });
        applyHistory(result.employee);
        await loadWorkplace();
        await loadHistory();
        return;
      }

      if (!gps) return;
      const result = await facePunchDavomat({
        descriptor: verified.descriptor,
        ...geoPayload(),
        action,
        snapshot: verified.faceImage,
        liveness: verified.liveness,
      });
      setVerified({
        ...verified,
        nextAction: action === "in" ? "out" : "done",
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        checkInAt: result.checkInAt ?? verified.checkInAt,
        checkOutAt: result.checkOutAt ?? verified.checkOutAt,
      });
      setMethodHint("FACE_ID");
      setScanOpen(false);
      if (result.user) {
        adoptRecognizedProfile(result.user as User, result.fullName || verified.fullName);
      }
      toast({
        title: action === "in" ? t("davomat.btnIn") : t("davomat.leftToast"),
        description: result.message,
      });
      applyHistory(result.employee);
      await loadWorkplace();
      await loadHistory();
    } catch (err) {
      if (
        err instanceof DavomatApiError &&
        (err.code === "already_in" || err.code === "already_complete")
      ) {
        setVerified({
          ...verified,
          nextAction: err.code === "already_complete" ? "done" : "out",
          checkIn: err.checkIn || verified.checkIn,
          checkOut: err.checkOut || verified.checkOut,
          checkInAt: err.checkInAt || verified.checkInAt,
          checkOutAt: err.checkOutAt || verified.checkOutAt,
        });
        toast({ title: t("davomat.alreadyMarked"), description: err.message });
        await loadWorkplace();
        await loadHistory();
        return;
      }
      toast({
        title: t("common.error"),
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      punchLockRef.current = false;
      setBusy(false);
      setConfirmOut(false);
    }
  };

  const onQrDetected = useCallback(
    async (payload: string) => {
      if (!adminQrAnywhere) {
        if (!gps) throw new Error(t("davomat.gpsMissing"));
        if (!inside) throw new Error(t("davomat.outside"));
      }
      const action = (verified?.nextAction || workplace?.today.nextAction || "in") as "in" | "out" | "done";
      if (action === "done") throw new Error(t("davomat.oncePerDay"));
      if (!payload.trim()) throw new Error("QR bo‘sh");

      // QR skan = tasdiq. Face ID ochilmasin — keyin Keldim/Ketdim.
      setScanOpen(false);
      setEnrollOpen(false);
      setQrOpen(false);
      setMethodHint("QR");
      setVerified({
        descriptor: [],
        qrPayload: payload.trim(),
        fullName: workplace?.employee.fullName || user?.fullName || t("davomat.employee"),
        nextAction: action === "out" ? "out" : "in",
        checkIn: workplace?.today.checkIn || "—",
        checkOut: workplace?.today.checkOut || "—",
        checkInAt: workplace?.today.checkInAt || null,
        checkOutAt: workplace?.today.checkOutAt || null,
      });
      toast({
        title: "✓ QR scanner tasdiqlandi",
        description: action === "out" ? "Endi «Ketdim» ni bosing" : "Endi «Keldim» ni bosing",
      });
    },
    [adminQrAnywhere, gps, inside, verified?.nextAction, workplace, user?.fullName, t],
  );

  const displayName =
    verified?.fullName || workplace?.employee.fullName || user?.fullName || t("davomat.employee");
  const displayShift = useMemo(() => {
    if (workplace?.shift) return workplace.shift;
    if (!user?.role) return null;
    return workShiftForUserRole(user.role);
  }, [workplace?.shift, user?.role]);
  const workplaceTitle = useMemo(
    () =>
      workplaceDisplayTitle(
        user?.role,
        workplace?.site ?? (site.kind ? { kind: site.kind, label: site.label } : null),
        workplace?.employee?.location,
        {
          mainOffice: t("davomat.mainOffice"),
          branchUnset: t("davomat.branchUnset"),
        },
      ),
    [user?.role, workplace?.site, workplace?.employee?.location, site.kind, site.label, t],
  );
  const position = roleLabel(user?.role) || t("davomat.employee");
  const department = user?.departmentName;
  const phone = user?.phone;
  const shownFace = verified?.faceImage || faceImage;
  const dayComplete = !verified && Boolean(workplace?.today.complete);
  const checkInLabel = verified?.checkIn || workplace?.today.checkIn || "—";
  const checkOutLabel = verified?.checkOut || workplace?.today.checkOut || "—";
  const closedWork = done
    ? workedMinutesFromPunch({
        checkIn: checkInLabel,
        checkOut: checkOutLabel,
        checkInAt: verified?.checkInAt || workplace?.today.checkInAt,
        checkOutAt: verified?.checkOutAt || workplace?.today.checkOutAt,
      })
    : null;
  const todayStamp =
    workplace?.workDate ||
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(nowTick);

  const filteredHistoryDays = useMemo(() => {
    const sorted = sortDaysDesc(historyDays);
    if (historyRange === "day") {
      return sorted.filter((d) => d.date === todayStamp).slice(0, 1);
    }
    if (historyRange === "week") {
      return sorted.slice(0, 7);
    }
    return sorted.slice(0, 31);
  }, [historyDays, historyRange, todayStamp]);

  const historySummary = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let minutes = 0;
    for (const d of filteredHistoryDays) {
      if (d.status === "present") present += 1;
      else if (d.status === "late") late += 1;
      else if (d.status === "absent") absent += 1;
      const w =
        d.checkIn !== "—" && d.checkOut !== "—"
          ? workedMinutesFromPunch({ checkIn: d.checkIn, checkOut: d.checkOut })
          : null;
      if (w != null) minutes += w;
      else if (typeof d.workedMinutes === "number") minutes += d.workedMinutes;
    }
    return { present, late, absent, minutes, count: filteredHistoryDays.length };
  }, [filteredHistoryDays]);

  const ringClass = inside
    ? "ring-4 ring-teal-400/70"
    : gps
      ? "ring-4 ring-rose-400/60"
      : "ring-4 ring-primary-foreground/25";

  const locationReady = Boolean(gps) && inside && !gpsError && faceRegistered !== false;
  const showFaceStep =
    faceRegistered !== false &&
    (locationReady || Boolean(verified) || Boolean(gps) || (hasIn && !done));
  const showPunchStep =
    Boolean(verified) &&
    !done &&
    !dayComplete &&
    (faceVerifiedReady || qrVerifiedReady || methodHint === "QR");

  /** Usul tanlangach Face/QR tugmalari yashirinadi — faqat Keldim/Ketdim */
  const showMethodPicker = showDualMethods && !done && !methodReady;
  const canPunchOut = hasIn && !done;

  const onEnrollCaptured = async (
    descriptor: number[] | number[][],
    snapshot?: string,
    liveness?: { blinked?: boolean; poses?: string[]; motion?: number; score?: number },
  ) => {
    await enrollFace(descriptor, snapshot, liveness);
    setFaceRegistered(true);
    saveFaceImage(snapshot);
    toast({
      title: t("davomat.enrollOk"),
      description: t("davomat.enrollOkDesc"),
    });
    await refreshFaceStatus();
  };

  const firstName = displayName.trim().split(/\s+/)[0] || displayName;
  const roleLine = [position, workplaceTitle].filter(Boolean).join(" · ");
  const needsPerms =
    !cameraGranted || (!adminQrAnywhere && (!gps || Boolean(gpsError)));
  /** GPS bor, lekin yashil zonadan tashqarida — usul/CTA bloklanadi */
  const outsideZone =
    !adminQrAnywhere && Boolean(gps) && !gpsError && !inside && !done;
  const mapNeedsGps = !adminQrAnywhere && (!gps || Boolean(gpsError));
  const gpsDenied =
    Boolean(gpsError) &&
    /ruxsat|denied|sozlama|berilmadi|bermadingiz|ask again/i.test(gpsError || "");
  const addressHint = workplace?.employee?.location || department || null;
  const outsideWarn =
    remain != null
      ? `Hududdan tashqaridasiz — yana ${Math.max(0, Math.round(remain))} m`
      : "Hududdan tashqaridasiz — yashil zonaga kiring";

  const cta = (() => {
    if (done) {
      return {
        label: t("davomat.closedToday"),
        sub: elapsedLabel ? `Ishlagan: ${elapsedLabel}` : "",
        disabled: true,
        tone: "done" as const,
      };
    }
    if (outsideZone) {
      return {
        label: "Hududdan tashqaridasiz",
        sub:
          remain != null
            ? `Yana ${Math.max(0, Math.round(remain))} m yaqinlashin`
            : "Avval yashil zona ichiga kiring",
        disabled: true,
        tone: "warn" as const,
      };
    }
    if (needsPerms) {
      return {
        label: gpsSharing ? "Joylashuv olinmoqda…" : "Ruxsat berish",
        sub: "Kamera va geolokatsiya",
        disabled: gpsSharing,
        tone: "perm" as const,
      };
    }
    if (!methodReady) {
      const face = selectedMethod === "FACE_ID";
      return {
        label: "Davom etish",
        sub: face
          ? faceRegistered === false
            ? "Face ID ro‘yxatdan o‘tkazish"
            : "Face ID orqali tasdiqlash"
          : "QR kodni skaner qilish",
        disabled: false,
        tone: "go" as const,
      };
    }
    if (!hasIn) {
      return {
        label: "Keldim",
        sub: "Bosib davomatni boshlang",
        disabled: busy,
        tone: "in" as const,
      };
    }
    return {
      label: "Ketdim",
      sub: afterShiftEnd
        ? `Ishlagan: ${elapsedLabel}`
        : `Ishlagan: ${elapsedLabel} · smena ${shiftEndHm} gacha`,
      disabled: busy || !canPunchOut,
      tone: "out" as const,
    };
  })();

  const handleContinue = () => {
    if (done || busy) return;
    if (outsideZone) return;
    if (needsPerms) {
      void requestLocationPermission();
      return;
    }
    if (!inside && !adminQrAnywhere) return;
    if (!methodReady) {
      if (selectedMethod === "QR") openQrMethod();
      else openFaceMethod();
      return;
    }
    if (!hasIn) {
      void punch("in");
      return;
    }
    setConfirmOut(true);
  };

  const pickMethod = (m: PremiumMethod) => {
    if (done || busy || outsideZone) return;
    if (m === "FACE_ID" && !canOpenFace) return;
    if (m === "QR" && !canOpenQr) return;
    setSelectedMethod(m);
    if (!methodReady) setMethodHint(null);
    if (needsPerms) {
      void requestLocationPermission();
      return;
    }
    if (methodReady) return;
    if (m === "QR") openQrMethod();
    else openFaceMethod();
  };

  const historyRows =
    historyDays.length === 0 ? (
      <p className="px-3 py-6 text-center text-xs text-white/45">{t("davomat.historyEmpty")}</p>
    ) : filteredHistoryDays.length === 0 ? (
      <p className="px-3 py-6 text-center text-xs text-white/45">{t("davomat.rangeEmpty")}</p>
    ) : (
      <ul className="divide-y divide-white/5">
        {filteredHistoryDays.slice(0, historyRange === "day" ? 1 : historyRange === "week" ? 7 : 14).map((d) => {
          const isToday = d.date === todayStamp;
          const dayParts = splitDay(d.date, t);
          return (
            <li
              key={d.date}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-2.5",
                isToday && "bg-sky-500/10",
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {dayParts.date}
                  {isToday ? (
                    <span className="ml-1.5 text-[10px] font-semibold text-sky-300">{t("davomat.todayTag")}</span>
                  ) : null}
                </p>
                <p className="text-[11px] capitalize text-white/45">{dayParts.weekday}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs tabular-nums">
                  <span className="text-emerald-300">{d.checkIn}</span>
                  <span className="text-white/30"> · </span>
                  <span className="text-rose-300">{d.checkOut}</span>
                </p>
                <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-sky-300/95">
                  {d.workedMinutes > 0
                    ? formatHours(d.workedMinutes, t)
                    : d.workedHours && d.workedHours !== "0:00" && d.workedHours !== "0"
                      ? d.workedHours
                      : `0 ${t("davomat.hourShort")}`}
                </p>
                <p className="text-[10px] text-white/45">
                  {t(STATUS_KEYS[d.status] || d.status, d.status)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    );

  return (
    <>
      <DavomatPremiumView
        firstName={firstName}
        roleLine={roleLine}
        dateLabel={dateLabel}
        dateWeekday={dateParts.weekday}
        dateDayMonth={dateParts.dayMonth}
        dateYear={dateParts.year}
        clockLabel={clockLabel}
        checkInLabel={checkInLabel}
        checkOutLabel={checkOutLabel}
        planIn={displayShift?.start || null}
        planOut={displayShift?.end || null}
        hasIn={hasIn}
        done={Boolean(done)}
        inside={inside}
        distance={distance}
        allowedMeters={allowedMeters}
        siteLat={site.latitude}
        siteLng={site.longitude}
        userLat={gps?.lat}
        userLng={gps?.lng}
        headingDeg={gps?.heading}
        accuracyMeters={gps?.accuracy}
        workplaceTitle={workplaceTitle}
        addressHint={null}
        needsGps={mapNeedsGps}
        gpsDenied={gpsDenied || Boolean(gpsError)}
        gpsSharing={gpsSharing}
        methodsReady={methodsReady}
        showMethodPicker={Boolean(methodsReady && !done && !methodReady)}
        selectedMethod={selectedMethod}
        onSelectMethod={setSelectedMethod}
        onPickMethod={pickMethod}
        canOpenFace={canOpenFace}
        canOpenQr={canOpenQr}
        outsideZone={outsideZone}
        outsideWarn={outsideWarn}
        methodReady={methodReady}
        faceRegistered={faceRegistered}
        busy={busy}
        working={Boolean(working)}
        elapsedLabel={elapsedLabel}
        ctaLabel={cta.label}
        ctaSub={cta.sub}
        ctaDisabled={cta.disabled}
        ctaTone={cta.tone}
        onContinue={handleContinue}
        onEnableGps={() => void requestLocationPermission()}
        backHref="/dashboard"
        canManageQr={canManageQr}
        canReport={canReport}
        isTgMiniApp={isTgMiniApp}
        isAuthenticated={isAuthenticated}
        salary={
          oylikMe.data
            ? {
                monthLabel: oylikMe.data.monthLabel,
                fixedSalary: oylikMe.data.fixedSalary,
                kpiPercent: oylikMe.data.kpiPercent,
                bonusAmount: oylikMe.data.bonusAmount,
                totalAmount: oylikMe.data.totalAmount,
              }
            : null
        }
        formatSom={formatSom}
        historyDays={historyDays}
        historyRange={historyRange}
        onHistoryRange={setHistoryRange}
        historyRows={historyRows}
        t={t}
      />

      <FaceScanDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        mode="enroll"
        title={t("davomat.enrollTitle")}
        description={t("davomat.frontCamHint")}
        onCaptured={onEnrollCaptured}
      />

      <FaceScanDialog
        open={scanOpen && methodHint !== "QR" && !qrVerifiedReady}
        onOpenChange={setScanOpen}
        mode="login"
        title={t("davomat.faceTitle")}
        description={t("davomat.frontCamHint")}
        onCaptured={onCaptured}
      />

      <QrScanDialog
        open={qrOpen && methodHint !== "FACE_ID" && !faceVerifiedReady}
        stream={qrStream}
        onOpenChange={setQrOpen}
        title={
          nextAction === "out"
            ? t("davomat.qrScanTitleOut")
            : t("davomat.qrScanTitleIn")
        }
        description={
          adminQrAnywhere
            ? t("davomat.qrScanDescAdmin")
            : pharmacyStaff
              ? t("davomat.qrScanDescBranch")
              : t("davomat.qrScanDescDept")
        }
        onDetected={onQrDetected}
      />

      {showDualMethods && !done ? <ScrollDownHint label={t("davomat.scrollDownHint")} /> : null}

      <AlertDialog open={confirmOut} onOpenChange={setConfirmOut}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Ketdim?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Ishlagan vaqt:{" "}
                  <span className="font-mono text-base font-bold text-foreground">{elapsedLabel}</span>
                </p>
                {!afterShiftEnd ? (
                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-800 dark:text-amber-200">
                    Ogohlantirish: smena tugashidan ({shiftEndHm}) oldin ketmoqdasiz. Baribir
                    ketasizmi?
                  </p>
                ) : (
                  <p>Smena yakunlandi. Ketdimni tasdiqlaysizmi?</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="rounded-xl">Yo‘q</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void punch("out")}
            >
              Ha — Ketdim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
