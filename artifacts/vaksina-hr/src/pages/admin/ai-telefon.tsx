import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Phone, PhoneCall, Trash2, Play, RefreshCw, Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { LiveCallStudio } from "@/components/calls/LiveCallStudio";
import {
  createAiCallJob,
  deleteAiCallJob,
  fetchAiCallJobs,
  fetchAiCallLogs,
  fetchAiCallStatus,
  fetchAiCallTargets,
  patchAiCallJob,
  runAiCallJobNow,
  type AiCallTarget,
} from "@/lib/ai-telefon-api";

function fmtDt(s: string) {
  try {
    return new Date(s).toLocaleString("uz-UZ", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function statusBadge(status: string) {
  if (status === "pending") return "bg-amber-100 text-amber-900";
  if (status === "running") return "bg-sky-100 text-sky-900";
  if (status === "done") return "bg-emerald-100 text-emerald-900";
  if (status === "failed") return "bg-rose-100 text-rose-900";
  return "bg-slate-100 text-slate-700";
}

function AiPlansPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AiCallTarget | null>(null);
  const [openScript, setOpenScript] = useState(
    "Assalomu alaykum. Bu AI Saydman. Vaksinahr platformasi bo‘yicha qisqa yordam uchun qo‘ng‘iroq qildim.",
  );
  const [conversational, setConversational] = useState(true);
  const [maxTurns, setMaxTurns] = useState(4);
  const [voice, setVoice] = useState<"male" | "female">("female");
  const [recurrence, setRecurrence] = useState<"once" | "daily">("once");
  const [scheduledLocal, setScheduledLocal] = useState(() => {
    const d = new Date(Date.now() + 5 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [dailyTime, setDailyTime] = useState("09:00");
  const [logJobId, setLogJobId] = useState<number | null>(null);

  const status = useQuery({
    queryKey: ["ai-telefon", "status"],
    queryFn: fetchAiCallStatus,
  });

  const targets = useQuery({
    queryKey: ["ai-telefon", "targets", q],
    queryFn: () => fetchAiCallTargets(q),
  });

  const jobs = useQuery({
    queryKey: ["ai-telefon", "jobs"],
    queryFn: fetchAiCallJobs,
    refetchInterval: 10_000,
  });

  const logs = useQuery({
    queryKey: ["ai-telefon", "logs", logJobId],
    queryFn: () => fetchAiCallLogs(logJobId ?? undefined),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["ai-telefon"] });
  };

  const createMut = useMutation({
    mutationFn: createAiCallJob,
    onSuccess: () => {
      toast({ title: "Reja saqlandi" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const runMut = useMutation({
    mutationFn: runAiCallJobNow,
    onSuccess: (r) => {
      toast({ title: r.message || "Qo‘ng‘iroq boshlandi" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: deleteAiCallJob,
    onSuccess: () => {
      toast({ title: "O‘chirildi" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      patchAiCallJob(id, { enabled, status: enabled ? "pending" : "cancelled" }),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const targetList = useMemo(() => targets.data?.targets || [], [targets.data]);

  const onCreate = () => {
    if (!selected) {
      toast({ title: "Xodim tanlang", variant: "destructive" });
      return;
    }
    if (!openScript.trim()) {
      toast({ title: "Ochilish matni kerak", variant: "destructive" });
      return;
    }
    const scheduledAt = recurrence === "once" ? new Date(scheduledLocal).toISOString() : undefined;
    createMut.mutate({
      targetUserId: selected.id,
      targetTelegramId: selected.telegramId,
      targetName: selected.fullName,
      openScript: openScript.trim(),
      conversational,
      maxTurns,
      voice,
      recurrence,
      dailyTime: recurrence === "daily" ? dailyTime : null,
      scheduledAt,
      enabled: true,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Telegram userbot orqali avtomatik chaqiruv — ochilish matni TTS + savol-javob.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={status.data?.configured ? "default" : "destructive"}>
            Userbot: {status.data?.configured ? "OK" : "sozlanmagan"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => invalidate()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Yangilash
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="h-4 w-4" /> Yangi reja
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Xodim (Telegram ulangan)</label>
              <Input placeholder="Qidirish…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="mt-2 max-h-40 overflow-auto rounded border">
                {targetList.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`flex w-full flex-col items-start border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/60 ${
                      selected?.id === t.id ? "bg-muted" : ""
                    }`}
                    onClick={() => setSelected(t)}
                  >
                    <span className="font-medium">{t.fullName}</span>
                    <span className="text-xs text-muted-foreground">
                      tg:{t.telegramId} · {t.role}
                    </span>
                  </button>
                ))}
                {!targetList.length && <p className="p-3 text-xs text-muted-foreground">Topilmadi</p>}
              </div>
              {selected && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Tanlangan: <b>{selected.fullName}</b>
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Ochilish matni (TTS)</label>
              <Textarea value={openScript} onChange={(e) => setOpenScript(e.target.value)} rows={4} />
              <p className="mt-1 text-xs text-muted-foreground">
                Shu yerga yozilgan matn qo‘ng‘iroqda aniq o‘qiladi; «Savol-javob» yoqilgan bo‘lsa, keyin tinglab javob beradi.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Savol-javob</p>
                <p className="text-xs text-muted-foreground">Faqat platforma mavzusi</p>
              </div>
              <Switch checked={conversational} onCheckedChange={setConversational} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Ovoz (sof o‘zbek)</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={voice === "male" ? "default" : "outline"}
                  onClick={() => setVoice("male")}
                >
                  Erkak
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={voice === "female" ? "default" : "outline"}
                  onClick={() => setVoice("female")}
                >
                  Ayol
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Max tur</label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Number(e.target.value) || 4)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Takrorlash</label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as "once" | "daily")}
                >
                  <option value="once">Bir marta</option>
                  <option value="daily">Har kuni</option>
                </select>
              </div>
            </div>

            {recurrence === "once" ? (
              <div>
                <label className="mb-1 block text-xs font-medium">Sana va soat</label>
                <Input
                  type="datetime-local"
                  value={scheduledLocal}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium">Har kuni (Toshkent)</label>
                <Input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} />
              </div>
            )}

            <Button className="w-full" onClick={onCreate} disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Saqlash
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PhoneCall className="h-4 w-4" /> Rejalar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(jobs.data?.jobs || []).map((j) => (
              <div key={j.id} className="rounded border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{j.targetName || j.targetTelegramId}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.recurrence === "daily" ? `Har kuni ${j.dailyTime}` : fmtDt(j.scheduledAt)}
                      {" · "}
                      {j.conversational ? "suhbat" : "faqat e’lon"}
                      {" · "}
                      {j.voice === "male" ? "erkak ovoz" : "ayol ovoz"}
                    </p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs ${statusBadge(j.status)}`}>{j.status}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{j.openScript}</p>
                {j.lastError && <p className="mt-1 text-xs text-rose-600">{j.lastError}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => runMut.mutate(j.id)}>
                    <Play className="mr-1 h-3 w-3" /> Hozir
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLogJobId(j.id)}>
                    Log
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleMut.mutate({ id: j.id, enabled: !j.enabled })}
                  >
                    {j.enabled ? "O‘chirish" : "Yoqish"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => delMut.mutate(j.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            {!jobs.data?.jobs?.length && <p className="text-sm text-muted-foreground">Hali reja yo‘q</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tarix {logJobId != null ? `(job #${logJobId})` : ""}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(logs.data?.logs || []).slice(0, 20).map((l) => (
            <div key={l.id} className="rounded border p-3 text-sm">
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  job #{l.jobId} · {l.outcome}
                </span>
                <span>{fmtDt(l.startedAt)}</span>
              </div>
              <div className="mt-2 space-y-1">
                {(l.transcript || []).map((t, i) => (
                  <p key={i} className="text-xs">
                    <b>{t.role}:</b> {t.text}
                  </p>
                ))}
              </div>
            </div>
          ))}
          {!logs.data?.logs?.length && <p className="text-sm text-muted-foreground">Loglar yo‘q</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AiTelefonPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Faqat bosh admin uchun.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Telefon</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Telegram orqali live qo‘ng‘iroq (sof o‘zbek erkak/ayol ovoz) va AI rejalari — bir panelda.
        </p>
      </div>

      <Tabs defaultValue="live" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="live" className="gap-1.5">
            <Radio className="h-3.5 w-3.5" /> Live studio
          </TabsTrigger>
          <TabsTrigger value="plans" className="gap-1.5">
            <PhoneCall className="h-3.5 w-3.5" /> AI rejalari
          </TabsTrigger>
        </TabsList>
        <TabsContent value="live" className="mt-6">
          <LiveCallStudio />
        </TabsContent>
        <TabsContent value="plans" className="mt-6">
          <AiPlansPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
