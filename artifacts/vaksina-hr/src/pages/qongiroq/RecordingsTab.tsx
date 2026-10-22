import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Film, Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTashkentRelative } from "@/lib/tashkent-time";

export type RecordingItem = {
  id: number;
  conferenceId: number;
  code: string;
  title: string;
  hostName: string | null;
  status: string;
  progress: number;
  etaSec: number | null;
  bytes: number | null;
  durationSec: number | null;
  mimeType: string | null;
  error: string | null;
  hasFile: boolean;
  uploadedBy: number | null;
  uploadedAt: string;
  sentAt: string | null;
  purgedAt: string | null;
  updatedAt: string;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Yuklanmadi");
  return data as T;
}

function formatBytes(n: number | null | undefined) {
  if (n == null || n <= 0) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec: number | null | undefined) {
  if (sec == null || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m ? `${h} soat ${m} daqiqa` : `${h} soat`;
  if (m > 0) return `${m} daqiqa`;
  return `${s} soniya`;
}

function formatEta(sec: number | null | undefined) {
  if (sec == null || sec < 0) return null;
  if (sec <= 0) return "tayyor";
  if (sec < 60) return `~${sec} soniya`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `~${m} daq ${s} son` : `~${m} daqiqa`;
}

function whenText(iso: string) {
  return formatTashkentRelative(iso);
}

type StatusView = {
  label: string;
  detail: string;
  tone: "idle" | "busy" | "ok" | "bad";
  showBar: boolean;
};

function statusView(r: RecordingItem): StatusView {
  const p = Math.max(0, Math.min(100, Math.round(r.progress || 0)));
  const eta = formatEta(r.etaSec);
  const dur = formatDuration(r.durationSec);
  switch (r.status) {
    case "uploaded":
      return {
        label: "Navbatda",
        detail: eta ? `Telegramga hali yuborilmagan · kutish ${eta}` : "Telegramga hali yuborilmagan",
        tone: "idle",
        showBar: true,
      };
    case "converting":
      return {
        label: `Tayyorlanmoqda · ${p}%`,
        detail: eta ? `MP4 ga o‘girilmoqda · taxminan ${eta}` : "MP4 ga o‘girilmoqda",
        tone: "busy",
        showBar: true,
      };
    case "sending":
      return {
        label: `Yuborilmoqda · ${p}%`,
        detail: eta ? `Telegram guruhiga yuklanmoqda · taxminan ${eta}` : "Telegram guruhiga yuklanmoqda",
        tone: "busy",
        showBar: true,
      };
    case "sent":
    case "sent_purged":
      return {
        label: "Yuborib bo‘lingan",
        detail: [
          r.sentAt ? `Telegramga yetkazildi · ${whenText(r.sentAt)}` : "Telegramga yetkazildi",
          dur ? `Yozuv: ${dur}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        tone: "ok",
        showBar: false,
      };
    case "failed":
      return {
        label: "Yuborilmadi",
        detail: r.error || "Xato — qayta urinish yoki o‘chirish mumkin",
        tone: "bad",
        showBar: false,
      };
    default:
      return { label: r.status, detail: "", tone: "idle", showBar: false };
  }
}

const toneCls = {
  idle: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
  busy: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
  bad: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
} as const;

export function RecordingsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const list = useQuery({
    queryKey: ["calls", "recordings"],
    queryFn: () => getJson<{ items: RecordingItem[] }>("/api/calls/recordings"),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      const busy = items.some((r) => r.status === "uploaded" || r.status === "converting" || r.status === "sending");
      return busy ? 2000 : 15_000;
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/calls/recordings/${id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "O‘chirilmadi");
    },
    onSuccess: () => {
      toast({ title: "Zapis o‘chirildi" });
      void qc.invalidateQueries({ queryKey: ["calls", "recordings"] });
    },
    onError: (e: Error) => toast({ title: "Xatolik", description: e.message, variant: "destructive" }),
  });

  async function downloadRecording(r: RecordingItem) {
    try {
      const res = await fetch(`/api/calls/recordings/${r.id}/file`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Yuklab bo‘lmadi");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `konferensiya_${r.code}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Yuklandi", description: formatDuration(r.durationSec) || r.title });
    } catch (e) {
      toast({
        title: "Yuklab bo‘lmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  if (list.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center text-sm text-muted-foreground">
        {(list.error as Error).message}
      </div>
    );
  }

  const items = list.data?.items ?? [];
  if (!items.length) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground shadow-sm">
          <Film className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-semibold">Hali zapis yo‘q</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Konferensiyada yozib olingan videolar shu yerda ko‘rinadi: davomiylik, Telegram holati va yuklab olish.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
        Faqat admin. Telegramga video + hisobot ketadi. Fayl platformada qoladi — shu yerdan yuklab olishingiz yoki
        qo‘lda o‘chirishingiz mumkin.
      </div>
      <div className="space-y-2">
        {items.map((r) => {
          const st = statusView(r);
          const p = Math.max(0, Math.min(100, Math.round(r.progress || 0)));
          const dur = formatDuration(r.durationSec);
          return (
            <div key={r.id} className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  {st.tone === "busy" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Film className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{r.title}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", toneCls[st.tone])}>
                      {st.label}
                    </span>
                    {dur ? (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-200">
                        Yozuv · {dur}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    Kod: {r.code}
                    {r.hostName ? ` · ${r.hostName}` : ""} · {formatBytes(r.bytes)} · {whenText(r.uploadedAt)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">{st.detail}</p>
                  {st.showBar ? (
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                        <span>{p}%</span>
                        <span>{formatEta(r.etaSec) || "…"}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            st.tone === "busy" ? "bg-amber-500" : "bg-sky-500",
                          )}
                          style={{ width: `${p}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  {r.hasFile ? (
                    <button
                      type="button"
                      title="Videoni yuklab olish"
                      onClick={() => void downloadRecording(r)}
                      className="rounded-xl bg-sky-50 p-2.5 text-sky-700 transition hover:bg-sky-100 active:scale-95 dark:bg-sky-500/10 dark:text-sky-200"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={del.isPending}
                    title="O‘chirish"
                    onClick={() => {
                      if (
                        window.confirm(
                          `"${r.title}" zapisini o‘chirilsinmi?${r.hasFile ? " Diskdagi fayl ham o‘chadi." : ""}`,
                        )
                      ) {
                        del.mutate(r.id);
                      }
                    }}
                    className="rounded-xl bg-red-50 p-2.5 text-red-600 transition hover:bg-red-100 active:scale-95 disabled:opacity-50 dark:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
