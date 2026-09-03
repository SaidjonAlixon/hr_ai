import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../hooks/use-toast";
import type { User } from "@workspace/api-client-react";
import { Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider";

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

async function miniAuth(
  payload: { initData?: string; token?: string },
  authFailMsg: string,
): Promise<{ user: User; ok?: boolean }> {
  const res = await fetch("/api/telegram/mini-auth", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || authFailMsg) as Error & {
      code?: string;
    };
    err.code = body?.code;
    throw err;
  }
  return { user: body.user as User, ok: true };
}

function redirectAfterLogin(user: User, next: string | null, setLocation: (path: string) => void) {
  const clean =
    next === "davomat-face" ? "/davomat-face?tg=1" : user.role === "stajyor" ? "/kirish" : "/dashboard";
  window.history.replaceState({}, "", clean);
  setLocation(clean);
}

/**
 * Telegram Mini App kirish.
 * 1) Token (yangi akkaunt) — muddat ichida qayta ochish ham OK
 * 2) Token ishlamasa → initData (Telegram bog‘lanish) — asosiy doimiy kirish
 * 3) Cookie sessiya
 */
export default function TgEntryPage() {
  const { t } = useI18n();
  const { switchToUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [phase, setPhase] = useState<"boot" | "auth" | "error">("boot");
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const finish = useCallback(
    (u: User, label: string) => {
      switchToUser(u);
      redirectAfterLogin(u, readNextFromUrl(), setLocation);
      toast({
        title: t("tg.welcome"),
        description: `${u.fullName} · ${label}`,
      });
    },
    [switchToUser, setLocation, toast, t],
  );

  const tryEnter = useCallback(async () => {
    prepareTelegramUi();
    const token = readTokenFromUrl();
    const initData = window.Telegram?.WebApp?.initData?.trim() || "";
    const authFail = t("tg.authFail");

    if (token) {
      try {
        const { user } = await miniAuth({ token }, authFail);
        finish(user, t("tg.label.telegram"));
        return true;
      } catch {
        // Token eskirgan — initData ga o‘tamiz
      }
    }

    if (initData) {
      try {
        const { user } = await miniAuth({ initData }, authFail);
        finish(user, t("tg.label.mini"));
        return true;
      } catch (e) {
        setError((e as Error).message || t("tg.initFail"));
        return false;
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
          finish(existing, t("tg.label.session"));
          return true;
        }
      }
    } catch {
      /* ignore */
    }

    setError(t("tg.noSession"));
    return false;
  }, [finish, t]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setPhase("auth");
      const ok = await tryEnter();
      if (cancelled) return;
      setPhase(ok ? "auth" : "error");
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
    try {
      const initData = window.Telegram?.WebApp?.initData?.trim() || "";
      if (!initData) {
        setPhase("error");
        setError(t("tg.noInitData"));
        return;
      }
      const { user } = await miniAuth({ initData }, t("tg.authFail"));
      finish(user, t("tg.label.retry"));
    } catch (e) {
      setPhase("error");
      setError((e as Error).message || t("tg.retryFail"));
    } finally {
      setRetrying(false);
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
