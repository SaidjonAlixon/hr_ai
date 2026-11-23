import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  Eye,
  FileDown,
  Loader2,
  Plus,
  QrCode,
  Search,
  Star,
  Store,
  MessageSquareWarning,
  Trash2,
  Users,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  bahoQrPreviewPng,
  downloadAllBahoQrPdf,
  downloadBahoQrPdf,
} from "@/lib/customer-rating-qr-pdf";
import { scriptIncludes } from "@/lib/script-search";
import { BranchCombobox } from "@/pages/reviziya/branch-combobox";

type QrItem = {
  branchId: number;
  branchLabel: string;
  branchNo?: number | null;
  mudirName?: string;
  coordinatorName?: string;
  coordinatorPhone?: string;
  regionLabel?: string | null;
  location?: string | null;
  token: string | null;
  status: string;
  version: number;
  publicUrl: string | null;
};

function qrPdfReady(item: QrItem) {
  return Boolean(item.publicUrl && item.status === "active");
}

type FeedItem = {
  id: number;
  branchId: number;
  branchLabel: string;
  branchNo: number | null;
  branchName: string;
  branchPhone: string;
  mudirName: string;
  mudirPhone: string;
  coordinatorName: string;
  coordinatorPhone: string;
  workDate: string;
  stars: number;
  serviceQuality: string;
  demeanor: string;
  comment: string | null;
  customerName: string | null;
  customerPhone: string | null;
  anonymous: boolean;
  targetMode?: string;
  rateType?: "staff" | "pharmacy" | "complaint";
  targets: Array<{
    employeeId: number;
    employeeName: string;
    position?: string | null;
    shiftKey?: string | null;
    userId?: number | null;
    phone?: string | null;
    photoUrl?: string | null;
  }>;
  createdAt: string;
  selfRating?: boolean;
  selfRatingReason?: string | null;
};

type FeedTarget = FeedItem["targets"][number];

type Tab = "qr" | "staff" | "pharmacy" | "complaint" | "stats";

async function readErr(res: Response, fb: string) {
  const b = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(b?.error || fb);
}

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("uz-UZ", {
      timeZone: "Asia/Tashkent",
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

function statusMeta(status: string) {
  if (status === "active") return { label: "Faol", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" };
  if (status === "blocked") return { label: "Bloklangan", cls: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200" };
  if (status === "revoked") return { label: "Eskirgan", cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100" };
  return { label: "QR yo‘q", cls: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300" };
}

export default function MijozlarBaholashiPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("qr");
  const [branchId, setBranchId] = useState<string>("");
  const [complaints, setComplaints] = useState(false);
  const [feedSearch, setFeedSearch] = useState("");
  const [starFilter, setStarFilter] = useState<"all" | "1" | "2" | "3" | "4" | "5">("all");
  const [selfOnly, setSelfOnly] = useState(false);
  const [qrSearch, setQrSearch] = useState("");
  const [qrFilter, setQrFilter] = useState<"all" | "missing" | "active" | "blocked">("all");
  /** Bo‘sh = barcha koordinatorlar */
  const [qrCoordinator, setQrCoordinator] = useState("");
  const [preview, setPreview] = useState<{ url: string; label: string; dataUrl: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pdfSelected, setPdfSelected] = useState<Set<number>>(new Set());
  const pdfSelInit = useRef(false);

  const meta = useQuery({
    queryKey: ["customer-ratings-meta"],
    queryFn: async () => {
      const res = await fetch("/api/customer-ratings/meta", { credentials: "include" });
      if (!res.ok) throw await readErr(res, "Ruxsat tekshirilmadi");
      return res.json() as Promise<{ canManage: boolean; canSeeIdentity: boolean; role?: string }>;
    },
  });

  const branches = useQuery({
    queryKey: ["customer-ratings-branches"],
    queryFn: async () => {
      const res = await fetch("/api/customer-ratings/branches", { credentials: "include" });
      if (!res.ok) throw await readErr(res, "Filiallar yuklanmadi");
      return res.json() as Promise<{ branches: Array<{ id: number; label: string; branchNo?: number | null }> }>;
    },
  });

  const qr = useQuery({
    queryKey: ["customer-ratings-qr"],
    queryFn: async () => {
      const res = await fetch("/api/customer-ratings/qr", { credentials: "include" });
      if (!res.ok) throw await readErr(res, "QR yuklanmadi");
      return res.json() as Promise<{ items: QrItem[]; canManage: boolean }>;
    },
  });

  const feedQs = useMemo(() => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    if (complaints && tab !== "complaint") p.set("complaints", "1");
    if (tab === "staff" || tab === "pharmacy" || tab === "complaint") p.set("rateType", tab);
    return p.toString();
  }, [branchId, complaints, tab]);

  const feed = useQuery({
    queryKey: ["customer-ratings-feed", feedQs],
    enabled: tab !== "qr",
    queryFn: async () => {
      const res = await fetch(`/api/customer-ratings/feed?${feedQs}`, { credentials: "include" });
      if (!res.ok) throw await readErr(res, "Baholar yuklanmadi");
      return res.json() as Promise<{
        items: FeedItem[];
        stats: {
          total: number;
          avgStars: number;
          complaints: number;
          byBranch: Array<{ branchId: number; label: string; count: number; avg: number }>;
          byEmployee: Array<{ employeeId: number; name: string; count: number; avg: number }>;
        };
      }>;
    },
  });

  const canManage = meta.data?.canManage ?? qr.data?.canManage ?? false;
  const canSee = meta.data?.canSeeIdentity ?? false;

  const coordinatorOptions = useMemo(() => {
    const names = new Set<string>();
    for (const it of qr.data?.items || []) {
      const n = String(it.coordinatorName || "").trim();
      if (n) names.add(n);
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b, "uz"))
      .map((name) => ({ id: name, label: name }));
  }, [qr.data?.items]);

  const qrItems = useMemo(() => {
    const list = [...(qr.data?.items || [])];
    const q = qrSearch.trim().toLowerCase();
    const coord = qrCoordinator.trim();
    return list
      .filter((it) => {
        if (coord) return String(it.coordinatorName || "").trim() === coord;
        return true;
      })
      .filter((it) => {
        if (qrFilter === "missing") return it.status === "missing" || !it.token;
        if (qrFilter === "active") return it.status === "active";
        if (qrFilter === "blocked") return it.status === "blocked";
        return true;
      })
      .filter((it) => {
        if (!q) return true;
        return (
          it.branchLabel.toLowerCase().includes(q) ||
          String(it.branchNo ?? "").includes(q) ||
          (it.mudirName || "").toLowerCase().includes(q) ||
          (it.coordinatorName || "").toLowerCase().includes(q) ||
          (it.regionLabel || "").toLowerCase().includes(q) ||
          (it.location || "").toLowerCase().includes(q)
        );
      });
  }, [qr.data?.items, qrSearch, qrFilter, qrCoordinator]);

  const qrStats = useMemo(() => {
    const items = qr.data?.items || [];
    return {
      total: items.length,
      active: items.filter((i) => i.status === "active").length,
      missing: items.filter((i) => i.status === "missing" || !i.token).length,
      blocked: items.filter((i) => i.status === "blocked").length,
      /** Faol bo‘lmaganlar — «Hammaga QR yaratish» shu sonni to‘ldiradi */
      needCreate: items.filter((i) => i.status !== "active" || !i.token).length,
    };
  }, [qr.data?.items]);

  useEffect(() => {
    const activeIds = (qr.data?.items || []).filter(qrPdfReady).map((i) => i.branchId);
    const activeSet = new Set(activeIds);
    setPdfSelected((prev) => {
      if (!pdfSelInit.current) {
        if (activeIds.length) pdfSelInit.current = true;
        return new Set(activeIds);
      }
      return new Set([...prev].filter((id) => activeSet.has(id)));
    });
  }, [qr.data?.items]);

  const pdfSelectableVisible = useMemo(
    () => qrItems.filter(qrPdfReady),
    [qrItems],
  );
  const pdfSelectedVisibleCount = useMemo(
    () => pdfSelectableVisible.filter((i) => pdfSelected.has(i.branchId)).length,
    [pdfSelectableVisible, pdfSelected],
  );
  const pdfAllVisibleSelected =
    pdfSelectableVisible.length > 0 && pdfSelectedVisibleCount === pdfSelectableVisible.length;

  const togglePdfBranch = (branchId: number, on: boolean) => {
    setPdfSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(branchId);
      else next.delete(branchId);
      return next;
    });
  };

  const selectAllVisiblePdf = () => {
    setPdfSelected((prev) => {
      const next = new Set(prev);
      for (const it of pdfSelectableVisible) next.add(it.branchId);
      return next;
    });
  };

  const clearVisiblePdf = () => {
    setPdfSelected((prev) => {
      const next = new Set(prev);
      for (const it of pdfSelectableVisible) next.delete(it.branchId);
      return next;
    });
  };

  const invalidateQr = () => void qc.invalidateQueries({ queryKey: ["customer-ratings-qr"] });

  const createQr = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch("/api/customer-ratings/qr", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: id }),
      });
      if (!res.ok) throw await readErr(res, "Yaratilmadi");
      return res.json();
    },
    onSuccess: () => {
      invalidateQr();
      toast({ title: "QR yaratildi" });
    },
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const createAllQr = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/customer-ratings/qr", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createAll: true }),
      });
      if (!res.ok) throw await readErr(res, "Yaratilmadi");
      return res.json() as Promise<{ created: number; total: number }>;
    },
    onSuccess: (data) => {
      invalidateQr();
      toast({ title: data.created ? `${data.created} ta QR yaratildi` : "Hammasi allaqachon bor" });
    },
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/customer-ratings/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw await readErr(res, "O‘chirilmadi");
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customer-ratings-feed"] });
      toast({ title: "Baho o‘chirildi" });
    },
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const showQr = async (item: QrItem) => {
    if (!item.publicUrl) return;
    const dataUrl = await bahoQrPreviewPng(item.publicUrl);
    setPreview({ url: item.publicUrl, label: item.branchLabel, dataUrl });
  };

  const downloadOnePdf = async (item: QrItem) => {
    if (!item.publicUrl || !canManage) return;
    setPdfBusy(true);
    try {
      await downloadBahoQrPdf({
        branchLabel: item.regionLabel
          ? `${item.branchLabel} · ${item.regionLabel}`
          : item.branchLabel,
        publicUrl: item.publicUrl,
        branchNo: item.branchNo,
      });
      toast({ title: "A4 PDF tayyor" });
    } catch (e) {
      toast({ title: "PDF xato", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadSelectedPdf = async () => {
    if (!canManage) return;
    // Faqat hozir ko‘rinayotgan (filtr/koordinator) + belgilanganlar
    const list = qrItems
      .filter((i) => qrPdfReady(i) && pdfSelected.has(i.branchId))
      .map((i) => ({
        branchLabel: i.regionLabel
          ? `${i.branchLabel} · ${i.regionLabel}`
          : i.branchLabel,
        publicUrl: i.publicUrl!,
        branchNo: i.branchNo,
      }));
    if (!list.length) {
      toast({
        title: "PDF uchun filial tanlang",
        description: qrCoordinator
          ? "Shu koordinator filiallaridan pitichka belgilang — keyin yuklab oling."
          : "Pitichkani belgilang — keyin yuklab oling.",
        variant: "destructive",
      });
      return;
    }
    setPdfBusy(true);
    try {
      await downloadAllBahoQrPdf(list);
      toast({
        title: `PDF: ${list.length} ta filial`,
        description: qrCoordinator ? `Koordinator: ${qrCoordinator}` : undefined,
      });
    } catch (e) {
      toast({ title: "PDF xato", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPdfBusy(false);
    }
  };

  const exportXlsx = (type: "all" | "staff" | "pharmacy" | "complaint" = "all") => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    if (complaints && type !== "complaint") p.set("complaints", "1");
    if (type !== "all") p.set("rateType", type);
    if (feedSearch.trim()) p.set("q", feedSearch.trim());
    if (starFilter !== "all" && type !== "complaint") p.set("stars", starFilter);
    window.open(`/api/customer-ratings/export.xlsx?${p}`, "_blank");
  };

  const stats = feed.data?.stats;
  const branchOptions = useMemo(
    () => (branches.data?.branches || []).map((b) => ({ id: String(b.id), label: b.label })),
    [branches.data?.branches],
  );

  const selfRatingCount = useMemo(
    () => (feed.data?.items || []).filter((it) => it.selfRating).length,
    [feed.data?.items],
  );

  const items = useMemo(() => {
    const list = feed.data?.items || [];
    const q = feedSearch.trim();
    return list.filter((it) => {
      if (selfOnly && !it.selfRating) return false;
      if (starFilter !== "all" && it.stars !== Number(starFilter)) return false;
      if (!q) return true;
      const hay = [
        it.branchLabel,
        it.branchName,
        it.branchNo != null ? String(it.branchNo) : "",
        it.branchPhone,
        it.mudirName,
        it.mudirPhone,
        it.coordinatorName,
        it.coordinatorPhone,
        it.serviceQuality,
        it.demeanor,
        it.comment,
        it.customerName,
        it.customerPhone,
        it.workDate,
        it.selfRatingReason,
        ...it.targets.map((t) => t.employeeName),
        String(it.stars),
      ]
        .filter(Boolean)
        .join(" ");
      return scriptIncludes(hay, q);
    });
  }, [feed.data?.items, feedSearch, starFilter, selfOnly]);
  const busyQr = createQr.isPending || createAllQr.isPending;

  return (
    <div className="w-full max-w-none space-y-4 px-0 py-2 sm:py-3">
      <header className="flex flex-wrap items-end justify-between gap-4 overflow-hidden rounded-3xl border border-[#5c2d91]/15 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-[#5c2d91] dark:text-white sm:text-3xl">
            Mijozlar baholashi
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Har filial uchun QR · xodim va dorixona baholari alohida · mudir/koordinator · mijoz ma’lumoti{" "}
            {canSee ? "admin uchun ochiq" : "anonim"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && tab === "qr" ? (
            <>
              <Button
                type="button"
                size="sm"
                className="h-10 gap-1.5 rounded-xl px-4"
                disabled={busyQr || qrStats.needCreate === 0}
                onClick={() => createAllQr.mutate()}
              >
                {createAllQr.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Hammaga QR yaratish
                {qrStats.needCreate ? ` (${qrStats.needCreate})` : ""}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 gap-1.5 rounded-xl px-4"
                disabled={pdfBusy || pdfSelectedVisibleCount === 0}
                onClick={() => void downloadSelectedPdf()}
              >
                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                Tanlanganlar A4 PDF
                {pdfSelectedVisibleCount ? ` (${pdfSelectedVisibleCount})` : ""}
              </Button>
            </>
          ) : null}
          {canManage && (tab === "staff" || tab === "pharmacy") ? (
            <Button type="button" size="sm" className="h-10 gap-1.5 rounded-xl" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Baho qo‘shish
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 gap-1.5 rounded-xl border-[#5c2d91]/25 bg-gradient-to-r from-white to-[#f7f3fc] font-bold text-[#5c2d91] hover:bg-[#f3edfa]"
            onClick={() =>
              exportXlsx(tab === "staff" || tab === "pharmacy" || tab === "complaint" ? tab : "all")
            }
          >
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Filiallar" value={String(qrStats.total || branches.data?.branches?.length || "…")} />
        <MiniStat label="Faol QR" value={String(qrStats.active)} tone="ok" />
        <MiniStat label="QR yo‘q" value={String(qrStats.missing)} tone={qrStats.missing ? "warn" : undefined} />
        <MiniStat label="Bloklangan" value={String(qrStats.blocked)} tone={qrStats.blocked ? "bad" : undefined} />
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-2xl bg-slate-100 p-1.5 dark:bg-white/5">
        {(
          [
            ["qr", "QR kodlar", QrCode],
            ["staff", "Xodim baholari", Users],
            ["pharmacy", "Dorixona baholari", Store],
            ["complaint", "Shikoyatlar", MessageSquareWarning],
            ["stats", "Statistika", Star],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition sm:flex-none sm:px-5",
              tab === k ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500 hover:text-slate-800",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {(tab === "staff" || tab === "pharmacy" || tab === "complaint" || tab === "stats") && (
        <div className="space-y-3 rounded-3xl border border-[#5c2d91]/12 bg-gradient-to-br from-white via-[#faf7ff] to-[#fffdf5] p-4 shadow-[0_12px_40px_-28px_rgba(92,45,145,0.45)] dark:border-white/10 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900">
          <div className="flex flex-wrap gap-2">
            {(tab === "staff" || tab === "pharmacy" || tab === "complaint") && (
              <div className="relative min-w-[260px] flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5c2d91]/60" />
                <input
                  value={feedSearch}
                  onChange={(e) => setFeedSearch(e.target.value)}
                  placeholder={
                    tab === "complaint"
                      ? "Qidiruv: filial, shikoyat, mijoz… (lotin/kirill)"
                      : tab === "staff"
                        ? "Qidiruv: filial, mudir, xodim… (lotin/kirill)"
                        : "Qidiruv: filial, mudir, izoh… (lotin/kirill)"
                  }
                  className="h-12 w-full rounded-2xl border border-[#5c2d91]/15 bg-white/90 pl-11 pr-3 text-sm font-semibold text-slate-800 outline-none ring-[#5c2d91]/20 placeholder:font-medium placeholder:text-slate-400 focus:ring-2 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            )}
            <BranchCombobox
              value={branchId}
              onChange={setBranchId}
              options={branchOptions}
              allowAll
              allLabel="Barcha filiallar"
              placeholder="Filialni tanlang"
              tone="violet"
              className="h-12 min-w-[240px] flex-1 rounded-2xl border-[#5c2d91]/15 sm:max-w-[320px]"
            />
            {tab !== "complaint" ? (
              <label className="inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-2xl border border-rose-200/80 bg-rose-50/80 px-4 text-sm font-bold text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                <input
                  type="checkbox"
                  checked={complaints}
                  onChange={(e) => setComplaints(e.target.checked)}
                  className="h-4 w-4 accent-rose-600"
                />
                Faqat past baholar
              </label>
            ) : null}
            {(tab === "staff" || tab === "pharmacy") && (
              <label className="inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-2xl border border-amber-300/90 bg-amber-50 px-4 text-sm font-bold text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100">
                <input
                  type="checkbox"
                  checked={selfOnly}
                  onChange={(e) => setSelfOnly(e.target.checked)}
                  className="h-4 w-4 accent-amber-600"
                />
                O‘ziga-o‘zi baholar
                {selfRatingCount > 0 ? (
                  <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-black tabular-nums">
                    {selfRatingCount}
                  </span>
                ) : null}
              </label>
            )}
          </div>
          {(tab === "staff" || tab === "pharmacy") && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Yulduz</span>
              {(
                [
                  ["all", "Hammasi"],
                  ["5", "5★"],
                  ["4", "4★"],
                  ["3", "3★"],
                  ["2", "2★"],
                  ["1", "1★"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStarFilter(k)}
                  className={cn(
                    "h-9 rounded-xl px-3 text-xs font-extrabold transition",
                    starFilter === k
                      ? "bg-[#5c2d91] text-white shadow-sm"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-[#5c2d91]/30 dark:border-white/10 dark:bg-slate-950",
                  )}
                >
                  {label}
                </button>
              ))}
              {(feedSearch || starFilter !== "all") && (
                <span className="ml-auto text-xs font-semibold text-slate-500">
                  Ko‘rsatilmoqda: <b className="text-[#5c2d91]">{items.length}</b>
                  {feed.data?.items ? ` / ${feed.data.items.length}` : ""}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "qr" ? (
        <section className="space-y-4">
          {!canManage ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              QR yaratish / almashtirish / o‘chirish / A4 PDF — faqat admin va HR. Siz filial QR larini ko‘ra olasiz.
            </p>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              Har bir qator — bitta filial (nom + viloyat/shahar). Yaratilgan QR o‘zgarmas: o‘chirilmaydi, almashtirilmaydi.
              Pitichka bilan PDF tanlang — «Tanlanganlar A4 PDF».
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={qrSearch}
                onChange={(e) => setQrSearch(e.target.value)}
                placeholder="Filial nomi, №, mudir yoki viloyat…"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium outline-none focus:border-[#0b3a5c]/40 dark:border-white/10 dark:bg-slate-900"
              />
            </div>
            {coordinatorOptions.length > 0 ? (
              <BranchCombobox
                value={qrCoordinator}
                onChange={(id) => {
                  setQrCoordinator(id);
                  // Koordinator tanlanganda shu filiallar PDF uchun avtomatik belgilanadi
                  const nextIds = (qr.data?.items || [])
                    .filter((it) => {
                      if (!id) return true;
                      return String(it.coordinatorName || "").trim() === id;
                    })
                    .filter(qrPdfReady)
                    .map((it) => it.branchId);
                  setPdfSelected(new Set(nextIds));
                }}
                options={coordinatorOptions}
                allowAll
                allLabel="Barcha koordinatorlar"
                placeholder="Koordinator"
                className="h-11 min-w-[220px] w-[260px] rounded-xl"
                tone="violet"
              />
            ) : null}
            {(
              [
                ["all", "Hammasi"],
                ["missing", "QR yo‘q"],
                ["active", "Faol"],
                ["blocked", "Blok"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setQrFilter(k)}
                className={cn(
                  "h-11 rounded-xl px-4 text-sm font-bold",
                  qrFilter === k
                    ? "bg-[#0b3a5c] text-white"
                    : "border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-slate-900",
                )}
              >
                {label}
              </button>
            ))}
            {canManage && pdfSelectableVisible.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 rounded-xl px-3 text-xs font-bold"
                  onClick={() => (pdfAllVisibleSelected ? clearVisiblePdf() : selectAllVisiblePdf())}
                >
                  {pdfAllVisibleSelected ? "Belgini olish" : "Barchasini belgilash"}
                  {` (${pdfSelectableVisible.length})`}
                </Button>
                <span className="text-xs font-semibold text-slate-500">
                  PDF: <b className="text-[#5c2d91]">{pdfSelectedVisibleCount}</b> ta
                  {qrCoordinator ? (
                    <span className="ml-1 text-[#5c2d91]">· {qrCoordinator}</span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>

          {qr.isLoading ? (
            <p className="flex items-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Filiallar yuklanmoqda…
            </p>
          ) : qr.isError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center dark:border-rose-500/30 dark:bg-rose-500/10">
              <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
              <p className="mt-2 text-sm font-bold text-rose-800 dark:text-rose-100">{(qr.error as Error).message}</p>
              <Button className="mt-3 rounded-xl" variant="outline" onClick={() => void qr.refetch()}>
                Qayta urinish
              </Button>
            </div>
          ) : !qrItems.length ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-14 text-center dark:border-white/10">
              <Store className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-base font-bold text-slate-700 dark:text-slate-200">Filial topilmadi</p>
              <p className="mt-1 text-sm text-slate-500">
                {qrStats.total === 0
                  ? "Tizimda faol mudir-filiallar yo‘q yoki ro‘yxat bo‘sh."
                  : "Qidiruv/filtr bo‘yicha natija yo‘q."}
              </p>
            </div>
          ) : (
            <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/5 sm:px-5">
                {canManage ? (
                  <div className="flex w-8 shrink-0 justify-center">
                    <Checkbox
                      checked={pdfAllVisibleSelected}
                      disabled={pdfSelectableVisible.length === 0}
                      onCheckedChange={(v) => {
                        if (v === true) selectAllVisiblePdf();
                        else clearVisiblePdf();
                      }}
                      aria-label="Barchasini belgilash"
                    />
                  </div>
                ) : null}
                <div className="w-10 shrink-0">№</div>
                <div className="min-w-0 flex-1">Filial · joylashuv</div>
                <div className="hidden w-[160px] shrink-0 lg:block">Mudir</div>
                <div className="hidden w-[160px] shrink-0 xl:block">Koordinator</div>
                <div className="hidden w-[88px] shrink-0 sm:block">Holat</div>
                <div className="w-[132px] shrink-0 text-right sm:w-[168px]">Amallar</div>
              </div>

              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {qrItems.map((item) => {
                  const st = statusMeta(item.status);
                  const needCreate = item.status === "missing" || item.status === "revoked" || !item.token;
                  const canPickPdf = canManage && qrPdfReady(item);
                  const region = (item.regionLabel || "").trim();
                  const hasActiveQr = Boolean(item.publicUrl && item.status === "active");
                  return (
                    <li
                      key={item.branchId}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50/70 dark:hover:bg-white/[0.03] sm:px-5"
                    >
                      {canManage ? (
                        <div className="flex w-8 shrink-0 justify-center">
                          <Checkbox
                            checked={canPickPdf && pdfSelected.has(item.branchId)}
                            disabled={!canPickPdf}
                            onCheckedChange={(v) => togglePdfBranch(item.branchId, v === true)}
                            aria-label={`${item.branchLabel} PDF`}
                          />
                        </div>
                      ) : null}

                      <div className="w-10 shrink-0 text-sm font-black tabular-nums text-slate-700 dark:text-slate-200">
                        {item.branchNo != null ? item.branchNo : "—"}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <p className="truncate text-[15px] font-bold text-slate-900 dark:text-white">
                            {item.branchLabel}
                          </p>
                          {item.version ? (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                              v{item.version}
                            </span>
                          ) : null}
                        </div>
                        {region ? (
                          <p className="mt-0.5 truncate text-[12px] font-semibold text-[#5c2d91] dark:text-violet-300">
                            {region}
                          </p>
                        ) : null}
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 lg:hidden">
                          {item.mudirName || "Mudir yo‘q"}
                          {item.coordinatorName ? (
                            <>
                              <span className="mx-1.5 text-slate-300">·</span>
                              {item.coordinatorName}
                            </>
                          ) : null}
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className={cn("font-semibold", st.cls.includes("emerald") ? "text-emerald-700" : "")}>
                            {st.label}
                          </span>
                        </p>
                      </div>

                      <div className="hidden w-[160px] shrink-0 truncate text-sm font-semibold text-slate-700 dark:text-slate-200 lg:block">
                        {item.mudirName || "—"}
                      </div>
                      <div className="hidden w-[160px] shrink-0 truncate text-sm font-semibold text-slate-600 dark:text-slate-300 xl:block">
                        {item.coordinatorName || "—"}
                      </div>

                      <div className="hidden w-[88px] shrink-0 sm:block">
                        <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold", st.cls)}>
                          {st.label}
                        </span>
                      </div>

                      <div className="flex w-[132px] shrink-0 items-center justify-end gap-1 sm:w-[168px]">
                        {canManage && needCreate ? (
                          <Button
                            size="sm"
                            className="h-8 rounded-lg px-2.5 text-xs"
                            disabled={busyQr}
                            onClick={() => createQr.mutate(item.branchId)}
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Yaratish</span>
                          </Button>
                        ) : null}

                        {hasActiveQr ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 rounded-lg p-0"
                              title="Ko‘rish"
                              onClick={() => void showQr(item)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {canManage ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg px-2 text-xs"
                                disabled={pdfBusy}
                                title="A4 PDF"
                                onClick={() => void downloadOnePdf(item)}
                              >
                                <FileDown className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">PDF</span>
                              </Button>
                            ) : null}
                          </>
                        ) : null}

                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-white/10 sm:px-5">
                Ko‘rsatilmoqda: <b>{qrItems.length}</b> / {qrStats.total} filial
              </div>
            </div>
          )}
        </section>
      ) : null}

      {tab === "stats" ? (
        <section className="space-y-4">
          {feed.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Jami baho" value={String(stats?.total ?? "0")} />
                <Stat label="O‘rtacha" value={stats ? stats.avgStars.toFixed(2) : "0"} icon />
                <Stat label="Shikoyat" value={String(stats?.complaints ?? "0")} warn />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Filiallar reytingi">
                  {(stats?.byBranch || []).slice(0, 20).map((b) => (
                    <Row key={b.branchId} left={b.label} right={`${b.avg.toFixed(2)} ★ · ${b.count}`} />
                  ))}
                  {!stats?.byBranch?.length ? <Empty /> : null}
                </Card>
                <Card title="Xodimlar (pastlardan)">
                  {(stats?.byEmployee || []).slice(0, 20).map((e) => (
                    <Row key={e.employeeId} left={e.name} right={`${e.avg.toFixed(2)} ★ · ${e.count}`} />
                  ))}
                  {!stats?.byEmployee?.length ? <Empty /> : null}
                </Card>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "staff" || tab === "pharmacy" ? (
        <RatingsTable
          kind={tab}
          items={items}
          loading={feed.isLoading}
          error={feed.isError ? (feed.error as Error).message : null}
          canSee={canSee}
          canManage={canManage}
          onDelete={(id) => {
            if (confirm("Bu bahoni o‘chirasizmi?")) del.mutate(id);
          }}
          deleting={del.isPending}
        />
      ) : null}

      {tab === "complaint" ? (
        <ComplaintsTable
          items={items}
          loading={feed.isLoading}
          error={feed.isError ? (feed.error as Error).message : null}
          canSee={canSee}
          canManage={canManage}
          onDelete={(id) => {
            if (confirm("Bu shikoyatni o‘chirasizmi?")) del.mutate(id);
          }}
          deleting={del.isPending}
        />
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreview(null)}>
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src="/logo_vaksina.png"
              alt="Vaksina"
              className="mx-auto h-14 w-auto object-contain"
            />
            <p className="mt-3 text-xl font-extrabold text-[#5c2d91] dark:text-white">Xizmatni baholang</p>
            <img src={preview.dataUrl} alt="QR" className="mx-auto mt-4 h-72 w-72 rounded-2xl border border-violet-100 shadow-sm" />
            <p className="mt-3 text-base font-bold text-slate-800 dark:text-slate-100">{preview.label}</p>
            <p className="mt-1 break-all text-[10px] text-slate-400">{preview.url}</p>
            <div className="mt-5 flex gap-2">
              {canManage ? (
                <Button
                  className="h-11 flex-1 rounded-xl"
                  disabled={pdfBusy}
                  onClick={() =>
                    void downloadBahoQrPdf({ branchLabel: preview.label, publicUrl: preview.url }).then(
                      () => toast({ title: "A4 PDF tayyor" }),
                      (e) => toast({ title: "PDF xato", description: String(e?.message || e), variant: "destructive" }),
                    )
                  }
                >
                  <FileDown className="h-4 w-4" /> A4 PDF
                </Button>
              ) : null}
              <Button variant="outline" className="h-11 flex-1 rounded-xl" onClick={() => setPreview(null)}>
                Yopish
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {addOpen && canManage ? (
        <AddRatingModal
          branches={branches.data?.branches || []}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            void qc.invalidateQueries({ queryKey: ["customer-ratings-feed"] });
            toast({ title: "Baho qo‘shildi" });
          }}
        />
      ) : null}

      <p className="pb-2 text-[11px] text-slate-400">
        {user?.fullName || user?.login} · rol: {meta.data?.role || user?.role || "—"} ·{" "}
        {canManage ? (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> boshqaruv ochiq
          </span>
        ) : (
          "faqat ko‘rish"
        )}
      </p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3.5",
        tone === "ok" && "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
        tone === "warn" && "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
        tone === "bad" && "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10",
        !tone && "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900",
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function qualityTone(v: string) {
  const s = v.toLocaleLowerCase("uz");
  if (/(alo|a'lo|yaxshi|аъло)/.test(s)) return "ok" as const;
  if (/(qoniqarli|нормал|normal)/.test(s)) return "mid" as const;
  if (/(yomon|qoniqarsiz|past)/.test(s)) return "bad" as const;
  return "neutral" as const;
}

function QualityChip({ value }: { value: string }) {
  const tone = qualityTone(value);
  return (
    <span
      className={cn(
        "inline-flex max-w-full truncate rounded-lg px-2 py-1 text-[11px] font-bold capitalize",
        tone === "ok" && "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80",
        tone === "mid" && "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80",
        tone === "bad" && "bg-rose-50 text-rose-800 ring-1 ring-rose-200/80",
        tone === "neutral" && "bg-slate-50 text-slate-700 ring-1 ring-slate-200/80",
      )}
    >
      {value || "—"}
    </span>
  );
}

function PersonCell({ name, phone }: { name?: string | null; phone?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[13px] font-bold leading-snug text-slate-800 dark:text-slate-100">{name || "—"}</p>
      {phone ? <p className="mt-0.5 truncate text-[11px] font-medium tabular-nums text-slate-400">{phone}</p> : null}
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100 px-3.5 py-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1.5 text-[14px] font-semibold text-slate-800 dark:text-slate-100">{children}</div>
    </div>
  );
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function StaffAvatar({
  name,
  photoUrl,
  size = "md",
  className,
}: {
  name: string;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const dim =
    size === "sm" ? "h-8 w-8 text-[10px]" : size === "lg" ? "h-16 w-16 text-lg" : size === "xl" ? "h-24 w-24 text-2xl" : "h-11 w-11 text-xs";
  const show = Boolean(photoUrl && !broken);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#5c2d91] to-[#c9a227] font-black text-white ring-2 ring-white shadow-md",
        dim,
        className,
      )}
    >
      {show ? (
        <img
          src={photoUrl!}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}

function RatedStaffCard({
  target,
  onOpen,
}: {
  target: FeedTarget;
  onOpen: (t: FeedTarget) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(target)}
      className="group flex w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:bg-amber-100 hover:shadow-md dark:border-amber-500/40 dark:bg-slate-800"
    >
      <StaffAvatar name={target.employeeName} photoUrl={target.photoUrl} size="lg" className="rounded-2xl ring-amber-200/80" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700/80">Baholangan xodim</span>
        <span className="mt-0.5 block truncate text-[15px] font-black text-slate-900 dark:text-slate-50">
          {target.employeeName}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-slate-500">
          {target.position ? <span>{target.position}</span> : null}
          {target.phone ? <span className="tabular-nums">{target.phone}</span> : null}
        </span>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#5c2d91] group-hover:underline">
          <Eye className="h-3.5 w-3.5" /> Rasm va ma’lumot
        </span>
      </span>
    </button>
  );
}

function StaffPhotoLightbox({ target, onClose }: { target: FeedTarget; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-[4/5] bg-slate-100 dark:bg-slate-800">
          {target.photoUrl ? (
            <img
              src={target.photoUrl}
              alt={target.employeeName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#5c2d91] to-[#c9a227] text-white">
              <span className="text-5xl font-black tracking-tight">{initialsOf(target.employeeName)}</span>
              <span className="text-xs font-semibold text-white/80">Rasm yuklanmagan</span>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-lg text-white backdrop-blur hover:bg-black/60"
            aria-label="Yopish"
          >
            ×
          </button>
        </div>
        <div className="space-y-1 px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Baholangan xodim</p>
          <h4 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{target.employeeName}</h4>
          {target.position ? (
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{target.position}</p>
          ) : null}
          {target.phone ? (
            <p className="text-sm font-medium tabular-nums text-slate-500">{target.phone}</p>
          ) : null}
          <Button type="button" variant="outline" className="mt-3 h-11 w-full rounded-xl" onClick={onClose}>
            Yopish
          </Button>
        </div>
      </div>
    </div>
  );
}

function RatingDetailModal({
  item,
  kind,
  canSee,
  canManage,
  onClose,
  onDelete,
  deleting,
}: {
  item: FeedItem;
  kind: "staff" | "pharmacy" | "complaint";
  canSee: boolean;
  canManage: boolean;
  onClose: () => void;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const [photoTarget, setPhotoTarget] = useState<FeedTarget | null>(null);
  const title =
    kind === "complaint" ? "Shikoyat tafsiloti" : kind === "pharmacy" ? "Dorixona bahosi" : "Xodim bahosi";
  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl dark:bg-slate-950 sm:rounded-3xl"
        style={{ backgroundColor: "var(--baho-modal-bg, #ffffff)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            "sticky top-0 z-10 border-b px-5 py-4 text-white",
            kind === "complaint"
              ? "border-rose-200/40 bg-gradient-to-r from-rose-700 via-rose-600 to-[#c9a227]"
              : "border-[#5c2d91]/20 bg-gradient-to-r from-[#5c2d91] via-[#6b3aa8] to-[#c9a227]",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
                Mijozlar baholashi
              </p>
              <h3 className="mt-0.5 text-lg font-black tracking-tight">{title}</h3>
              <p className="mt-1 text-xs font-medium text-white/80">
                {fmtWhen(item.createdAt)} · {item.workDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25"
              aria-label="Yopish"
            >
              ×
            </button>
          </div>
        </div>

        <div className="space-y-3 bg-white p-5 dark:bg-slate-950">
          {item.selfRating ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
              O‘ziga-o‘zi / ichki baho
              {item.selfRatingReason ? (
                <span className="mt-1 block text-xs font-semibold text-amber-800">{item.selfRatingReason}</span>
              ) : null}
            </div>
          ) : null}

          {kind === "staff" ? (
            <div className="space-y-2">
              {item.targets.length ? (
                item.targets.map((t) => (
                  <RatedStaffCard key={t.employeeId} target={t} onOpen={setPhotoTarget} />
                ))
              ) : (
                <DetailField label="Baholangan xodim(lar)">—</DetailField>
              )}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailField label="Filial">
              <p>
                {item.branchNo != null ? `№${item.branchNo} ` : ""}
                {item.branchName || item.branchLabel || "—"}
              </p>
              {item.branchPhone ? (
                <p className="mt-1 text-xs font-medium tabular-nums text-slate-500">{item.branchPhone}</p>
              ) : null}
            </DetailField>
            <DetailField label="Sana / vaqt">
              <p>{item.workDate}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">{fmtWhen(item.createdAt)}</p>
            </DetailField>
            <DetailField label="Mudir">
              <PersonCell name={item.mudirName} phone={item.mudirPhone} />
            </DetailField>
            <DetailField label="Koordinator">
              <PersonCell name={item.coordinatorName} phone={item.coordinatorPhone} />
            </DetailField>
          </div>

          {kind !== "complaint" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailField label="Baho">
                <div className="flex items-center gap-2">
                  <Stars n={item.stars} />
                  <span className="text-sm font-black tabular-nums text-slate-600">{item.stars}/5</span>
                </div>
              </DetailField>
              <DetailField label={kind === "staff" ? "Xizmat / Muomala" : "Tozalik / Tanlov"}>
                <div className="flex flex-wrap gap-1.5">
                  <QualityChip value={item.serviceQuality} />
                  <QualityChip value={item.demeanor} />
                </div>
              </DetailField>
            </div>
          ) : null}

          <DetailField label={kind === "complaint" ? "Shikoyat matni" : "Izoh"}>
            <p className="whitespace-pre-wrap text-[14px] font-medium leading-relaxed text-slate-700 dark:text-slate-200">
              {item.comment || "—"}
            </p>
          </DetailField>

          {canSee ? (
            <DetailField label="Mijoz">
              <p className="font-extrabold text-sky-800 dark:text-sky-300">{item.customerName || "—"}</p>
              {item.customerPhone ? (
                <p className="mt-1 text-xs font-medium tabular-nums text-slate-500">{item.customerPhone}</p>
              ) : null}
            </DetailField>
          ) : (
            <DetailField label="Mijoz">
              <p className="text-slate-400">Anonim (ko‘rish huquqi yo‘q)</p>
            </DetailField>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl" onClick={onClose}>
              Yopish
            </Button>
            {canManage ? (
              <Button
                type="button"
                variant="destructive"
                className="h-11 rounded-xl"
                disabled={deleting}
                onClick={() => {
                  if (confirm(kind === "complaint" ? "Bu shikoyatni o‘chirasizmi?" : "Bu bahoni o‘chirasizmi?")) {
                    onDelete(item.id);
                    onClose();
                  }
                }}
              >
                <Trash2 className="h-4 w-4" /> O‘chirish
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {photoTarget ? <StaffPhotoLightbox target={photoTarget} onClose={() => setPhotoTarget(null)} /> : null}
    </div>
  );
  if (typeof document === "undefined") return modal;
  return createPortal(modal, document.body);
}

function ComplaintsTable({
  items,
  loading,
  error,
  canSee,
  canManage,
  onDelete,
  deleting,
}: {
  items: FeedItem[];
  loading: boolean;
  error: string | null;
  canSee: boolean;
  canManage: boolean;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const [detail, setDetail] = useState<FeedItem | null>(null);
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-3xl border border-rose-200/60 bg-white py-16 text-sm font-semibold text-slate-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-rose-600" /> Yuklanmoqda…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm font-semibold text-rose-800">
        {error}
      </div>
    );
  }
  if (!items.length) return <Empty />;

  return (
    <div className="overflow-hidden rounded-[28px] border border-rose-200/70 bg-white shadow-[0_18px_50px_-32px_rgba(190,24,93,0.45)] dark:border-rose-500/20 dark:bg-slate-900">
      <div className="relative overflow-hidden border-b border-rose-200/50 bg-gradient-to-r from-rose-700 via-rose-600 to-[#c9a227] px-5 py-4 text-white">
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">Mijozlar baholashi</p>
            <h2 className="mt-0.5 text-lg font-black tracking-tight sm:text-xl">Shikoyatlar</h2>
          </div>
          <span className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-extrabold backdrop-blur">
            {items.length} ta shikoyat
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead>
            <tr className="bg-rose-50/80 text-[10px] uppercase tracking-[0.14em] text-rose-800/70 dark:bg-rose-500/10 dark:text-rose-200/70">
              <th className="px-4 py-3.5 font-extrabold">Sana</th>
              <th className="px-4 py-3.5 font-extrabold">Filial</th>
              <th className="px-4 py-3.5 font-extrabold">Mudir</th>
              <th className="px-4 py-3.5 font-extrabold">Koordinator</th>
              <th className="px-4 py-3.5 font-extrabold">Shikoyat</th>
              {canSee ? <th className="px-4 py-3.5 font-extrabold">Mijoz</th> : null}
              {canManage ? <th className="px-4 py-3.5 font-extrabold" /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr
                key={it.id}
                role="button"
                tabIndex={0}
                onClick={() => setDetail(it)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetail(it);
                  }
                }}
                className={cn(
                  "cursor-pointer align-top border-t border-rose-100/80 transition-colors dark:border-rose-500/10",
                  idx % 2 === 0 ? "bg-white hover:bg-rose-50/40" : "bg-rose-50/30 hover:bg-rose-50/60",
                )}
              >
                <td className="whitespace-nowrap px-4 py-3.5">
                  <p className="text-[13px] font-extrabold tabular-nums text-slate-800">{it.workDate}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-400">{fmtWhen(it.createdAt)}</p>
                </td>
                <td className="px-4 py-3.5">
                  <p className="text-[13px] font-extrabold text-rose-800 dark:text-rose-200">
                    {it.branchNo != null ? (
                      <span className="mr-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-black tabular-nums">
                        №{it.branchNo}
                      </span>
                    ) : null}
                    {it.branchName || it.branchLabel}
                  </p>
                  {it.branchPhone ? (
                    <p className="mt-0.5 text-[11px] font-medium tabular-nums text-slate-400">{it.branchPhone}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3.5">
                  <PersonCell name={it.mudirName} phone={it.mudirPhone} />
                </td>
                <td className="px-4 py-3.5">
                  <PersonCell name={it.coordinatorName} phone={it.coordinatorPhone} />
                </td>
                <td className="max-w-[360px] px-4 py-3.5">
                  <div className="rounded-2xl border border-rose-100 bg-white px-3 py-2.5 shadow-sm dark:border-rose-500/20 dark:bg-slate-950">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
                      {it.comment || "—"}
                    </p>
                  </div>
                </td>
                {canSee ? (
                  <td className="px-4 py-3.5">
                    <p className="text-[13px] font-extrabold text-sky-800 dark:text-sky-300">
                      {it.customerName || "—"}
                    </p>
                    {it.customerPhone ? (
                      <p className="mt-0.5 text-[11px] font-medium tabular-nums text-slate-400">{it.customerPhone}</p>
                    ) : null}
                  </td>
                ) : null}
                {canManage ? (
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(it.id);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                      title="O‘chirish"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail ? (
        <RatingDetailModal
          item={detail}
          kind="complaint"
          canSee={canSee}
          canManage={canManage}
          onClose={() => setDetail(null)}
          onDelete={onDelete}
          deleting={deleting}
        />
      ) : null}
    </div>
  );
}

function RatingsTable({
  kind,
  items,
  loading,
  error,
  canSee,
  canManage,
  onDelete,
  deleting,
}: {
  kind: "staff" | "pharmacy";
  items: FeedItem[];
  loading: boolean;
  error: string | null;
  canSee: boolean;
  canManage: boolean;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const [detail, setDetail] = useState<FeedItem | null>(null);
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-3xl border border-[#5c2d91]/10 bg-white py-16 text-sm font-semibold text-slate-500 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <Loader2 className="h-4 w-4 animate-spin text-[#5c2d91]" /> Yuklanmoqda…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm font-semibold text-rose-800">
        {error}
      </div>
    );
  }
  if (!items.length) return <Empty />;

  const avg =
    items.length > 0 ? items.reduce((s, it) => s + it.stars, 0) / items.length : 0;
  const low = items.filter((it) => it.stars <= 2).length;
  const selfN = items.filter((it) => it.selfRating).length;

  return (
    <div className="overflow-hidden rounded-[28px] border border-[#5c2d91]/12 bg-white shadow-[0_18px_50px_-32px_rgba(92,45,145,0.55)] dark:border-white/10 dark:bg-slate-900">
      <div className="relative overflow-hidden border-b border-[#5c2d91]/10 bg-gradient-to-r from-[#5c2d91] via-[#6b3aa8] to-[#c9a227] px-5 py-4 text-white">
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
              Mijozlar baholashi
            </p>
            <h2 className="mt-0.5 text-lg font-black tracking-tight sm:text-xl">
              {kind === "staff" ? "Xodim baholari" : "Dorixona baholari"}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-extrabold backdrop-blur">
              {items.length} ta yozuv
            </span>
            <span className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-extrabold backdrop-blur">
              ★ {avg.toFixed(2)}
            </span>
            {selfN > 0 ? (
              <span className="rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-extrabold text-amber-950">
                {selfN} o‘ziga-o‘zi
              </span>
            ) : null}
            {low > 0 ? (
              <span className="rounded-xl bg-rose-500/90 px-3 py-1.5 text-xs font-extrabold">
                {low} past baho
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-xl px-3 py-1.5 text-[11px] font-black tracking-wide",
                kind === "staff" ? "bg-amber-300 text-amber-950" : "bg-sky-200 text-sky-950",
              )}
            >
              {kind === "staff" ? "XODIM" : "DORIXONA"}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full text-left text-sm">
          <thead>
            <tr className="bg-[#f7f3fc] text-[10px] uppercase tracking-[0.14em] text-[#5c2d91]/75 dark:bg-white/[0.04] dark:text-violet-200/70">
              <th className="px-4 py-3.5 font-extrabold">Sana</th>
              <th className="px-4 py-3.5 font-extrabold">Filial</th>
              <th className="px-4 py-3.5 font-extrabold">Mudir</th>
              <th className="px-4 py-3.5 font-extrabold">Koordinator</th>
              {kind === "staff" ? <th className="px-4 py-3.5 font-extrabold">Xodim(lar)</th> : null}
              <th className="px-4 py-3.5 font-extrabold">Baho</th>
              <th className="px-4 py-3.5 font-extrabold">
                {kind === "staff" ? "Xizmat / Muomala" : "Tozalik / Tanlov"}
              </th>
              <th className="px-4 py-3.5 font-extrabold">Izoh</th>
              {canSee ? <th className="px-4 py-3.5 font-extrabold">Mijoz</th> : null}
              {canManage ? <th className="px-4 py-3.5 font-extrabold" /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const complaint = it.stars <= 2;
              const selfHit = Boolean(it.selfRating);
              return (
                <tr
                  key={it.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(it)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetail(it);
                    }
                  }}
                  className={cn(
                    "cursor-pointer align-top border-t border-slate-100/90 transition-colors dark:border-white/5",
                    selfHit
                      ? "bg-amber-50/90 hover:bg-amber-50 dark:bg-amber-500/15"
                      : complaint
                        ? "bg-rose-50/70 hover:bg-rose-50 dark:bg-rose-500/10"
                        : idx % 2 === 0
                          ? "bg-white hover:bg-[#faf7ff] dark:bg-slate-900"
                          : "bg-[#fbfaff] hover:bg-[#f6f1ff] dark:bg-white/[0.02]",
                  )}
                >
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <p className="text-[13px] font-extrabold tabular-nums text-slate-800 dark:text-slate-100">
                      {it.workDate}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">{fmtWhen(it.createdAt)}</p>
                    {selfHit ? (
                      <p className="mt-1 inline-flex rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-900">
                        O‘ziga-o‘zi
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="text-[13px] font-extrabold leading-snug text-[#5c2d91] dark:text-violet-200">
                      {it.branchNo != null ? (
                        <span className="mr-1 rounded-md bg-[#5c2d91]/10 px-1.5 py-0.5 text-[10px] font-black tabular-nums">
                          №{it.branchNo}
                        </span>
                      ) : null}
                      {it.branchName || it.branchLabel}
                    </p>
                    {it.branchPhone ? (
                      <p className="mt-0.5 text-[11px] font-medium tabular-nums text-slate-400">{it.branchPhone}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5">
                    <PersonCell name={it.mudirName} phone={it.mudirPhone} />
                  </td>
                  <td className="px-4 py-3.5">
                    <PersonCell name={it.coordinatorName} phone={it.coordinatorPhone} />
                  </td>
                  {kind === "staff" ? (
                    <td className="px-4 py-3.5">
                      <div className="flex max-w-[260px] flex-col gap-1.5">
                        {it.targets.length ? (
                          it.targets.map((t) => (
                            <span
                              key={t.employeeId}
                              className="inline-flex items-center gap-2 rounded-xl bg-amber-50/90 px-2 py-1.5 text-[12px] font-bold text-amber-950 ring-1 ring-amber-200/70"
                            >
                              <StaffAvatar name={t.employeeName} photoUrl={t.photoUrl} size="sm" className="rounded-xl ring-1 ring-amber-200/60" />
                              <span className="min-w-0 truncate">{t.employeeName}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </td>
                  ) : null}
                  <td className="px-4 py-3.5">
                    <div
                      className={cn(
                        "inline-flex flex-col gap-1 rounded-2xl px-2.5 py-2 ring-1",
                        complaint
                          ? "bg-rose-100/80 ring-rose-200"
                          : it.stars >= 4
                            ? "bg-amber-50 ring-amber-200/80"
                            : "bg-slate-50 ring-slate-200/80",
                      )}
                    >
                      <Stars n={it.stars} />
                      <span className="text-center text-[10px] font-black tabular-nums text-slate-500">
                        {it.stars}/5
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      <QualityChip value={it.serviceQuality} />
                      <QualityChip value={it.demeanor} />
                    </div>
                  </td>
                  <td className="max-w-[240px] px-4 py-3.5">
                    <p className="line-clamp-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {it.comment || <span className="text-slate-300">—</span>}
                    </p>
                  </td>
                  {canSee ? (
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-extrabold text-sky-800 dark:text-sky-300">
                        {it.customerName || "—"}
                      </p>
                      {it.customerPhone ? (
                        <p className="mt-0.5 text-[11px] font-medium tabular-nums text-slate-400">
                          {it.customerPhone}
                        </p>
                      ) : null}
                      {selfHit && it.selfRatingReason ? (
                        <p className="mt-1 max-w-[180px] text-[10px] font-bold leading-snug text-amber-800">
                          {it.selfRatingReason}
                        </p>
                      ) : null}
                    </td>
                  ) : null}
                  {canManage ? (
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(it.id);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                        title="O‘chirish"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail ? (
        <RatingDetailModal
          item={detail}
          kind={kind}
          canSee={canSee}
          canManage={canManage}
          onClose={() => setDetail(null)}
          onDelete={onDelete}
          deleting={deleting}
        />
      ) : null}
    </div>
  );
}

function AddRatingModal({
  branches,
  onClose,
  onSaved,
}: {
  branches: Array<{ id: number; label: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [rateType, setRateType] = useState<"staff" | "pharmacy">("staff");
  const [branchId, setBranchId] = useState("");
  const [employeeIds, setEmployeeIds] = useState<number[]>([]);
  const [stars, setStars] = useState(5);
  const [serviceQuality, setServiceQuality] = useState("alo");
  const [demeanor, setDemeanor] = useState("xushmuomala");
  const [comment, setComment] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }));

  const staffQ = useQuery({
    queryKey: ["customer-ratings-branch-staff", branchId],
    enabled: rateType === "staff" && Boolean(branchId),
    queryFn: async () => {
      const res = await fetch(`/api/customer-ratings/branch-staff?branchId=${branchId}`, { credentials: "include" });
      if (!res.ok) throw await readErr(res, "Xodimlar yuklanmadi");
      return res.json() as Promise<{ staff: Array<{ employeeId: number; fullName: string; position: string }> }>;
    },
  });

  useEffect(() => {
    setEmployeeIds([]);
    setDemeanor(rateType === "pharmacy" ? "alo" : "xushmuomala");
  }, [rateType, branchId]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/customer-ratings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateType,
          branchId: Number(branchId),
          employeeIds,
          stars,
          serviceQuality,
          demeanor,
          comment,
          customerName,
          customerPhone,
          workDate,
        }),
      });
      if (!res.ok) throw await readErr(res, "Saqlanmadi");
      return res.json();
    },
    onSuccess: onSaved,
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const qualityOpts = ["alo", "yaxshi", "qoniqarli", "yomon", "juda_yomon"];
  const demeanorOpts = rateType === "pharmacy" ? qualityOpts : ["xushmuomala", "yaxshi", "oddiy", "qopol", "juda_qopol"];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold">Baho qo‘shish</h2>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setRateType("staff")}
            className={cn(
              "rounded-xl border px-3 py-3 text-left text-sm font-bold",
              rateType === "staff" ? "border-amber-400 bg-amber-50" : "border-slate-200",
            )}
          >
            Xodim bahosi
          </button>
          <button
            type="button"
            onClick={() => setRateType("pharmacy")}
            className={cn(
              "rounded-xl border px-3 py-3 text-left text-sm font-bold",
              rateType === "pharmacy" ? "border-sky-400 bg-sky-50" : "border-slate-200",
            )}
          >
            Dorixona bahosi
          </button>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-xs font-bold">Filial</p>
          <BranchCombobox
            value={branchId}
            onChange={(id) => {
              setBranchId(id);
              setEmployeeIds([]);
            }}
            options={branches.map((b) => ({ id: String(b.id), label: b.label }))}
            placeholder="Filialni yozib qidiring"
            tone="violet"
            className="h-11 rounded-xl"
          />
        </div>

        {rateType === "staff" ? (
          <div className="mt-3">
            <p className="text-xs font-bold">Xodimlar</p>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-xl border p-2">
              {(staffQ.data?.staff || []).map((s) => {
                const on = employeeIds.includes(s.employeeId);
                return (
                  <label key={s.employeeId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setEmployeeIds((prev) => (on ? prev.filter((x) => x !== s.employeeId) : [...prev, s.employeeId]))
                      }
                    />
                    <span className="font-semibold">{s.fullName}</span>
                  </label>
                );
              })}
              {!staffQ.isLoading && !staffQ.data?.staff?.length ? (
                <p className="text-xs text-slate-400">Filial tanlang</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs font-bold">
            Yulduz
            <select value={stars} onChange={(e) => setStars(Number(e.target.value))} className="mt-1 h-11 w-full rounded-xl border px-3 text-sm">
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Sana
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-sm" />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs font-bold">
            {rateType === "pharmacy" ? "Tozalik" : "Xizmat"}
            <select value={serviceQuality} onChange={(e) => setServiceQuality(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-sm">
              {qualityOpts.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            {rateType === "pharmacy" ? "Tanlov" : "Muomala"}
            <select value={demeanor} onChange={(e) => setDemeanor(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-sm">
              {demeanorOpts.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 block text-xs font-bold">
          Izoh
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs font-bold">
            Mijoz ismi
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-sm" />
          </label>
          <label className="text-xs font-bold">
            Telefon
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-sm" />
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <Button className="h-11 flex-1 rounded-xl" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Saqlash
          </Button>
          <Button variant="outline" className="h-11 flex-1 rounded-xl" onClick={onClose}>
            Bekor
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, warn }: { label: string; value: string; icon?: boolean; warn?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        warn
          ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
          : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900",
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-2xl font-extrabold tabular-nums">
        {icon ? <Star className="h-5 w-5 fill-amber-400 text-amber-400" /> : null}
        {warn ? <MessageSquareWarning className="h-5 w-5 text-rose-500" /> : null}
        {value}
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
      <p className="mb-3 text-sm font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm dark:bg-white/5">
      <span className="min-w-0 truncate font-semibold">{left}</span>
      <span className="shrink-0 tabular-nums text-slate-500">{right}</span>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5 drop-shadow-sm",
            i <= n ? "fill-amber-400 text-amber-400" : "text-slate-300/80",
          )}
        />
      ))}
    </span>
  );
}

function Empty() {
  return (
    <div className="rounded-[28px] border border-dashed border-[#5c2d91]/20 bg-gradient-to-b from-white to-[#faf7ff] px-6 py-16 text-center shadow-sm dark:border-white/10 dark:from-slate-900 dark:to-slate-900">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5c2d91]/10 text-[#5c2d91]">
        <Star className="h-6 w-6" />
      </div>
      <p className="mt-4 text-base font-extrabold text-slate-700 dark:text-slate-200">Hozircha ma’lumot yo‘q</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
        Filial, yulduz yoki qidiruv filtrlarni o‘zgartiring — mos baholar shu yerda chiqadi.
      </p>
    </div>
  );
}
