import React, { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchDavomatAgentChat,
  type DavomatAgentContext,
} from "@/lib/davomat-api";

type Msg = { role: "user" | "assistant"; content: string };

type Props = {
  open: boolean;
  onClose: () => void;
  context: DavomatAgentContext;
};

const QUICK = [
  "Smenam qachon, Ketdim qachongacha?",
  "Ketdimni bosmasam nima bo‘ladi?",
  "Kecha davomatim?",
  "Face ID qanday?",
  "Oxirgi 10 kun",
];

export function DavomatAgentChat({ open, onClose, context }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const greeted = useRef(false);

  useEffect(() => {
    if (!open) {
      greeted.current = false;
      return;
    }
    if (greeted.current) return;
    greeted.current = true;
    setBusy(true);
    void fetchDavomatAgentChat({ message: "__greet__", context })
      .then((r) => {
        setMsgs([{ role: "assistant", content: r.reply }]);
      })
      .catch(() => {
        setMsgs([
          {
            role: "assistant",
            content:
              "Davomat agenti. Smena, Face ID, GPS yoki oxirgi kunlar haqida so‘rang. Ketdimni muddatgacha bosmasangiz kun yopiladi — jarima xavfi.",
          },
        ]);
      })
      .finally(() => setBusy(false));
  }, [open, context]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const hist = msgs.map((m) => ({ role: m.role, text: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await fetchDavomatAgentChat({
        message: q,
        context,
        history: hist,
      });
      setMsgs((m) => [...m, { role: "assistant", content: r.reply }]);
    } catch {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: "Hozir javob chiqmadi. Qayta yozing. Agar baza xato bo‘lsa — eng oxirgi chorada HR tuzatadi.",
        },
      ]);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-[#070b14] text-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Solid header — iPhone blur/hiralik yo‘q */}
      <header
        className="relative z-10 flex shrink-0 items-center gap-2 border-b border-white/15 bg-[#0f172a] px-3 pb-3"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-extrabold tracking-tight text-white">
            Davomat agenti
          </h2>
          <p className="truncate text-[11px] font-medium text-slate-300">
            Smena · Face ID · GPS · baza
          </p>
        </div>
        <button
          type="button"
          aria-label="Yopish"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#0f172a] shadow-md"
          onClick={onClose}
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3">
        {msgs.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[92%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-snug",
                m.role === "user"
                  ? "bg-rose-600 text-white"
                  : "bg-slate-800 text-slate-50 ring-1 ring-white/10",
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-[12px] text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Javob yozilmoqda…
          </div>
        ) : null}
        <div ref={bottomRef} className="h-1" />
      </div>

      {/* Composer — jo‘natish doim ko‘rinadi */}
      <div className="relative z-10 shrink-0 border-t border-white/15 bg-[#0f172a] px-3 pt-2.5 pb-3">
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => void send(q)}
              className="shrink-0 rounded-full border border-white/20 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-100"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            placeholder="Savolingizni yozing…"
            className="min-h-[48px] max-h-28 min-w-0 flex-1 resize-none rounded-2xl border border-white/20 bg-slate-900 px-3.5 py-3 text-[15px] text-white placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Jo‘natish"
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg",
              busy || !input.trim()
                ? "bg-rose-600/40"
                : "bg-rose-600 active:bg-rose-500",
            )}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
