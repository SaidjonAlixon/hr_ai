import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { canManageSettings } from "../../lib/roles";
import {
  fetchAttendanceSettings,
  patchAttendanceSettings,
  type ShiftTimes,
} from "../../lib/attendance-settings-api";
import { Skeleton } from "../../components/ui/skeleton";

type FormState = {
  one: { start: string; end: string };
  two: { start: string; end: string };
  three: { start: string; end: string; overnight: boolean };
  office: { start: string; end: string };
  graceMinutes: number;
  unpaidBreakOneMin: number;
  unpaidBreakOfficeMin: number;
};

function fromApi(s?: ShiftTimes | null) {
  return { start: s?.start || "09:00", end: s?.end || "18:00" };
}

const DEFAULT_FORM: FormState = {
  one: { start: "08:00", end: "17:00" },
  two: { start: "17:00", end: "23:45" },
  three: { start: "23:00", end: "07:00", overnight: true },
  office: { start: "09:00", end: "18:00" },
  graceMinutes: 15,
  unpaidBreakOneMin: 60,
  unpaidBreakOfficeMin: 60,
};

function TimeRow({
  label,
  hint,
  start,
  end,
  onStart,
  onEnd,
  overnight,
  onOvernight,
}: {
  label: string;
  hint?: string;
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  overnight?: boolean;
  onOvernight?: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {onOvernight ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={overnight}
              onChange={(e) => onOvernight(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Tungi (keyingi kun)
          </label>
        ) : null}
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Boshlanish</Label>
          <Input type="time" value={start} onChange={(e) => onStart(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tugash</Label>
          <Input type="time" value={end} onChange={(e) => onEnd(e.target.value)} className="h-9" />
        </div>
      </div>
    </div>
  );
}

export default function AdminSmenaSozlamalarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canEdit = canManageSettings(user?.role);

  const q = useQuery({
    queryKey: ["attendance-settings"],
    queryFn: fetchAttendanceSettings,
  });

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (!q.data) return;
    try {
      const s = q.data.shifts;
      const settings = (q.data.settings || {}) as {
        graceMinutes?: number;
        unpaidBreakByShift?: { one?: number; office?: number };
      };
      setForm({
        one: fromApi(s?.one),
        two: fromApi(s?.two),
        three: { ...fromApi(s?.three), overnight: !!s?.three?.overnight },
        office: fromApi(s?.office),
        graceMinutes: Number(settings.graceMinutes ?? 15),
        unpaidBreakOneMin: Number(settings.unpaidBreakByShift?.one ?? 60),
        unpaidBreakOfficeMin: Number(settings.unpaidBreakByShift?.office ?? 60),
      });
    } catch {
      setForm(DEFAULT_FORM);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Forma bo‘sh");
      return patchAttendanceSettings({
        shifts: {
          one: form.one,
          two: form.two,
          three: form.three,
          office: form.office,
        },
        graceMinutes: form.graceMinutes,
        unpaidBreakOneMin: form.unpaidBreakOneMin,
        unpaidBreakOfficeMin: form.unpaidBreakOfficeMin,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-settings"] });
      toast({ title: "Smena vaqtlari saqlandi" });
    },
    onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
  });

  if (q.isError && !form) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <p className="text-sm text-rose-600">
          Sozlamalar yuklanmadi: {(q.error as Error)?.message || "xato"}
        </p>
        <Button type="button" variant="outline" onClick={() => void q.refetch()}>
          Qayta urinish
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setForm(DEFAULT_FORM)}
        >
          Standart qiymatlar bilan ochish
        </Button>
      </div>
    );
  }

  if (q.isLoading || !form) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Clock3 className="h-5 w-5" />
          Smena sozlamalari
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Smena faqat mudir, farmasevt va stajyor uchun. Ofis xodimlari smenasiz — belgilangan ish vaqti.
        </p>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Apteka smenalari</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <TimeRow
            label="1-smena"
            hint="Masalan 08:00–17:00"
            start={form.one.start}
            end={form.one.end}
            onStart={(v) => setForm((f) => (f ? { ...f, one: { ...f.one, start: v } } : f))}
            onEnd={(v) => setForm((f) => (f ? { ...f, one: { ...f.one, end: v } } : f))}
          />
          <TimeRow
            label="2-smena"
            hint="Masalan 17:00–23:45"
            start={form.two.start}
            end={form.two.end}
            onStart={(v) => setForm((f) => (f ? { ...f, two: { ...f.two, start: v } } : f))}
            onEnd={(v) => setForm((f) => (f ? { ...f, two: { ...f.two, end: v } } : f))}
          />
          <TimeRow
            label="3-smena (tungi)"
            hint="Masalan 23:00–07:00"
            start={form.three.start}
            end={form.three.end}
            overnight={form.three.overnight}
            onOvernight={(v) => setForm((f) => (f ? { ...f, three: { ...f.three, overnight: v } } : f))}
            onStart={(v) => setForm((f) => (f ? { ...f, three: { ...f.three, start: v } } : f))}
            onEnd={(v) => setForm((f) => (f ? { ...f, three: { ...f.three, end: v } } : f))}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Kechikish (daq)</Label>
              <Input
                type="number"
                min={0}
                max={120}
                value={form.graceMinutes}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, graceMinutes: Number(e.target.value) || 0 } : f))
                }
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">1-smena tushlik (daq, unpaid)</Label>
              <Input
                type="number"
                min={0}
                max={180}
                value={form.unpaidBreakOneMin}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, unpaidBreakOneMin: Number(e.target.value) || 0 } : f))
                }
                className="h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Ofis (smena yo‘q)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-xs text-muted-foreground">
            Ofis xodimlari smena tanlamaydi — faqat shu belgilangan vaqtga ishlaydi.
          </p>
          <TimeRow
            label="Ofis ish vaqti"
            start={form.office.start}
            end={form.office.end}
            onStart={(v) => setForm((f) => (f ? { ...f, office: { ...f.office, start: v } } : f))}
            onEnd={(v) => setForm((f) => (f ? { ...f, office: { ...f.office, end: v } } : f))}
          />
          <div className="space-y-1">
            <Label className="text-xs">Ofis tushlik (daq, unpaid)</Label>
            <Input
              type="number"
              min={0}
              max={180}
              value={form.unpaidBreakOfficeMin}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, unpaidBreakOfficeMin: Number(e.target.value) || 0 } : f))
              }
              className="h-9 max-w-[12rem]"
            />
          </div>
        </CardContent>
      </Card>

      {canEdit ? (
        <Button className="w-full sm:w-auto" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-2 h-4 w-4" />
          {save.isPending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">O‘zgartirish faqat admin yoki direktor uchun.</p>
      )}
    </div>
  );
}
