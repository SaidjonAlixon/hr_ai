import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChefHat, Loader2, QrCode, Star, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDay, useAbetToday } from "@/lib/abet-api";
import { RateTab } from "./rate-tab";
import { MenuTab } from "./menu-tab";
import { AnalyticsTab } from "./analytics-tab";
import { QrTab } from "./qr-tab";

type TabId = "rate" | "menu" | "analytics" | "qr";

function takeQrParam(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const qr = params.get("qr");
  if (!qr) return null;
  params.delete("qr");
  const rest = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  return window.location.origin + "/abet?qr=" + encodeURIComponent(qr);
}

export default function AbetPage() {
  const today = useAbetToday();
  const [initialQr] = useState(takeQrParam);
  const [tab, setTab] = useState<TabId | null>(null);
  const d = today.data;

  const tabs = useMemo(() => {
    if (!d) return [];
    const list: Array<{ id: TabId; label: string; icon: typeof Star }> = [];
    if (d.canRate || !d.canViewAnalytics) list.push({ id: "rate", label: "Baholash", icon: Star });
    if (d.canManageMenu) list.push({ id: "menu", label: "Menyu kiritish", icon: ChefHat });
    if (d.canViewAnalytics) {
      list.push({ id: "analytics", label: "Tahlil", icon: BarChart3 });
      list.push({ id: "qr", label: "QR kod", icon: QrCode });
    }
    return list;
  }, [d]);

  useEffect(() => {
    if (tab || !tabs.length) return;
    setTab(initialQr && tabs.some((t) => t.id === "rate") ? "rate" : tabs[0]!.id);
  }, [tabs, tab, initialQr]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-400 text-white shadow">
          <UtensilsCrossed className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Abet</h1>
          <p className="text-sm text-slate-500 dark:text-white/50">
            {d ? `${fmtDay(d.window.day)} · baholash ${d.window.opensAt}–${d.window.closesAt}` : "Kunlik menyu va baholash"}
          </p>
        </div>
      </div>

      {today.isLoading ? (
        <Loader2 className="mx-auto my-16 h-7 w-7 animate-spin text-slate-400" />
      ) : today.error || !d ? (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{(today.error as Error)?.message ?? "Yuklanmadi"}</p>
      ) : (
        <>
          {tabs.length > 1 ? (
            <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-white/5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
                    tab === t.id ? "bg-teal-600 text-white shadow" : "text-slate-600 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/10",
                  )}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}

          {tab === "rate" ? <RateTab data={d} initialQr={initialQr} /> : null}
          {tab === "menu" ? <MenuTab today={d.window.day} /> : null}
          {tab === "analytics" ? <AnalyticsTab data={d} /> : null}
          {tab === "qr" ? <QrTab /> : null}
        </>
      )}
    </div>
  );
}
