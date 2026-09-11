import React, { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Phone, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/i18n/I18nProvider";
import { canAccessBoglanish } from "@/lib/roles";
import { fetchBoglanishStatus, type BoglanishStatus } from "@/lib/boglanish-api";
import { useToast } from "@/hooks/use-toast";

const TOAST_KEY = "boglanish_missing_toast_v1";

export function BoglanishMissingBanner() {
  const { isAuthenticated, user } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [status, setStatus] = useState<BoglanishStatus | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated || !canAccessBoglanish(user?.role)) {
      setStatus(null);
      return;
    }
    try {
      const next = await fetchBoglanishStatus();
      setStatus(next);
    } catch {
      /* ignore */
    }
  }, [isAuthenticated, user?.role]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    const onSaved = () => void load();
    window.addEventListener("boglanish:saved", onSaved);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("boglanish:saved", onSaved);
    };
  }, [load]);

  useEffect(() => {
    if (!status?.show || !user?.id) return;
    const key = `${TOAST_KEY}:${user.id}`;
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    toast({
      title: t("boglanish.warnTitle"),
      description: t("boglanish.warnDesc"),
      variant: "destructive",
    });
  }, [status?.show, user?.id, t, toast]);

  if (!status?.show) return null;

  return (
    <div
      className={cn(
        "border-b border-amber-500/30 bg-amber-50 px-3 py-2.5 text-amber-950",
        "dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100",
        "sm:px-4",
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{t("boglanish.warnTitle")}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-amber-900/80 dark:text-amber-100/80">
              {t("boglanish.warnBanner")}
              {status.missingBranchNames[0]
                ? ` · ${status.missingBranchNames[0]}`
                : ""}
            </p>
          </div>
        </div>
        <Link href="/boglanish">
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-lg bg-[#0a2540] text-white hover:bg-[#0b5fff]"
          >
            <Phone className="h-3.5 w-3.5" />
            {t("boglanish.openCta")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
