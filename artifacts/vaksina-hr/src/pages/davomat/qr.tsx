import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  Loader2,
  QrCode,
  RefreshCw,
  ScanLine,
  Trash2,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "../../components/ui/button";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { QrScanDialog, openScanCamera } from "../../components/QrScanDialog";
import {
  fetchActiveBranchQr,
  fetchActiveDepartmentQr,
  fetchDavomatMethods,
  fetchQrBranches,
  fetchQrDepartments,
  issueBranchQr,
  issueDepartmentQr,
  qrPunchDavomat,
  revokeBranchQr,
  revokeDepartmentQr,
} from "../../lib/davomat-api";
import { downloadAllQrPdf, downloadQrPdf, downloadQrPng, renderQrToCanvas } from "../../lib/qr-render";
import { canManageSettings, isDeptHeadRole } from "../../lib/roles";
import { cn } from "../../lib/utils";

function QrCanvasItem({ payload, size = 240 }: { payload: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))));
      if (cancelled || !ref.current) return;
      try {
        await renderQrToCanvas(ref.current, payload, size);
      } catch {
        /* ignore paint errors per-item */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload, size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className="h-[min(240px,68vw)] w-[min(240px,68vw)] max-w-full sm:h-[240px] sm:w-[240px]"
    />
  );
}

type GalleryQr = {
  id: number;
  name: string;
  version: number | null;
  payload: string | null;
  needsReissue: boolean;
};

type Scope = "branches" | "departments";

type Props = {
  /** Admin: o‘chirish + barcha filiallar/bo‘limlar */
  adminMode?: boolean;
};

export default function DavomatQrPage({ adminMode = false }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>("branches");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [needsReissue, setNeedsReissue] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [qrStream, setQrStream] = useState<MediaStream | null>(null);
  const [scanAction, setScanAction] = useState<"in" | "out">("in");
  const [scanBusy, setScanBusy] = useState(false);
  const [gallery, setGallery] = useState<GalleryQr[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryTick, setGalleryTick] = useState(0);
  const [bulkPdfBusy, setBulkPdfBusy] = useState(false);

  useEffect(() => {
    if (scanOpen) return;
    setQrStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, [scanOpen]);

  const isAdmin = adminMode || canManageSettings(user?.role);
  /** Faqat admin: istalgan filial/bo‘lim QR + lokatsiyasiz skaner */
  const adminQrAnywhere = user?.role === "admin";

  const methodsQ = useQuery({
    queryKey: ["davomat-methods"],
    queryFn: fetchDavomatMethods,
    enabled: Boolean(user),
  });

  const canBranch =
    Boolean(methodsQ.data?.canManageBranchQr) ||
    user?.role === "mudir" ||
    user?.role === "koordinator" ||
    isAdmin;
  const canDept =
    Boolean(methodsQ.data?.canManageDeptQr) || isDeptHeadRole(user?.role) || isAdmin;

  useEffect(() => {
    if (methodsQ.isLoading) return;
    if (canBranch && !canDept) setScope("branches");
    else if (!canBranch && canDept) setScope("departments");
  }, [methodsQ.isLoading, canBranch, canDept]);

  useEffect(() => {
    setSelectedId(null);
    setNeedsReissue(false);
    setGallery([]);
  }, [scope]);

  const branchQ = useQuery({
    queryKey: ["davomat-qr-branches"],
    queryFn: fetchQrBranches,
    enabled: Boolean(user) && scope === "branches" && canBranch,
  });

  const deptQ = useQuery({
    queryKey: ["davomat-qr-departments"],
    queryFn: fetchQrDepartments,
    enabled: Boolean(user) && scope === "departments" && canDept,
  });

  const listLoading = scope === "branches" ? branchQ.isLoading : deptQ.isLoading;
  const listError = scope === "branches" ? branchQ.isError : deptQ.isError;
  const listErrorMsg =
    scope === "branches"
      ? (branchQ.error as Error)?.message
      : (deptQ.error as Error)?.message;

  const branches = branchQ.data?.branches ?? [];
  const departments = deptQ.data?.departments ?? [];
  const items: Array<{ id: number; name: string; hasActiveQr: boolean; version: number | null; managerName?: string }> =
    scope === "branches"
      ? branches.map((b) => ({
          id: b.id,
          name: b.name,
          hasActiveQr: b.hasActiveQr,
          version: b.version,
          managerName: b.managerName,
        }))
      : departments.map((d) => ({
          id: d.id,
          name: d.name,
          hasActiveQr: d.hasActiveQr,
          version: d.version,
        }));

  const selected = useMemo(
    () => items.find((b) => b.id === selectedId) ?? null,
    [items, selectedId],
  );

  const activeCount = useMemo(() => items.filter((b) => b.hasActiveQr).length, [items]);

  useEffect(() => {
    let cancelled = false;
    const withQr = items.filter((b) => b.hasActiveQr);
    if (!withQr.length) {
      setGallery([]);
      setGalleryLoading(false);
      return;
    }
    setGalleryLoading(true);
    void (async () => {
      const rows = await Promise.all(
        withQr.map(async (b) => {
          try {
            if (scope === "branches") {
              const r = await fetchActiveBranchQr(b.id);
              return {
                id: b.id,
                name: r.active?.branchLabel || b.name,
                version: r.active?.version ?? b.version,
                payload: r.active?.payload || null,
                needsReissue: Boolean(r.active?.needsReissue || !r.active?.payload),
              } satisfies GalleryQr;
            }
            const r = await fetchActiveDepartmentQr(b.id);
            return {
              id: b.id,
              name: r.active?.departmentLabel || b.name,
              version: r.active?.version ?? b.version,
              payload: r.active?.payload || null,
              needsReissue: Boolean(r.active?.needsReissue || !r.active?.payload),
            } satisfies GalleryQr;
          } catch {
            return {
              id: b.id,
              name: b.name,
              version: b.version,
              payload: null,
              needsReissue: true,
            } satisfies GalleryQr;
          }
        }),
      );
      if (!cancelled) {
        setGallery(rows);
        setGalleryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items, galleryTick, scope]);

  const loadActive = useMutation({
    mutationFn: (id: number) =>
      scope === "branches" ? fetchActiveBranchQr(id) : fetchActiveDepartmentQr(id),
    onSuccess: (r) => {
      setNeedsReissue(Boolean(r.active && (r.active.needsReissue || !r.active.payload)));
    },
  });

  useEffect(() => {
    if (selectedId == null) return;
    loadActive.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, scope]);

  useEffect(() => {
    if (selectedId != null || !items.length) return;
    const withQr = items.find((b) => b.hasActiveQr);
    setSelectedId((withQr || items[0]!).id);
  }, [items, selectedId]);

  const issue = useMutation({
    mutationFn: (id: number) =>
      scope === "branches" ? issueBranchQr(id) : issueDepartmentQr(id),
    onSuccess: (r) => {
      setNeedsReissue(false);
      const id = "branchId" in r ? r.branchId : r.departmentId;
      setSelectedId(id);
      void qc.invalidateQueries({
        queryKey: scope === "branches" ? ["davomat-qr-branches"] : ["davomat-qr-departments"],
      });
      setGalleryTick((n) => n + 1);
      toast({
        title: "QR saqlandi",
        description:
          scope === "branches"
            ? "Endi mudir va koordinator istalgan vaqtda ko‘ra oladi."
            : "Bo‘lim QR saqlandi — istalgan vaqtda ko‘rish mumkin.",
      });
    },
    onError: (e: Error) => toast({ title: "Xato", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) =>
      scope === "branches" ? revokeBranchQr(id) : revokeDepartmentQr(id),
    onSuccess: () => {
      setNeedsReissue(false);
      void qc.invalidateQueries({
        queryKey: scope === "branches" ? ["davomat-qr-branches"] : ["davomat-qr-departments"],
      });
      setGalleryTick((n) => n + 1);
      toast({ title: "QR o‘chirildi (bekor qilindi)" });
    },
    onError: (e: Error) => toast({ title: "O‘chirilmadi", description: e.message, variant: "destructive" }),
  });

  async function onDownloadPng(text: string, id: number) {
    try {
      await downloadQrPng(text, `davomat-qr-${scope}-${id}.png`);
    } catch (e) {
      toast({ title: "PNG yuklanmadi", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function onDownloadPdf(text: string, label: string, id: number) {
    try {
      await downloadQrPdf(
        text,
        label || (scope === "branches" ? "Filial QR" : "Bo‘lim QR"),
        `davomat-qr-${scope}-${id}.pdf`,
      );
    } catch (e) {
      toast({ title: "PDF ochilmadi", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function onDownloadAllPdf() {
    setBulkPdfBusy(true);
    try {
      let source = gallery.filter((g) => g.payload?.trim());

      if (!source.length) {
        const withQr = items.filter((b) => b.hasActiveQr);
        if (!withQr.length) {
          toast({
            title: "PDF",
            description: "Faol QR yo‘q — avval QR yarating",
            variant: "destructive",
          });
          return;
        }
        const rows = await Promise.all(
          withQr.map(async (b) => {
            try {
              if (scope === "branches") {
                const r = await fetchActiveBranchQr(b.id);
                return {
                  id: b.id,
                  name: r.active?.branchLabel || b.name,
                  version: r.active?.version ?? b.version,
                  payload: r.active?.payload || null,
                  needsReissue: Boolean(r.active?.needsReissue || !r.active?.payload),
                } satisfies GalleryQr;
              }
              const r = await fetchActiveDepartmentQr(b.id);
              return {
                id: b.id,
                name: r.active?.departmentLabel || b.name,
                version: r.active?.version ?? b.version,
                payload: r.active?.payload || null,
                needsReissue: Boolean(r.active?.needsReissue || !r.active?.payload),
              } satisfies GalleryQr;
            } catch {
              return {
                id: b.id,
                name: b.name,
                version: b.version,
                payload: null,
                needsReissue: true,
              } satisfies GalleryQr;
            }
          }),
        );
        source = rows.filter((r) => r.payload?.trim());
      }

      if (!source.length) {
        toast({
          title: "PDF",
          description: "Yuklash uchun saqlangan QR topilmadi",
          variant: "destructive",
        });
        return;
      }

      const pdfItems = source
        .map((g) => {
          const idx = items.findIndex((b) => b.id === g.id);
          return {
            n: idx >= 0 ? idx + 1 : 0,
            title: g.name,
            payload: g.payload!,
          };
        })
        .sort((a, b) => a.n - b.n || a.title.localeCompare(b.title));

      await downloadAllQrPdf(
        pdfItems,
        isAdmin
          ? scope === "branches"
            ? "Admin · Filial QR"
            : "Admin · Bo‘lim QR"
          : scope === "branches"
            ? "Davomat QR · Filiallar"
            : "Davomat QR · Bo‘limlar",
      );
      toast({
        title: "PDF tayyor",
        description: `${pdfItems.length} ta QR · chop etish oynasi ochildi (PDF saqlang). HTML ham yuklandi.`,
      });
    } catch (e) {
      toast({
        title: "PDF ochilmadi",
        description: e instanceof Error ? e.message : "Qayta urinib ko‘ring",
        variant: "destructive",
      });
    } finally {
      setBulkPdfBusy(false);
    }
  }

  async function openAdminScanner() {
    setScanBusy(true);
    try {
      const stream = await openScanCamera();
      setQrStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return stream;
      });
      setScanOpen(true);
    } catch {
      toast({
        title: "Kamera",
        description: "Kameraga ruxsat berilmadi yoki kamera topilmadi",
        variant: "destructive",
      });
    } finally {
      setScanBusy(false);
    }
  }

  async function onAdminScan(detected: string) {
    const result = await qrPunchDavomat({
      payload: detected,
      action: scanAction,
    });
    const place = result.branchLabel || result.departmentLabel || null;
    toast({
      title: result.action === "in" ? "✓ Keldim (QR)" : "✓ Ketdim (QR)",
      description: place
        ? `${result.message || "Qabul qilindi"} · ${place}`
        : result.message || "Admin QR qabul qilindi (lokatsiya shart emas)",
    });
  }

  if (!methodsQ.isLoading && !canBranch && !canDept) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-center dark:border-rose-900/50 dark:bg-rose-950/30">
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
            QR yaratishga ruxsat yo‘q. Filial: mudir/koordinator · Bo‘lim: rahbar/admin.
          </p>
          <Link
            href="/davomat-face"
            className="mt-3 inline-flex text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            ← Davomat
          </Link>
        </div>
      </div>
    );
  }

  if (listError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-center dark:border-rose-900/50 dark:bg-rose-950/30">
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
            {listErrorMsg ||
              (scope === "branches"
                ? "QR filiallari yuklanmadi."
                : "QR bo‘limlari yuklanmadi.")}
          </p>
          <Link
            href="/davomat-face"
            className="mt-3 inline-flex text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            ← Davomat
          </Link>
        </div>
      </div>
    );
  }

  const canIssue = Boolean(selectedId) && !issue.isPending;
  const canRevoke = Boolean(selectedId && selected?.hasActiveQr) && !revoke.isPending;
  const entityLabel = scope === "branches" ? "filial" : "bo‘lim";
  const showTabs = canBranch && canDept;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 pb-28 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <QrCode className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {isAdmin ? "Admin · Davomat QR" : "Davomat QR"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {adminQrAnywhere
                ? "Filial va bo‘lim QR · istalgan QR skaner"
                : scope === "branches"
                  ? "Filial QR yaratish, ko‘rish va yuklab olish"
                  : "Bo‘lim QR yaratish, ko‘rish va yuklab olish"}
            </p>
          </div>
          {items.length > 0 ? (
            <div className="flex items-center gap-2 text-[11px] font-medium">
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
                Faol {activeCount}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                Jami {items.length}
              </span>
            </div>
          ) : null}
        </div>
        <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
          {scope === "branches"
            ? "QR bir marta yaratiladi va saqlanadi — mudir ham, koordinator ham ko‘radi. Yangi yaratilsa eski almashtiriladi."
            : "Ofis bo‘limi QR — faqat shu bo‘lim xodimlari ofis zonasida (150 m) skaner qiladi. Rahbar faqat o‘z bo‘limini boshqaradi."}
        </p>
      </header>

      {showTabs ? (
        <div
          role="tablist"
          aria-label="QR turi"
          className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/30 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={scope === "branches"}
            onClick={() => setScope("branches")}
            className={cn(
              "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              scope === "branches"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Filiallar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === "departments"}
            onClick={() => setScope("departments")}
            className={cn(
              "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              scope === "departments"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Bo‘limlar
          </button>
        </div>
      ) : null}

      {adminQrAnywhere ? (
        <section className="rounded-2xl border border-sky-200/80 bg-sky-50/60 p-4 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/25 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
                <ScanLine className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">Admin QR scanner</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Istalgan filial yoki bo‘lim QR · lokatsiya shart emas · faqat admin
                </p>
              </div>
            </div>
            <div className="flex w-full max-w-xl flex-col gap-2 lg:w-[26rem]">
              <div
                role="group"
                aria-label="Davomat turi"
                className="grid grid-cols-2 gap-1 rounded-2xl border border-border/80 bg-background/80 p-1"
              >
                <button
                  type="button"
                  onClick={() => setScanAction("in")}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                    scanAction === "in"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  Keldim
                </button>
                <button
                  type="button"
                  onClick={() => setScanAction("out")}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                    scanAction === "out"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  Ketdim
                </button>
              </div>
              <Button
                type="button"
                size="lg"
                className="h-11 w-full gap-2 rounded-2xl shadow-sm"
                disabled={scanBusy}
                onClick={() => void openAdminScanner()}
              >
                {scanBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanLine className="h-5 w-5" />}
                QR scanner — skaner qiling
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {scope === "branches" ? "Filialni tanlang" : "Bo‘limni tanlang"}
          </h2>
          {selected ? (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                selected.hasActiveQr
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {selected.hasActiveQr ? `Tanlangan · Faol v${selected.version}` : "Tanlangan · Nofaol"}
            </span>
          ) : null}
        </div>

        {listLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
            {scope === "branches"
              ? "Filial topilmadi (GPS bo‘lishi shart)."
              : "Bo‘lim topilmadi yoki ruxsat yo‘q."}
          </p>
        ) : (
          <div className="grid max-h-[16rem] gap-1.5 overflow-y-auto rounded-2xl border border-border/70 bg-muted/20 p-1.5 sm:max-h-none sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((b, idx) => {
              const on = selectedId === b.id;
              const n = idx + 1;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition",
                    on
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-background/90 text-foreground hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums",
                      on
                        ? "bg-white/15"
                        : b.hasActiveQr
                          ? "bg-emerald-500/15 text-emerald-700"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {n}. {b.name}
                    </span>
                    <span
                      className={cn(
                        "block truncate text-[11px]",
                        on ? "text-primary-foreground/80" : "text-muted-foreground",
                      )}
                    >
                      {b.hasActiveQr ? `Faol · v${b.version}` : "QR yo‘q"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "hidden h-5 w-5 shrink-0 items-center justify-center sm:flex",
                      on
                        ? "text-primary-foreground/80"
                        : b.hasActiveQr
                          ? "text-emerald-600"
                          : "text-muted-foreground/70",
                    )}
                    aria-hidden
                  >
                    {b.hasActiveQr ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Button
            type="button"
            size="lg"
            className="h-11 w-full max-w-xs gap-2 rounded-2xl sm:w-auto sm:min-w-[12rem]"
            disabled={!canIssue}
            onClick={() => selectedId && issue.mutate(selectedId)}
          >
            {issue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {selected?.hasActiveQr ? "Yangi QR" : "QR yaratish"}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-11 w-full max-w-xs gap-2 rounded-2xl sm:w-auto sm:min-w-[12rem]"
            disabled={bulkPdfBusy || galleryLoading || (gallery.length === 0 && activeCount === 0)}
            onClick={() => void onDownloadAllPdf()}
          >
            {bulkPdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            PDF — barcha QR
          </Button>
          {isAdmin ? (
            <Button
              type="button"
              size="lg"
              variant="destructive"
              className={cn(
                "h-11 w-full max-w-xs gap-2 rounded-2xl sm:w-auto sm:min-w-[10rem]",
                !canRevoke && "opacity-45",
              )}
              disabled={!canRevoke}
              onClick={() => {
                if (!selectedId) return;
                if (!window.confirm(`Bu ${entityLabel} QR ni butunlay bekor qilasizmi?`)) return;
                revoke.mutate(selectedId);
              }}
            >
              {revoke.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              O‘chirish
            </Button>
          ) : null}
        </div>
        {needsReissue && selectedId ? (
          <p className="mt-2 text-center text-[11px] text-amber-700 dark:text-amber-300">
            Tanlangan {entityLabel}da eski QR payload yo‘q — «Yangi QR» bosing.
          </p>
        ) : selected?.hasActiveQr ? (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            «Yangi QR» eski kodni bekor qiladi. Barcha QR lar pastda ketma-ket ko‘rinadi.
          </p>
        ) : selected ? (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Tanlangan {entityLabel}da hali QR yo‘q — «QR yaratish» ni bosing.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Barcha QR kodlar</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Faol {scope === "branches" ? "filial" : "bo‘lim"} QR lari · PDF da har sahifada 20 ta
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {galleryLoading ? "Yuklanmoqda…" : `${gallery.length} ta`}
            </span>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5 rounded-xl"
              disabled={bulkPdfBusy || galleryLoading || (gallery.length === 0 && activeCount === 0)}
              onClick={() => void onDownloadAllPdf()}
            >
              {bulkPdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              PDF — barcha QR
            </Button>
          </div>
        </div>

        {galleryLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            QR lar yuklanmoqda…
          </div>
        ) : gallery.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <QrCode className="h-6 w-6" />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              Hali faol QR yo‘q. Yuqoridan {entityLabel}ni tanlab «QR yaratish» ni bosing — shu yerda
              chiqadi.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {gallery.map((item, idx) => {
              const highlighted = selectedId === item.id;
              const n = idx + 1;
              return (
                <article
                  key={`${scope}-${item.id}`}
                  className={cn(
                    "rounded-2xl border p-4 transition sm:p-5",
                    highlighted
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "border-border/80 bg-muted/10",
                  )}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground sm:text-base">
                      {n}. {item.name}
                      {item.version != null ? (
                        <span className="ml-1.5 font-medium text-muted-foreground">· v{item.version}</span>
                      ) : null}
                    </h3>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        item.payload
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/15 text-amber-800 dark:text-amber-200",
                      )}
                    >
                      {item.payload ? "Faol" : "Qayta yaratish kerak"}
                    </span>
                  </div>

                  {item.payload ? (
                    <div className="flex flex-col items-center gap-4 md:flex-row md:items-start md:justify-center md:gap-10">
                      <div className="rounded-[1.25rem] border border-border bg-white p-3 shadow-sm">
                        <QrCanvasItem payload={item.payload} size={240} />
                      </div>
                      <div className="flex w-full max-w-xs flex-col items-center gap-2 md:items-stretch md:pt-2">
                        <p className="text-center text-[12px] leading-relaxed text-muted-foreground md:text-left">
                          Saqlangan QR — yangi yaratilmaguncha shu ko‘rinishda qoladi.
                        </p>
                        <div className="flex w-full flex-wrap justify-center gap-2 md:justify-start">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 min-w-[5.5rem] flex-1 gap-1.5 rounded-xl"
                            onClick={() => void onDownloadPng(item.payload!, item.id)}
                          >
                            <FileImage className="h-4 w-4" />
                            PNG
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 min-w-[5.5rem] flex-1 gap-1.5 rounded-xl"
                            onClick={() => void onDownloadPdf(item.payload!, item.name, item.id)}
                          >
                            <FileText className="h-4 w-4" />
                            PDF
                          </Button>
                        </div>
                        <Button
                          type="button"
                          className="h-10 w-full gap-2 rounded-xl"
                          onClick={() => void onDownloadPng(item.payload!, item.id)}
                        >
                          <Download className="h-4 w-4" />
                          Yuklab olish
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-9 text-xs text-muted-foreground"
                          onClick={() => setSelectedId(item.id)}
                        >
                          Shu {entityLabel}ni tanlash
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-4 text-center text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                      Payload yo‘q. {entityLabel}ni tanlab «Yangi QR» bosing.
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1 text-sm">
        <Link href="/davomat-face" className="font-medium text-primary underline-offset-2 hover:underline">
          ← Davomat sahifasi
        </Link>
        {!adminMode && isAdmin ? (
          <Link href="/admin/davomat-qr" className="font-medium text-primary underline-offset-2 hover:underline">
            Admin QR boshqaruvi →
          </Link>
        ) : null}
      </div>

      {adminQrAnywhere ? (
        <QrScanDialog
          open={scanOpen}
          stream={qrStream}
          onOpenChange={setScanOpen}
          title={scanAction === "out" ? "Ketdim — QR scanner" : "Keldim — QR scanner"}
          description="Istalgan filial yoki bo‘lim QR · lokatsiya shart emas · skaner qiling"
          onDetected={onAdminScan}
        />
      ) : null}
    </div>
  );
}
