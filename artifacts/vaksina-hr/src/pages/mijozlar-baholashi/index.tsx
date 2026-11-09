import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Download,
  FileDown,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Star,
  Store,
  MessageSquareWarning,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  bahoQrPreviewPng,
  downloadAllBahoQrPdf,
  downloadBahoQrPdf,
} from "@/lib/customer-rating-qr-pdf";

type QrItem = {
  branchId: number;
  branchLabel: string;
  token: string | null;
  status: string;
  version: number;
  publicUrl: string | null;
};

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
  rateType?: "staff" | "pharmacy";
  targets: Array<{ employeeId: number; employeeName: string }>;
  createdAt: string;
};

type Tab = "stats" | "staff" | "pharmacy" | "qr";

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

export default function MijozlarBaholashiPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("staff");
  const [branchId, setBranchId] = useState<string>("");
  const [complaints, setComplaints] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string; dataUrl: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const meta = useQuery({
    queryKey: ["customer-ratings-meta"],
    queryFn: async () => {
      const res = await fetch("/api/customer-ratings/meta", { credentials: "include" });
      if (!res.ok) throw await readErr(res, "Ruxsat tekshirilmadi");
      return res.json() as Promise<{ canManage: boolean; canSeeIdentity: boolean }>;
    },
  });

  const branches = useQuery({
    queryKey: ["customer-ratings-branches"],
    queryFn: async () => {
      const res = await fetch("/api/customer-ratings/branches", { credentials: "include" });
      if (!res.ok) throw await readErr(res, "Filiallar yuklanmadi");
      return res.json() as Promise<{ branches: Array<{ id: number; label: string }> }>;
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

  const rateType: "staff" | "pharmacy" | "all" =
    tab === "staff" ? "staff" : tab === "pharmacy" ? "pharmacy" : "all";

  const feedQs = useMemo(() => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    if (complaints) p.set("complaints", "1");
    if (tab === "staff" || tab === "pharmacy") p.set("rateType", tab);
    return p.toString();
  }, [branchId, complaints, tab]);

  const feed = useQuery({
    queryKey: ["customer-ratings-feed", feedQs],
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
      void qc.invalidateQueries({ queryKey: ["customer-ratings-qr"] });
      toast({ title: "QR tayyor" });
    },
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const rotateQr = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/customer-ratings/qr/${id}/rotate`, { method: "POST", credentials: "include" });
      if (!res.ok) throw await readErr(res, "Yangilanmadi");
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customer-ratings-qr"] });
      toast({ title: "QR yangilandi" });
    },
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const blockQr = useMutation({
    mutationFn: async ({ id, blocked }: { id: number; blocked: boolean }) => {
      const res = await fetch(`/api/customer-ratings/qr/${id}/block`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked }),
      });
      if (!res.ok) throw await readErr(res, "Saqlanmadi");
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customer-ratings-qr"] });
      toast({ title: "Holat yangilandi" });
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
      await downloadBahoQrPdf({ branchLabel: item.branchLabel, publicUrl: item.publicUrl });
      toast({ title: "A4 PDF tayyor" });
    } catch (e) {
      toast({ title: "PDF xato", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadAllPdf = async () => {
    if (!canManage) return;
    const list = (qr.data?.items || [])
      .filter((i) => i.publicUrl && i.status === "active")
      .map((i) => ({ branchLabel: i.branchLabel, publicUrl: i.publicUrl! }));
    if (!list.length) {
      toast({ title: "Faol QR yo‘q", variant: "destructive" });
      return;
    }
    setPdfBusy(true);
    try {
      await downloadAllBahoQrPdf(list);
      toast({ title: `PDF: ${list.length} ta filial` });
    } catch (e) {
      toast({ title: "PDF xato", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPdfBusy(false);
    }
  };

  const exportXlsx = (type: "all" | "staff" | "pharmacy" = "all") => {
    const p = new URLSearchParams();
    if (branchId) p.set("branchId", branchId);
    if (complaints) p.set("complaints", "1");
    if (type !== "all") p.set("rateType", type);
    window.open(`/api/customer-ratings/export.xlsx?${p}`, "_blank");
  };

  const canManage = meta.data?.canManage ?? false;
  const canSee = meta.data?.canSeeIdentity ?? false;
  const stats = feed.data?.stats;
  const items = feed.data?.items || [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">Mijozlar baholashi</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Xodim va dorixona baholari alohida · filial / mudir / koordinator ·{" "}
            {canSee ? "mijoz ma’lumoti ochiq" : "mijozlar anonim"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <Button type="button" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Qo‘shish
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-xl"
            onClick={() => exportXlsx(tab === "staff" || tab === "pharmacy" ? tab : "all")}
          >
            <Download className="h-3.5 w-3.5" /> Excel
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5 rounded-2xl bg-slate-100 p-1 dark:bg-white/5">
        {(
          [
            ["staff", "Xodim baholari", Users],
            ["pharmacy", "Dorixona baholari", Store],
            ["stats", "Statistika", Star],
            ["qr", "QR kodlar", QrCode],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition",
              tab === k ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold dark:border-white/10 dark:bg-slate-900"
        >
          <option value="">Barcha filiallar</option>
          {(branches.data?.branches || []).map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.label}
            </option>
          ))}
        </select>
        <label className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold dark:border-white/10 dark:bg-slate-900">
          <input type="checkbox" checked={complaints} onChange={(e) => setComplaints(e.target.checked)} />
          Faqat shikoyatlar
        </label>
      </div>

      {tab === "stats" ? (
        <section className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Jami baho" value={String(stats?.total ?? "…")} />
            <Stat label="O‘rtacha" value={stats ? stats.avgStars.toFixed(2) : "…"} icon />
            <Stat label="Shikoyat" value={String(stats?.complaints ?? "…")} warn />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Filiallar reytingi">
              {(stats?.byBranch || []).slice(0, 12).map((b) => (
                <Row key={b.branchId} left={b.label} right={`${b.avg.toFixed(2)} ★ · ${b.count}`} />
              ))}
              {!stats?.byBranch?.length ? <Empty /> : null}
            </Card>
            <Card title="Xodimlar (eng pastlardan)">
              {(stats?.byEmployee || []).slice(0, 12).map((e) => (
                <Row key={e.employeeId} left={e.name} right={`${e.avg.toFixed(2)} ★ · ${e.count}`} />
              ))}
              {!stats?.byEmployee?.length ? <Empty /> : null}
            </Card>
          </div>
        </section>
      ) : null}

      {tab === "staff" || tab === "pharmacy" ? (
        <RatingsTable
          kind={tab}
          items={items}
          loading={feed.isLoading}
          canSee={canSee}
          canManage={canManage}
          onDelete={(id) => {
            if (confirm("Bu bahoni o‘chirasizmi?")) del.mutate(id);
          }}
          deleting={del.isPending}
        />
      ) : null}

      {tab === "qr" ? (
        <section className="space-y-3">
          {!canManage ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
              QR yaratish, almashtirish, o‘chirish va A4 PDF faqat admin/HR uchun.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-slate-900">
              <p className="text-xs text-slate-500">
                A4 bo‘yi · yuqorida «Xizmatni baholang» · pastda filial · chop etishga tayyor
              </p>
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 rounded-xl"
                disabled={pdfBusy}
                onClick={() => void downloadAllPdf()}
              >
                {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                Barchasi 1 PDF
              </Button>
            </div>
          )}
          {(qr.data?.items || []).map((item) => (
            <div
              key={item.branchId}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-900"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b3a5c] text-white">
                <Store className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{item.branchLabel}</p>
                <p className="text-[11px] text-slate-500">
                  {item.status === "missing" ? "QR yo‘q" : `${item.status} · v${item.version}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {canManage && (item.status === "missing" || item.status === "blocked" || item.status === "revoked") ? (
                  <Button size="sm" className="h-8 rounded-lg" onClick={() => createQr.mutate(item.branchId)}>
                    <QrCode className="h-3.5 w-3.5" /> Yaratish
                  </Button>
                ) : null}
                {item.publicUrl && item.status === "active" ? (
                  <>
                    <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => void showQr(item)}>
                      <QrCode className="h-3.5 w-3.5" /> Ko‘rish
                    </Button>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg"
                        disabled={pdfBusy}
                        onClick={() => void downloadOnePdf(item)}
                      >
                        <FileDown className="h-3.5 w-3.5" /> A4 PDF
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {canManage && item.publicUrl ? (
                  <>
                    <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => rotateQr.mutate(item.branchId)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Almashtirish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-rose-700"
                      onClick={() => blockQr.mutate({ id: item.branchId, blocked: item.status !== "blocked" })}
                    >
                      <Ban className="h-3.5 w-3.5" /> {item.status === "blocked" ? "Ochish" : "O‘chirish"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreview(null)}>
          <div
            className="w-full max-w-md rounded-3xl bg-white p-5 text-center shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">VAKSINA MED</p>
            <p className="mt-1 text-lg font-extrabold text-[#0b3a5c] dark:text-white">Xizmatni baholang</p>
            <img
              src={preview.dataUrl}
              alt="QR"
              className="mx-auto mt-4 h-64 w-64 rounded-2xl border border-slate-100 shadow-sm"
            />
            <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">{preview.label}</p>
            <p className="mt-1 break-all text-[10px] text-slate-400">{preview.url}</p>
            <div className="mt-4 flex gap-2">
              {canManage ? (
                <Button
                  className="h-10 flex-1 rounded-xl"
                  disabled={pdfBusy}
                  onClick={() =>
                    void downloadBahoQrPdf({ branchLabel: preview.label, publicUrl: preview.url }).then(
                      () => toast({ title: "A4 PDF tayyor" }),
                      (e) => toast({ title: "PDF xato", description: String(e?.message || e), variant: "destructive" }),
                    )
                  }
                >
                  <FileDown className="h-3.5 w-3.5" /> A4 PDF
                </Button>
              ) : null}
              <Button variant="outline" className="h-10 flex-1 rounded-xl" onClick={() => setPreview(null)}>
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

      <p className="text-[10px] text-slate-400">
        Kirgan: {user?.fullName || user?.login} · faol: {rateType}
      </p>
    </div>
  );
}

function RatingsTable({
  kind,
  items,
  loading,
  canSee,
  canManage,
  onDelete,
  deleting,
}: {
  kind: "staff" | "pharmacy";
  items: FeedItem[];
  loading: boolean;
  canSee: boolean;
  canManage: boolean;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
      </p>
    );
  }
  if (!items.length) return <Empty />;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-white/10">
        <p className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
          {kind === "staff" ? "Xodim ustidan baholar" : "Dorixona baholari"}
          <span className="ml-2 font-semibold text-slate-400">{items.length} ta</span>
        </p>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-bold",
            kind === "staff" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900",
          )}
        >
          {kind === "staff" ? "XODIM" : "DORIXONA"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-white/5">
            <tr>
              <th className="px-3 py-2.5 font-bold">Sana</th>
              <th className="px-3 py-2.5 font-bold">Filial</th>
              <th className="px-3 py-2.5 font-bold">Mudir</th>
              <th className="px-3 py-2.5 font-bold">Koordinator</th>
              {kind === "staff" ? <th className="px-3 py-2.5 font-bold">Xodim(lar)</th> : null}
              <th className="px-3 py-2.5 font-bold">Baho</th>
              <th className="px-3 py-2.5 font-bold">{kind === "staff" ? "Xizmat / Muomala" : "Tozalik / Tanlov"}</th>
              <th className="px-3 py-2.5 font-bold">Izoh</th>
              {canSee ? <th className="px-3 py-2.5 font-bold">Mijoz</th> : null}
              {canManage ? <th className="px-3 py-2.5 font-bold" /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-slate-100 align-top dark:border-white/5">
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{it.workDate}</p>
                  <p className="text-[10px] text-slate-400">{fmtWhen(it.createdAt)}</p>
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-bold text-slate-900 dark:text-white">
                    {it.branchNo != null ? `№${it.branchNo} · ` : ""}
                    {it.branchName || it.branchLabel}
                  </p>
                  {it.branchPhone ? <p className="text-[10px] text-slate-500">{it.branchPhone}</p> : null}
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-semibold">{it.mudirName || "—"}</p>
                  {it.mudirPhone ? <p className="text-[10px] text-slate-500">{it.mudirPhone}</p> : null}
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-semibold">{it.coordinatorName || "—"}</p>
                  {it.coordinatorPhone ? <p className="text-[10px] text-slate-500">{it.coordinatorPhone}</p> : null}
                </td>
                {kind === "staff" ? (
                  <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-100">
                    {it.targets.map((t) => t.employeeName).join(", ") || "—"}
                  </td>
                ) : null}
                <td className="px-3 py-2.5">
                  <Stars n={it.stars} />
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                  <b>{it.serviceQuality}</b>
                  <span className="text-slate-300"> · </span>
                  <b>{it.demeanor}</b>
                </td>
                <td className="max-w-[180px] px-3 py-2.5 text-slate-600 dark:text-slate-300">
                  {it.comment || "—"}
                </td>
                {canSee ? (
                  <td className="px-3 py-2.5">
                    <p className="font-bold text-sky-800 dark:text-sky-300">{it.customerName || "—"}</p>
                    <p className="text-[10px] text-slate-500">{it.customerPhone || ""}</p>
                  </td>
                ) : null}
                {canManage ? (
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => onDelete(it.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      title="O‘chirish"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    if (rateType === "pharmacy") setDemeanor("alo");
    else setDemeanor("xushmuomala");
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
        <h2 className="text-base font-extrabold">Baho qo‘shish</h2>
        <p className="mt-0.5 text-xs text-slate-500">Admin/HR qo‘lda kiritish · auditga yoziladi</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setRateType("staff")}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-left text-xs font-bold",
              rateType === "staff" ? "border-amber-400 bg-amber-50" : "border-slate-200",
            )}
          >
            Xodim bahosi
          </button>
          <button
            type="button"
            onClick={() => setRateType("pharmacy")}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-left text-xs font-bold",
              rateType === "pharmacy" ? "border-sky-400 bg-sky-50" : "border-slate-200",
            )}
          >
            Dorixona bahosi
          </button>
        </div>

        <label className="mt-3 block text-xs font-bold">
          Filial
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
          >
            <option value="">Tanlang</option>
            {branches.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        {rateType === "staff" ? (
          <div className="mt-3">
            <p className="text-xs font-bold">Xodimlar</p>
            <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-xl border p-2">
              {(staffQ.data?.staff || []).map((s) => {
                const on = employeeIds.includes(s.employeeId);
                return (
                  <label key={s.employeeId} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setEmployeeIds((prev) =>
                          on ? prev.filter((x) => x !== s.employeeId) : [...prev, s.employeeId],
                        )
                      }
                    />
                    <span className="font-semibold">{s.fullName}</span>
                    <span className="text-slate-400">{s.position}</span>
                  </label>
                );
              })}
              {!staffQ.isLoading && !staffQ.data?.staff?.length ? (
                <p className="text-[11px] text-slate-400">Filial tanlang yoki xodim topilmadi</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs font-bold">
            Yulduz
            <select value={stars} onChange={(e) => setStars(Number(e.target.value))} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm">
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Sana
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs font-bold">
            {rateType === "pharmacy" ? "Tozalik" : "Xizmat"}
            <select value={serviceQuality} onChange={(e) => setServiceQuality(e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm">
              {qualityOpts.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            {rateType === "pharmacy" ? "Tanlov" : "Muomala"}
            <select value={demeanor} onChange={(e) => setDemeanor(e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm">
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
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" />
          </label>
          <label className="text-xs font-bold">
            Telefon
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" />
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <Button className="h-10 flex-1 rounded-xl" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Saqlash
          </Button>
          <Button variant="outline" className="h-10 flex-1 rounded-xl" onClick={onClose}>
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
        "rounded-2xl border px-3 py-3",
        warn
          ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
          : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900",
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-xl font-extrabold tabular-nums">
        {icon ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : null}
        {warn ? <MessageSquareWarning className="h-4 w-4 text-rose-500" /> : null}
        {value}
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-900">
      <p className="mb-2 text-xs font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-xs dark:bg-white/5">
      <span className="min-w-0 truncate font-semibold text-slate-800 dark:text-slate-100">{left}</span>
      <span className="shrink-0 tabular-nums text-slate-500">{right}</span>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i <= n ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
      ))}
    </span>
  );
}

function Empty() {
  return <p className="py-6 text-center text-xs text-slate-400">Hozircha ma’lumot yo‘q</p>;
}
