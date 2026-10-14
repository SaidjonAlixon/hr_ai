import { useEffect, useState } from "react";
import { AlarmClock, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { useToast } from "../../hooks/use-toast";
import { fetchScheduleConfig, saveScheduleConfig, type ScheduleConfig, type ScheduledRun } from "../../lib/davomat-api";
import { cn } from "../../lib/utils";

export function ScheduledReports({
  open,
  shifts,
  groupReady,
}: {
  open: boolean;
  shifts: { key: string; label: string }[];
  groupReady: boolean;
}) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<ScheduleConfig | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [runs, setRuns] = useState<ScheduledRun[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchScheduleConfig()
      .then((c) => {
        if (!alive) return;
        setCfg(c);
        setEnabled(c.enabled);
        setRuns(c.runs);
      })
      .catch((err) => toast({ title: "Jadval yuklanmadi", description: (err as Error).message, variant: "destructive" }));
    return () => {
      alive = false;
    };
  }, [open, toast]);

  const dirty = !!cfg && (cfg.enabled !== enabled || JSON.stringify(cfg.runs) !== JSON.stringify(runs));

  const setRun = (i: number, next: Partial<ScheduledRun>) =>
    setRuns((cur) => cur.map((r, j) => (j === i ? { ...r, ...next } : r)));

  const toggleBucket = (i: number, key: string) => {
    const r = runs[i]!;
    setRun(i, { buckets: r.buckets.includes(key) ? r.buckets.filter((k) => k !== key) : [...r.buckets, key] });
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const c = await saveScheduleConfig({ enabled, runs });
      setCfg(c);
      setEnabled(c.enabled);
      setRuns(c.runs);
      toast({
        title: c.enabled ? "Jadval saqlandi" : "Jadval o‘chirildi",
        description: c.enabled ? c.runs.map((r) => r.hm).join(" va ") + " da guruhga yuboriladi." : undefined,
      });
    } catch (err) {
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const labelOf = (key: string) => shifts.find((s) => s.key === key)?.label ?? key;

  return (
    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <AlarmClock className="h-4 w-4 text-emerald-600" /> Belgilangan soatda guruhga
          </div>
          <div className="text-xs text-muted-foreground">
            Faqat kelmagan va kechikkanlar · koordinator nik bilan belgilanadi
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!cfg || saving} />
      </div>

      {!cfg ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </div>
      ) : (
        <div className={cn("space-y-2", !enabled && "opacity-60")}>
          {runs.map((r, i) => {
            const sent = cfg.sentToday.includes(r.hm);
            return (
              <div key={i} className="rounded-md border bg-background p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="time"
                    value={r.hm}
                    onChange={(e) => setRun(i, { hm: e.target.value })}
                    className="h-8 rounded-md border bg-background px-2 text-sm font-semibold"
                    disabled={!enabled}
                  />
                  {sent ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" /> bugun yuborildi
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {r.buckets.map(labelOf).join(", ") || "smena tanlanmagan"}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {shifts.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      disabled={!enabled}
                      onClick={() => toggleBucket(i, s.key)}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-xs font-medium transition",
                        r.buckets.includes(s.key)
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {!groupReady ? (
            <p className="text-xs text-amber-600">Guruh hali belgilanmagan: «Koordinatorlar» mavzusida /hisobot_guruh deb yozing.</p>
          ) : null}
        </div>
      )}

      {dirty ? (
        <Button type="button" variant="outline" size="sm" className="w-full gap-2" disabled={saving} onClick={() => void onSave()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlarmClock className="h-4 w-4" />}
          Jadvalni saqlash
        </Button>
      ) : null}
    </div>
  );
}
