import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Download,
  FileUp,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
  ScanLine,
  Layers,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { deliverFile } from "@/lib/tg-download";
import {
  type Point,
  type ScanMode,
  A4_HEIGHT,
  A4_WIDTH,
  applyHandleDrag,
  cornersToHandles,
  defaultCorners,
  detectDocumentCorners,
  enhanceDocument,
  imageDataToCanvas,
  imageToImageData,
  loadImageFromFile,
  orderCorners,
  pagesToPdfBlob,
  warpToA4,
} from "@/lib/document-scan";

type Step = "capture" | "crop" | "pages";

export type DocumentScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (blob: Blob, filename: string) => void | Promise<void>;
  title?: string;
  defaultFileName?: string;
  standalone?: boolean;
};

export function DocumentScanner({
  open,
  onOpenChange,
  onComplete,
  title = "Hujjat skaneri",
  defaultFileName = "hujjat.pdf",
  standalone = false,
}: DocumentScannerProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const [step, setStep] = useState<Step>("capture");
  const [busy, setBusy] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [sourceData, setSourceData] = useState<ImageData | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<ScanMode>("bw");
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCamError(null);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (err: any) {
      setCamError(err?.message || "Kameraga ruxsat berilmadi");
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setStep("capture");
      setSourceData(null);
      setSourceUrl(null);
      setCorners([]);
      setPages([]);
      setPreviewUrls((prev) => {
        prev.forEach((u) => {
          if (u.startsWith("blob:")) URL.revokeObjectURL(u);
        });
        return [];
      });
      return;
    }
    if (step === "capture") void startCamera();
    else stopCamera();
  }, [open, step, startCamera, stopCamera]);

  const beginCrop = useCallback((img: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) => {
    const { data } = imageToImageData(img, 2000);
    const detected = detectDocumentCorners(data);
    setSourceData(data);
    const c = document.createElement("canvas");
    c.width = data.width;
    c.height = data.height;
    c.getContext("2d")!.putImageData(data, 0, 0);
    setSourceUrl(c.toDataURL("image/jpeg", 0.92));
    setCorners(detected);
    setStep("crop");
  }, []);

  const captureFrame = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      toast({ title: "Kamera tayyor emas", variant: "destructive" });
      return;
    }
    beginCrop(v);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setBusy(true);
      if (file.type === "application/pdf") {
        if (onComplete) await onComplete(file, file.name || defaultFileName);
        else {
          await deliverFile(file, file.name || defaultFileName);
          toast({ title: "PDF yuborildi / yuklandi" });
        }
        onOpenChange(false);
        return;
      }
      const img = await loadImageFromFile(file);
      beginCrop(img);
    } catch (err: any) {
      toast({ title: err?.message || "Fayl ochilmadi", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Overlay: dim + teal frame + 8 handles (3-rasm)
  useEffect(() => {
    if (step !== "crop" || !sourceData || !overlayRef.current) return;
    const canvas = overlayRef.current;
    canvas.width = sourceData.width;
    canvas.height = sourceData.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (corners.length !== 4) return;

    const ordered = orderCorners(corners);
    const handles = cornersToHandles(ordered);
    const lw = Math.max(2.5, canvas.width / 350);

    // Dim outside polygon
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(ordered[0]!.x, ordered[0]!.y);
    for (let i = 1; i < 4; i++) ctx.lineTo(ordered[i]!.x, ordered[i]!.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Teal frame
    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(ordered[0]!.x, ordered[0]!.y);
    for (let i = 1; i < 4; i++) ctx.lineTo(ordered[i]!.x, ordered[i]!.y);
    ctx.closePath();
    ctx.stroke();

    // L-corners
    const arm = Math.max(22, canvas.width / 28);
    ctx.lineWidth = lw * 1.6;
    ctx.lineCap = "round";
    const drawL = (a: Point, towardB: Point, towardD: Point) => {
      const vb = { x: towardB.x - a.x, y: towardB.y - a.y };
      const vd = { x: towardD.x - a.x, y: towardD.y - a.y };
      const nb = Math.hypot(vb.x, vb.y) || 1;
      const nd = Math.hypot(vd.x, vd.y) || 1;
      ctx.beginPath();
      ctx.moveTo(a.x + (vb.x / nb) * arm, a.y + (vb.y / nb) * arm);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(a.x + (vd.x / nd) * arm, a.y + (vd.y / nd) * arm);
      ctx.stroke();
    };
    drawL(ordered[0]!, ordered[1]!, ordered[3]!);
    drawL(ordered[1]!, ordered[0]!, ordered[2]!);
    drawL(ordered[2]!, ordered[1]!, ordered[3]!);
    drawL(ordered[3]!, ordered[0]!, ordered[2]!);

    // 8 handles
    handles.forEach((p, i) => {
      const r = i % 2 === 0 ? Math.max(11, canvas.width / 90) : Math.max(8, canvas.width / 110);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#0d9488";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });
  }, [step, sourceData, corners]);

  const pointerToImage = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceData) return;
    const p = pointerToImage(e);
    const handles = cornersToHandles(corners);
    let best = -1;
    let bestD = Infinity;
    handles.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const thresh = Math.max(36, sourceData.width / 14);
    if (best >= 0 && bestD < thresh) {
      setDragIdx(best);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragIdx == null || !sourceData) return;
    const p = pointerToImage(e);
    setCorners(
      applyHandleDrag(corners, dragIdx, p, {
        w: sourceData.width,
        h: sourceData.height,
      }),
    );
  };

  const onPointerUp = () => setDragIdx(null);

  const confirmPage = async (then: "continue" | "pages") => {
    if (!sourceData || corners.length !== 4) return;
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 16));
      const warped = warpToA4(sourceData, corners, A4_WIDTH, A4_HEIGHT);
      const enhanced = enhanceDocument(warped, mode);
      const canvas = imageDataToCanvas(enhanced);
      const url = canvas.toDataURL("image/jpeg", 0.92);
      setPages((p) => [...p, canvas]);
      setPreviewUrls((u) => [...u, url]);
      setSourceData(null);
      setSourceUrl(null);
      toast({
        title: `Sahifa ${pages.length + 1} qo‘shildi`,
        description: then === "continue" ? "Keyingi sahifani skaner qiling" : undefined,
      });
      setStep(then === "continue" ? "capture" : "pages");
    } catch (err: any) {
      toast({ title: err?.message || "Kesish xatosi", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const removePage = (idx: number) => {
    setPages((p) => p.filter((_, i) => i !== idx));
    setPreviewUrls((u) => u.filter((_, i) => i !== idx));
  };

  const buildPdf = async () => {
    if (!pages.length) {
      toast({ title: "Kamida 1 sahifa skaner qiling", variant: "destructive" });
      return null;
    }
    return pagesToPdfBlob(pages, defaultFileName);
  };

  const finishSave = async () => {
    setSaving(true);
    try {
      const result = await buildPdf();
      if (!result) return;
      if (onComplete) await onComplete(result.blob, result.filename);
      else {
        await deliverFile(result.blob, result.filename);
        toast({ title: "PDF tayyor" });
      }
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: err?.message || "Saqlash xatosi", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const shareTg = async () => {
    setSaving(true);
    try {
      const result = await buildPdf();
      if (!result) return;
      const r = await deliverFile(result.blob, result.filename);
      toast({
        title: r.via === "telegram" ? "Telegramga yuborildi" : "Yuklab olindi",
      });
    } catch (err: any) {
      toast({ title: err?.message || "Ulashish xatosi", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const downloadOnly = async () => {
    setSaving(true);
    try {
      const result = await buildPdf();
      if (!result) return;
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF yuklab olindi" });
    } catch (err: any) {
      toast({ title: err?.message || "Yuklash xatosi", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] w-[min(100vw-1rem,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5 text-teal-600" />
            {title}
            {pages.length > 0 ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                <Layers className="h-3 w-3" />
                {pages.length} sahifa
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Listni belgilang → skaner → yana sahifa qo‘shing → «Yakunlash» bilan PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {step === "capture" ? (
            <div className="space-y-3">
              <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-black sm:aspect-video">
                {camError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/90">
                    <p>{camError}</p>
                    <p className="text-xs text-white/60">Rasm yuklashdan foydalaning</p>
                  </div>
                ) : (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="h-full w-full object-cover"
                  />
                )}
                <div className="pointer-events-none absolute inset-[10%] rounded-sm border-2 border-teal-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
                {pages.length > 0 ? (
                  <div className="absolute left-2 top-2 rounded-md bg-teal-600/90 px-2 py-1 text-xs font-semibold text-white">
                    {pages.length} ta tayyor
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-center gap-4">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-12 w-12 rounded-full"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  title="Galereya"
                >
                  <FileUp className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  className="h-16 w-16 rounded-full bg-white text-slate-900 shadow-lg hover:bg-slate-100"
                  onClick={captureFrame}
                  disabled={!!camError}
                  title="Suratga olish"
                >
                  <Camera className="h-7 w-7" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="relative h-12 w-12 rounded-full"
                  disabled={!pages.length}
                  onClick={() => setStep("pages")}
                  title="Sahifalar"
                >
                  <Layers className="h-5 w-5" />
                  {pages.length ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] text-white">
                      {pages.length}
                    </span>
                  ) : null}
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={onPickFile}
              />

              {pages.length > 0 ? (
                <Button
                  type="button"
                  className="w-full bg-teal-700 hover:bg-teal-800"
                  onClick={() => setStep("pages")}
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  Yakunlash ({pages.length} sahifa → PDF)
                </Button>
              ) : (
                <p className="text-center text-[11px] text-muted-foreground">
                  Hujjatni ramkaga joylashtiring va markaziy tugmani bosing
                </p>
              )}
            </div>
          ) : null}

          {step === "crop" && sourceUrl ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Faqat listni belgilang — oq nuqtalarni sudrang (burchak va yonlar). Keyin skaner.
              </p>
              <div className="relative mx-auto max-h-[52vh] w-full overflow-hidden rounded-lg bg-black">
                <img src={sourceUrl} alt="scan" className="block h-auto w-full select-none" draggable={false} />
                <canvas
                  ref={overlayRef}
                  className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["bw", "Skaner"],
                    ["gray", "Kulrang"],
                    ["color", "Rangli"],
                  ] as const
                ).map(([k, label]) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={mode === k ? "default" : "outline"}
                    onClick={() => setMode(k)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    sourceData && setCorners(defaultCorners(sourceData.width, sourceData.height))
                  }
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => sourceData && setCorners(detectDocumentCorners(sourceData))}
                >
                  Avto
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant="outline" onClick={() => setStep("capture")}>
                  <X className="mr-1 h-4 w-4" />
                  Bekor
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void confirmPage("continue")}
                >
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                  + Sahifa
                </Button>
                <Button
                  type="button"
                  className="bg-teal-700 hover:bg-teal-800"
                  disabled={busy}
                  onClick={() => void confirmPage("pages")}
                >
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                  Qo‘shish
                </Button>
              </div>
            </div>
          ) : null}

          {step === "pages" ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Barcha sahifalar tayyor. Kerak bo‘lsa yana qo‘shing yoki «Yakunlash» bilan PDF yarating.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {previewUrls.map((url, i) => (
                  <div
                    key={i}
                    className="group relative overflow-hidden rounded-md border bg-white shadow-sm ring-1 ring-black/5"
                  >
                    <img
                      src={url}
                      alt={`Sahifa ${i + 1}`}
                      className="aspect-[210/297] w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-1.5 py-1 text-[10px] text-white">
                      <span>#{i + 1}</span>
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-white/20"
                        onClick={() => removePage(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setStep("capture")}
                  className="flex aspect-[210/297] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-teal-400/60 bg-teal-50/40 text-teal-800 transition hover:bg-teal-50 dark:bg-teal-950/20 dark:text-teal-300"
                >
                  <Plus className="h-6 w-6" />
                  <span className="text-xs font-medium">Yana sahifa</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {step === "pages" ? (
          <div className="shrink-0 space-y-2 border-t bg-muted/40 px-4 py-3">
            <Button
              type="button"
              className="w-full bg-teal-700 hover:bg-teal-800"
              disabled={!pages.length || saving}
              onClick={() => void finishSave()}
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              Yakunlash — PDF yaratish ({pages.length} sahifa)
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={!pages.length || saving}
                onClick={() => void shareTg()}
              >
                <Send className="mr-1.5 h-4 w-4" />
                Telegram
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={!pages.length || saving}
                onClick={() => void downloadOnly()}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Yuklash
              </Button>
            </div>
            <p className={cn("text-[11px] text-muted-foreground")}>
              {standalone || !onComplete
                ? "PDF A4 formatida yaratiladi."
                : "PDF xodim hujjatiga saqlanadi."}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export async function uploadPdfBlob(
  blob: Blob,
  filename: string,
): Promise<{ url: string; size: number }> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/pdf",
      "X-File-Name": encodeURIComponent(filename),
    },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Yuklash ${res.status}`);
  return { url: (body as { url: string }).url, size: (body as { size?: number }).size || blob.size };
}
