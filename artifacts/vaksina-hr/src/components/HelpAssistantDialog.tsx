import React, { useEffect, useRef, useState } from "react";
import { Send, Loader2, Bot, User, Phone, SendHorizontal, ImagePlus, Globe } from "lucide-react";
import { OperatorHeadsetIcon } from "@/components/OperatorHeadsetIcon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/types";

type HelpLink = { label: string; url: string; hint?: string };

type Msg = {
  role: "user" | "assistant";
  content: string;
  imagePreview?: string;
  showContacts?: boolean;
  links?: HelpLink[];
};

const SUPPORT_PHONE = "+998 70 174 37 22";
const SUPPORT_PHONE_HREF = "tel:+998701743722";
const SUPPORT_TELEGRAM = "@saidmuhammadalixon_hr";
const SUPPORT_TELEGRAM_URL = "https://t.me/saidmuhammadalixon_hr";

const QUICK_APP_IDS = [
  { id: "face-id-ulash", labelKey: "help.chip.faceId" },
  { id: "davomat-gps", labelKey: "help.chip.davomat" },
  { id: "smena-vaqt", labelKey: "help.chip.smena" },
  { id: "oylik-kpi", labelKey: "help.chip.oylik" },
  { id: "login-parol", labelKey: "help.chip.login" },
  { id: "checklist", labelKey: "help.chip.checklist" },
] as const;

const QUICK_LOGIN_IDS = [
  { id: "login-parol", labelKey: "help.chip.login" },
  { id: "telegram", labelKey: "help.chip.telegram" },
  { id: "face-id-ulash", labelKey: "help.chip.faceShort" },
] as const;

type HelpChatResponse = {
  reply: string;
  source?: string;
  needPhoto?: boolean;
  showContacts?: boolean;
  phone?: string;
  telegram?: string;
  telegramUrl?: string;
  links?: HelpLink[];
  error?: string;
};

async function postHelpChat(
  opts: {
    message?: string;
    context?: string;
    imageDataUrl?: string;
    locale?: Locale;
  },
): Promise<HelpChatResponse> {
  const res = await fetch("/api/help/chat", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": opts.locale === "ru" ? "ru" : "uz",
    },
    body: JSON.stringify({ ...opts, locale: opts.locale || "uz" }),
  });
  const body = (await res.json().catch(() => ({}))) as HelpChatResponse;
  if (!res.ok) {
    throw new Error(body?.error || "help.error");
  }
  return body;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

function ContactCards({ phoneLabel, telegramLabel }: { phoneLabel: string; telegramLabel: string }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      <a
        href={SUPPORT_PHONE_HREF}
        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <Phone className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-semibold tabular-nums text-emerald-900 dark:text-emerald-100">
            {SUPPORT_PHONE}
          </span>
          <span className="block text-[10px] text-emerald-700/70 dark:text-emerald-200/60">{phoneLabel}</span>
        </span>
      </a>
      <a
        href={SUPPORT_TELEGRAM_URL}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:hover:bg-sky-500/15"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300">
          <SendHorizontal className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-semibold text-sky-900 dark:text-sky-100">
            {SUPPORT_TELEGRAM}
          </span>
          <span className="block text-[10px] text-sky-700/70 dark:text-sky-200/60">{telegramLabel}</span>
        </span>
      </a>
    </div>
  );
}

function LinkButtons({ links }: { links: HelpLink[] }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {links.map((link) => {
        const isTg = /t\.me\//i.test(link.url) || link.label.startsWith("@");
        return (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition",
              isTg
                ? "border-sky-200 bg-sky-50 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:hover:bg-sky-500/15"
                : "border-indigo-200 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                isTg
                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
              )}
            >
              {isTg ? <SendHorizontal className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block truncate text-[12px] font-semibold",
                  isTg
                    ? "text-sky-900 dark:text-sky-100"
                    : "text-indigo-900 dark:text-indigo-100",
                )}
              >
                {link.label}
              </span>
              {link.hint ? (
                <span
                  className={cn(
                    "block text-[10px]",
                    isTg
                      ? "text-sky-700/70 dark:text-sky-200/60"
                      : "text-indigo-700/70 dark:text-indigo-200/60",
                  )}
                >
                  {link.hint}
                </span>
              ) : null}
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function HelpAssistantDialog({
  open,
  onOpenChange,
  variant = "app",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** login — kirish sahifasi (auth shart emas) */
  variant?: "app" | "login";
}) {
  const { t, locale } = useI18n();
  const welcome = t(variant === "login" ? "help.welcomeLogin" : "help.welcomeApp");
  const quick = variant === "login" ? QUICK_LOGIN_IDS : QUICK_APP_IDS;
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: welcome }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needPhoto, setNeedPhoto] = useState(false);
  const [lastContext, setLastContext] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessages([{ role: "assistant", content: welcome }]);
    setInput("");
    setError(null);
    setNeedPhoto(false);
    setLastContext("");
  }, [open, welcome, locale]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading, needPhoto]);

  const applyReply = (data: HelpChatResponse) => {
    setNeedPhoto(Boolean(data.needPhoto));
    const links = data.links?.map((l) => ({
      ...l,
      hint:
        l.url.includes("t.me")
          ? t("help.link.bot")
          : l.url.includes("vaksinahr")
            ? t("help.link.site")
            : l.hint,
    }));
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: data.showContacts ? t("help.contactsLead") : data.reply,
        showContacts: Boolean(data.showContacts),
        links: links?.length ? links : undefined,
      },
    ]);
  };

  const ask = async (textRaw: string) => {
    const text = textRaw.trim();
    if (!text || loading) return;
    setError(null);
    setInput("");
    setLastContext(text);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const data = await postHelpChat({ message: text, locale });
      applyReply(data);
    } catch (e) {
      setError(e instanceof Error && e.message !== "help.error" ? e.message : t("help.botError"));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: t("help.contactsLead"), showContacts: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onPickImage = async (file: File | null) => {
    if (!file || loading) return;
    if (!file.type.startsWith("image/")) {
      setError(t("help.imageOnly"));
      return;
    }
    if (file.size > 1_200_000) {
      setError(t("help.imageTooBig"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: input.trim() || t("help.screenshotSent"), imagePreview: dataUrl },
      ]);
      const note = input.trim();
      setInput("");
      const data = await postHelpChat({
        message: note || t("help.placeholder"),
        context: lastContext,
        imageDataUrl: dataUrl,
        locale,
      });
      setNeedPhoto(false);
      applyReply(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("help.imageReadError"));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: t("help.contactsLead"), showContacts: true },
      ]);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(34rem,85dvh)] w-[calc(100%-1.25rem)] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white">
              <OperatorHeadsetIcon className="h-5 w-5" />
            </span>
            {t("help.title")}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{t("help.subtitle")}</p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}
              >
                {m.role === "assistant" ? (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                    <Bot className="h-3.5 w-3.5" />
                  </span>
                ) : null}
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                    m.role === "user"
                      ? "rounded-br-md bg-violet-600 text-white"
                      : "rounded-bl-md bg-muted text-foreground",
                  )}
                >
                  {m.imagePreview ? (
                    <img
                      src={m.imagePreview}
                      alt=""
                      className="mb-2 max-h-40 w-full rounded-lg object-contain"
                    />
                  ) : null}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.links?.length ? <LinkButtons links={m.links} /> : null}
                  {m.showContacts ? (
                    <ContactCards phoneLabel={t("common.phone")} telegramLabel={t("common.telegram")} />
                  ) : null}
                </div>
                {m.role === "user" ? (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/70">
                    <User className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </div>
            ))}
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {needPhoto ? t("help.analyzing") : t("help.replying")}
              </div>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div ref={bottomRef} />
          </div>

          <div className="border-t bg-card p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  disabled={loading}
                  onClick={() => void ask(q.id)}
                  className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted"
                >
                  {t(q.labelKey)}
                </button>
              ))}
            </div>

            {needPhoto ? (
              <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12px] text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100">
                {t("help.photoHint")}
              </div>
            ) : null}

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void onPickImage(e.target.files?.[0] || null)}
            />

            <div className="flex items-end gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className={cn(
                  "h-10 w-10 shrink-0 rounded-xl",
                  needPhoto && "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-500/15",
                )}
                disabled={loading}
                title={t("help.photoUpload")}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                rows={2}
                placeholder={needPhoto ? t("help.placeholderPhoto") : t("help.placeholder")}
                className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] outline-none ring-violet-500/30 focus:ring-2"
              />
              <Button
                type="button"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700"
                disabled={loading || !input.trim()}
                onClick={() => void ask(input)}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
