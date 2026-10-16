import { AlertTriangle, CheckCircle2, MessageCircle, Phone } from "lucide-react";

export const SUPPORT_PHONE = "+998701743722";
export const SUPPORT_PHONE_DISPLAY = "+998 70 174 37 22";
export const SUPPORT_TELEGRAM = "saidmuhammadalixon_hr";

export type LastDeviceApproval = {
  at: string;
  deviceName?: string | null;
  status?: string;
};

export type PrimaryDeviceInfo = {
  name?: string | null;
  lastLoginAt?: string | null;
};

function formatApprovalAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Boshqa qurilmadan kirish — aniq ogohlantirish */
export function ForeignDeviceWarning({
  show,
  primaryName,
  currentName,
}: {
  show?: boolean;
  primaryName?: string | null;
  currentName?: string | null;
}) {
  if (!show) return null;
  return (
    <div className="rounded-xl border border-rose-300/90 bg-rose-50 px-3 py-2.5 text-left dark:border-rose-500/40 dark:bg-rose-500/10">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-300">
            Ogohlantirish
          </p>
          <p className="text-sm font-semibold text-rose-950 dark:text-rose-100">
            Boshqa qurilmadan kiryapsiz
          </p>
          <p className="mt-1 text-xs leading-relaxed text-rose-900/80 dark:text-rose-200/80">
            Akkaunt asosiy telefonga biriktirilgan. Bu joydan kirish uchun admin ruxsati kerak.
          </p>
          {primaryName || currentName ? (
            <div className="mt-2 space-y-0.5 text-xs text-rose-900/90 dark:text-rose-100/90">
              {primaryName ? (
                <p>
                  <span className="text-muted-foreground">Asosiy: </span>
                  <span className="font-medium">{primaryName}</span>
                </p>
              ) : null}
              {currentName ? (
                <p>
                  <span className="text-muted-foreground">Hozirgi: </span>
                  <span className="font-medium">{currentName}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Oldingi admin ruxsati — qayta so‘rovda qachon berilgani ko‘rinsin */
export function LastApprovalBanner({ lastApproval }: { lastApproval?: LastDeviceApproval | null }) {
  if (!lastApproval?.at) return null;
  return (
    <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/90 px-3 py-2.5 text-left dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckCircle2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            Oxirgi ruxsat
          </p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {formatApprovalAt(lastApproval.at)}
          </p>
          {lastApproval.deviceName ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Qurilma: {lastApproval.deviceName}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Admin shu vaqtda asosiy qurilmaga ruxsat bergan
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

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
