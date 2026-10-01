import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { cn } from "@/lib/utils";
import { monthLabelUz, useSaveOylikFiksa, type PayrollRow } from "@/lib/oylik-api";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { daysInMonth } from "@/lib/oylik-period";
import { parseMoney } from "@/lib/money-format";
import { useToast } from "@/hooks/use-toast";

function dayShare(total: number, month: string) {
  const n = daysInMonth(month);
  const amount = Math.max(0, Math.round(total));
  if (amount <= 0 || n <= 0) return { base: 0, extraDays: 0, days: n };
  const base = Math.floor(amount / n);
  return { base, extraDays: amount - base * n, days: n };
}

export function FiksaDialog({
  open,
  onOpenChange,
  month,
  rows,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  rows: PayrollRow[];
  onSaved: (saved: number) => void;
}) {
  const save = useSaveOylikFiksa();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  const [picked, setPicked] = useState<number[]>([]);
  const [find, setFind] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [bulk, setBulk] = useState("");

  useEffect(() => {
    if (!open) return;
    const next: Record<number, number> = {};
    for (const row of rows) {
      if (row.userId) next[row.userId] = Math.round(Number(row.salary) || 0);
    }
    setDrafts(next);
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

  const changed = useMemo(
    () =>
      rows.filter((row) => {
        if (!row.userId) return false;
        const next = drafts[row.userId];
        if (next == null) return false;
        return next !== Math.round(Number(row.salary) || 0);
      }),
    [rows, drafts],
  );

  const setOne = (userId: number, salary: number) => {
    setDrafts((cur) => ({ ...cur, [userId]: Math.max(0, Math.round(salary)) }));
  };

  const toggle = (userId: number) => {
    setPicked((cur) => (cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId]));
  };

  const visibleIds = visible.map((row) => row.userId as number);
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));

  const applyBulk = () => {
    const amount = Math.max(0, Math.round(parseMoney(bulk)));
    if (!picked.length) return;
    setDrafts((cur) => {
      const next = { ...cur };
      for (const id of picked) next[id] = amount;
      return next;
    });
  };

  const submit = () => {
    const lines = changed
      .filter((row) => row.userId)
      .map((row) => ({
        userId: row.userId as number,
        employeeId: row.employeeId,
        salary: drafts[row.userId as number] ?? 0,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(980px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <div className="border-b bg-[#0b3a5c] px-5 py-4 text-white">
          <DialogTitle className="text-lg font-semibold text-white">Fiksa kiritish</DialogTitle>
          <p className="mt-1 text-sm text-white/75">
            {monthLabelUz(month)} · ism, lavozim va 1 oylik fiksa. Kunlik summa shu fiksadan chiqadi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <Input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Ism, familiya yoki lavozim"
            className="h-9 w-full max-w-xs"
          />
          <button
            type="button"
            onClick={() => setOnlyEmpty((on) => !on)}
            className={cn(
              "h-9 rounded-lg border px-3 text-sm font-medium",
              onlyEmpty ? "border-[#0b3a5c] bg-[#0b3a5c] text-white" : "border-slate-200 bg-white text-slate-700",
            )}
          >
            Yozilmaganlar
          </button>
          <span className="text-xs text-muted-foreground">{visible.length} xodim</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#0b3a5c]"
                    checked={allOn}
                    onChange={() => setPicked(allOn ? picked.filter((id) => !visibleIds.includes(id)) : [...new Set([...picked, ...visibleIds])])}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Xodim</th>
                <th className="px-3 py-2 font-semibold">Lavozim</th>
                <th className="px-3 py-2 text-right font-semibold">1 oylik fiksa</th>
                <th className="px-3 py-2 text-right font-semibold">Kunlik</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const userId = row.userId as number;
                const amount = drafts[userId] ?? 0;
                const share = dayShare(amount, month);
                const dirty = amount !== Math.round(Number(row.salary) || 0);
                return (
                  <tr key={userId} className={cn("border-b border-slate-100", picked.includes(userId) && "bg-sky-50/80")}>
                    <td className="px-3 py-2 align-middle">
                      <input type="checkbox" className="h-4 w-4 accent-[#0b3a5c]" checked={picked.includes(userId)} onChange={() => toggle(userId)} />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <p className="font-semibold text-slate-900">{row.fullName}</p>
                      {row.branch ? <p className="text-[11px] text-slate-500">{displayBranchName(row.branch)}</p> : null}
                    </td>
                    <td className="px-3 py-2 align-middle text-slate-600">{row.position || row.roleLabel}</td>
                    <td className="px-3 py-2 text-right align-middle">
                      <MoneyInput
                        className={cn(
                          "ml-auto h-9 w-36 rounded-lg border px-2 text-right text-sm",
                          dirty ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white",
                        )}
                        value={amount}
                        onLive={(n) => setOne(userId, n)}
                        onCommit={(n) => setOne(userId, n)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-middle">
                      <p className="font-semibold tabular-nums text-blue-700">{share.base.toLocaleString("ru-RU")}</p>
                      <p className="text-[10px] text-slate-400">
                        {share.days} kun{share.extraDays > 0 ? ` · oxirgi ${share.extraDays} kunga +1` : ""}
                      </p>
                    </td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                    Bu tanlovda xodim yo‘q.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Tanlangan {picked.length} kishiga bir xil fiksa</span>
            <Input value={bulk} onChange={(event) => setBulk(event.target.value)} placeholder="3 000 000" className="h-9 w-36 text-right" />
            <Button type="button" variant="outline" className="h-9" disabled={!picked.length} onClick={applyBulk}>
              Qo‘yish
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{changed.length} ta o‘zgarish</span>
            <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
              Yopish
            </Button>
            <Button type="button" className="h-9 bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]" disabled={!changed.length || save.isPending} onClick={submit}>
              {save.isPending ? "Saqlanmoqda…" : "Saqlash"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
