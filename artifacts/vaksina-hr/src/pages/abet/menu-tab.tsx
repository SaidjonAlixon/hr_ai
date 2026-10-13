import { useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, Copy, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  fmtDay,
  shiftDay,
  useAbetMenus,
  useApproveAbetMenu,
  useSaveAbetMenu,
  type AbetMenu,
  type DishCategory,
  type MenuItem,
} from "@/lib/abet-api";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as DishCategory[];
const EMPTY: MenuItem[] = [
  { name: "", category: "birinchi" },
  { name: "", category: "ikkinchi" },
  { name: "", category: "salat" },
];

function sameItems(a: MenuItem[], b: MenuItem[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function MenuTab({ today }: { today: string }) {
  const { toast } = useToast();
  const menus = useAbetMenus(true);
  const save = useSaveAbetMenu();
  const approve = useApproveAbetMenu();
  const [day, setDay] = useState(today);
  const [items, setItems] = useState<MenuItem[]>(EMPTY);
  const [note, setNote] = useState("");

  const byDay = useMemo(() => new Map((menus.data?.items ?? []).map((m) => [m.day, m])), [menus.data]);
  const current: AbetMenu | undefined = byDay.get(day);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(today, i)), [today]);
  const previous = useMemo(
    () => (menus.data?.items ?? []).filter((m) => m.day < day && m.items.length).sort((a, b) => b.day.localeCompare(a.day))[0],
    [menus.data, day],
  );

  useEffect(() => {
    setItems(current?.items.length ? current.items : EMPTY);
    setNote(current?.note ?? "");
  }, [day, current?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const clean = items.map((i) => ({ ...i, name: i.name.trim() })).filter((i) => i.name);
  const dirty = !current || !sameItems(clean, current.items) || (note.trim() || null) !== (current.note ?? null);
  const isToday = day === today;

  const update = (idx: number, patch: Partial<MenuItem>) => setItems((p) => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const doSave = async () => {
    if (!clean.length) {
      toast({ title: "Kamida bitta taom kiriting", variant: "destructive" });
      return null;
    }
    const r = await save.mutateAsync({ day, items: clean, note });
    return r.menu;
  };

  const onSave = async () => {
    try {
      if (await doSave()) toast({ title: "Menyu saqlandi", description: "Xodimlarga yuborish uchun «Tasdiqlash» tugmasini bosing" });
    } catch (e) {
      toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onApprove = async () => {
    const msg = isToday
      ? "Menyu tasdiqlansa barcha ofis xodimlariga bot va platforma orqali «Bugun abetda quyidagilar…» xabari yuboriladi. Davom etasizmi?"
      : `Menyu tasdiqlanadi va ${fmtDay(day)} kuni ertalab 08:00 da barcha ofis xodimlariga yuboriladi. Davom etasizmi?`;
    if (!window.confirm(msg)) return;
    try {
      if (dirty && !(await doSave())) return;
      const r = await approve.mutateAsync(day);
      toast({
        title: "Menyu tasdiqlandi",
        description: r.notified != null ? `${r.notified} nafar xodimga xabar yuborilmoqda` : `${fmtDay(day)} kuni ertalab yuboriladi`,
      });
    } catch (e) {
      toast({ title: "Tasdiqlanmadi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy = save.isPending || approve.isPending;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const m = byDay.get(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={cn(
                "min-w-[110px] shrink-0 rounded-xl border px-3 py-2 text-left transition",
                d === day ? "border-teal-600 bg-teal-600 text-white shadow" : "border-slate-200 bg-white hover:border-teal-400 dark:border-white/10 dark:bg-white/5",
              )}
            >
              <span className="block text-xs opacity-80">{d === today ? "Bugun" : d === shiftDay(today, 1) ? "Ertaga" : fmtDay(d, false)}</span>
              <span className="block text-sm font-semibold">{fmtDay(d).split(", ")[1]}</span>
              <span
                className={cn(
                  "mt-1 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold",
                  m?.status === "approved"
                    ? d === day ? "bg-white/25" : "bg-emerald-100 text-emerald-700"
                    : m
                      ? d === day ? "bg-white/25" : "bg-amber-100 text-amber-700"
                      : d === day ? "bg-white/15" : "bg-slate-100 text-slate-500",
                )}
              >
                {m?.status === "approved" ? "Tasdiqlangan" : m ? "Qoralama" : "Kiritilmagan"}
              </span>
            </button>
          );
        })}
        <Input
          type="date"
          value={day}
          min={today}
          max={shiftDay(today, 30)}
          onChange={(e) => e.target.value && e.target.value >= today && setDay(e.target.value)}
          className="h-auto w-[160px] shrink-0"
        />
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{fmtDay(day)} — menyu</h3>
          {current?.status === "approved" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" /> Tasdiqlangan
              {current.approvedByName ? ` · ${current.approvedByName}` : ""}
            </span>
          ) : current ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Qoralama — xodimlarga hali yuborilmagan</span>
          ) : null}
          {previous && !current ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setItems(previous.items);
                setNote(previous.note ?? "");
              }}
            >
              <Copy className="mr-1.5 h-4 w-4" /> {fmtDay(previous.day, false)} menyusidan nusxa
            </Button>
          ) : null}
        </div>

        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={it.category}
                onChange={(e) => update(idx, { category: e.target.value as DishCategory })}
                className="h-10 w-[120px] shrink-0 rounded-md border border-input bg-background px-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <Input
                value={it.name}
                maxLength={80}
                placeholder="Taom nomi, masalan: Mastava"
                onChange={(e) => update(idx, { name: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="O‘chirish"
                onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                disabled={items.length <= 1}
              >
                <Trash2 className="h-4 w-4 text-slate-400" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setItems((p) => [...p, { name: "", category: "boshqa" }])}
            disabled={items.length >= 20}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Taom qo‘shish
          </Button>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700 dark:text-white/80">Izoh (ixtiyoriy)</p>
          <Input value={note} maxLength={300} placeholder="Masalan: bugun abet 13:00 da" onChange={(e) => setNote(e.target.value)} />
        </div>

        {current?.status === "approved" && dirty ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Tasdiqlangan menyu o‘zgartirildi. Qayta tasdiqlasangiz xodimlarga «menyu yangilandi» xabari boradi.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => void onSave()} disabled={busy || !dirty}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Saqlash
          </Button>
          <Button
            onClick={() => void onApprove()}
            disabled={busy || !clean.length || (current?.status === "approved" && !dirty)}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {approve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}
            Tasdiqlash va xabar yuborish
          </Button>
        </div>
      </div>
    </div>
  );
}
