import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  Check,
  Copy,
  Crown,
  Loader2,
  Mic,
  MicOff,
  Search,
  Send,
  Settings2,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CallAvatar } from "@/components/calls/CallLayer";
import {
  DEFAULT_SETTINGS,
  conferenceApi,
  conferenceLink,
  copyText,
  type ConfSettings,
  type Invitee,
  type Person,
} from "@/lib/conference/api";

type Selected = Invitee & { fullName: string; position: string | null };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextSlot() {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

const DURATIONS = [30, 45, 60, 90, 120];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition",
            value === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Section({ icon, title, children, extra }: { icon: ReactNode; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
          {title}
        </h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function ConferenceFormDialog({
  open,
  onOpenChange,
  editCode,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Tahrirlash rejimi */
  editCode?: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const editing = Boolean(editCode);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => toDateInput(nextSlot()));
  const [time, setTime] = useState(() => toTimeInput(nextSlot()));
  const [duration, setDuration] = useState(60);
  const [settings, setSettings] = useState<ConfSettings>(DEFAULT_SETTINGS);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [notify, setNotify] = useState(true);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ code: string; invited: number } | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const dq = useDebounced(q.trim());

  const details = useQuery({
    queryKey: ["conference", editCode],
    queryFn: () => conferenceApi.details(editCode!),
    enabled: open && editing,
  });

  useEffect(() => {
    if (!open) return;
    if (!editing) {
      if (loadedFor !== "new") {
        const slot = nextSlot();
        setTitle("");
        setDescription("");
        setDate(toDateInput(slot));
        setTime(toTimeInput(slot));
        setDuration(60);
        setSettings(DEFAULT_SETTINGS);
        setSelected([]);
        setNotify(true);
        setCreated(null);
        setQ("");
        setLoadedFor("new");
      }
      return;
    }
    const d = details.data;
    if (!d || loadedFor === editCode) return;
    const c = d.conference;
    const when = new Date(c.scheduledAt);
    setTitle(c.title);
    setDescription(c.description ?? "");
    setDate(toDateInput(when));
    setTime(toTimeInput(when));
    setDuration(c.durationMin);
    setSettings(c.settings);
    setSelected(
      (d.members ?? [])
        .filter((m) => m.invited && m.role !== "host")
        .map((m) => ({
          userId: m.userId,
          fullName: m.fullName,
          position: m.position,
          role: m.role === "cohost" ? "cohost" : "participant",
          canSpeak: m.canSpeak,
        })),
    );
    setNotify(true);
    setCreated(null);
    setLoadedFor(editCode ?? null);
  }, [open, editing, editCode, details.data, loadedFor]);

  useEffect(() => {
    if (!open) setLoadedFor(null);
  }, [open]);

  const people = useQuery({
    queryKey: ["conference-people", dq],
    queryFn: () => conferenceApi.people({ q: dq, code: editCode ?? undefined }),
    enabled: open && dq.length >= 2,
    staleTime: 60_000,
  });
  const departments = useQuery({
    queryKey: ["conference-departments"],
    queryFn: () => conferenceApi.departments(),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.userId)), [selected]);

  const addPeople = (list: Person[]) => {
    setSelected((prev) => {
      const have = new Set(prev.map((p) => p.userId));
      const add = list
        .filter((p) => !have.has(p.id))
        .map<Selected>((p) => ({ userId: p.id, fullName: p.fullName, position: p.position, role: "participant", canSpeak: null }));
      return [...prev, ...add];
    });
  };

  const addDepartment = async (id: number) => {
    try {
      const { items } = await conferenceApi.people({ departmentId: id, code: editCode ?? undefined });
      addPeople(items);
      toast({ title: `${items.length} kishi qo‘shildi` });
    } catch (e) {
      toast({ title: "Xatolik", description: (e as Error).message, variant: "destructive" });
    }
  };

  const patchSel = (userId: number, patch: Partial<Selected>) =>
    setSelected((prev) => prev.map((s) => (s.userId === userId ? { ...s, ...patch } : s)));

  const speakDefault = settings.speakMode === "all";

  const submit = async (startNow = false) => {
    if (!title.trim()) {
      toast({ title: "Mavzuni kiriting", variant: "destructive" });
      return;
    }
    const when = startNow ? new Date() : new Date(`${date}T${time}`);
    if (Number.isNaN(when.getTime())) {
      toast({ title: "Sana yoki vaqt noto‘g‘ri", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || null,
        scheduledAt: when.toISOString(),
        durationMin: duration,
        settings,
        invitees: selected.map(({ userId, role, canSpeak }) => ({ userId, role, canSpeak })),
        notify,
      };
      if (editing && editCode) {
        await conferenceApi.update(editCode, input);
        toast({ title: "Saqlandi" });
        onSaved();
        onOpenChange(false);
      } else {
        const out = await conferenceApi.create(input);
        onSaved();
        if (startNow) {
          window.location.assign(`/konferensiya/${out.code}`);
          return;
        }
        setCreated({ code: out.code, invited: out.invited });
      }
    } catch (e) {
      toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const results = (people.data?.items ?? []).filter((p) => !selectedIds.has(p.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl gap-0 overflow-hidden p-0 sm:rounded-3xl">
        {created ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
              <Check className="h-8 w-8" />
            </div>
            <DialogTitle className="mt-4 text-xl">Konferensiya yaratildi</DialogTitle>
            <DialogDescription className="mt-1.5 max-w-md">
              {created.invited
                ? `${created.invited} kishiga taklif ${notify ? "va bot orqali xabar " : ""}yuborildi. Belgilangan vaqtda havola orqali kiradi.`
                : "Havolani kerakli odamlarga yuboring — ular tizimga kirib, shu havola orqali qo‘shiladi."}
            </DialogDescription>
            <div className="mt-5 flex w-full max-w-md items-center gap-2 rounded-2xl border bg-muted/40 p-1.5 pl-4">
              <span className="min-w-0 flex-1 truncate text-left font-mono text-sm">{conferenceLink(created.code)}</span>
              <button
                type="button"
                onClick={async () => {
                  if (await copyText(conferenceLink(created.code))) toast({ title: "Havola nusxalandi" });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
              >
                <Copy className="h-3.5 w-3.5" /> Nusxalash
              </button>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-xl border px-4 py-2.5 text-sm font-semibold transition hover:bg-muted"
              >
                Yopish
              </button>
              <a
                href={`/konferensiya/${created.code}`}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition hover:bg-emerald-700"
              >
                <Video className="h-4 w-4" /> Konferensiyaga kirish
              </a>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader className="border-b bg-gradient-to-br from-[#062e2a] via-[#0b4d5c] to-[#0b5fff] px-6 py-5 text-left text-white">
              <DialogTitle className="text-xl text-white">{editing ? "Konferensiyani tahrirlash" : "Yangi konferensiya"}</DialogTitle>
              <DialogDescription className="text-white/75">
                Mavzu, vaqt va ishtirokchilarni belgilang. Taklif qilinganlarga bot orqali kirish havolasi boradi.
              </DialogDescription>
            </DialogHeader>

            {editing && details.isLoading ? (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Yuklanmoqda…
              </div>
            ) : (
              <div className="max-h-[calc(92vh-11rem)] space-y-4 overflow-y-auto bg-muted/20 p-4 sm:p-5 [scrollbar-width:thin]">
                <Section icon={<CalendarClock className="h-4 w-4" />} title="Asosiy ma’lumot">
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Mavzu, masalan: Haftalik yig‘ilish"
                    maxLength={120}
                    className="h-11 rounded-xl"
                  />
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Kun tartibi yoki izoh (ixtiyoriy)"
                    maxLength={1000}
                    rows={2}
                    className="resize-none rounded-xl"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Sana</span>
                      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Boshlanish vaqti</span>
                      <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11 rounded-xl" />
                    </label>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Davomiyligi</span>
                    <div className="flex flex-wrap gap-1.5">
                      {DURATIONS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDuration(m)}
                          className={cn(
                            "rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                            duration === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                          )}
                        >
                          {m < 60 ? `${m} daq` : m % 60 ? `${Math.floor(m / 60)} s ${m % 60} daq` : `${m / 60} soat`}
                        </button>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section
                  icon={<Users className="h-4 w-4" />}
                  title={`Ishtirokchilar · ${selected.length}`}
                  extra={
                    selected.length ? (
                      <button type="button" onClick={() => setSelected([])} className="text-xs font-medium text-muted-foreground hover:text-destructive">
                        Hammasini olib tashlash
                      </button>
                    ) : null
                  }
                >
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Ism, lavozim yoki bo‘lim bo‘yicha qidirish…"
                      className="h-11 rounded-xl pl-9"
                    />
                  </div>
                  {dq.length >= 2 ? (
                    <div className="max-h-56 overflow-y-auto rounded-xl border bg-background [scrollbar-width:thin]">
                      {people.isLoading ? (
                        <p className="p-3 text-xs text-muted-foreground">Qidirilmoqda…</p>
                      ) : results.length === 0 ? (
                        <p className="p-3 text-xs text-muted-foreground">Hech kim topilmadi</p>
                      ) : (
                        <>
                          {results.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => addPeople(results)}
                              className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs font-semibold text-primary hover:bg-muted"
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Hammasini qo‘shish ({results.length})
                            </button>
                          ) : null}
                          {results.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => addPeople([p])}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-muted"
                            >
                              <CallAvatar id={p.id} name={p.fullName} className="h-8 w-8 text-xs" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{p.fullName}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {[p.position, p.department].filter(Boolean).join(" · ") || "Xodim"}
                                </span>
                              </span>
                              <UserPlus className="h-4 w-4 text-muted-foreground" />
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  ) : null}
                  {(departments.data?.items ?? []).length ? (
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <select
                        value=""
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          if (id) void addDepartment(id);
                        }}
                        className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                      >
                        <option value="">Bo‘lim bo‘yicha butunlay qo‘shish…</option>
                        {departments.data!.items.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.people})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {selected.length ? (
                    <div className="max-h-72 divide-y overflow-y-auto rounded-xl border bg-background [scrollbar-width:thin]">
                      {selected.map((s) => {
                        const speaks = s.role === "cohost" || (s.canSpeak ?? speakDefault);
                        return (
                          <div key={s.userId} className="flex items-center gap-2 px-3 py-2">
                            <CallAvatar id={s.userId} name={s.fullName} className="h-8 w-8 text-xs" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{s.fullName}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {s.role === "cohost" ? "Yordamchi tashkilotchi" : s.position || "Ishtirokchi"}
                              </p>
                            </div>
                            <button
                              type="button"
                              title={s.role === "cohost" ? "Yordamchi tashkilotchi — olib tashlash" : "Yordamchi tashkilotchi qilish"}
                              onClick={() => patchSel(s.userId, { role: s.role === "cohost" ? "participant" : "cohost" })}
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-lg transition",
                                s.role === "cohost" ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15" : "text-muted-foreground hover:bg-muted",
                              )}
                            >
                              <Crown className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={s.role === "cohost"}
                              title={speaks ? "Gapira oladi — bosib taqiqlash" : "Gapira olmaydi — bosib ruxsat berish"}
                              onClick={() => patchSel(s.userId, { canSpeak: !speaks })}
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40",
                                speaks ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15" : "bg-red-50 text-red-500 dark:bg-red-500/10",
                              )}
                            >
                              {speaks ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                            </button>
                            <button
                              type="button"
                              title="Olib tashlash"
                              onClick={() => setSelected((prev) => prev.filter((x) => x.userId !== s.userId))}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-red-50 hover:text-red-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                      Hali hech kim tanlanmagan. Taklif qilinmaganlar ham havola orqali kira oladi.
                    </p>
                  )}
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <Crown className="mr-1 inline h-3 w-3 text-amber-500" />— yordamchi tashkilotchi (boshqaruv huquqi).
                    <Mic className="mx-1 inline h-3 w-3 text-emerald-600" />— gapirish ruxsati (boshlanishdan oldin belgilanadi, ichkarida ham o‘zgartiriladi).
                  </p>
                </Section>

                <Section icon={<Settings2 className="h-4 w-4" />} title="Boshqaruv sozlamalari">
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Kim gapira oladi</span>
                    <Segmented
                      value={settings.speakMode}
                      onChange={(v) => setSettings((s) => ({ ...s, speakMode: v }))}
                      options={[
                        ["all", "Hamma"],
                        ["selected", "Faqat ruxsat berilganlar"],
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Kamera yoqish</span>
                    <Segmented
                      value={settings.cameraMode}
                      onChange={(v) => setSettings((s) => ({ ...s, cameraMode: v }))}
                      options={[
                        ["all", "Hamma"],
                        ["speakers", "Faqat gapiruvchilar"],
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Ekran ulashish</span>
                    <Segmented
                      value={settings.screenMode}
                      onChange={(v) => setSettings((s) => ({ ...s, screenMode: v }))}
                      options={[
                        ["all", "Hamma"],
                        ["speakers", "Gapiruvchilar"],
                        ["hosts", "Faqat tashkilotchi"],
                      ]}
                    />
                  </div>
                  <div className="divide-y">
                    <ToggleRow label="Chat" hint="Ishtirokchilar yozishmasi" checked={settings.chat} onChange={(v) => setSettings((s) => ({ ...s, chat: v }))} />
                    <ToggleRow
                      label="Kirganda mikrofon o‘chiq"
                      checked={settings.muteOnJoin}
                      onChange={(v) => setSettings((s) => ({ ...s, muteOnJoin: v }))}
                    />
                    <ToggleRow
                      label="Kirganda kamera o‘chiq"
                      checked={settings.camOffOnJoin}
                      onChange={(v) => setSettings((s) => ({ ...s, camOffOnJoin: v }))}
                    />
                  </div>
                </Section>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:px-5">
              <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                <Switch checked={notify} onCheckedChange={setNotify} />
                <Send className="h-3.5 w-3.5" /> Botga va tizimga xabar yuborish
              </label>
              {!editing ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submit(true)}
                  className="rounded-xl border px-4 py-2.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
                >
                  Hoziroq boshlash
                </button>
              ) : null}
              <button
                type="button"
                disabled={saving || (editing && details.isLoading)}
                onClick={() => void submit(false)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                {editing ? "Saqlash" : "Rejalashtirish"}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
