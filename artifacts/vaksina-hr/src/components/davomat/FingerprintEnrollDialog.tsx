import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Fingerprint, Loader2, Lock, Smartphone, UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DavomatApiError,
  enrollFingerprint,
  fingerprintSupported,
  type FingerprintEnrollResult,
} from "@/lib/davomat-api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnrolled: (status: FingerprintEnrollResult) => void;
  isTgMiniApp?: boolean;
};

const RULES = [
  { icon: UserCheck, text: "Bitta akkauntga faqat bitta barmoq izi biriktiriladi — faqat sizniki." },
  { icon: Smartphone, text: "Faqat shu qurilmada ishlaydi. Boshqa telefon yoki kompyuterda ochilmaydi." },
  { icon: Lock, text: "Bu qurilma boshqa xodimga biriktirilmaydi, sizning barmoq izingiz boshqa akkauntni ochmaydi." },
  { icon: AlertTriangle, text: "Qayta ro‘yxatdan o‘tish yoki telefon almashtirish — faqat admin orqali." },
];

export function FingerprintEnrollDialog({ open, onOpenChange, onEnrolled, isTgMiniApp }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanner, setScanner] = useState<"checking" | "yes" | "no">("checking");
  const supported = fingerprintSupported();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!supported) {
      setScanner("no");
      return;
    }
    setScanner("checking");
    void PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then((ok) => setScanner(ok ? "yes" : "no"))
      .catch(() => setScanner("no"));
  }, [open, supported]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await enrollFingerprint();
      onEnrolled(status);
    } catch (err) {
      setError(err instanceof DavomatApiError || err instanceof Error ? err.message : "Xato — qayta urinib ko‘ring");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600">
            <Fingerprint className="h-8 w-8" />
          </div>
          <DialogTitle className="text-center">Barmoq izini ro‘yxatdan o‘tkazish</DialogTitle>
          <DialogDescription className="text-center">
            Bir marta ro‘yxatdan o‘tkazasiz — shu tasdiq bilan darhol Keldim/Ketdim qilasiz, keyingi safar esa barmoq
            izi bilan tasdiqlaysiz.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {RULES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-2.5 rounded-xl bg-muted/60 px-3 py-2 text-xs leading-relaxed text-foreground">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        {!supported ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800">
            {isTgMiniApp
              ? "Telegram ichida barmoq izi ishlamaydi. Saytni Chrome yoki Safari brauzerida oching."
              : "Bu brauzer barmoq izini qo‘llamaydi. Saytni Chrome yoki Safari brauzerida oching."}
          </p>
        ) : scanner === "no" ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            Bu qurilmada barmoq izi skaneri topilmadi. Telefon sozlamalarida barmoq izini yoqing yoki USB barmoq
            izi skaneri ulangan kompyuterdan foydalaning.
          </p>
        ) : (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
            Muhim: telefoningiz sozlamalarida faqat o‘zingizning barmoq izingiz saqlangan bo‘lsin. Ro‘yxatdan o‘tishda
            ekran qulfi (PIN) emas, barmog‘ingizni skanerga qo‘ying.
          </p>
        )}

        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium leading-relaxed text-rose-800">
            {error}
          </p>
        ) : null}

        <Button
          type="button"
          className={cn("h-12 w-full gap-2 text-base font-semibold", "bg-emerald-600 text-white hover:bg-emerald-700")}
          disabled={busy || !supported || scanner === "checking"}
          onClick={() => void start()}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" />}
          {busy ? "Barmog‘ingizni skanerga qo‘ying…" : "Ro‘yxatdan o‘tkazish"}
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Barmoq izi rasmi serverga yuborilmaydi — qurilmaning o‘zida tekshiriladi.
        </p>
      </DialogContent>
    </Dialog>
  );
}
