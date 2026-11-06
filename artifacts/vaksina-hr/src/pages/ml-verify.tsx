import { useParams } from "wouter";
import { CheckCircle2, FileBadge2, FileDown, Loader2, XCircle } from "lucide-react";
import { useMalumotnomaVerify } from "@/lib/malumotnoma-api";
import { useState } from "react";

export default function MlVerifyPage() {
  const { token = "" } = useParams<{ token: string }>();
  const q = useMalumotnomaVerify(token);
  const d = q.data;
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!d?.pdfUrl) return;
    setBusy(true);
    try {
      const res = await fetch(`${d.pdfUrl}?download=1`);
      if (!res.ok) throw new Error("PDF yuklanmadi");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Malumotnoma_${d.docNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-start justify-center bg-gradient-to-b from-violet-50 to-white px-3 py-6 sm:items-center dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-center gap-3 bg-[#4A1C6A] px-5 py-4 text-white">
          <FileBadge2 className="h-6 w-6 text-amber-300" />
          <div>
            <p className="text-sm font-bold">VAKSINA MED · Ma’lumotnoma</p>
            <p className="text-[11px] text-white/70">Hujjat haqiqiyligini tekshirish</p>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          {q.isLoading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Tekshirilmoqda…
            </p>
          ) : q.isError || !d ? (
            <div className="rounded-2xl bg-red-50 px-4 py-6 text-center dark:bg-red-500/10">
              <XCircle className="mx-auto h-8 w-8 text-red-600" />
              <p className="mt-2 font-semibold text-red-700">Hujjat topilmadi</p>
              <p className="mt-1 text-xs text-red-600/80">Bu QR kod platformadagi ma’lumotnomaga tegishli emas.</p>
            </div>
          ) : d.cancelled || !d.valid ? (
            <>
              <div className="rounded-2xl bg-amber-50 px-4 py-5 text-center dark:bg-amber-500/10">
                <XCircle className="mx-auto h-8 w-8 text-amber-600" />
                <p className="mt-2 font-semibold text-amber-800 dark:text-amber-200">Hujjat bekor qilingan</p>
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/70">
                  Bu ma’lumotnoma admin tomonidan bekor qilingan — haqiqiy emas.
                </p>
              </div>
              <dl className="mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-200 text-sm dark:divide-white/5 dark:border-white/10">
                <Row k="Hujjat №" v={d.docNo} />
                <Row k="Xodim" v={d.fullName} />
                <Row k="Lavozim" v={d.position} />
                <Row k="Holat" v="Bekor qilingan" />
              </dl>
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-emerald-50 px-4 py-5 text-center dark:bg-emerald-500/10">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                <p className="mt-2 font-semibold text-emerald-800 dark:text-emerald-300">Hujjat haqiqiy</p>
                <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-200/70">
                  Ma’lumotnoma VAKSINA HR da rasmiy yaratilgan.
                </p>
              </div>
              <dl className="mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-200 text-sm dark:divide-white/5 dark:border-white/10">
                <Row k="Hujjat №" v={d.docNo} />
                <Row k="Xodim" v={d.fullName} />
                <Row k="Lavozim" v={d.position} />
                <Row k="Filial" v={d.branch} />
                <Row k="Smena" v={`${d.shiftLabel} · ${d.workStart}–${d.workEnd}`} />
                <Row k="Kompaniya" v={d.companyName} />
                <Row k="Berilgan" v={d.issuedAtLabel} />
              </dl>
              <button
                type="button"
                onClick={download}
                disabled={busy}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#4A1C6A] text-sm font-semibold text-white hover:bg-[#3a1554] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                PDF yuklab olish
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-900 dark:text-white">{v || "—"}</dd>
    </div>
  );
}
