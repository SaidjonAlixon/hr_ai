import { MessageCircle, Phone } from "lucide-react";

export const SUPPORT_PHONE = "+998701743722";
export const SUPPORT_PHONE_DISPLAY = "+998 70 174 37 22";
export const SUPPORT_TELEGRAM = "saidmuhammadalixon_hr";

/** Qurilma ruxsati / so‘rov ekrani — telefon va Telegram */
export function SupportContacts() {
  return (
    <div className="space-y-2 rounded-2xl border border-[#1e3a8a]/15 bg-gradient-to-br from-[#1e3a8a]/[0.06] to-sky-50/80 p-3 dark:from-sky-500/10 dark:to-background">
      <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-[#1e3a8a] dark:text-sky-300">
        Bog‘lanish
      </p>
      <a
        href={`tel:${SUPPORT_PHONE}`}
        className="flex min-h-12 items-center gap-3 rounded-xl border border-emerald-200/80 bg-white px-3 py-2.5 shadow-sm transition active:scale-[0.99] dark:border-emerald-500/30 dark:bg-card"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Phone className="h-5 w-5" />
        </span>
        <span className="min-w-0 text-left">
          <span className="block text-[11px] text-muted-foreground">Qo‘ng‘iroq</span>
          <span className="block text-base font-semibold tracking-tight text-foreground">
            {SUPPORT_PHONE_DISPLAY}
          </span>
        </span>
      </a>
      <a
        href={`https://t.me/${SUPPORT_TELEGRAM}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-12 items-center gap-3 rounded-xl border border-sky-200/80 bg-white px-3 py-2.5 shadow-sm transition active:scale-[0.99] dark:border-sky-500/30 dark:bg-card"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white">
          <MessageCircle className="h-5 w-5" />
        </span>
        <span className="min-w-0 text-left">
          <span className="block text-[11px] text-muted-foreground">Telegram</span>
          <span className="block text-base font-semibold tracking-tight text-foreground">
            @{SUPPORT_TELEGRAM}
          </span>
        </span>
      </a>
    </div>
  );
}
