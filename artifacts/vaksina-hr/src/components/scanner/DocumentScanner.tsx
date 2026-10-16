import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  Download,
  Eye,
  FileUp,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
  ScanLine,
  Layers,
  Wand2,
  Sparkles,
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
import { formatExpiresIn, saveScannerDoc, type ScannerDoc } from "@/lib/scanner-docs-api";
import {
  type Point,
  type ScanMode,
  A4_HEIGHT,
  A4_WIDTH,
  applyHandleDrag,
  cornersToHandles,
  defaultCorners,
  detectDocumentCorners,
  autoFitPage,
  enhanceDocument,
  imageDataToCanvas,
  imageToImageData,
  loadImageFromFile,
  orderCorners,
  pagesToPdfBlob,
  warpPreview,
  warpToA4,
} from "@/lib/document-scan";

type Step = "capture" | "crop" | "pages" | "view";

export type DocumentScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (blob: Blob, filename: string) => void | Promise<void>;
  title?: string;
  defaultFileName?: string;
  standalone?: boolean;
};

/** Ekran koordinatasini rasm pikseliga — object-contain letterbox hisobga oladi */
function clientToImagePoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  imgW: number,
  imgH: number,
): Point {
  const scale = Math.min(rect.width / imgW, rect.height / imgH);
  const dispW = imgW * scale;
  const dispH = imgH * scale;
  const ox = rect.left + (rect.width - dispW) / 2;
  const oy = rect.top + (rect.height - dispH) / 2;
  return {
    x: Math.max(0, Math.min(imgW - 1, ((clientX - ox) / dispW) * imgW)),
    y: Math.max(0, Math.min(imgH - 1, ((clientY - oy) / dispH) * imgH)),
  };
}

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
  const cropBoxRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>("capture");
  const [busy, setBusy] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [sourceData, setSourceData] = useState<ImageData | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Rangli pechat/muhur/imzo saqlanadi (yumshoq skaner)
  const [mode, setMode] = useState<ScanMode>("color");
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [savedDoc, setSavedDoc] = useState<ScannerDoc | null>(null);

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
      setLivePreview(null);
      setViewIdx(null);
      setSavedDoc(null);
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
    setLivePreview(null);
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

  // Overlay chizish — rasm o‘lchami bilan bir xil canvas
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
    const lw = Math.max(3, canvas.width / 280);

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(ordered[0]!.x, ordered[0]!.y);
    for (let i = 1; i < 4; i++) ctx.lineTo(ordered[i]!.x, ordered[i]!.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(ordered[0]!.x, ordered[0]!.y);
    for (let i = 1; i < 4; i++) ctx.lineTo(ordered[i]!.x, ordered[i]!.y);
    ctx.closePath();
    ctx.stroke();

    const arm = Math.max(28, canvas.width / 24);
    ctx.lineWidth = lw * 1.8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#4ade80";
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

    handles.forEach((p, i) => {
      const corner = i % 2 === 0;
      const r = corner ? Math.max(14, canvas.width / 70) : Math.max(10, canvas.width / 95);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = corner ? "#16a34a" : "#22c55e";
      ctx.lineWidth = 3;
      ctx.stroke();
      if (corner) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = "#16a34a";
        ctx.fill();
      }
    });
  }, [step, sourceData, corners]);

  // Live preview (kichik) — burchak o‘zgarganda
  useEffect(() => {
    if (step !== "crop" || !sourceData || corners.length !== 4 || dragIdx != null) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      try {
        const warped = warpPreview(sourceData, corners, 360);
        const fitted = autoFitPage(warped);
        const enhanced = enhanceDocument(fitted, mode);
        const c = imageDataToCanvas(enhanced);
        if (!cancelled) setLivePreview(c.toDataURL("image/jpeg", 0.85));
      } catch {
        /* ignore preview errors */
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [step, sourceData, corners, mode, dragIdx]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceData) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const p = clientToImagePoint(e.clientX, e.clientY, rect, sourceData.width, sourceData.height);
    const scale = Math.min(rect.width / sourceData.width, rect.height / sourceData.height);
    // Ekranda ~34px — oldingi katta threshold noto‘g‘ri tutqichni ushlar edi
    const thresh = Math.max(22, 34 / Math.max(scale, 0.05));
    const handles = cornersToHandles(corners);
    let best = -1;
    let bestD = Infinity;
    handles.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      // Burchak tutqichlariga biroz ustunlik
      const bias = i % 2 === 0 ? 0.85 : 1;
      const scored = d * bias;
      if (scored < bestD) {
        bestD = scored;
        best = i;
      }
    });
    if (best >= 0 && bestD < thresh) {
      setDragIdx(best);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragIdx == null || !sourceData) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const p = clientToImagePoint(e.clientX, e.clientY, rect, sourceData.width, sourceData.height);
    setCorners(
      applyHandleDrag(corners, dragIdx, p, {
        w: sourceData.width,
        h: sourceData.height,
      }),
    );
  };

  const onPointerUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    setDragIdx(null);
  };

  const confirmPage = async (then: "continue" | "pages") => {
    if (!sourceData || corners.length !== 4) return;
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 16));
      const warped = warpToA4(sourceData, corners, A4_WIDTH, A4_HEIGHT);
      const fitted = autoFitPage(warped, A4_WIDTH, A4_HEIGHT);
      const enhanced = enhanceDocument(fitted, mode);
      const canvas = imageDataToCanvas(enhanced);
      const url = canvas.toDataURL("image/jpeg", 0.92);
      setPages((p) => [...p, canvas]);
      setPreviewUrls((u) => [...u, url]);
      setSourceData(null);
      setSourceUrl(null);
      setLivePreview(null);
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
    setPages((p) => {
      const next = p.filter((_, i) => i !== idx);
      if (step === "view" && viewIdx === idx) {
        setStep(next.length ? "pages" : "capture");
        setViewIdx(null);
      } else if (!next.length && (step === "pages" || step === "view")) {
        setStep("capture");
        setViewIdx(null);
      }
      return next;
    });
    setPreviewUrls((u) => u.filter((_, i) => i !== idx));
    setViewIdx((cur) => {
      if (cur == null) return null;
      if (cur === idx) return null;
      if (cur > idx) return cur - 1;
      return cur;
    });
  };

  const openPageView = (idx: number) => {
    setViewIdx(idx);
    setStep("view");
  };

  const retakePage = (idx: number) => {
    removePage(idx);
    setViewIdx(null);
    setSourceData(null);
    setSourceUrl(null);
    setLivePreview(null);
    setStep("capture");
    toast({ title: "Sahifa o‘chirildi", description: "Yangi listni skaner qiling" });
  };

  const discardCrop = () => {
    setSourceData(null);
    setSourceUrl(null);
    setLivePreview(null);
    setStep(pages.length > 0 ? "pages" : "capture");
  };

  const buildPdf = async () => {
    if (!pages.length) {
      toast({ title: "Kamida 1 sahifa skaner qiling", variant: "destructive" });
      return null;
    }
    return pagesToPdfBlob(pages, defaultFileName);
  };

  /** PDF yaratish + 1 soat saqlash + TX bo‘limiga yuborish */
  const persistPdf = async (): Promise<{
    blob: Blob;
    filename: string;
    doc: ScannerDoc | null;
  } | null> => {
    const result = await buildPdf();
    if (!result) return null;
    if (savedDoc && savedDoc.expiresInSec > 60) {
      return { blob: result.blob, filename: result.filename, doc: savedDoc };
    }
    try {
      const doc = await saveScannerDoc(result.blob, result.filename, pages.length);
      setSavedDoc(doc);
      return { blob: result.blob, filename: result.filename, doc };
    } catch {
      return { blob: result.blob, filename: result.filename, doc: null };
    }
  };

  const finishSave = async () => {
    setSaving(true);
    try {
      const persisted = await persistPdf();
      if (!persisted) return;
      if (onComplete) await onComplete(persisted.blob, persisted.filename);
      else {
        await deliverFile(persisted.blob, persisted.filename);
      }
      toast({
        title: persisted.doc?.sentToTx
          ? "PDF tayyor · TX bo‘limiga yuborildi"
          : "PDF tayyor",
        description: persisted.doc
          ? `Yuklash/Telegram: ${formatExpiresIn(persisted.doc.expiresInSec)} (keyin o‘chadi)`
          : "Mahalliy yetkazildi",
      });
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
      const persisted = await persistPdf();
      if (!persisted) return;
      const r = await deliverFile(persisted.blob, persisted.filename);
      toast({
        title: r.via === "telegram" ? "Telegramga yuborildi" : "Yuklab olindi",
        description: persisted.doc
          ? `Serverda yana ${formatExpiresIn(persisted.doc.expiresInSec)}`
          : undefined,
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
      const persisted = await persistPdf();
      if (!persisted) return;
      const url = URL.createObjectURL(persisted.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = persisted.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "PDF yuklab olindi",
        description: persisted.doc
          ? `Serverda yana ${formatExpiresIn(persisted.doc.expiresInSec)}`
          : undefined,
      });
    } catch (err: any) {
      toast({ title: err?.message || "Yuklash xatosi", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const cropAspect = sourceData
    ? `${sourceData.width} / ${sourceData.height}`
    : "3 / 4";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[96vh] w-[min(100vw-0.5rem,720px)] flex-col gap-0 overflow-hidden border-0 bg-zinc-950 p-0 text-zinc-50 sm:max-w-[720px] sm:border sm:border-zinc-800 [&>button]:rounded-full [&>button]:text-zinc-300 [&>button]:hover:bg-zinc-800 [&>button]:hover:text-white"
        onPointerDownOutside={(e) => {
          if (step === "crop" && dragIdx != null) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (step === "crop") e.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-zinc-800 px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-50">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <ScanLine className="h-4 w-4" />
            </span>
            {title}
            {pages.length > 0 ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                <Layers className="h-3 w-3" />
                {pages.length} sahifa
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            {step === "capture" && "Listni ramkaga joylashtiring — faqat qog‘oz skaner qilinadi."}
            {step === "crop" &&
              "Yashil ramkani list chetiga torting. Pechat/muhur/imzo ranglari saqlanadi."}
            {step === "pages" &&
              "Sahifani oching · PDF 1 soat saqlanadi · TX bo‘limiga ham yuboriladi."}
            {step === "view" &&
              viewIdx != null &&
              `Sahifa ${viewIdx + 1} — ko‘rib chiqing, keyin davom eting yoki qayta oling.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {step === "capture" ? (
            <div className="space-y-4">
              <div className="relative mx-auto aspect-[3/4] max-h-[58vh] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-zinc-800 sm:aspect-video sm:max-h-[50vh]">
                {camError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-zinc-300">
                    <p>{camError}</p>
                    <p className="text-xs text-zinc-500">Galereyadan rasm yuklang</p>
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
                <div className="pointer-events-none absolute inset-[8%] rounded-md border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8 text-center text-[11px] font-medium text-emerald-100/90">
                  Faqat oq listni ramka ichiga oling
                </div>
                {pages.length > 0 ? (
                  <div className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white shadow">
                    {pages.length} ta tayyor
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-center gap-5">
                <button
                  type="button"
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  title="Galereya"
                >
                  <FileUp className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_0_6px_rgba(16,185,129,0.25)] transition hover:bg-emerald-400 disabled:opacity-40"
                  onClick={captureFrame}
                  disabled={!!camError}
                  title="Suratga olish"
                >
                  <Camera className="h-8 w-8" />
                </button>
                <button
                  type="button"
                  className="relative flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
                  disabled={!pages.length}
                  onClick={() => setStep("pages")}
                  title="Sahifalar"
                >
                  <Layers className="h-5 w-5" />
                  {pages.length ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                      {pages.length}
                    </span>
                  ) : null}
                </button>
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
                  className="h-11 w-full rounded-xl bg-emerald-600 text-base font-semibold hover:bg-emerald-500"
                  onClick={() => setStep("pages")}
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  Yakunlash ({pages.length} sahifa → PDF)
                </Button>
              ) : null}
            </div>
          ) : null}

          {step === "crop" && sourceUrl && sourceData ? (
            <div className="space-y-3">
              <div className="flex justify-center">
                <div
                  ref={cropBoxRef}
                  className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-zinc-800"
                  style={{
                    aspectRatio: cropAspect,
                    width: `min(100%, calc(min(54vh, 560px) * ${sourceData.width} / ${sourceData.height}))`,
                  }}
                >
                  <img
                    src={sourceUrl}
                    alt="scan"
                    className="absolute inset-0 h-full w-full select-none"
                    draggable={false}
                  />
                  <canvas
                    ref={overlayRef}
                    className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  />
                </div>
              </div>

              <div className="flex items-stretch gap-2">
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {(
                    [
                      ["color", "Skaner", Sparkles],
                      ["bw", "Qora-oq", null],
                      ["gray", "Kulrang", null],
                    ] as const
                  ).map(([k, label, Icon]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setMode(k)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold transition",
                        mode === k
                          ? "bg-emerald-500 text-white"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700",
                      )}
                    >
                      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-1 rounded-full bg-zinc-800 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
                    onClick={() =>
                      sourceData && setCorners(detectDocumentCorners(sourceData))
                    }
                  >
                    <Wand2 className="h-3.5 w-3.5 text-emerald-400" />
                    Avto
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-1 rounded-full bg-zinc-800 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
                    onClick={() =>
                      sourceData &&
                      setCorners(defaultCorners(sourceData.width, sourceData.height))
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                </div>
                {livePreview ? (
                  <div className="hidden w-16 shrink-0 overflow-hidden rounded-lg border border-emerald-500/40 bg-white shadow sm:block">
                    <img
                      src={livePreview}
                      alt="preview"
                      className="aspect-[210/297] w-full object-cover"
                    />
                  </div>
                ) : null}
              </div>

              {livePreview ? (
                <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 sm:hidden">
                  <img
                    src={livePreview}
                    alt="preview"
                    className="h-20 w-14 rounded-md border border-zinc-700 object-cover"
                  />
                  <p className="text-[11px] leading-snug text-zinc-400">
                    Natija shunday. Muhur/imzo ranglari saqlanadi. Yashil nuqtalarni faqat list
                    chetiga torting.
                  </p>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-900 hover:text-white"
                  onClick={discardCrop}
                >
                  <X className="mr-1 h-4 w-4" />
                  Bekor
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-900 hover:text-white"
                  onClick={() => {
                    setSourceData(null);
                    setSourceUrl(null);
                    setLivePreview(null);
                    setStep("capture");
                  }}
                >
                  <Camera className="mr-1 h-4 w-4" />
                  Qayta ol
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  className="h-11 rounded-xl bg-zinc-100 font-semibold text-zinc-900 hover:bg-white"
                  onClick={() => void confirmPage("continue")}
                >
                  {busy ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1 h-4 w-4" />
                  )}
                  + Sahifa
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  className="h-11 rounded-xl bg-emerald-500 text-base font-semibold text-white hover:bg-emerald-400"
                  onClick={() => void confirmPage("pages")}
                >
                  {busy ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  Skaner
                </Button>
              </div>
            </div>
          ) : null}

          {step === "pages" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {previewUrls.map((url, i) => (
                  <div
                    key={i}
                    className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-white shadow-sm"
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => openPageView(i)}
                    >
                      <img
                        src={url}
                        alt={`Sahifa ${i + 1}`}
                        className="aspect-[210/297] w-full object-cover"
                      />
                    </button>
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1.5 pt-8 text-[11px] font-medium text-white">
                      <span>#{i + 1}</span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          className="rounded-md bg-white/15 p-1.5 hover:bg-emerald-500/90"
                          title="Ochib ko‘rish"
                          onClick={() => openPageView(i)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-white/15 p-1.5 hover:bg-amber-500/90"
                          title="Qayta olish"
                          onClick={() => retakePage(i)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-white/15 p-1.5 hover:bg-red-500/90"
                          title="O‘chirish"
                          onClick={() => {
                            removePage(i);
                            toast({ title: `Sahifa ${i + 1} o‘chirildi` });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setStep("capture")}
                  className="flex aspect-[210/297] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-500/50 bg-emerald-500/10 text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  <Plus className="h-7 w-7" />
                  <span className="text-xs font-semibold">Yana sahifa</span>
                </button>
              </div>
            </div>
          ) : null}

          {step === "view" && viewIdx != null && previewUrls[viewIdx] ? (
            <div className="space-y-3">
              <div className="relative mx-auto max-h-[58vh] overflow-auto rounded-2xl bg-white ring-1 ring-zinc-700">
                <img
                  src={previewUrls[viewIdx]}
                  alt={`Sahifa ${viewIdx + 1}`}
                  className="mx-auto h-auto w-full max-w-md object-contain"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-900 hover:text-white"
                  onClick={() => {
                    setViewIdx(null);
                    setStep("pages");
                  }}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Ro‘yxat
                </Button>
                <Button
                  type="button"
                  className="h-11 rounded-xl bg-zinc-100 font-semibold text-zinc-900 hover:bg-white"
                  onClick={() => setStep("capture")}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Davom etish
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-amber-600/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  onClick={() => retakePage(viewIdx)}
                >
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Qayta ol
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-red-600/40 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                  onClick={() => {
                    const n = viewIdx + 1;
                    removePage(viewIdx);
                    setViewIdx(null);
                    setStep("pages");
                    toast({ title: `Sahifa ${n} o‘chirildi` });
                  }}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  O‘chirish
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {step === "pages" || step === "view" ? (
          <div className="shrink-0 space-y-2 border-t border-zinc-800 bg-zinc-900/90 px-4 py-3">
            {step === "view" ? (
              <Button
                type="button"
                className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                onClick={() => {
                  setViewIdx(null);
                  setStep("pages");
                }}
              >
                <Layers className="mr-1.5 h-4 w-4" />
                Barcha sahifalar ({pages.length})
              </Button>
            ) : null}
            <Button
              type="button"
              className="h-12 w-full rounded-xl bg-emerald-500 text-base font-semibold hover:bg-emerald-400"
              disabled={!pages.length || saving}
              onClick={() => void finishSave()}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Yakunlash — PDF ({pages.length} sahifa)
            </Button>
            {step === "pages" ? (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="h-10 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                    disabled={!pages.length || saving}
                    onClick={() => void shareTg()}
                  >
                    <Send className="mr-1.5 h-4 w-4" />
                    Telegram
                  </Button>
                  <Button
                    type="button"
                    className="h-10 flex-1 rounded-xl border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800"
                    disabled={!pages.length || saving}
                    onClick={() => void downloadOnly()}
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    Yuklash
                  </Button>
                </div>
            <p className={cn("text-center text-[11px] text-zinc-500")}>
              {savedDoc
                ? `Saqlangan · ${formatExpiresIn(savedDoc.expiresInSec)} ichida TG/yuklash · ${
                    savedDoc.sentToTx ? "TX ga yuborilgan" : "TX kutilmoqda"
                  }`
                : standalone || !onComplete
                  ? "PDF 1 soat saqlanadi, keyin o‘chadi. Tushuntirish xatlari bo‘limiga ham yuboriladi."
                  : "PDF xodim hujjatiga va TX bo‘limiga yuboriladi (1 soat)."}
            </p>
              </>
            ) : null}
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
