import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileImage, FileText, Loader2, QrCode, RefreshCw, ScanLine, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { QrScanDialog } from "../../components/QrScanDialog";
import {
  fetchActiveBranchQr,
  fetchQrBranches,
  issueBranchQr,
  qrPunchDavomat,
  revokeBranchQr,
  type QrBranchRow,
} from "../../lib/davomat-api";
import { downloadQrPdf, downloadQrPng, renderQrToCanvas } from "../../lib/qr-render";
import { canManageSettings } from "../../lib/roles";
import { cn } from "../../lib/utils";

type Props = {
  /** Admin: o‘chirish + barcha filiallar */
  adminMode?: boolean;
};

export default function DavomatQrPage({ adminMode = false }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [needsReissue, setNeedsReissue] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanAction, setScanAction] = useState<"in" | "out">("in");
  const isAdmin = adminMode || canManageSettings(user?.role);
  /** Faqat admin: istalgan filial QR + lokatsiyasiz skaner */
  const adminQrAnywhere = user?.role === "admin";

  const q = useQuery({
    queryKey: ["davomat-qr-branches"],
    queryFn: fetchQrBranches,
    enabled: Boolean(user),
  });

  const branches = q.data?.branches ?? [];
  const selected: QrBranchRow | null = useMemo(
    () => branches.find((b) => b.id === selectedId) ?? null,
    [branches, selectedId],
  );

  async function paint(payloadText: string) {
    const el = canvasRef.current;
    if (!el) return;
    await renderQrToCanvas(el, payloadText, 280);
  }

  /** Canvas DOM ga chiqqandan keyin chizish (aks holda bo‘sh qolardi) */
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    const run = async () => {
      // 2 frame — React mount + layout
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))));
      if (cancelled || !canvasRef.current) return;
      try {
        await paint(payload);
      } catch (e) {
        toast({
          title: "QR chizilmadi",
          description: e instanceof Error ? e.message : "Qayta urinib ko‘ring",
          variant: "destructive",
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const loadActive = useMutation({
    mutationFn: (branchId: number) => fetchActiveBranchQr(branchId),
    onSuccess: (r) => {
      if (!r.active) {
        setPayload(null);
        setLabel(selected?.name || "");
        setVersion(null);
        setNeedsReissue(false);
        return;
      }
      setLabel(r.active.branchLabel || selected?.name || "");
      setVersion(r.active.version);
      setNeedsReissue(Boolean(r.active.needsReissue || !r.active.payload));
      setPayload(r.active.payload || null);
    },
    onError: (e: Error) => toast({ title: "Yuklanmadi", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (selectedId == null) return;
    loadActive.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (selectedId != null || !branches.length) return;
    const withQr = branches.find((b) => b.hasActiveQr);
    setSelectedId((withQr || branches[0]!).id);
  }, [branches, selectedId]);

  const issue = useMutation({
    mutationFn: (branchId: number) => issueBranchQr(branchId),
    onSuccess: (r) => {
      setLabel(r.branchLabel);
      setVersion(r.version);
      setNeedsReissue(false);
      setSelectedId(r.branchId);
      setPayload(r.payload);
      qc.invalidateQueries({ queryKey: ["davomat-qr-branches"] });
      toast({ title: "QR saqlandi", description: "Endi mudir va koordinator istalgan vaqtda ko‘ra oladi." });
    },
    onError: (e: Error) => toast({ title: "Xato", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (branchId: number) => revokeBranchQr(branchId),
    onSuccess: () => {
      setPayload(null);
      setVersion(null);
      setNeedsReissue(false);
      qc.invalidateQueries({ queryKey: ["davomat-qr-branches"] });
      toast({ title: "QR o‘chirildi (bekor qilindi)" });
    },
    onError: (e: Error) => toast({ title: "O‘chirilmadi", description: e.message, variant: "destructive" }),
  });

  async function onDownloadPng() {
    if (!payload) return;
    try {
      await downloadQrPng(payload, `davomat-qr-${selectedId || "branch"}.png`);
    } catch (e) {
      toast({ title: "PNG yuklanmadi", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function onDownloadPdf() {
    if (!payload) return;
    try {
      await downloadQrPdf(payload, label || "Filial QR", `davomat-qr-${selectedId || "branch"}.pdf`);
    } catch (e) {
      toast({ title: "PDF ochilmadi", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function onAdminScan(detected: string) {
    const result = await qrPunchDavomat({
      payload: detected,
      action: scanAction,
    });
    toast({
      title: result.action === "in" ? "✓ Keldim (QR)" : "✓ Ketdim (QR)",
      description: result.branchLabel
        ? `${result.message || "Qabul qilindi"} · ${result.branchLabel}`
        : result.message || "Admin QR qabul qilindi (lokatsiya shart emas)",
    });
  }

  if (q.isError) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-rose-600">
          {(q.error as Error)?.message || "QR filiallari yuklanmadi. Faqat mudir / koordinator / admin."}
        </p>
        <Link href="/davomat-face" className="mt-3 inline-block text-sm text-primary underline">
          ← Davomat
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <QrCode className="h-5 w-5" />
          {isAdmin ? "Admin · Davomat QR" : "Davomat QR"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          QR bir marta yaratiladi va saqlanadi — mudir ham, koordinator ham ko‘radi. Yangi yaratilsa eski
          almashtiriladi. Farmasevt/stajyor yaratolmaydi.
        </p>
      </div>

      {adminQrAnywhere ? (
        <Card className="border-sky-200 dark:border-sky-900/50">
          <CardHeader className="py-3">
            <CardTitle className="text-base">Admin QR scanner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-muted-foreground">
              Istalgan filial QR kodini skaner qiling. Lokatsiya qayerda bo‘lishidan qat’i nazar qabul
              qilinadi — faqat admin.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={scanAction === "in" ? "default" : "outline"}
                onClick={() => setScanAction("in")}
              >
                Keldim
              </Button>
              <Button
                type="button"
                variant={scanAction === "out" ? "default" : "outline"}
                onClick={() => setScanAction("out")}
              >
                Ketdim
              </Button>
            </div>
            <Button type="button" className="w-full gap-2" onClick={() => setScanOpen(true)}>
              <ScanLine className="h-4 w-4" />
              QR scanner — skaner qiling
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Filialni tanlang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {q.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </p>
          ) : branches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Filial topilmadi (GPS bo‘lishi shart).</p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
              {branches.map((b) => {
                const on = selectedId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 text-left last:border-0",
                      on ? "bg-sky-50 dark:bg-sky-950/40" : "hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {b.managerName}
                        {b.hasActiveQr ? ` · QR v${b.version}` : " · QR yo‘q"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              className="w-full gap-2"
              disabled={!selectedId || issue.isPending}
              onClick={() => selectedId && issue.mutate(selectedId)}
            >
              {issue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {selected?.hasActiveQr ? "Yangi QR (eski bekor)" : "QR yaratish"}
            </Button>
            {isAdmin ? (
              <Button
                type="button"
                variant="destructive"
                className="w-full gap-2"
                disabled={!selectedId || !selected?.hasActiveQr || revoke.isPending}
                onClick={() => {
                  if (!selectedId) return;
                  if (!window.confirm("Bu filial QR ni butunlay bekor qilasizmi?")) return;
                  revoke.mutate(selectedId);
                }}
              >
                {revoke.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                O‘chirish
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {loadActive.isPending ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> QR yuklanmoqda…
        </p>
      ) : payload ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">
              {label || "QR kod"}
              {version != null ? ` · v${version}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 pt-0">
            <canvas
              ref={canvasRef}
              width={280}
              height={280}
              className="h-[280px] w-[280px] rounded-2xl border border-border bg-white p-2 shadow-sm"
            />
            <p className="text-center text-[11px] text-emerald-700 dark:text-emerald-300">
              Saqlangan QR — yangi yaratilmaguncha shu ko‘rinishda qoladi.
            </p>
            <div className="grid w-full grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => void onDownloadPng()}>
                <FileImage className="h-4 w-4" />
                PNG
              </Button>
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => void onDownloadPdf()}>
                <FileText className="h-4 w-4" />
                PDF
              </Button>
            </div>
            <Button type="button" className="w-full gap-2" onClick={() => void onDownloadPng()}>
              <Download className="h-4 w-4" />
              Yuklab olish
            </Button>
          </CardContent>
        </Card>
      ) : needsReissue ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-center text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Eski QR payload saqlanmagan. «Yangi QR» bosing — keyin doim ko‘rinadi.
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Filialni tanlang. QR bo‘lsa avtomatik chiqadi; yo‘q bo‘lsa «QR yaratish».
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-4 text-sm">
        <Link href="/davomat-face" className="text-primary underline-offset-2 hover:underline">
          ← Davomat sahifasi
        </Link>
        {!adminMode && isAdmin ? (
          <Link href="/admin/davomat-qr" className="text-primary underline-offset-2 hover:underline">
            Admin QR boshqaruvi →
          </Link>
        ) : null}
      </div>

      {adminQrAnywhere ? (
        <QrScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          title={scanAction === "out" ? "Ketdim — QR scanner" : "Keldim — QR scanner"}
          description="Istalgan filial QR · lokatsiya shart emas · skaner qiling"
          onDetected={onAdminScan}
        />
      ) : null}
    </div>
  );
}
