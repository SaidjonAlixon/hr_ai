import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLetterSettings, useSaveLetterSettings } from "@/lib/explanation-letters-api";

const MAX_LINES = 4;

/** Barcha tushuntirish xatlarining shapkasi — bir joyda o‘zgartiriladi */
export function LetterHeaderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const settings = useLetterSettings(open);
  const save = useSaveLetterSettings();
  const [lines, setLines] = useState<string[]>([]);
  const [company, setCompany] = useState("");

  useEffect(() => {
    if (!open || !settings.data) return;
    setLines(settings.data.headerLines);
    setCompany(settings.data.companyName);
  }, [open, settings.data]);

  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const canSave = clean.length > 0 && company.trim().length >= 3 && !save.isPending;

  const submit = () =>
    save.mutate(
      { headerLines: clean, companyName: company.trim() },
      {
        onSuccess: () => {
          toast({ title: "Shapka saqlandi", description: "Barcha tushuntirish xatlari va PDF nusxalar yangi shapka bilan chiqadi." });
          onClose();
        },
        onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !save.isPending && onClose()}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-3xl gap-4 overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-base sm:text-lg">Tushuntirish xati shapkasi</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Shapka o‘ng tomonda «kimga» yoziladigan qatorlar. Saqlangach barcha xatlarda (oldingi imzolanganlarida ham) va PDF
            nusxalarda darhol yangilanadi.
          </DialogDescription>
        </DialogHeader>

        {settings.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Shapka qatorlari (kimga)</p>
                {lines.map((line, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      value={line}
                      maxLength={80}
                      onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                      placeholder={i === 0 ? "«VAKSINA HEALTHCARE» MChJ" : "direktori F.I.Sh.ga"}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 shrink-0 rounded-xl"
                      disabled={lines.length <= 1}
                      onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                      title="Qatorni o‘chirish"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {lines.length < MAX_LINES ? (
                  <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 rounded-lg text-xs" onClick={() => setLines((p) => [...p, ""])}>
                    <Plus className="h-3.5 w-3.5" /> Qator qo‘shish
                  </Button>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Matndagi tashkilot nomi</p>
                <input
                  value={company}
                  maxLength={120}
                  onChange={(e) => setCompany(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
                />
                <p className="text-[11px] text-slate-500">«Men, … {company || "tashkilot"}ning … filialida …» gapiga qo‘yiladi.</p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">Ko‘rinishi</p>
              <div className="relative overflow-hidden rounded-xl bg-white p-4 pt-6 text-[#111827] shadow-sm ring-1 ring-slate-200" style={{ fontFamily: '"DejaVu Sans", "Segoe UI", Arial, sans-serif' }}>
                <div className="absolute inset-x-0 top-0 h-1.5 bg-[#0b3a5c]" />
                <div className="flex gap-3">
                  <div className="h-14 w-14 shrink-0 border border-dashed border-slate-300" />
                  <div className="min-w-0 flex-1 text-[11.5px] leading-snug">
                    {(clean.length ? clean : ["—"]).map((l, i) => (
                      <p key={i} className="truncate text-right font-bold">
                        {l}
                      </p>
                    ))}
                    <p className="mt-1.5 border-b border-slate-600 text-[10.5px]">jamiyatning Farmasevt</p>
                    <p className="text-[10.5px]">lavozimida faoliyat yurituvchi xodim</p>
                    <p className="border-b border-slate-600 text-[10.5px] font-bold">F.I.Sh.dan</p>
                  </div>
                </div>
                <div className="mt-3 h-[2px] bg-[#0b3a5c]" />
                <p className="mt-3 text-center text-[12px] font-bold tracking-[0.2em]">TUSHUNTIRISH XATI</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="rounded-xl" onClick={onClose} disabled={save.isPending}>
            Bekor
          </Button>
          <Button type="button" className="gap-1.5 rounded-xl bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]/90" disabled={!canSave} onClick={submit}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Saqlash
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
