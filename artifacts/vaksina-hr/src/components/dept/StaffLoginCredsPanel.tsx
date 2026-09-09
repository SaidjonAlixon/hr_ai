import { useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Props = {
  fullName: string;
  subtitle?: string;
  login: string;
  password: string;
  className?: string;
};

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export function StaffLoginCredsPanel({ fullName, subtitle, login, password, className }: Props) {
  const { toast } = useToast();
  const [showPwd, setShowPwd] = useState(false);
  const [copied, setCopied] = useState<"login" | "pwd" | "both" | null>(null);

  const flash = ( wh: "login" | "pwd" | "both", label: string) => {
    setCopied(wh);
    toast({ title: `${label} nusxalandi` });
    window.setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-background to-sky-500/5 px-3.5 py-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{fullName}</p>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            Login va parolni saqlang yoki nusxalang — keyin Exceldan ham olishingiz mumkin.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-muted/30 shadow-sm">
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/50 px-3.5 py-2">
          <KeyRound className="h-3.5 w-3.5 text-primary" />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Kirish ma’lumotlari
          </p>
        </div>

        <div className="space-y-0 divide-y divide-border/70">
          <div className="flex items-center justify-between gap-2 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Login</p>
              <p className="mt-0.5 truncate font-mono text-sm font-semibold text-foreground">{login}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1 rounded-lg"
              onClick={() =>
                void copyToClipboard(login).then(() => flash("login", "Login"))
              }
            >
              {copied === "login" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Parol</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                {showPwd ? password : "••••••••"}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={() => setShowPwd((v) => !v)}
              >
                {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 rounded-lg"
                onClick={() =>
                  void copyToClipboard(password).then(() => flash("pwd", "Parol"))
                }
              >
                {copied === "pwd" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="h-10 w-full gap-2 rounded-xl font-semibold"
        onClick={() =>
          void copyToClipboard(`Login: ${login}\nParol: ${password}`).then(() =>
            flash("both", "Login/parol"),
          )
        }
      >
        {copied === "both" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        Ikkalasini nusxalash
      </Button>
    </div>
  );
}
