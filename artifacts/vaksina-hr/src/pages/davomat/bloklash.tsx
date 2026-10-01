import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Building2, Loader2, QrCode, ScanFace, Search, ShieldOff, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { hasFullPlatformAccess, userRoleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  fetchDavomatMethodAccess,
  saveDavomatMethodAccess,
  saveDavomatMethodAccessBulk,
  type DavomatMethodAccessRow,
} from "@/lib/davomat-api";

type PlaceFilter = "all" | "ofis" | "dorixona";
type StateFilter = "all" | "open" | "limited" | "blocked" | "face_only" | "qr_only";

const PAGE = 40;

function foldScript(input: string): string {
  const cyr: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", ғ: "g", қ: "q", ҳ: "h",
  };
  let s = input.toLowerCase().replace(/[\u2018\u2019\u02BB\u02BC']/g, "'");
  s = s.replace(/g'/g, "g").replace(/o'/g, "o");
  let out = "";
  for (const ch of s) out += cyr[ch] ?? ch;
  return out.replace(/[^a-z0-9]+/g, "");
}

function matchesQuery(row: DavomatMethodAccessRow, query: string) {
  const words = query.trim().split(/\s+/).map(foldScript).filter(Boolean);
  if (!words.length) return true;
  const hay = foldScript(`${row.fullName} ${userRoleLabel(row.role)} ${row.position} ${row.location} ${row.role}`);
  return words.every((word) => hay.includes(word));
}

function positionOf(row: DavomatMethodAccessRow) {
  const raw = row.position.trim();
  if (raw && !/^(manager|pharmacist|intern|coordinator|employee)$/i.test(raw)) return raw;
  return userRoleLabel(row.role) || raw || "—";
}

function stateOf(row: DavomatMethodAccessRow): Exclude<StateFilter, "all" | "limited"> {
  if (row.face && row.qr) return "open";
  if (!row.face && !row.qr) return "blocked";
  if (row.face && !row.qr) return "face_only";
  return "qr_only";
}

function matchesState(row: DavomatMethodAccessRow, filter: StateFilter) {
  if (filter === "all") return true;
  if (filter === "limited") return !(row.face && row.qr);
  return stateOf(row) === filter;
}

export default function DavomatBloklashPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = hasFullPlatformAccess(user?.role);
  const [rows, setRows] = useState<DavomatMethodAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [place, setPlace] = useState<PlaceFilter>("all");
  const [state, setState] = useState<StateFilter>("all");
  const [position, setPosition] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [ask, setAsk] = useState<{
    title: string;
    text: string;
    confirm: string;
    danger?: boolean;
    run: () => Promise<void>;
  } | null>(null);
  const [askBusy, setAskBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchDavomatMethodAccess();
      setRows(data.items);
    } catch (err) {
      toast({ title: "Ro‘yxat yuklanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) void load();
    else setLoading(false);
  }, [allowed]);

  const positions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) set.add(positionOf(row));
    return [...set].sort((a, b) => a.localeCompare(b, "uz"));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (place !== "all" && row.place !== place) return false;
      if (position !== "all" && positionOf(row) !== position) return false;
      if (!matchesState(row, state)) return false;
      return matchesQuery(row, q);
    });
  }, [rows, place, position, state, q]);

  useEffect(() => {
    setPage(1);
  }, [q, place, state, position]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const view = filtered.slice((page - 1) * PAGE, page * PAGE);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allViewSelected = view.length > 0 && view.every((row) => selectedSet.has(row.userId));

  const counts = useMemo(() => {
    const base = rows.filter((row) => (place === "all" || row.place === place) && matchesQuery(row, q) && (position === "all" || positionOf(row) === position));
    return {
      all: base.length,
      ofis: rows.filter((row) => row.place === "ofis").length,
      dorixona: rows.filter((row) => row.place === "dorixona").length,
      open: base.filter((row) => row.face && row.qr).length,
      limited: base.filter((row) => !(row.face && row.qr)).length,
      blocked: base.filter((row) => !row.face && !row.qr).length,
      faceOnly: base.filter((row) => row.face && !row.qr).length,
      qrOnly: base.filter((row) => !row.face && row.qr).length,
    };
  }, [rows, place, q, position]);

  const applyLocal = (userIds: number[], patch: { face?: boolean; qr?: boolean }) => {
    const set = new Set(userIds);
    setRows((cur) => cur.map((row) => (set.has(row.userId) ? { ...row, ...patch } : row)));
  };

  const toggle = async (row: DavomatMethodAccessRow, key: "face" | "qr", next: boolean) => {
    setSavingId(row.userId);
    applyLocal([row.userId], { [key]: next });
    try {
      const saved = await saveDavomatMethodAccess({ userId: row.userId, [key]: next });
      applyLocal([row.userId], { face: saved.face, qr: saved.qr });
    } catch (err) {
      applyLocal([row.userId], { face: row.face, qr: row.qr });
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const setBoth = async (row: DavomatMethodAccessRow, on: boolean) => {
    setSavingId(row.userId);
    applyLocal([row.userId], { face: on, qr: on });
    try {
      const saved = await saveDavomatMethodAccess({ userId: row.userId, face: on, qr: on });
      applyLocal([row.userId], { face: saved.face, qr: saved.qr });
      toast({
        title: on ? "Qoldirildi" : "O‘chirildi",
        description: on
          ? `${row.fullName}: Face ID va QR yoqildi.`
          : `${row.fullName}: Face ID va QR o‘chirildi. Davomat qila olmaydi.`,
      });
    } catch (err) {
      applyLocal([row.userId], { face: row.face, qr: row.qr });
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const askBoth = (row: DavomatMethodAccessRow, on: boolean) => {
    setAsk({
      title: on ? "Qoldirish" : "O‘chirish",
      confirm: on ? "Ha, qoldirish" : "Ha, o‘chirish",
      danger: !on,
      text: on
        ? `${row.fullName} uchun Face ID ham, QR ham yoqiladi. Shu xodim ikkala usul bilan ham davomat qila oladi.`
        : `${row.fullName} uchun Face ID ham, QR ham o‘chiriladi. Davomat qila olmaydi. Keyin ruxsat berilmagan usulda «Aynan sizga ruxsat yo‘q» chiqadi.`,
      run: () => setBoth(row, on),
    });
  };

  const bulk = async (patch: { face?: boolean; qr?: boolean }, label: string) => {
    const ids = selected.filter((id) => filtered.some((row) => row.userId === id));
    if (!ids.length) return;
    const snapshot = rows.filter((row) => ids.includes(row.userId));
    setBulkBusy(true);
    applyLocal(ids, patch);
    try {
      await saveDavomatMethodAccessBulk({ userIds: ids, ...patch });
      toast({ title: label, description: `${ids.length} xodim yangilandi` });
      setSelected([]);
    } catch (err) {
      setRows((cur) => cur.map((row) => snapshot.find((item) => item.userId === row.userId) ?? row));
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  const askBulk = (patch: { face?: boolean; qr?: boolean }, title: string, text: string, confirm: string) => {
    const count = selected.filter((id) => filtered.some((row) => row.userId === id)).length;
    if (!count) return;
    setAsk({
      title,
      text: `${count} xodim. ${text}`,
      confirm,
      danger: patch.face === false,
      run: () => bulk(patch, title),
    });
  };

  const confirmAsk = async () => {
    if (!ask) return;
    setAskBusy(true);
    try {
      await ask.run();
      setAsk(null);
    } finally {
      setAskBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-medium text-rose-700">Bloklash oynasi faqat admin uchun.</p>
        <Link href="/davomat" className="mt-3 inline-block text-sm font-semibold text-[#0b3a5c] underline">
          Davomat hisobotga qaytish
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Davomat</p>
          <h1 className="text-xl font-semibold text-[#0f2744]">Bloklash oynasi</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Xodimga Face ID va QR ni alohida qoldirish yoki o‘chirish. Ruxsat berilmagan usulda «Aynan sizga ruxsat yo‘q» chiqadi.
          </p>
        </div>
        <Button type="button" variant="outline" className="h-9" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Yangilash
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Jami xodim" value={rows.length} />
        <Stat label="Ofis" value={counts.ofis} />
        <Stat label="Dorixona" value={counts.dorixona} />
        <Stat label="Cheklangan" value={rows.filter((row) => !(row.face && row.qr)).length} tone="rose" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Ism, familiya, lavozim — lotin yoki kirill"
            className="h-10 pl-9"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={place === "all"} onClick={() => setPlace("all")}>Hammasi</Chip>
          <Chip active={place === "ofis"} onClick={() => setPlace("ofis")}><Building2 className="h-3.5 w-3.5" /> Ofis</Chip>
          <Chip active={place === "dorixona"} onClick={() => setPlace("dorixona")}><Store className="h-3.5 w-3.5" /> Dorixona</Chip>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <Chip active={state === "all"} onClick={() => setState("all")}>Hammasi · {counts.all}</Chip>
          <Chip active={state === "open"} onClick={() => setState("open")}>Yoqilgan · {counts.open}</Chip>
          <Chip active={state === "limited"} onClick={() => setState("limited")}>O‘chirilgan · {counts.limited}</Chip>
          <Chip active={state === "blocked"} onClick={() => setState("blocked")}>To‘liq o‘chiq · {counts.blocked}</Chip>
          <Chip active={state === "face_only"} onClick={() => setState("face_only")}>Faqat Face ID · {counts.faceOnly}</Chip>
          <Chip active={state === "qr_only"} onClick={() => setState("qr_only")}>Faqat QR · {counts.qrOnly}</Chip>
        </div>

        <div className="mt-3">
          <select
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="all">Barcha lavozimlar</option>
            {positions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#0b3a5c]/20 bg-[#0b3a5c]/5 px-3 py-2">
          <span className="text-sm font-semibold text-[#0b3a5c]">{selected.length} tanlandi</span>
          <Button type="button" size="sm" variant="outline" disabled={bulkBusy} onClick={() => askBulk({ face: true, qr: true }, "Ikkalasini qoldirish", "Face ID ham, QR ham yoqiladi. Tanlangan xodimlar ikkala usul bilan davomat qila oladi.", "Ha, qoldirish")}>Ikkalasini qoldirish</Button>
          <Button type="button" size="sm" variant="outline" disabled={bulkBusy} onClick={() => askBulk({ face: true, qr: false }, "Faqat Face ID", "QR o‘chiriladi, Face ID qoladi. QR bosilsa «Aynan sizga ruxsat yo‘q» chiqadi.", "Ha, faqat Face ID")}>Faqat Face ID</Button>
          <Button type="button" size="sm" variant="outline" disabled={bulkBusy} onClick={() => askBulk({ face: false, qr: true }, "Faqat QR", "Face ID o‘chiriladi, QR qoladi. Face ID bosilsa «Aynan sizga ruxsat yo‘q» chiqadi.", "Ha, faqat QR")}>Faqat QR</Button>
          <Button type="button" size="sm" variant="destructive" disabled={bulkBusy} onClick={() => askBulk({ face: false, qr: false }, "To‘liq o‘chirish", "Face ID ham, QR ham o‘chiriladi. Tanlangan xodimlar davomat qila olmaydi.", "Ha, o‘chirish")}>To‘liq o‘chirish</Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
          <span>{filtered.length} xodim</span>
          <span>{page} / {pages}</span>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…</p>
        ) : view.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">Bu filtrda xodim yo‘q.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allViewSelected}
                      onChange={() => {
                        if (allViewSelected) setSelected((cur) => cur.filter((id) => !view.some((row) => row.userId === id)));
                        else setSelected((cur) => [...new Set([...cur, ...view.map((row) => row.userId)])]);
                      }}
                    />
                  </th>
                  <th className="px-3 py-2">Xodim</th>
                  <th className="px-3 py-2">Joy</th>
                  <th className="px-3 py-2">Holat</th>
                  <th className="px-3 py-2">Face ID</th>
                  <th className="px-3 py-2">QR</th>
                  <th className="px-3 py-2">Amal</th>
                </tr>
              </thead>
              <tbody>
                {view.map((row) => {
                  const mode = stateOf(row);
                  return (
                    <tr key={row.userId} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.userId)}
                          onChange={() => setSelected((cur) => cur.includes(row.userId) ? cur.filter((id) => id !== row.userId) : [...cur, row.userId])}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-[#0f2744]">{row.fullName}</p>
                        <p className="text-[11px] text-slate-500">{positionOf(row)}{row.location ? ` · ${row.location}` : ""}</p>
                      </td>
                      <td className="px-3 py-2 text-xs">{row.place === "dorixona" ? "Dorixona" : "Ofis"}</td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          mode === "open" && "bg-emerald-50 text-emerald-700",
                          mode === "blocked" && "bg-rose-50 text-rose-700",
                          mode === "face_only" && "bg-sky-50 text-sky-700",
                          mode === "qr_only" && "bg-violet-50 text-violet-700",
                        )}>
                          {mode === "open" ? "Yoqilgan" : mode === "blocked" ? "To‘liq o‘chiq" : mode === "face_only" ? "Faqat Face ID" : "Faqat QR"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-2 text-xs">
                          <ScanFace className="h-4 w-4 text-sky-600" />
                          <Switch checked={row.face} disabled={savingId === row.userId || bulkBusy} onCheckedChange={(on) => void toggle(row, "face", on)} />
                        </label>
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-2 text-xs">
                          <QrCode className="h-4 w-4 text-violet-600" />
                          <Switch checked={row.qr} disabled={savingId === row.userId || bulkBusy} onCheckedChange={(on) => void toggle(row, "qr", on)} />
                        </label>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={savingId === row.userId} onClick={() => askBoth(row, true)}>Qoldirish</Button>
                          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px] text-rose-700" disabled={savingId === row.userId} onClick={() => askBoth(row, false)}>O‘chirish</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Oldingi</Button>
            <Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>Keyingi</Button>
          </div>
        ) : null}
      </div>

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Ikkalasi ham o‘chsa, xodim davomat qila olmaydi. Koordinator uchun QR standart holatda yopiq — bu yerda ochsangiz, faqat shu xodimga ochiladi.
      </p>
      <Dialog open={ask != null} onOpenChange={(open) => { if (!open && !askBusy) setAsk(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ask?.title}</DialogTitle>
            <DialogDescription>{ask?.text}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={askBusy} onClick={() => setAsk(null)}>Bekor qilish</Button>
            <Button type="button" variant={ask?.danger ? "destructive" : "default"} disabled={askBusy} onClick={() => void confirmAsk()}>
              {askBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {ask?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "rose" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={cn("text-lg font-semibold", tone === "rose" ? "text-rose-600" : "text-[#0f2744]")}>{value}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
        active ? "border-[#0b3a5c] bg-[#0b3a5c] text-white" : "border-slate-200 bg-white text-slate-600",
      )}
    >
      {children}
    </button>
  );
}
