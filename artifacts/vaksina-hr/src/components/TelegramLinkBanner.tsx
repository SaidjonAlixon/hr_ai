import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bell, Check, CheckCircle2, ClipboardList, Copy, ExternalLink, Loader2, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { isOfisStaffRole } from "@/lib/roles";
import {
  createTelegramLinkToken,
  fetchTelegramLinkStatus,
  type TelegramLinkStatus,
  type TelegramLinkToken,
} from "@/lib/telegram-link-api";

const PROMPT_KEY = "tg_link_prompt_v1";
const POLL_MS = 3_000;
const POLL_WINDOW_MS = 30 * 60_000;

function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function todayKey(userId: number): string {
  const d = new Date();
  return `${PROMPT_KEY}:${userId}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const BENEFITS = [
  { icon: ClipboardList, text: "Yangi topshiriqlar va muddatlar" },
  { icon: Bell, text: "Davomat, eslatmalar va ogohlantirishlar" },
  { icon: ShieldCheck, text: "Muhim holatlardan darhol xabardor bo‘lish" },
];

export function TelegramLinkBanner() {
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const [status, setStatus] = useState<TelegramLinkStatus | null>(null);
  const [opening, setOpening] = useState(false);
  const [link, setLink] = useState<TelegramLinkToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const pollUntil = useRef(0);
  const wasUnlinked = useRef(false);

  const waiting = !!link;
  const eligible = isAuthenticated && !!user && isOfisStaffRole(user.role) && !location.startsWith("/tg");

  const load = useCallback(async () => {
    if (!eligible) {
      setStatus(null);
      return null;
    }
    try {
      const next = await fetchTelegramLinkStatus();
      if (wasUnlinked.current && next.linked) {
        toast({ title: "Akkaunt botga ulandi", description: "Endi barcha xabarlar Telegramga keladi." });
      }
      wasUnlinked.current = !next.linked;
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [eligible, toast]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 180_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(async () => {
      const next = await load();
      if (next?.linked) {
        setLink(null);
        setDialogOpen(false);
      } else if (Date.now() > pollUntil.current) {
        setLink(null);
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, load]);

  useEffect(() => {
    if (!status?.show || !user?.id) return;
    const key = todayKey(user.id);
    try {
      if (localStorage.getItem(key) === "1") return;
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    setDialogOpen(true);
  }, [status?.show, user?.id]);

  const connect = useCallback(async () => {
    const popup = isTouchDevice() ? null : window.open("", "_blank");
    setOpening(true);
    try {
      const next = await createTelegramLinkToken();
      if (popup) popup.location.href = next.url;
      pollUntil.current = Date.now() + POLL_WINDOW_MS;
      setCopied(false);
      setLink(next);
      setDialogOpen(true);
    } catch (err) {
      popup?.close();
      toast({
        title: "Havola ochilmadi",
        description: err instanceof Error ? err.message : "Qayta urinib ko‘ring",
        variant: "destructive",
      });
    } finally {
      setOpening(false);
    }
  }, [toast]);

  const copyCode = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [link]);

  if (!status?.show) return null;

  const connectButton = (full?: boolean) => (
    <Button
      onClick={() => void connect()}
      disabled={opening}
      className={cn(
        "gap-2 rounded-xl bg-[#229ED9] font-semibold text-white shadow-sm hover:bg-[#1c8cc2]",
        full ? "h-12 w-full text-base" : "h-9 px-4",
      )}
    >
      {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      Botga ulanish
    </Button>
  );

  return (
    <>
      <div
        className={cn(
          "border-b border-sky-500/25 bg-gradient-to-r from-sky-50 via-white to-sky-50 px-3 py-2.5",
          "dark:border-sky-400/20 dark:from-sky-500/10 dark:via-transparent dark:to-sky-500/10",
          "sm:px-4",
        )}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#229ED9] text-white shadow-sm">
              <Send className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">
                Botga ulaning — barcha holatlardan xabardor bo‘ling
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                {waiting ? (
                  <>
                    Botga shu kodni yuboring: <b className="font-mono tracking-widest text-slate-900 dark:text-white">{link?.code}</b>
                  </>
                ) : (
                  "Topshiriqlar, davomat va eslatmalar Telegramga keladi. Bir marta bosish kifoya."
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:justify-end">
            {waiting ? (
              <Button variant="outline" className="h-9 w-full gap-2 rounded-xl sm:w-auto" onClick={() => setDialogOpen(true)}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Kutilmoqda — kodni ko‘rish
              </Button>
            ) : (
              <div className="w-full sm:w-auto [&>button]:w-full sm:[&>button]:w-auto">{connectButton()}</div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] rounded-2xl p-0 sm:max-w-md">
          <div className="rounded-t-2xl bg-gradient-to-br from-[#229ED9] to-[#1b7fb0] px-6 pb-6 pt-7 text-white">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
              <Send className="h-6 w-6" />
            </span>
            <DialogHeader className="mt-4 space-y-1.5 text-left">
              <DialogTitle className="text-xl font-bold text-white">Botga ulaning</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-white/85">
                Barcha holatlardan xabardor bo‘lish uchun akkauntingizni VAKSINA HR botiga ulang.
              </DialogDescription>
            </DialogHeader>
          </div>

          {link ? (
            <div className="space-y-4 px-6 pb-6 pt-5">
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9] text-base font-semibold text-white shadow-sm hover:bg-[#1c8cc2]"
              >
                <Send className="h-4 w-4" />
                1. Telegramda botni ochish
                <ExternalLink className="h-4 w-4 opacity-80" />
              </a>

              <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-center dark:border-sky-500/30 dark:bg-sky-500/10">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  2. Avtomatik ulanmasa — botga shu kodni yuboring
                </p>
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="mx-auto mt-2 flex items-center gap-3 rounded-xl bg-white px-4 py-2 shadow-sm ring-1 ring-sky-200 transition hover:ring-sky-400 dark:bg-slate-900 dark:ring-sky-500/30"
                >
                  <span className="font-mono text-3xl font-bold tracking-[0.3em] text-slate-900 dark:text-white">
                    {link.code}
                  </span>
                  {copied ? <Check className="h-5 w-5 text-emerald-600" /> : <Copy className="h-5 w-5 text-slate-400" />}
                </button>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Kod 30 daqiqa amal qiladi · bot: @{link.botUsername}
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-200">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#229ED9]" />
                Ulanish kutilmoqda — bot tasdiqlashi bilan shu oyna o‘zi yopiladi.
              </div>
              <button
                type="button"
                onClick={() => void connect()}
                disabled={opening}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400"
              >
                Yangi kod olish
              </button>
            </div>
          ) : (
            <div className="space-y-5 px-6 pb-6 pt-5">
              <ul className="space-y-3">
                {BENEFITS.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[#229ED9]">
                      <Icon className="h-4 w-4" />
                    </span>
                    {text}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Login/parol kiritish shart emas — akkauntingiz o‘zi ulanadi.
              </div>
              {connectButton(true)}
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400"
              >
                Keyinroq
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
