import { useI18n, type Locale } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** compact — header/mobile */
  size?: "sm" | "md";
  /** header: rejimga moslashadi, dark: to'q fon ustida */
  variant?: "header" | "dark";
};

function FlagUz({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 16" className={className} aria-hidden="true">
      <rect width="24" height="16" rx="2" fill="#1EB53A" />
      <rect width="24" height="5.33" y="0" fill="#0099B5" />
      <rect width="24" height="5.34" y="5.33" fill="#fff" />
      <rect width="24" height="1.1" y="4.78" fill="#CE1126" />
      <rect width="24" height="1.1" y="10.12" fill="#CE1126" />
      <circle cx="5.2" cy="2.65" r="1.35" fill="none" stroke="#fff" strokeWidth="0.7" />
      <circle cx="5.7" cy="2.65" r="1.15" fill="#0099B5" />
      <g fill="#fff">
        <circle cx="8.4" cy="1.35" r="0.28" />
        <circle cx="9.35" cy="1.35" r="0.28" />
        <circle cx="10.3" cy="1.35" r="0.28" />
        <circle cx="8.85" cy="2.15" r="0.28" />
        <circle cx="9.8" cy="2.15" r="0.28" />
        <circle cx="8.4" cy="2.95" r="0.28" />
        <circle cx="9.35" cy="2.95" r="0.28" />
        <circle cx="10.3" cy="2.95" r="0.28" />
        <circle cx="8.85" cy="3.75" r="0.28" />
        <circle cx="9.8" cy="3.75" r="0.28" />
        <circle cx="10.75" cy="2.15" r="0.28" />
        <circle cx="10.75" cy="3.75" r="0.28" />
      </g>
    </svg>
  );
}

function FlagRu({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 16" className={className} aria-hidden="true">
      <rect width="24" height="16" rx="2" fill="#D52B1E" />
      <rect width="24" height="5.34" y="0" fill="#fff" />
      <rect width="24" height="5.33" y="5.33" fill="#0039A6" />
    </svg>
  );
}

const FLAGS: Record<Locale, (p: { className?: string }) => JSX.Element> = {
  uz: FlagUz,
  ru: FlagRu,
};

export function LanguageSwitcher({ className, size = "sm", variant = "header" }: Props) {
  const { locale, setLocale, t } = useI18n();
  /** header — kunduzgi/kechki rejimga moslashadi; dark — to'q fon ustida (login) */
  const onDark = variant === "dark";

  const btn = (code: Locale, label: string) => {
    const active = locale === code;
    const Flag = FLAGS[code];
    const flagSize = size === "sm" ? "h-3.5 w-[21px]" : "h-4 w-6";

    return (
      <button
        type="button"
        onClick={() => setLocale(code)}
        aria-pressed={active}
        aria-label={`${t("common.language")}: ${label}`}
        className={cn(
          "group relative inline-flex items-center justify-center gap-1.5 rounded-full font-semibold tracking-wide transition-all duration-200",
          size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
          onDark
            ? active
              ? "bg-white text-slate-900 shadow-sm"
              : "text-white/75 hover:bg-white/10 hover:text-white"
            : active
              ? "bg-[#0b3a5c] text-white shadow-sm dark:bg-white dark:text-slate-900"
              : "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white",
        )}
      >
        <span
          className={cn(
            "relative overflow-hidden rounded-[3px] ring-1",
            onDark
              ? active ? "ring-slate-900/10 shadow-sm" : "ring-white/20"
              : "ring-black/10 dark:ring-white/20",
            flagSize,
          )}
        >
          <Flag className="h-full w-full" />
        </span>
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full p-0.5",
        size === "sm" ? "h-9" : "h-11",
        onDark
          ? "border border-white/15 bg-[#312e81]/90 shadow-[0_8px_18px_-12px_rgba(91,33,182,0.85)] backdrop-blur-md"
          : "border border-slate-200/90 bg-[hsl(0_0%_100%/0.85)] shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-slate-900/70",
        className,
      )}
      role="group"
      aria-label={t("common.language")}
    >
      {btn("uz", "UZ")}
      {btn("ru", "RU")}
    </div>
  );
}

export type { Locale };
