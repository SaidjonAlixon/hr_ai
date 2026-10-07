import { useState } from "react";
import { useParams } from "wouter";
import { CheckCircle2, Eye, FileDown, FileSignature, Hourglass, Loader2, XCircle } from "lucide-react";
import {
  downloadVerifiedPdf,
  fmtLetterDate,
  fmtLetterStamp,
  letterVerifyPdfUrl,
  useLetterVerify,
} from "@/lib/explanation-letters-api";

/** QR orqali ochiladigan ochiq sahifa — tushuntirish xati haqiqiyligi va imzolangan nusxasi */
export default function TxVerifyPage() {
  const { token = "" } = useParams<{ token: string }>();
  const q = useLetterVerify(token);
  const d = q.data;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const download = async () => {
    if (!d) return;
    setBusy(true);
    setErr(null);
    try {
      await downloadVerifiedPdf(token, d.fullName || "xodim", d.eventDate || "");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-start justify-center bg-gradient-to-b from-slate-100 to-white px-3 py-6 sm:items-center sm:px-4 sm:py-10 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-center gap-3 bg-[#0b3a5c] px-5 py-4 text-white">
          <FileSignature className="h-6 w-6" />
          <div>
            <p className="text-sm font-bold">VAKSINA HR · Hujjat tekshiruvi</p>
            <p className="text-[11px] text-white/70">«VAKSINA HEALTHCARE» MChJ</p>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {q.isLoading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Tekshirilmoqda…
            </p>
          ) : q.isError || !d ? (
            <Verdict icon={XCircle} tone="text-red-600 bg-red-50 dark:bg-red-500/10" title="Tekshirib bo‘lmadi" text={(q.error as Error | null)?.message || "Keyinroq qayta urinib ko‘ring."} />
          ) : !d.letterNo ? (
            <Verdict icon={XCircle} tone="text-red-600 bg-red-50 dark:bg-red-500/10" title="Hujjat topilmadi" text="Bu QR kod platformada ro‘yxatdan o‘tgan tushuntirish xatiga tegishli emas." />
          ) : (
            <>
              {d.valid ? (
                <Verdict
                  icon={CheckCircle2}
                  tone="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10"
                  title="Hujjat haqiqiy"
                  text="Tushuntirish xati VAKSINA HR platformasida xodim tomonidan elektron imzolangan."
                />
              ) : (
                <Verdict
                  icon={Hourglass}
                  tone="text-amber-600 bg-amber-50 dark:bg-amber-500/10"
                  title="Imzolanmagan"
                  text="Xat tasdiqlangan, lekin xodim hali imzo qo‘ymagan."
                />
              )}
              {d.isTest ? (
                <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-center text-xs font-semibold text-violet-800 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-500/30">
                  Bu test hujjat — admin tomonidan tekshiruv uchun yaratilgan.
                </p>
              ) : null}
              <dl className="mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-200 text-sm dark:divide-white/5 dark:border-white/10">
                <Row k="Hujjat №" v={d.letterNo} />
                <Row k="Turi" v={`Tushuntirish xati · ${d.kind === "late" ? "ishga kechikish" : "ishga kelmaslik"}`} />
                <Row k="Xodim" v={d.fullName || "—"} />
                <Row k="Lavozim" v={d.position || "—"} />
                <Row k="Filial" v={d.branch || "—"} />
                <Row k="Holat sanasi" v={d.eventDate ? fmtLetterDate(d.eventDate) : "—"} />
                {d.kind === "late" && d.lateMinutes ? <Row k="Kechikish" v={`${d.lateMinutes} daqiqa`} /> : null}
                {d.strikeN ? <Row k="Qoidabuzarlik" v={`Oy davomida ${d.strikeN}-marta${d.final ? " · oxirgi ogohlantirish" : ""}`} /> : null}
                {d.reviewStatus ? <Row k="Rahbariyat qarori" v={d.reviewStatus === "approved" ? "Tasdiqlangan" : "Bekor qilingan"} /> : null}
                <Row k="Imzolangan" v={d.signedAt ? `${fmtLetterStamp(d.signedAt)} (Toshkent)` : "—"} />
              </dl>
              {d.pdf ? (
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <a
                    href={letterVerifyPdfUrl(token)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                  >
                    <Eye className="h-4 w-4" /> Ko‘rish
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void download()}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#0b3a5c] text-sm font-bold text-white hover:bg-[#0b3a5c]/90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                    PDF yuklab olish
                  </button>
                </div>
              ) : null}
              {err ? <p className="mt-2 text-center text-xs text-red-600">{err}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Verdict({ icon: Icon, tone, title, text }: { icon: typeof CheckCircle2; tone: string; title: string; text: string }) {
  return (
    <div className="text-center">
      <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${tone}`}>
        <Icon className="h-9 w-9" />
      </span>
      <h1 className="mt-3 text-xl font-extrabold text-slate-900 dark:text-white">{title}</h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="text-right font-semibold text-slate-800 dark:text-slate-100">{v}</dd>
    </div>
  );
}
