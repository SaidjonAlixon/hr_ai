import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { cn } from "@/lib/utils";
import { monthLabelUz, useSaveOylikFiksa, type PayrollRow, type UsdRate } from "@/lib/oylik-api";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { daysInMonth } from "@/lib/oylik-period";
import { downloadFiksaExcel, readFiksaExcel } from "@/lib/fiksa-excel";
import { formatMoney, parseMoney } from "@/lib/money-format";
import { useToast } from "@/hooks/use-toast";

function dayShare(total: number, month: string) {
  const n = daysInMonth(month);
  const amount = Math.max(0, Math.round(total));
  if (amount <= 0 || n <= 0) return { base: 0, extraDays: 0, days: n, last: 0 };
  const base = Math.floor(amount / n);
  const extraDays = amount - base * n;
  return { base, extraDays, days: n, last: extraDays > 0 ? base + 1 : base };
}

export function FiksaDialog({
  open,
  onOpenChange,
  month,
  rows,
  usdRate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  rows: PayrollRow[];
  usdRate: UsdRate | null;
  onSaved: (saved: number) => void;
}) {
  const save = useSaveOylikFiksa();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  /** null — fiksa so‘mda; son — dollarda */
  const [usd, setUsd] = useState<Record<number, number | null>>({});
  const [picked, setPicked] = useState<number[]>([]);
  const [find, setFind] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [bulk, setBulk] = useState("");
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const next: Record<number, number> = {};
    const nextUsd: Record<number, number | null> = {};
    for (const row of rows) {
      if (!row.userId) continue;
      next[row.userId] = Math.round(Number(row.salary) || 0);
      nextUsd[row.userId] = row.salaryUsd ?? null;
    }
    setDrafts(next);
    setUsd(nextUsd);
    setPicked([]);
    setFind("");
    setOnlyEmpty(false);
    setBulk("");
  }, [open, rows]);

  const visible = useMemo(() => {
    const q = find.trim().toLowerCase();
    return rows.filter((row) => {
      if (!row.userId) return false;
      if (onlyEmpty && Math.round(Number(row.salary) || 0) > 0) return false;
      if (!q) return true;
      const hay = `${row.fullName} ${row.position || ""} ${row.roleLabel} ${row.branch || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, find, onlyEmpty]);

  const somOf = (userId: number) => {
    const d = usd[userId];
    if (d != null && usdRate) return Math.max(0, Math.round(d * usdRate.rate));
    return drafts[userId] ?? 0;
  };

  const isDirty = (row: PayrollRow) => {
    if (!row.userId) return false;
    if ((usd[row.userId] ?? null) !== (row.salaryUsd ?? null)) return true;
    if (usd[row.userId] != null) return false;
    const next = drafts[row.userId];
    return next != null && next !== Math.round(Number(row.salary) || 0);
  };

  const changed = rows.filter(isDirty);

  const setOne = (userId: number, salary: number) => {
    setDrafts((cur) => ({ ...cur, [userId]: Math.max(0, Math.round(salary)) }));
    setUsd((cur) => ({ ...cur, [userId]: null }));
  };

  const setOneUsd = (userId: number, amount: number) => {
    setUsd((cur) => ({ ...cur, [userId]: Math.max(0, Math.round(amount)) }));
  };

  const switchCurrency = (row: PayrollRow, toUsd: boolean) => {
    const userId = row.userId as number;
    if (toUsd) {
      const start = row.salaryUsd ?? (usdRate ? Math.round(somOf(userId) / usdRate.rate) : 0);
      setUsd((cur) => ({ ...cur, [userId]: start }));
    } else {
      const som = somOf(userId);
      setUsd((cur) => ({ ...cur, [userId]: null }));
      setDrafts((cur) => ({ ...cur, [userId]: som }));
    }
  };

  const toggle = (userId: number) => {
    setPicked((cur) => (cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId]));
  };

  const visibleIds = visible.map((row) => row.userId as number);
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));

  const foldName = (value: string) => value.toLowerCase().replace(/['’‘`]/g, "'").replace(/\s+/g, " ").trim();

  const downloadExcel = async () => {
    const lines = visible
      .filter((row) => row.userId)
      .map((row) => ({
        userId: row.userId as number,
        fullName: row.fullName,
        branch: displayBranchName(row.branch),
        position: row.position || row.roleLabel,
        salary: somOf(row.userId as number),
      }));
    if (!lines.length) {
      toast({ title: "Bu tanlovda xodim yo‘q" });
      return;
    }
    const coords = new Map<number, { coordinator: string; coordinatorPhone: string }>();
    try {
      const res = await fetch("/api/oylik/fiksa/coordinators", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: lines.map((line) => line.userId) }),
      });
      if (res.ok) {
        const data = (await res.json()) as { items: Array<{ userId: number; coordinator: string; coordinatorPhone: string }> };
        for (const item of data.items) coords.set(item.userId, item);
      }
    } catch {
      /* koordinatorsiz ham yuklanadi */
    }
    void downloadFiksaExcel(
      month,
      `Fiksa · ${monthLabelUz(month)}`,
      lines.map((line) => ({ ...line, ...coords.get(line.userId) })),
    );
  };

  const uploadExcel = async (file: File) => {
    setReading(true);
    try {
      const lines = await readFiksaExcel(file);
      const byId = new Map(rows.filter((row) => row.userId).map((row) => [row.userId as number, row]));
      const byName = new Map(rows.filter((row) => row.userId).map((row) => [foldName(row.fullName), row]));
      const next = { ...drafts };
      const nextUsd = { ...usd };
      let applied = 0;
      let missed = 0;
      for (const line of lines) {
        const row = (line.userId ? byId.get(line.userId) : undefined) || (line.name ? byName.get(foldName(line.name)) : undefined);
        if (!row?.userId) {
          missed += 1;
          continue;
        }
        next[row.userId] = line.salary;
        nextUsd[row.userId] = null;
        applied += 1;
      }
      setDrafts(next);
      setUsd(nextUsd);
      toast({
        title: applied ? `${applied} ta fiksa o‘qildi` : "Fiksa topilmadi",
        description: missed ? `${missed} qator shu ro‘yxatda yo‘q. Saqlashni bosing.` : "Tekshirib, Saqlashni bosing.",
        variant: applied ? undefined : "destructive",
      });
    } catch (error) {
      toast({ title: "Excel o‘qilmadi", description: (error as Error).message, variant: "destructive" });
    } finally {
      setReading(false);
    }
  };

  const applyBulk = () => {
    const amount = Math.max(0, Math.round(parseMoney(bulk)));
    if (!picked.length) return;
    setDrafts((cur) => {
      const next = { ...cur };
      for (const id of picked) next[id] = amount;
      return next;
    });
    setUsd((cur) => {
      const next = { ...cur };
      for (const id of picked) next[id] = null;
      return next;
    });
  };

  const submit = () => {
    const lines = changed
      .filter((row) => row.userId)
      .map((row) => ({
        userId: row.userId as number,
        employeeId: row.employeeId,
        salary: somOf(row.userId as number),
        salaryUsd: usd[row.userId as number] ?? null,
      }));
    if (!lines.length) return;
    save.mutate(
      { month, lines },
      {
        onSuccess: (result) => {
          onSaved(result.saved);
          onOpenChange(false);
        },
        onError: (error) => {
          toast({ title: "Fiksa saqlanmadi", description: (error as Error).message, variant: "destructive" });
        },
      },
    );
  };

  const monthDays = daysInMonth(month);
  const emptyCount = rows.filter((row) => row.userId && Math.round(Number(row.salary) || 0) <= 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="flex h-[min(920px,calc(100vh-1.5rem))] w-[min(1280px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <div className="shrink-0 bg-[#0b3a5c] px-6 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-xl font-semibold tracking-tight text-white">Fiksa kiritish</DialogTitle>
              <p className="mt-1 text-sm text-white/80">
                {monthLabelUz(month)} · {monthDays} kun · {visible.length} xodim
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadExcel()}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/20"
              >
                <Download className="h-4 w-4" />
                Excel yuklab olish
              </button>
              <button
                type="button"
                disabled={reading}
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-[#0b3a5c] hover:bg-slate-100 disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                {reading ? "O‘qilmoqda…" : "Excelni yuklash"}
              </button>
              <button
                type="button"
                aria-label="Yopish"
                onClick={() => onOpenChange(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <p className="mt-3 max-w-4xl text-[13px] leading-relaxed text-sky-100/95">
            Bir kunlik hisob — 1 oylik fiksa shu oyning {monthDays} kuniga bo‘linadi. Bo‘linmay qolgan so‘mlar oy oxiridagi kunlarga 1 so‘mdan qo‘shiladi, shunda kunlar yig‘indisi oylik fiksaga teng chiqadi.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-white px-6 py-3">
          <Input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Ism, familiya yoki lavozim"
            className="h-10 w-full max-w-sm"
          />
          <div className="flex h-10 overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setOnlyEmpty(false)}
              className={cn(
                "px-3 text-sm font-semibold",
                !onlyEmpty ? "bg-[#0b3a5c] text-white" : "bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              Hammasi
            </button>
            <button
              type="button"
              onClick={() => setOnlyEmpty(true)}
              className={cn(
                "border-l border-slate-200 px-3 text-sm font-semibold",
                onlyEmpty ? "bg-amber-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              Fiksasi yo‘q · {emptyCount}
            </button>
          </div>
          <span
            className={cn(
              "inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold",
              changed.length ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-500",
            )}
          >
            {changed.length ? `${changed.length} ta o‘zgargan` : "O‘zgarish yo‘q"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadExcel(file);
            }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50/60">
          <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white text-slate-500 shadow-[0_1px_0_#e2e8f0]">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#0b3a5c]"
                    checked={allOn}
                    onChange={() => setPicked(allOn ? picked.filter((id) => !visibleIds.includes(id)) : [...new Set([...picked, ...visibleIds])])}
                    aria-label="Hammasini tanlash"
                  />
                </th>
                <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide">Xodim</th>
                <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide">Lavozim</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide">1 oylik fiksa</th>
                <th className="w-[280px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Bir kunlik hisob</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const userId = row.userId as number;
                const amount = somOf(userId);
                const usdAmount = usd[userId] ?? null;
                const share = dayShare(amount, month);
                const dirty = isDirty(row);
                const selected = picked.includes(userId);
                return (
                  <tr
                    key={userId}
                    className={cn(
                      "border-b border-slate-100",
                      dirty ? "bg-emerald-50/80" : selected ? "bg-sky-50" : "bg-white",
                    )}
                  >
                    <td className="px-4 py-3 align-middle">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#0b3a5c]"
                        checked={selected}
                        onChange={() => toggle(userId)}
                        aria-label={`${row.fullName} ni tanlash`}
                      />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <p className="font-semibold text-slate-900">{row.fullName}</p>
                      {row.branch ? <p className="mt-0.5 text-xs text-slate-500">{displayBranchName(row.branch)}</p> : null}
                    </td>
                    <td className="px-3 py-3 align-middle text-slate-600">{row.position || row.roleLabel}</td>
                    <td className="px-3 py-3 text-right align-middle">
                      <div className="ml-auto w-56">
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
                            <button
                              type="button"
                              onClick={() => usdAmount != null && switchCurrency(row, false)}
                              className={cn("px-2", usdAmount == null ? "bg-[#0b3a5c] text-white" : "bg-white text-slate-500 hover:bg-slate-50")}
                            >
                              so‘m
                            </button>
                            <button
                              type="button"
                              disabled={!usdRate}
                              title={usdRate ? undefined : "Dollar kursi hali olinmagan"}
                              onClick={() => usdAmount == null && switchCurrency(row, true)}
                              className={cn(
                                "border-l border-slate-200 px-2 disabled:opacity-40",
                                usdAmount != null ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50",
                              )}
                            >
                              $
                            </button>
                          </div>
                          <MoneyInput
                            className={cn(
                              "h-10 w-full rounded-lg border px-3 text-right text-sm font-semibold tabular-nums",
                              dirty ? "border-emerald-500 bg-white ring-2 ring-emerald-100" : "border-slate-200 bg-white",
                            )}
                            value={usdAmount ?? amount}
                            onLive={(n) => (usdAmount != null ? setOneUsd(userId, n) : setOne(userId, n))}
                            onCommit={(n) => (usdAmount != null ? setOneUsd(userId, n) : setOne(userId, n))}
                          />
                        </div>
                        {usdAmount != null && usdRate ? (
                          <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                            ≈ {formatMoney(amount)} so‘m · kurs {formatMoney(Math.round(usdRate.rate))} ({usdRate.date.split("-").reverse().join(".")})
                          </p>
                        ) : null}
                        <p className={cn("mt-1 text-[11px] font-medium", dirty ? "text-emerald-700" : amount > 0 ? "text-slate-400" : "text-amber-700")}>
                          {dirty ? "O‘zgardi · hali saqlanmagan" : amount > 0 ? "Saqlangan fiksa" : "Fiksa yozilmagan"}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      {amount <= 0 ? (
                        <p className="text-sm text-slate-400">Fiksa yozilsa, kunlik hisob chiqadi</p>
                      ) : (
                        <div>
                          <p className="font-semibold tabular-nums text-[#0b3a5c]">{formatMoney(share.base)} so‘m har kunga</p>
                          <p className="mt-0.5 text-xs leading-snug text-slate-500">
                            {share.extraDays > 0
                              ? `Oyda ${share.days} kun. Qolgan ${share.extraDays} so‘m oxirgi ${share.extraDays} kunga qo‘shiladi: o‘sha kunlarda ${formatMoney(share.last)} so‘m.`
                              : `Oyda ${share.days} kun. Har biriga teng, qoldiq yo‘q.`}
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr>
                  <td colSpan={5} className="bg-white px-4 py-16 text-center text-sm text-slate-500">
                    Bu tanlovda xodim yo‘q.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-white px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-medium", picked.length ? "text-slate-800" : "text-slate-400")}>
              {picked.length ? `${picked.length} kishi tanlangan` : "Bir xil fiksa qo‘yish uchun xodimni belgilang"}
            </span>
            <Input
              value={bulk}
              onChange={(event) => setBulk(event.target.value)}
              placeholder="3 000 000"
              className="h-10 w-36 text-right font-semibold"
            />
            <Button type="button" variant="outline" className="h-10" disabled={!picked.length} onClick={applyBulk}>
              Tanlanganlarga qo‘yish
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="h-10 px-4" onClick={() => onOpenChange(false)}>
              Yopish
            </Button>
            <Button
              type="button"
              className="h-10 bg-[#0b3a5c] px-5 text-white hover:bg-[#082c46] disabled:bg-slate-200 disabled:text-slate-400"
              disabled={!changed.length || save.isPending}
              onClick={submit}
            >
              {save.isPending ? "Saqlanmoqda…" : changed.length ? `Saqlash · ${changed.length}` : "Saqlash"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
