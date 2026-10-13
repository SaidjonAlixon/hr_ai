import { useEffect, useMemo, useState } from "react";
import { AlarmClock, AlertTriangle, BellRing, Check, CheckCircle2, ChevronDown, Copy, Loader2, Plus, Save, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  DISH_SUGGESTIONS,
  fmtDay,
  shiftDay,
  useAbetMenus,
  useApproveAbetMenu,
  useSaveAbetMenu,
  type AbetMenu,
  type DishCategory,
  type MenuItem,
  type RateWindow,
} from "@/lib/abet-api";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as DishCategory[];
const SUGGEST_CATS = CATEGORIES.filter((c) => DISH_SUGGESTIONS[c].length);
const EMPTY: MenuItem[] = [
  { name: "", category: "birinchi" },
  { name: "", category: "ikkinchi" },
  { name: "", category: "salat" },
];

function sameItems(a: MenuItem[], b: MenuItem[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Steps({ filled, saved, approved }: { filled: boolean; saved: boolean; approved: boolean }) {
  const steps = [
    { label: "Taomlar kiritildi", done: filled },
    { label: "Saqlandi", done: saved },
    { label: "Tasdiqlandi va yuborildi", done: approved },
  ];
  return (
    <ol className="flex items-center gap-1 sm:gap-2">
      {steps.map((s, i) => (
        <li key={s.label} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition",
              s.done ? "bg-teal-600 text-white shadow-sm shadow-teal-600/30" : "bg-slate-100 text-slate-400 dark:bg-white/10",
            )}
          >
            {s.done ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <span className={cn("truncate text-xs font-medium sm:text-sm", s.done ? "text-slate-900 dark:text-white" : "text-slate-400")}>{s.label}</span>
          {i < steps.length - 1 ? <span className={cn("hidden h-px flex-1 sm:block", s.done ? "bg-teal-300" : "bg-slate-200 dark:bg-white/10")} /> : null}
        </li>
      ))}
    </ol>
  );
}

/** Server `menuTelegramHtml` bilan bir xil ko‘rinish */
function TelegramMenuBubble({ day, items, note, update }: { day: string; items: MenuItem[]; note: string | null; update: boolean }) {
  return (
    <div className="space-y-0.5 text-[13px] leading-[1.5] text-slate-900">
      <p className="font-bold">{update ? "🔄 ABET MENYUSI YANGILANDI" : "🍽 BUGUN ABETDA QUYIDAGILAR"}</p>
      <p className="italic">📅 {fmtDay(day)}</p>
      <p className="text-slate-400">━━━━━━━━━━━━━━━━</p>
      {items.map((it) => (
        <p key={it.name}>
          {CATEGORY_EMOJI[it.category]} <b>{it.name}</b>
          {it.category !== "boshqa" ? <i className="text-slate-600">{`  · ${CATEGORY_LABEL[it.category]}`}</i> : null}
        </p>
      ))}
      <p className="text-slate-400">━━━━━━━━━━━━━━━━</p>
      {note ? <p className="pb-2">📝 {note}</p> : null}
      <p>
        ⭐ <b>Baholash:</b> bugun <b>12:30–15:00</b>
      </p>
      <p>📷 Oshxonadagi QR kodni skaner qiling yoki «Abet» bo‘limida «Bugun»ni tanlang</p>
      <p className="pt-2 italic">Yoqimli ishtaha! 😊</p>
    </div>
  );
}

function DeadlineBanner({ win, approved, hasMenu }: { win: RateWindow; approved: boolean; hasMenu: boolean }) {
  const [h1, m1] = win.now.split(":").map(Number);
  const [h2, m2] = win.menuDeadline.split(":").map(Number);
  const left = h2! * 60 + m2! - (h1! * 60 + m1!);
  const leftText = left >= 60 ? `${Math.floor(left / 60)} soat ${left % 60} daqiqa` : `${left} daqiqa`;
  if (approved) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <span>
          <b>Bugungi menyu tasdiqlangan</b>
          <span className="block text-xs opacity-80">Barcha ofis xodimlari bot va platforma orqali xabardor qilindi</span>
        </span>
      </div>
    );
  }
  const late = left <= 0;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
        late
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200",
      )}
    >
      {late ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <AlarmClock className="h-5 w-5 shrink-0" />}
      <span>
        <b>
          {late
            ? `Kechikdi! Menyu ${win.menuDeadline} gacha tasdiqlanishi kerak edi`
            : `Bugungi menyuni ${win.menuDeadline} gacha ${hasMenu ? "tasdiqlang" : "kiriting va tasdiqlang"}`}
        </b>
        <span className="block text-xs opacity-80">
          {late
            ? "Xodimlar bugungi ovqatni hali bilishmaydi — hoziroq tasdiqlang"
            : `Qoldi: ${leftText} · tasdiqlangach barcha xodimlarga xabar avtomatik boradi`}
        </span>
      </span>
    </div>
  );
}

function TelegramPreview({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  return (
    <div className="overflow-hidden rounded-[28px] border-[6px] border-slate-900 bg-slate-900 shadow-xl dark:border-slate-700">
      <div className="flex items-center gap-2.5 bg-[#517da2] px-4 py-2.5 text-white">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">VH</span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">VAKSINA HR</p>
          <p className="text-[11px] opacity-80">bot</p>
        </div>
      </div>
      <div className="min-h-[300px] bg-[#cfe0c3] bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.35),transparent_40%),radial-gradient(circle_at_80%_60%,rgba(255,255,255,.25),transparent_40%)] p-3">
        {empty ? (
          <p className="mt-24 text-center text-xs text-slate-600/80">Taom kiritsangiz, xabar shu yerda ko‘rinadi</p>
        ) : (
          <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">
            <div className="break-words">{children}</div>
            <p className="mt-1 text-right text-[10px] text-slate-400">
              {new Date().toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" })}
            </p>
            <div className="-mx-1 mt-1.5 rounded-lg bg-[#517da2]/10 py-1.5 text-center text-[13px] font-medium text-[#3a6d99]">🍽 Menyu va baholash</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MenuTab({ win }: { win: RateWindow }) {
  const today = win.day;
  const { toast } = useToast();
  const menus = useAbetMenus(true);
  const save = useSaveAbetMenu();
  const approve = useApproveAbetMenu();
  const [day, setDay] = useState(today);
  const [items, setItems] = useState<MenuItem[]>(EMPTY);
  const [note, setNote] = useState("");
  const [suggestCat, setSuggestCat] = useState<DishCategory>("birinchi");
  const [previewOpen, setPreviewOpen] = useState(false);

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
  const noteClean = note.trim() || null;
  const dirty = !current || !sameItems(clean, current.items) || noteClean !== (current.note ?? null);
  const isToday = day === today;
  const approved = current?.status === "approved" && !dirty;
  const usedNames = new Set(clean.map((i) => i.name.toLowerCase()));
  const preview = (
    <TelegramMenuBubble day={day} items={clean} note={noteClean} update={current?.status === "approved" && dirty} />
  );

  const update = (idx: number, patch: Partial<MenuItem>) => setItems((p) => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const addSuggestion = (name: string, category: DishCategory) => {
    if (usedNames.has(name.toLowerCase())) return;
    setItems((p) => {
      const emptyIdx = p.findIndex((it) => !it.name.trim() && it.category === category);
      const anyEmpty = emptyIdx >= 0 ? emptyIdx : p.findIndex((it) => !it.name.trim());
      if (anyEmpty >= 0) return p.map((it, i) => (i === anyEmpty ? { name, category } : it));
      return p.length >= 20 ? p : [...p, { name, category }];
    });
  };

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
      if (await doSave()) toast({ title: "Menyu saqlandi ✅", description: "Xodimlarga yuborish uchun «Tasdiqlash» tugmasini bosing" });
    } catch (e) {
      toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onApprove = async () => {
    const msg = isToday
      ? "Menyu tasdiqlansa barcha ofis xodimlariga bot va platforma orqali xabar yuboriladi. Davom etasizmi?"
      : `Menyu tasdiqlanadi va ${fmtDay(day)} kuni ertalab 08:00 da barcha ofis xodimlariga yuboriladi. Davom etasizmi?`;
    if (!window.confirm(msg)) return;
    try {
      if (dirty && !(await doSave())) return;
      const r = await approve.mutateAsync(day);
      toast({
        title: "Menyu tasdiqlandi 🎉",
        description: r.notified != null ? `${r.notified} nafar xodimga xabar yuborilmoqda` : `${fmtDay(day)} kuni ertalab yuboriladi`,
      });
    } catch (e) {
      toast({ title: "Tasdiqlanmadi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy = save.isPending || approve.isPending;

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {days.map((d) => {
          const m = byDay.get(d);
          const active = d === day;
          const status = m?.status === "approved" ? "approved" : m ? "draft" : "none";
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={cn(
                "relative w-[92px] shrink-0 snap-start rounded-2xl border px-3 py-2.5 text-left transition sm:w-[112px]",
                active
                  ? "border-transparent bg-gradient-to-br from-teal-600 to-emerald-500 text-white shadow-lg shadow-teal-600/25"
                  : "border-slate-200 bg-white hover:border-teal-300 hover:shadow-sm dark:border-white/10 dark:bg-white/5",
              )}
            >
              <span
                className={cn(
                  "absolute right-2.5 top-2.5 h-2 w-2 rounded-full",
                  status === "approved" ? "bg-emerald-400" : status === "draft" ? "bg-amber-400" : active ? "bg-white/40" : "bg-slate-200",
                )}
              />
              <span className={cn("block text-[11px] font-medium", active ? "text-white/80" : "text-slate-400")}>
                {d === today ? "Bugun" : d === shiftDay(today, 1) ? "Ertaga" : fmtDay(d, false)}
              </span>
              <span className="block text-sm font-bold">{fmtDay(d).split(", ")[1]}</span>
              <span className={cn("mt-0.5 block text-[10px]", active ? "text-white/85" : "text-slate-400")}>
                {status === "approved" ? "Tasdiqlangan" : status === "draft" ? "Qoralama" : "Bo‘sh"}
              </span>
            </button>
          );
        })}
        <label className="flex w-[120px] shrink-0 snap-start cursor-pointer flex-col justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-500 dark:border-white/15 dark:bg-white/5">
          Boshqa kun
          <input
            type="date"
            value={day}
            min={today}
            max={shiftDay(today, 30)}
            onChange={(e) => e.target.value && e.target.value >= today && setDay(e.target.value)}
            className="mt-0.5 w-full bg-transparent text-xs font-semibold text-slate-800 outline-none dark:text-white"
          />
        </label>
      </div>

      {isToday ? <DeadlineBanner win={win} approved={current?.status === "approved"} hasMenu={!!current} /> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-white/10 dark:bg-white/5">
        <Steps filled={clean.length > 0} saved={!!current && !dirty} approved={approved} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-white/5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{fmtDay(day)}</h3>
                <p className="text-xs text-slate-500 dark:text-white/50">
                  {approved
                    ? `Tasdiqlangan${current?.approvedByName ? ` · ${current.approvedByName}` : ""}`
                    : current?.status === "approved"
                      ? "O‘zgartirildi — qayta tasdiqlang"
                      : current
                        ? "Qoralama — xodimlarga hali yuborilmagan"
                        : "Menyu hali kiritilmagan"}
                </p>
              </div>
              {approved ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Yuborilgan
                </span>
              ) : previous && !current ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto rounded-full"
                  onClick={() => {
                    setItems(previous.items);
                    setNote(previous.note ?? "");
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> {fmtDay(previous.day, false)} dan nusxa
                </Button>
              ) : null}
            </div>

            <div className="space-y-2">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-1.5 pr-1 transition focus-within:border-teal-400 focus-within:bg-white focus-within:shadow-sm dark:border-white/10 dark:bg-white/5"
                >
                  <label className="relative flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-white px-2 shadow-sm dark:bg-white/10">
                    <span className="text-xl leading-none">{CATEGORY_EMOJI[it.category]}</span>
                    <span className="hidden text-xs font-semibold text-slate-600 sm:inline dark:text-white/70">{CATEGORY_LABEL[it.category]}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    <select
                      aria-label="Taom turi"
                      value={it.category}
                      onChange={(e) => update(idx, { category: e.target.value as DishCategory })}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_EMOJI[c]} {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    value={it.name}
                    maxLength={80}
                    placeholder={`${CATEGORY_LABEL[it.category]} nomi…`}
                    onChange={(e) => update(idx, { name: e.target.value })}
                    className="h-11 min-w-0 flex-1 bg-transparent px-1 text-[15px] font-medium text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 dark:text-white"
                  />
                  <button
                    type="button"
                    aria-label="O‘chirish"
                    onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                    disabled={items.length <= 1}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setItems((p) => [...p, { name: "", category: "boshqa" }])}
                disabled={items.length >= 20}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 text-sm font-medium text-slate-500 transition hover:border-teal-400 hover:text-teal-700 disabled:opacity-40 dark:border-white/10"
              >
                <Plus className="h-4 w-4" /> Taom qo‘shish
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-white/5">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-white/90">Tez qo‘shish</h4>
              <span className="text-xs text-slate-400">— bosing, ro‘yxatga tushadi</span>
            </div>
            <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {SUGGEST_CATS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSuggestCat(c)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    suggestCat === c ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-white/70",
                  )}
                >
                  {CATEGORY_EMOJI[c]} {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {DISH_SUGGESTIONS[suggestCat].map((name) => {
                const used = usedNames.has(name.toLowerCase());
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={used}
                    onClick={() => addSuggestion(name, suggestCat)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition active:scale-95",
                      used
                        ? "border-teal-200 bg-teal-50 text-teal-700"
                        : "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:text-teal-700 dark:border-white/15 dark:bg-white/5 dark:text-white/80",
                    )}
                  >
                    {used ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5 text-slate-400" />}
                    {name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-white/5">
            <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-white/90">
              📝 Izoh <span className="font-normal text-slate-400">(ixtiyoriy)</span>
            </p>
            <Input value={note} maxLength={300} placeholder="Masalan: bugun abet 13:00 da boshlanadi" onChange={(e) => setNote(e.target.value)} className="h-11" />
          </section>

          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 lg:hidden dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <span className="flex items-center gap-2">
              <Send className="h-4 w-4 text-[#517da2]" /> Xodimlarga boradigan xabar
            </span>
            <ChevronDown className={cn("h-4 w-4 transition", previewOpen && "rotate-180")} />
          </button>
          {previewOpen ? (
            <div className="lg:hidden">
              <TelegramPreview empty={!clean.length}>{preview}</TelegramPreview>
            </div>
          ) : null}

          <div className="grid gap-2 sm:flex sm:justify-end">
            <Button variant="outline" onClick={() => void onSave()} disabled={busy || !dirty} className="h-12 rounded-xl sm:h-11">
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Qoralama saqlash
            </Button>
            <Button
              onClick={() => void onApprove()}
              disabled={busy || !clean.length || approved}
              className="h-12 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-500 text-base font-semibold shadow-lg shadow-teal-600/25 hover:from-teal-700 hover:to-emerald-600 sm:h-11 sm:text-sm"
            >
              {approve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : approved ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <BellRing className="mr-2 h-4 w-4" />}
              {approved ? "Tasdiqlangan" : isToday ? "Tasdiqlash va xabar yuborish" : "Tasdiqlash (08:00 da yuboriladi)"}
            </Button>
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-white/80">
              <Send className="h-4 w-4 text-[#517da2]" /> Xodimlarga boradigan xabar
            </p>
            <TelegramPreview empty={!clean.length}>{preview}</TelegramPreview>
            <p className="text-center text-xs text-slate-400">Bot, platforma va telefon bildirishnomasida aynan shu matn</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
