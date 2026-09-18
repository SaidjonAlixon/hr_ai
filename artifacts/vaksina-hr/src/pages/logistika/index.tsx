import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { canViewLogistika } from "@/lib/roles";
import {
  LOGISTIKA_SECTIONS,
  requestVaksinamedSso,
  fetchVaksinamedStatus,
  sectionFromParam,
  vmPathForSection,
} from "@/lib/vaksinamed-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLink, Loader2, RefreshCw, Truck } from "lucide-react";

type Props = { params?: { section?: string } };

function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export default function LogistikaPage({ params }: Props) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = canViewLogistika(user?.role);
  const localDev = isLocalDevHost();
  const section = sectionFromParam(params?.section);
  const meta = useMemo(
    () => LOGISTIKA_SECTIONS.find((s) => s.id === section) || LOGISTIKA_SECTIONS[0]!,
    [section],
  );

  const [enterUrl, setEnterUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState<string | null>(null);

  const loadSso = useCallback(async (opts?: { openWindow?: boolean }) => {
    if (!allowed) return;
    const openWindow = Boolean(opts?.openWindow) || localDev;
    setLoading(true);
    setError(null);
    if (openWindow) setOpening(true);
    else setEnterUrl(null);
    try {
      const st = await fetchVaksinamedStatus().catch(() => null);
      if (st) setHost(st.host);
      if (st && !st.configured) {
        setError("Logistika vaqtincha ulanmagan — admin VAKSINAMED_BASE_URL / API_KEY ni sozlasin");
        return;
      }
      // Ticket ~90s, bir marta. iframe urinishi ticketni sarflaydi — lokalda faqat yangi oyna.
      const r = await requestVaksinamedSso(vmPathForSection(section), !localDev && !openWindow);
      if (openWindow) {
        window.open(r.enterUrl, "_blank", "noopener,noreferrer");
        setEnterUrl(null);
      } else {
        setEnterUrl(r.enterUrl);
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) setError("Sizda Logistika ruxsati yo‘q");
      else setError(err.message || "Logistika ochilmadi");
    } finally {
      setLoading(false);
      setOpening(false);
    }
  }, [allowed, section, localDev]);

  useEffect(() => {
    void loadSso({ openWindow: localDev });
  }, [loadSso, localDev]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Ruxsat yo‘q</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Logistika bo‘limini faqat direktor, HR direktor va admin ko‘radi.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col gap-3">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-sky-600" />
            <h1 className="text-lg font-bold tracking-tight">Logistika</h1>
            {host ? (
              <span className="truncate text-[11px] text-muted-foreground">{host}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            VaksinaMed GPS — {meta.title}. HR ichida to‘liq ishlash (SSO).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-xl"
            onClick={() => void loadSso({ openWindow: localDev })}
            disabled={loading || opening}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-9 rounded-xl"
            disabled={loading || opening}
            onClick={() => void loadSso({ openWindow: true })}
          >
            {opening ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-1.5 h-4 w-4" />
            )}
            Yangi oynada ochish
          </Button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/40 p-1.5">
        {LOGISTIKA_SECTIONS.map((s) => {
          const active = s.id === section;
          return (
            <Link
              key={s.id}
              href={s.path}
              onClick={(e) => {
                e.preventDefault();
                setLocation(s.path);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
              )}
            >
              {s.title}
            </Link>
          );
        })}
      </nav>

      <div className="relative min-h-[min(70vh,720px)] flex-1 overflow-hidden rounded-2xl border border-border bg-slate-950/5 shadow-sm">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
            VaksinaMed ga ulanilmoqda…
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="max-w-md text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
            <Button
              type="button"
              size="sm"
              className="rounded-xl"
              onClick={() => void loadSso({ openWindow: localDev })}
            >
              Qayta urinish
            </Button>
          </div>
        ) : localDev ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="max-w-md text-sm text-foreground">
              Lokalda iframe bloklanadi (GPS faqat <strong>vaksinahr.uz</strong> ga ruxsat beradi).
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              Eski ticket ishlamaydi (~90 soniya, bir marta). Har safar yangi SSO oling.
            </p>
            <Button
              type="button"
              size="sm"
              className="rounded-xl"
              disabled={opening}
              onClick={() => void loadSso({ openWindow: true })}
            >
              {opening ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-1.5 h-4 w-4" />
              )}
              Yangi ticket bilan ochish
            </Button>
          </div>
        ) : enterUrl ? (
          <iframe
            title={`VaksinaMed — ${meta.title}`}
            src={enterUrl}
            className="h-[calc(100vh-11rem)] min-h-[560px] w-full border-0 bg-white"
            allow="geolocation; microphone; camera; clipboard-read; clipboard-write"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : null}
      </div>
    </div>
  );
}

/** /logistika → dashboard */
export function LogistikaIndexRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/logistika/dashboard");
  }, [setLocation]);
  return (
    <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Logistika…
    </div>
  );
}
