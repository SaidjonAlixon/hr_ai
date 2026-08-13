import React, { useCallback, useEffect, useState } from "react";
import { ScanFace, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  enrollFace,
  fetchFaceIdStatus,
  isFaceIdSupported,
  removeFaceId,
} from "@/lib/face-id";
import { FaceScanDialog } from "@/components/FaceScanDialog";
import { cn } from "@/lib/utils";

export function FaceIdEnroll({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const supported = isFaceIdSupported();
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFaceIdStatus()
      .then((s) => {
        if (!cancelled) setRegistered(s.registered);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCaptured = useCallback(
    async (descriptor: number[]) => {
      await enrollFace(descriptor);
      setRegistered(true);
      toast({
        title: "Face ID ulandi",
        description: "Keyingi safar faqat yuzingiz bilan kirasiz",
      });
    },
    [toast],
  );

  const onRemove = async () => {
    if (!window.confirm("Face ID ni o‘chirasizmi? Keyin login/parol bilan kirasiz.")) return;
    setLoading(true);
    try {
      await removeFaceId();
      setRegistered(false);
      toast({ title: "Face ID o‘chirildi" });
    } catch (err) {
      toast({
        title: "O‘chirilmadi",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;
  if (!supported && !registered) return null;

  return (
    <>
      <FaceScanDialog open={scanOpen} onOpenChange={setScanOpen} mode="enroll" onCaptured={onCaptured} />
      {compact ? (
        <div className="mt-2 space-y-1">
          <button
            type="button"
            onClick={() => (registered ? void onRemove() : setScanOpen(true))}
            disabled={loading}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors",
              registered
                ? "text-emerald-300 hover:bg-white/10"
                : "text-sidebar-foreground/80 hover:bg-white/10 hover:text-white",
            )}
            title={registered ? "Face ID o‘chirish" : "Face ID ulash"}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanFace className="h-3.5 w-3.5" />}
            <span className="truncate">{registered ? "Face ID ulangan" : "Face ID ni ulash"}</span>
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ScanFace className="h-4 w-4 text-[#0b3a5c]" />
                Face ID
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Kameraga qarang — yuzingiz bazaga saqlanadi. Keyin faqat yuz bilan kirasiz,
                parol so‘ralmaydi.
              </p>
            </div>
            {registered ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                <CheckCircle2 className="h-3 w-3" /> Ulangan
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={loading || !supported} onClick={() => setScanOpen(true)}>
              <ScanFace className="mr-1.5 h-3.5 w-3.5" />
              {registered ? "Qayta ulash" : "Face ID ni ulash"}
            </Button>
            {registered ? (
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void onRemove()}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                O‘chirish
              </Button>
            ) : null}
          </div>
          {!supported ? (
            <p className="mt-2 text-[11px] text-amber-700">
              Face ID uchun kamera va localhost/HTTPS kerak.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
