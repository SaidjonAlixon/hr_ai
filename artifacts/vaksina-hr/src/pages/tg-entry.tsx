import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../hooks/use-toast";
import type { User } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

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

async function exchangeToken(token: string): Promise<User> {
  const res = await fetch("/api/telegram/mini-auth", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || "Kirish muvaffaqiyatsiz");
  }
  return body.user as User;
}

/** Telegram Mini App kirish — token → cookie → dashboard */
export default function TgEntryPage() {
  const { setUser, isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [phase, setPhase] = useState<"boot" | "auth" | "error">("boot");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      prepareTelegramUi();
      const token = readTokenFromUrl();

      if (!token) {
        if (isAuthenticated && user) {
          setLocation(user.role === "stajyor" ? "/kirish" : "/dashboard");
          return;
        }
        setPhase("error");
        setError("Token topilmadi. Botdagi «Kirish» tugmasidan oching.");
        return;
      }

      setPhase("auth");
      try {
        const u = await exchangeToken(token);
        if (cancelled) return;
        setUser(u);
        // URL dan tokenni olib tashlash
        window.history.replaceState({}, "", "/dashboard");
        setLocation(u.role === "stajyor" ? "/kirish" : "/dashboard");
        toast({
          title: "Xush kelibsiz",
          description: `${u.fullName} · Mini App`,
        });
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        setError((e as Error).message || "Xatolik");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // faqat mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-slate-50 px-6 text-center">
      {phase !== "error" ? (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-[#0b3a5c]" />
          <p className="mt-4 text-sm font-medium text-slate-800">
            Telegram orqali kirilmoqda…
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sessiyangiz tekshirilmoqda
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-rose-700">Kirish amalga oshmadi</p>
          <p className="mt-2 max-w-sm text-sm text-slate-600">{error}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            Botga qaytib /start bosing va yangi «Kirish» tugmasini bosing.
          </p>
          <a
            href="/login"
            className="mt-6 inline-flex rounded-lg bg-[#0b3a5c] px-4 py-2 text-sm font-medium text-white"
          >
            Oddiy login
          </a>
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
