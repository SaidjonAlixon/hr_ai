import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, FileSignature, Receipt } from "lucide-react";
import { DavomatJarimaPanel } from "../oylik/jarima-panel";

const MONTHS_UZ = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
/** Jarima hisobi shu oydan boshlangan */
const FIRST_MONTH = "2026-10";

function thisMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function shiftMonth(m: string, delta: number) {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y!, mm! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return y && mm ? `${MONTHS_UZ[mm - 1]} ${y}` : m;
}

export default function JarimalarPage() {
  const current = useMemo(thisMonth, []);
  const [month, setMonth] = useState(current);
  const canPrev = month > FIRST_MONTH;
  const canNext = month < current;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-sm shadow-rose-900/30">
          <Receipt className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl dark:text-white">Jarimalar</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Davomat bo‘yicha kechikish va kelmaslik jarimalari — dorixona va ofis alohida</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Link
            href="/admin/tushuntirish-xatlari"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-800 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
          >
            <FileSignature className="h-4 w-4" />
            <span className="hidden sm:inline">Tushuntirish xatlari</span>
          </Link>
          <div className="flex h-10 flex-1 items-center justify-between gap-1 rounded-xl border border-slate-200 bg-white px-1 sm:flex-none dark:border-white/10 dark:bg-slate-900">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-white/10"
              aria-label="Oldingi oy"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-bold text-slate-800 dark:text-white">{monthLabel(month)}</span>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-white/10"
              aria-label="Keyingi oy"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <DavomatJarimaPanel month={month} />
    </div>
  );
}
