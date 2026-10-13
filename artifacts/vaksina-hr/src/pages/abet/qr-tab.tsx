import { useEffect, useState } from "react";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadDataUrl, qrPngDataUrl } from "@/lib/qr-render";
import { useAbetQr, useRotateAbetQr } from "@/lib/abet-api";

function posterHtml(png: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Abet QR</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; color: #0f172a; }
  .wrap { border: 3px solid #0f766e; border-radius: 22px; padding: 28px 24px; text-align: center; min-height: 260mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
  h1 { font-size: 46px; margin: 0; color: #0f766e; letter-spacing: .5px; }
  h2 { font-size: 22px; margin: 0; font-weight: 500; color: #334155; }
  img { width: 120mm; height: 120mm; image-rendering: pixelated; }
  .time { display: inline-block; background: #f97316; color: #fff; font-weight: 700; font-size: 26px; padding: 8px 22px; border-radius: 999px; }
  ol { text-align: left; font-size: 18px; line-height: 1.6; margin: 6px 0 0; color: #334155; }
  .foot { font-size: 13px; color: #64748b; margin-top: 8px; }
</style></head><body>
<div class="wrap">
  <h1>🍽 ABETNI BAHOLANG</h1>
  <h2>Fikringiz oshxonamizni yanada yaxshilashga yordam beradi</h2>
  <img src="${png}" alt="QR" />
  <div class="time">Har kuni 12:30 – 15:00</div>
  <ol>
    <li>VAKSINA HR ilovasida <b>«Abet»</b> bo‘limini oching</li>
    <li><b>«QR kodni skaner qilish»</b> tugmasini bosing yoki telefon kamerasi bilan skaner qiling</li>
    <li>Bugungi taomlarga yulduzcha qo‘yib, fikringizni yozing</li>
  </ol>
  <div class="foot">Faqat o‘sha kungi abet baholanadi · VAKSINA HR</div>
</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
}

export function QrTab() {
  const { toast } = useToast();
  const qr = useAbetQr(true);
  const rotate = useRotateAbetQr();
  const [png, setPng] = useState<string | null>(null);

  useEffect(() => {
    if (!qr.data?.url) return;
    let alive = true;
    void qrPngDataUrl(qr.data.url, 720).then((u) => alive && setPng(u));
    return () => {
      alive = false;
    };
  }, [qr.data?.url]);

  const print = () => {
    if (!png) return;
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      toast({ title: "Oyna ochilmadi", description: "Brauzerda qalqib chiquvchi oynalarga ruxsat bering", variant: "destructive" });
      return;
    }
    w.document.open();
    w.document.write(posterHtml(png));
    w.document.close();
  };

  const onRotate = async () => {
    if (!window.confirm("Yangi QR yaratilsa, oshxonadagi eski QR ishlamay qoladi va yangisini chop etib yopishtirish kerak bo‘ladi. Davom etasizmi?")) return;
    try {
      await rotate.mutateAsync();
      toast({ title: "Yangi QR yaratildi", description: "Endi uni chop etib oshxonaga yopishtiring" });
    } catch (e) {
      toast({ title: "QR", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (qr.isLoading) return <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-slate-400" />;
  if (qr.error || !qr.data) return <p className="text-sm text-red-600">{(qr.error as Error)?.message ?? "QR yuklanmadi"}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border-2 border-teal-600 bg-white p-5 text-center shadow-sm">
        <p className="text-xl font-bold tracking-wide text-teal-700">🍽 ABETNI BAHOLANG</p>
        {png ? <img src={png} alt="Abet QR" className="mx-auto my-3 w-full max-w-[300px]" /> : <Loader2 className="mx-auto my-24 h-6 w-6 animate-spin" />}
        <span className="inline-block rounded-full bg-orange-500 px-4 py-1 text-sm font-bold text-white">Har kuni 12:30 – 15:00</span>
      </div>
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/80">
          <p className="mb-2 font-semibold text-slate-900 dark:text-white">Qanday ishlaydi</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Ushbu QR kodni chop etib, oshxonaga ko‘rinadigan joyga yopishtiring.</li>
            <li>Xodim ilovadagi «QR kodni skaner qilish» tugmasi yoki telefon kamerasi orqali skaner qiladi.</li>
            <li>QR bitta va doimiy — har kuni faqat o‘sha kungi abet, 12:30 dan 15:00 gacha baholanadi.</li>
            <li>Tahlilda har bir bahoning manbai (QR yoki ilova) ko‘rsatiladi.</li>
          </ul>
          <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500 dark:bg-white/5">{qr.data.url}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={print} disabled={!png} className="bg-teal-600 hover:bg-teal-700">
            <Printer className="mr-2 h-4 w-4" /> Chop etish (A4 plakat)
          </Button>
          <Button variant="outline" onClick={() => png && downloadDataUrl(png, "abet-qr.png")} disabled={!png}>
            <Download className="mr-2 h-4 w-4" /> PNG yuklab olish
          </Button>
          <Button variant="ghost" onClick={() => void onRotate()} disabled={rotate.isPending} className="text-red-600 hover:text-red-700">
            {rotate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Yangi QR yaratish
          </Button>
        </div>
      </div>
    </div>
  );
}
