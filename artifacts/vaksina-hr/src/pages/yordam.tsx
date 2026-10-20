import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, SendHorizontal } from "lucide-react";
import { HelpAssistantDialog, HELP_BOT_URL } from "@/components/HelpAssistantDialog";

/** Ochiq yordam chati — havola orqali tashqaridan ham yozish mumkin: vaksinahr.uz/yordam */
export default function YordamPage() {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-violet-50 to-background p-4 dark:from-violet-950/30">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-bold tracking-tight">VAKSINA HR — Yordamchi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Savolingizni yozing yoki xato skrinshotini yuboring — to‘liq javob beraman.
          Login qilgan xodimlar uchun muammo adminga tayyorlab qo‘yiladi.
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <button
            type="button"
            className="rounded-full bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700"
            onClick={() => setOpen(true)}
          >
            Chatni ochish
          </button>
          <a
            href={HELP_BOT_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 px-4 py-2 font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-300"
          >
            <SendHorizontal className="h-4 w-4" /> Telegram bot
          </a>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          <Link href="/login" className="inline-flex items-center gap-1 underline">
            <ArrowLeft className="h-3 w-3" /> Kirish sahifasiga qaytish
          </Link>
        </p>
      </div>
      <HelpAssistantDialog open={open} onOpenChange={setOpen} variant="login" />
    </div>
  );
}
