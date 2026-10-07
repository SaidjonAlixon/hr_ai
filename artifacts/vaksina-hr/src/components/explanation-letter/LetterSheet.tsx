import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { stageTone, type LetterContent } from "@/lib/explanation-letters-api";

const SHEET_W = 794;
const SHEET_H = 1123;

type Props = {
  content: LetterContent;
  qrPng?: string | null;
  signaturePng?: string | null;
  /** Xodim yozayotgan sabab — tasdiqlashdan oldin varaqda jonli ko‘rinadi */
  reasonDraft?: string | null;
  highlightSignature?: boolean;
  className?: string;
};

/** A4 varaq — PDF bilan bir xil joylashuv, kenglikka moslab kichrayadi */
export function LetterSheet({ content: c, qrPng, signaturePng, reasonDraft, highlightSignature, className }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(SHEET_H);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const sheet = sheetRef.current;
    if (!outer || !sheet) return;
    const update = () => {
      setScale(Math.min(1, outer.clientWidth / SHEET_W));
      setHeight(sheet.offsetHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, []);

  const reason = c.reason ?? (reasonDraft?.trim() ? reasonDraft.trim() : null);
  const accent = c.final ? "#ad1220" : "#0b3a5c";

  return (
    <div ref={outerRef} className={cn("w-full", className)} style={{ height: height * scale }}>
      <div
        ref={sheetRef}
        className="relative origin-top-left overflow-hidden bg-white text-[#111827] shadow-[0_10px_40px_-12px_rgba(15,23,42,.35)] ring-1 ring-slate-200"
        style={{
          width: SHEET_W,
          minHeight: SHEET_H,
          transform: `scale(${scale})`,
          fontFamily: '"DejaVu Sans", "Segoe UI", Arial, sans-serif',
          padding: "52px 64px 30px 76px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[13px]" style={{ background: accent }} />

        <header className="flex items-start justify-between gap-6">
          <div className="w-[128px] shrink-0">
            {qrPng ? (
              <div className="inline-block border border-slate-200 p-1">
                <img src={qrPng} alt="Tekshiruv QR kodi" className="h-[96px] w-[96px]" />
              </div>
            ) : (
              <div className="flex h-[104px] w-[104px] items-center justify-center border border-dashed border-slate-300 px-2 text-center text-[10px] leading-tight text-slate-400">
                QR kod tasdiqlangandan keyin qo‘yiladi
              </div>
            )}
            <p className="mt-1.5 text-[9.5px] leading-tight text-slate-500">Haqiqiyligini tekshirish uchun QR kodni skanerlang</p>
            <p className="mt-2 text-[9px] text-slate-500">Hujjat raqami</p>
            <p className="text-[11.5px] font-bold" style={{ color: "#0b3a5c" }}>
              № {c.letterNo}
            </p>
          </div>

          <div className="w-[380px] text-[14.5px] leading-[1.45]">
            <div className="mb-1.5">
              {c.addressee.map((line, i) => (
                <p key={`${i}-${line}`} className="text-right text-[15px] font-bold">
                  {line}
                </p>
              ))}
            </div>
            <Field label="jamiyatning" value={c.sender.position} />
            <p className="mt-1">lavozimida faoliyat yurituvchi xodim</p>
            <Field value={c.sender.branch} />
            <Field value={c.sender.fullName} bold after="dan" />
            <Field label="Tel:" value={c.sender.phone || " "} />
          </div>
        </header>

        <div className="mt-5 space-y-[3px]">
          <div className="h-[1.5px]" style={{ background: accent }} />
          <div className="h-px" style={{ background: accent }} />
        </div>

        <h1
          className="mt-7 whitespace-pre text-center text-[20px] font-bold tracking-[0.12em]"
          style={{ color: c.final ? accent : "#0f172a" }}
        >
          {spaced(c.title)}
        </h1>
        <div className="mt-2 text-center">
          <span
            className={cn(
              "inline-block text-[11.5px] font-bold",
              c.final ? "rounded-sm bg-[#ad1220] px-3 py-1 text-white" : stageTone(c.stage).text,
            )}
          >
            {c.subtitle}
          </span>
        </div>
        <p className="mb-4 mt-1.5 text-center text-[11.5px]">
          <span className="text-slate-500">Belgilangan chora: </span>
          <b className={c.final ? "text-[#ad1220]" : "text-slate-900"}>{c.penalty}</b>
        </p>

        <div className="space-y-2.5 text-[14.5px] leading-[1.6]" style={{ textAlign: "justify", hyphens: "auto" }} lang="uz">
          <Para>{c.intro}</Para>
          <Para>{c.facts}</Para>
          {reason ? (
            <Para className={c.reason ? undefined : "rounded bg-amber-50 text-amber-900 ring-1 ring-amber-200"}>{reason}</Para>
          ) : (
            <div className="space-y-[18px] pb-1 pt-3" aria-label="Sabab uchun bo‘sh joy">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-px bg-slate-300" />
              ))}
            </div>
          )}
          <Para>{c.commitment}</Para>
          {c.finalConsent ? (
            <div className="my-1 border border-[#ad1220] bg-[#fef0f0] px-3 py-2.5" style={{ textAlign: "justify" }}>
              <p className="text-[11px] font-bold tracking-wide text-[#ad1220]">ISHDAN BO‘SHATISHGA ROZILIK</p>
              <p className="mt-1 text-[13.5px] font-bold leading-[1.5] text-[#ad1220]">{c.finalConsent}</p>
            </div>
          ) : null}
          {c.closing.map((p) => (
            <Para key={p}>{p}</Para>
          ))}
        </div>

        <div className="mt-auto pt-8">
          <StageStrip c={c} />
          <div className="mt-8 grid grid-cols-3 items-end gap-10 text-center text-[15px]">
            <FooterCol caption="(sana)">{c.footer.date}</FooterCol>
            <FooterCol caption="(imzo)" highlight={highlightSignature}>
              {signaturePng ? <img src={signaturePng} alt="Imzo" className="mx-auto -mb-2 h-[58px] max-w-full object-contain" /> : null}
            </FooterCol>
            <FooterCol caption="(F.I.Sh.)">{c.footer.signer}</FooterCol>
          </div>
          <div className="mt-6 border-t border-slate-200 pt-2 text-center text-[10px] text-slate-400">
            {c.footer.signedAt
              ? `Elektron imzolangan: ${c.footer.signedAt} (Toshkent vaqti) · Hujjat № ${c.letterNo} · VAKSINA HR platformasi`
              : `Hujjat № ${c.letterNo} · VAKSINA HR platformasi · imzolanmagan`}
          </div>
        </div>
      </div>
    </div>
  );
}

function StageStrip({ c }: { c: LetterContent }) {
  const next = stageTone(Math.min(6, c.stage + 1));
  return (
    <div>
      <p className="mb-1 text-[9.5px] font-bold tracking-wide text-slate-500">INTIZOMIY CHORALAR BOSQICHLARI (joriy oy davomida)</p>
      <div className="grid grid-cols-6 gap-1.5">
        {c.stages.map((s) => {
          const t = stageTone(s.n);
          const cur = s.n === c.stage;
          const past = s.n < c.stage;
          return (
            <div
              key={s.n}
              className={cn(
                "rounded-[3px] border px-1.5 py-1 leading-tight",
                cur ? cn(t.solid, "border-transparent") : past ? t.soft : "border-slate-200 text-slate-400",
              )}
            >
              <p className="text-[10px] font-bold">
                {s.n}-holat{cur ? " · SIZ" : ""}
              </p>
              <p className={cn("text-[9.5px] leading-tight", cur && "font-bold")}>{s.label}</p>
            </div>
          );
        })}
      </div>
      <p className={cn("mt-1.5 text-[11px] font-bold leading-snug", next.text)}>▶ {c.nextStep}</p>
    </div>
  );
}

function spaced(title: string) {
  return title.replace(/SH/g, "\u0000").split("").map((ch) => (ch === "\u0000" ? "SH" : ch)).join(" ");
}

function Para({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("px-0.5", className)} style={{ textIndent: 40 }}>
      {children}
    </p>
  );
}

function Field({ label, value, bold, after }: { label?: string; value: string; bold?: boolean; after?: string }) {
  return (
    <div className="mt-1 flex items-end gap-1.5">
      {label ? <span className="shrink-0">{label}</span> : null}
      <span className={cn("min-w-0 flex-1 truncate border-b border-slate-700 px-1", bold && "font-bold")}>{value}</span>
      {after ? <span className="shrink-0">{after}</span> : null}
    </div>
  );
}

function FooterCol({ caption, children, highlight }: { caption: string; children?: ReactNode; highlight?: boolean }) {
  return (
    <div>
      <div
        className={cn(
          "flex h-[60px] items-end justify-center border-b border-slate-700 pb-1",
          highlight && "animate-pulse rounded-t-md bg-sky-50 ring-2 ring-sky-300",
        )}
      >
        {children}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{caption}</p>
    </div>
  );
}
