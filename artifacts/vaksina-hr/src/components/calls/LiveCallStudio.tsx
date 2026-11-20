import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Phone, PhoneCall, Search, User, UserRound } from "lucide-react";
import { CallAvatar } from "@/components/calls/CallLayer";
import { VoiceWaveform } from "@/components/calls/VoiceWaveform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  fetchAiCallLogs,
  fetchAiCallStatus,
  fetchAiCallTargets,
  startLiveTelegramCall,
  type AiCallTarget,
  type AiCallVoice,
} from "@/lib/ai-telefon-api";

function fmtDt(s: string) {
  try {
    return new Date(s).toLocaleString("uz-UZ", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

export function LiveCallStudio() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AiCallTarget | null>(null);
  const [voice, setVoice] = useState<AiCallVoice>("female");
  const [conversational, setConversational] = useState(true);
  const [openScript, setOpenScript] = useState(
    "Assalomu alaykum. Bu AI Saydman. Vaksinahr platformasi bo‘yicha qisqa yordam uchun qo‘ng‘iroq qildim.",
  );
  const [callingName, setCallingName] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["ai-telefon", "status"],
    queryFn: fetchAiCallStatus,
    refetchInterval: 5_000,
  });

  const targets = useQuery({
    queryKey: ["ai-telefon", "targets", q],
    queryFn: () => fetchAiCallTargets(q),
  });

  const logs = useQuery({
    queryKey: ["ai-telefon", "logs", "live"],
    queryFn: () => fetchAiCallLogs(),
    refetchInterval: 8_000,
  });

  const liveMut = useMutation({
    mutationFn: startLiveTelegramCall,
    onSuccess: (r) => {
      toast({ title: r.message || "Telegram qo‘ng‘iroq boshlandi" });
      void qc.invalidateQueries({ queryKey: ["ai-telefon"] });
    },
    onError: (e: Error) => {
      setCallingName(null);
      toast({ title: e.message, variant: "destructive" });
    },
  });

  const busy = Boolean(status.data?.busy || liveMut.isPending || callingName);
  const list = useMemo(() => targets.data?.targets || [], [targets.data]);

  useEffect(() => {
    if (!status.data?.busy && callingName && !liveMut.isPending) {
      // band tugasa UI ni bo‘shatamiz
      const t = setTimeout(() => setCallingName(null), 800);
      return () => clearTimeout(t);
    }
  }, [status.data?.busy, callingName, liveMut.isPending]);

  const startCall = () => {
    if (!selected) {
      toast({ title: "Telegram ulangan xodim tanlang", variant: "destructive" });
      return;
    }
    if (!openScript.trim()) {
      toast({ title: "Ochilish matni kerak", variant: "destructive" });
      return;
    }
    if (!status.data?.configured) {
      toast({ title: "Telegram userbot sozlanmagan", variant: "destructive" });
      return;
    }
    setCallingName(selected.fullName);
    liveMut.mutate({
      targetUserId: selected.id,
      targetTelegramId: selected.telegramId,
      targetName: selected.fullName,
      openScript: openScript.trim(),
      conversational,
      maxTurns: 4,
      voice,
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Telegram ulangan xodim…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="max-h-[480px] overflow-auto rounded-2xl border bg-card/60">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-0 hover:bg-muted/50",
                selected?.id === t.id && "bg-muted",
              )}
              onClick={() => setSelected(t)}
            >
              <CallAvatar id={t.id} name={t.fullName} className="h-10 w-10 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  tg:{t.telegramId}
                  {t.role ? ` · ${t.role}` : ""}
                </p>
              </div>
              {selected?.id === t.id ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  tanlangan
                </Badge>
              ) : null}
            </button>
          ))}
          {!list.length && (
            <p className="p-4 text-sm text-muted-foreground">Telegram ulangan xodim topilmadi</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "relative overflow-hidden rounded-3xl border shadow-xl",
            "min-h-[380px] bg-[radial-gradient(ellipse_at_top,_#123524_0%,_#0b1220_55%,_#05080f_100%)]",
          )}
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center text-white">
            {selected || callingName ? (
              <>
                <CallAvatar
                  id={selected?.id || 1}
                  name={callingName || selected?.fullName || "Xodim"}
                  className="relative h-28 w-28 text-4xl ring-4 ring-emerald-400/30"
                />
                <div>
                  <p className="text-xl font-semibold tracking-tight">
                    {callingName || selected?.fullName}
                  </p>
                  <p className="mt-1 text-sm text-white/70">
                    {busy
                      ? "Telegram orqali qo‘ng‘iroq…"
                      : `tg:${selected?.telegramId} · platformadan emas, Telegram`}
                  </p>
                </div>
                <VoiceWaveform stream={null} active={busy} simulated className="opacity-90" />
                {busy ? (
                  <Badge className="gap-1.5 bg-emerald-600 hover:bg-emerald-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Telegram chaqiruv
                  </Badge>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
                  <PhoneCall className="h-10 w-10 text-white/80" />
                </div>
                <div>
                  <p className="text-lg font-semibold">Telegram Live studio</p>
                  <p className="mt-1 max-w-md text-sm text-white/65">
                    Chapdan Telegram ulangan xodimni tanlang. Qo‘ng‘iroq Telegram orqali ketadi —
                    platforma WebRTC emas.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-card/70 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Ovoz (sof o‘zbek)</p>
              <p className="text-xs text-muted-foreground">Erkak yoki ayol diktor — xatosiz o‘qish</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={voice === "male" ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => setVoice("male")}
              >
                <UserRound className="h-3.5 w-3.5" /> Erkak
              </Button>
              <Button
                type="button"
                size="sm"
                variant={voice === "female" ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => setVoice("female")}
              >
                <User className="h-3.5 w-3.5" /> Ayol
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Ochilish matni (Telegramda o‘qiladi)</label>
            <Textarea value={openScript} onChange={(e) => setOpenScript(e.target.value)} rows={3} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Savol-javob</p>
              <p className="text-xs text-muted-foreground">Telegram qo‘ng‘iroqda tinglab javob beradi</p>
            </div>
            <Switch checked={conversational} onCheckedChange={setConversational} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.data?.configured ? "default" : "destructive"}>
              Userbot: {status.data?.configured ? "OK" : "sozlanmagan"}
            </Badge>
            {status.data?.busy ? <Badge variant="secondary">Band</Badge> : null}
            <Button className="ml-auto gap-2" disabled={busy || !selected} onClick={startCall}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              Telegramdan qo‘ng‘iroq
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border bg-card/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">So‘nggi Telegram suhbatlar</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void qc.invalidateQueries({ queryKey: ["ai-telefon", "logs"] })}
            >
              Yangilash
            </Button>
          </div>
          <div className="space-y-2">
            {(logs.data?.logs || []).slice(0, 8).map((l) => (
              <div key={l.id} className="rounded-xl border px-3 py-2 text-sm">
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    job #{l.jobId} · {l.outcome}
                  </span>
                  <span>{fmtDt(l.startedAt)}</span>
                </div>
                {(l.transcript || []).slice(0, 2).map((t, i) => (
                  <p key={i} className="mt-1 line-clamp-2 text-xs">
                    <b>{t.role}:</b> {t.text}
                  </p>
                ))}
              </div>
            ))}
            {!logs.data?.logs?.length && (
              <p className="text-sm text-muted-foreground">Hali suhbat yo‘q</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
