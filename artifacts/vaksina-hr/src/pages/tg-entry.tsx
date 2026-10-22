import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../hooks/use-toast";
import type { User } from "@workspace/api-client-react";
import { Loader2, RefreshCw, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider";
import { isPharmacyDeviceStaff, isReviziyaRole, requiresMandatoryFaceEnroll } from "../lib/roles";
import {
  getOrCreateClientDeviceKey,
  readDeviceBind,
  requestDeviceChange,
  saveDeviceBind,
} from "../lib/device-security-api";
import {
  ForeignDeviceWarning,
  LastApprovalBanner,
  SupportContacts,
  type LastDeviceApproval,
  type PrimaryDeviceInfo,
} from "../components/SupportContacts";
import { fetchFaceIdStatus } from "../lib/face-id";
import { Button } from "../components/ui/button";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        enableClosingConfirmation?: () => void;
        disableVerticalSwipes?: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        initData?: string;
        initDataUnsafe?: { user?: { id: number; first_name?: string } };
        themeParams?: Record<string, string>;
        isExpanded?: boolean;
        platform?: string;
        colorScheme?: string;
        openTelegramLink?: (url: string) => void;
      };
    };
  }
}

type DeviceGate = {
  code: "DEVICE_PENDING" | "DEVICE_NOT_AUTHORIZED";
  message: string;
  deviceName?: string;
  canRequestChange?: boolean;
  lastApproval?: LastDeviceApproval | null;
  foreignDevice?: boolean;
  primaryDevice?: PrimaryDeviceInfo | null;
};

function readTokenFromUrl(): string | null {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("token") || u.searchParams.get("tg") || null;
  } catch {
    return null;
  }
}

function readNextFromUrl(): string | null {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("next");
  } catch {
    return null;
  }
}

function prepareTelegramUi() {
  const wa = window.Telegram?.WebApp;
  if (!wa) return false;
  try {
    wa.ready();
    wa.expand();
    wa.enableClosingConfirmation?.();
    wa.disableVerticalSwipes?.();
    wa.setHeaderColor?.("#0b3a5c");
    wa.setBackgroundColor?.("#f8fafc");
  } catch {
    /* ignore */
  }
  document.documentElement.classList.add("tg-mini-app");
  document.body.classList.add("tg-mini-app");
  return true;
}

function devicePayload() {
  return {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "telegram-mini-app",
    clientKey: getOrCreateClientDeviceKey(),
    deviceBind: readDeviceBind() || undefined,
    deviceName: "Telegram Mini App",
    deviceType: "mobile",
    browser: "Telegram",
  };
}

async function miniAuth(
  payload: { initData?: string; token?: string },
  authFailMsg: string,
): Promise<{ user: User; ok?: boolean }> {
  const res = await fetch("/api/telegram/mini-auth", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...payload, device: devicePayload() }),
  });
  const body = await res.json().catch(() => ({}));
  const bind = (body as { deviceBind?: { deviceId?: string; token?: string } }).deviceBind;
  if (bind) saveDeviceBind(bind);
  if (!res.ok) {
    const err = new Error(
      (body as { error?: string; message?: string }).message ||
        (body as { error?: string }).error ||
        authFailMsg,
    ) as Error & { code?: string; data?: Record<string, unknown> };
    err.code = (body as { code?: string }).code;
    err.data = body as Record<string, unknown>;
    throw err;
  }
  return { user: body.user as User, ok: true };
}

async function redirectAfterLogin(
  user: User,
  next: string | null,
  setLocation: (path: string) => void,
) {
  let clean: string;
  if (next === "davomat-face" || next === "davomat-face?tg=1") {
    clean = "/davomat-face?tg=1";
  } else if (next && /^[a-zA-Z0-9/_?=&.%-]+$/.test(next) && !next.includes("..")) {
    clean = next.startsWith("/") ? next : `/${next}`;
  } else if (requiresMandatoryFaceEnroll(user.role)) {
    try {
      const face = await fetchFaceIdStatus();
      if (!face.registered) {
        clean = "/davomat-face?enroll=1&tg=1";
      } else if (isPharmacyDeviceStaff(user.role)) {
        clean = "/davomat-face?tg=1";
      } else if (user.role === "resepsion") {
        clean = "/resepsion";
      } else {
        clean = "/dashboard";
      }
    } catch {
      clean = "/davomat-face?enroll=1&tg=1";
    }
  } else if (user.role === "stajyor") {
    clean = "/kirish";
  } else if (isReviziyaRole(user.role)) {
    clean = "/reviziya";
  } else {
    clean = "/dashboard";
  }
  window.history.replaceState({}, "", clean);
  setLocation(clean);
}

/**
 * Telegram Mini App kirish.
 * Dorixona: qurilma bog‘lash + admin ruxsati + Face ID — brauzer bilan bir xil.
 */
export default function TgEntryPage() {
  const { t } = useI18n();
  const { switchToUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [phase, setPhase] = useState<"boot" | "auth" | "error" | "gate">("boot");
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<DeviceGate | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const finish = useCallback(
    async (u: User, label: string) => {
      switchToUser(u);
      await redirectAfterLogin(u, readNextFromUrl(), setLocation);
      toast({
        title: t("tg.welcome"),
        description: `${u.fullName} · ${label}`,
      });
    },
    [switchToUser, setLocation, toast, t],
  );

  const parseDeviceError = (
    e: Error & { code?: string; data?: Record<string, unknown> },
  ): DeviceGate | null => {
    const code = String(e.code || e.data?.code || "");
    if (code !== "DEVICE_PENDING" && code !== "DEVICE_NOT_AUTHORIZED") return null;
    const data = e.data || {};
    return {
      code: code as DeviceGate["code"],
      message: String(data.message || data.error || e.message),
      deviceName: (data.device as { name?: string } | undefined)?.name,
      canRequestChange: Boolean(data.canRequestChange) || code === "DEVICE_NOT_AUTHORIZED",
      lastApproval: (data.lastApproval as LastDeviceApproval | null | undefined) ?? null,
      foreignDevice: Boolean(data.foreignDevice) || code === "DEVICE_NOT_AUTHORIZED",
      primaryDevice: (data.primaryDevice as PrimaryDeviceInfo | null | undefined) ?? null,
    };
  };

  const tryEnter = useCallback(async (): Promise<"ok" | "gate" | "error"> => {
    prepareTelegramUi();
    const token = readTokenFromUrl();
    const initData = window.Telegram?.WebApp?.initData?.trim() || "";
    const authFail = t("tg.authFail");

    if (token) {
      try {
        const { user } = await miniAuth({ token }, authFail);
        await finish(user, t("tg.label.telegram"));
        return "ok";
      } catch (e) {
        const g = parseDeviceError(e as Error & { code?: string; data?: Record<string, unknown> });
        if (g) {
          setGate(g);
          return "gate";
        }
        // Token eskirgan — initData ga o‘tamiz
      }
    }

    if (initData) {
      try {
        const { user } = await miniAuth({ initData }, authFail);
        await finish(user, t("tg.label.mini"));
        return "ok";
      } catch (e) {
        const g = parseDeviceError(e as Error & { code?: string; data?: Record<string, unknown> });
        if (g) {
          setGate(g);
          return "gate";
        }
        setError((e as Error).message || t("tg.initFail"));
        return "error";
      }
    }

    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const existing = (await res.json()) as User;
        if (existing?.id) {
          await finish(existing, t("tg.label.session"));
          return "ok";
        }
      } else if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const code = String(body.code || "");
        if (code === "DEVICE_PENDING" || code === "DEVICE_NOT_AUTHORIZED") {
          setGate({
            code: code as DeviceGate["code"],
            message: String(body.message || body.error || "Qurilma ruxsati yo‘q"),
            canRequestChange: true,
          });
          return "gate";
        }
      }
    } catch {
      /* ignore */
    }

    setError(t("tg.noSession"));
    return "error";
  }, [finish, t]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setPhase("auth");
      const result = await tryEnter();
      if (cancelled) return;
      if (result === "ok") setPhase("auth");
      else if (result === "gate") setPhase("gate");
      else setPhase("error");
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [tryEnter]);

  const onRetryInitData = async () => {
    setRetrying(true);
    setPhase("auth");
    setError(null);
    setGate(null);
    try {
      const initData = window.Telegram?.WebApp?.initData?.trim() || "";
      if (!initData) {
        setPhase("error");
        setError(t("tg.noInitData"));
        return;
      }
      const { user } = await miniAuth({ initData }, t("tg.authFail"));
      await finish(user, t("tg.label.retry"));
    } catch (e) {
      const g = parseDeviceError(e as Error & { code?: string; data?: Record<string, unknown> });
      if (g) {
        setGate(g);
        setPhase("gate");
        return;
      }
      setPhase("error");
      setError((e as Error).message || t("tg.retryFail"));
    } finally {
      setRetrying(false);
    }
  };

  const onRequestChange = async () => {
    setRequesting(true);
    try {
      await requestDeviceChange("Telegram Mini App orqali so‘rov");
      toast({
        title: "So‘rov yuborildi",
        description: "Administrator tasdig‘ini kuting. Tasdiqlansa shu Telegram qurilmasi asosiy bo‘ladi.",
      });
      setGate((g) =>
        g
          ? {
              ...g,
              code: "DEVICE_PENDING",
              message: "So‘rov adminga yuborildi. Tasdiqlansa Telegram orqali kira olasiz.",
            }
          : g,
      );
    } catch (err) {
      toast({
        title: "Yuborilmadi",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setRequesting(false);
    }
  };

  const openBotForNewToken = () => {
    const wa = window.Telegram?.WebApp;
    try {
      wa?.openTelegramLink?.("https://t.me/vaksinahrbot?start=kirish");
    } catch {
      window.open("https://t.me/vaksinahrbot", "_blank");
    }
  };

  if (phase === "gate" && gate) {
    const pendingGate = gate.code === "DEVICE_PENDING";
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-8 dark:from-slate-950 dark:to-slate-900">
        <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-5 shadow-lg">
          <div className="flex flex-col items-center gap-3 text-center">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-full ${
                pendingGate ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"
              }`}
            >
              {pendingGate ? <ShieldQuestion className="h-7 w-7" /> : <ShieldAlert className="h-7 w-7" />}
            </div>
            <h1 className="text-xl font-semibold">
              {pendingGate ? "Yangi qurilma" : "Qurilma tasdiqlanmagan"}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{gate.message}</p>
          </div>
          {gate.deviceName ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-left">
              <div className="text-xs text-muted-foreground">Qurilma</div>
              <div className="font-medium">{gate.deviceName}</div>
            </div>
          ) : null}
          <p className="text-center text-xs text-muted-foreground">
            {pendingGate
              ? "Admin tasdiqlasa Telegram bot orqali shu telefonda ishlay olasiz."
              : "Faqat asosiy telefongizdan kiring. Boshqa joydan — admin ruxsati kerak."}
          </p>
          <ForeignDeviceWarning
            show={gate.foreignDevice || gate.code === "DEVICE_NOT_AUTHORIZED"}
            primaryName={gate.primaryDevice?.name || gate.lastApproval?.deviceName}
            currentName={gate.deviceName}
          />
          <LastApprovalBanner lastApproval={gate.lastApproval} />
          <SupportContacts />
          <div className="flex flex-col gap-2">
            {gate.canRequestChange ? (
              <Button
                className="w-full"
                variant="secondary"
                disabled={requesting}
                onClick={() => void onRequestChange()}
              >
                {requesting ? "Yuborilmoqda…" : "Qurilmani almashtirish so‘rash"}
              </Button>
            ) : null}
            <Button
              className="w-full"
              variant="outline"
              disabled={retrying}
              onClick={() => void onRetryInitData()}
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Tasdiqdan keyin qayta urinish</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-muted px-6 text-center">
      {phase !== "error" ? (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-[#0b3a5c]" />
          <p className="mt-4 text-sm font-medium text-foreground">
            {t("tg.loading")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("tg.checking")}</p>
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-rose-700">{t("tg.failed")}</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">{error}</p>
          <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
            <button
              type="button"
              disabled={retrying}
              onClick={() => void onRetryInitData()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("tg.retryBtn")}
            </button>
            <button
              type="button"
              onClick={openBotForNewToken}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#0b3a5c]/30 bg-card px-4 py-2.5 text-sm font-medium text-[#0b3a5c]"
            >
              {t("tg.newToken")}
            </button>
            <a
              href="/login"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("tg.plainLogin")}
            </a>
          </div>
          <div className="mt-6 w-full max-w-xs">
            <SupportContacts />
          </div>
          <p className="mt-4 max-w-xs text-[11px] text-muted-foreground">
            {t("tg.botHint")}
          </p>
        </>
      )}
    </div>
  );
}

/** Layout ichida Mini App UI sozlash (har safar) */
export function useTelegramMiniAppChrome() {
  useEffect(() => {
    prepareTelegramUi();
  }, []);
}
