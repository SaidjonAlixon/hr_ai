import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  Clock,
  Loader2,
  MessageSquare,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
const isAdminOnly = (role?: string | null) => role === "admin";
import { cn } from "@/lib/utils";
import {
  AI_KIND_LABEL,
  AI_STATUS_LABEL,
  approveAiProposal,
  fetchAiGroups,
  fetchAiMessages,
  fetchAiOverview,
  rejectAiProposal,
  replyAiConversation,
  setAiGroupEnabled,
  type AiGroup,
  type AiProposal,
} from "@/lib/ai-assistant-api";

function fmtDt(s: string) {
  try {
    return new Date(s).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}

function statusClass(status: string) {
  if (status === "pending") return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200";
  if (status === "executed") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "rejected") return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

export default function YordamchiAiPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedConv, setSelectedConv] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});

  const overview = useQuery({
    queryKey: ["ai-assistant", "overview"],
    queryFn: fetchAiOverview,
    refetchInterval: 15_000,
    enabled: isAdminOnly(user?.role),
  });

  const messages = useQuery({
    queryKey: ["ai-assistant", "messages", selectedConv],
    queryFn: () => fetchAiMessages(selectedConv!),
    enabled: selectedConv != null,
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["ai-assistant"] });
  };

  const groups = useQuery({
    queryKey: ["ai-assistant", "groups"],
    queryFn: fetchAiGroups,
    refetchInterval: 30_000,
    enabled: isAdminOnly(user?.role),
  });

  const toggleGroup = useMutation({
    mutationFn: (g: AiGroup) => setAiGroupEnabled(g.chatId, !g.enabled),
    onSuccess: (_r, g) => {
      toast({
        title: g.enabled ? "Guruhda bot o‘chirildi" : "Guruhda bot yoqildi",
        description: g.title || g.chatId,
      });
      invalidate();
    },
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: (p: AiProposal) => approveAiProposal(p.id, notes[p.id]),
    onSuccess: (r) => {
      toast({ title: "Tasdiqlandi va bajarildi", description: r.result });
      invalidate();
    },
    onError: (e) => toast({ title: "Bajarilmadi", description: (e as Error).message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: (p: AiProposal) => rejectAiProposal(p.id, notes[p.id]),
    onSuccess: () => {
      toast({ title: "Rad etildi", description: "Xodimga davom etish uchun xabar ketdi" });
      invalidate();
    },
    onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
  });

  const reply = useMutation({
    mutationFn: () => replyAiConversation(selectedConv!, replyText.trim()),
    onSuccess: () => {
      setReplyText("");
      invalidate();
    },
    onError: (e) => toast({ title: "Yuborilmadi", description: (e as Error).message, variant: "destructive" }),
  });

  if (!isAdminOnly(user?.role)) {
    return <div className="p-6 text-sm text-muted-foreground">Bu bo‘lim faqat admin uchun.</div>;
  }

  const proposals = overview.data?.proposals ?? [];
  const pending = proposals.filter((p) => p.status === "pending");
  const done = proposals.filter((p) => p.status !== "pending");
  const conversations = overview.data?.conversations ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles className="h-6 w-6 text-violet-600" />
          Yordamchi AI
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Xodimlarga AI ishlatilmaydi — bot ularga faqat bazadan standart ma’lumot beradi (davomat,
          test holati). To‘liq AI, buyruq bajarish va fayl (PDF/Excel) tayyorlash faqat sizda:
          botga nima yozsangiz, o‘shani bajaradi. Guruhda bot adminga javob bermaydi; guruhdagi
          botni quyidan yoki guruhda <code>/bot_on</code> / <code>/bot_off</code> bilan boshqarasiz.
        </p>
        {overview.data && !overview.data.aiEnabled ? (
          <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            AI hozir o‘chiq: serverda OPENAI_API_KEY yo‘q yoki AI_ASSISTANT_ENABLED=0. Bot oddiy rejimda javob beradi.
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: "Kutilayotgan takliflar", value: pending.length, icon: Clock },
          { label: "Ko‘rib chiqilgan", value: done.length, icon: Check },
          { label: "Suhbatlar", value: conversations.length, icon: MessageSquare },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3">
            <s.icon className="h-5 w-5 text-violet-600" />
            <div>
              <p className="text-lg font-bold leading-none">{overview.isLoading ? "…" : s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-violet-600" /> Telegram guruhlari
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Bot guruhda <b>adminga javob bermaydi</b>. Yoqish/o‘chirish faqat sizda — shu yerdan yoki
            guruhda <code>/bot_on</code> / <code>/bot_off</code> yozing: bot guruhga javob bermaydi,
            shaxsiy chatingizga tasdiq yuboradi. O‘chirilgan guruhda bot hech kimga javob bermaydi;
            yoqilgan guruhda xodimlarga faqat standart ma’lumot (davomat/test) beradi.
          </p>
          {groups.isLoading ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </p>
          ) : !(groups.data?.groups.length) ? (
            <p className="py-2 text-sm text-muted-foreground">
              Hozircha guruh ko‘rilmagan. Bot guruhda xabar ko‘rishi bilan guruh shu ro‘yxatda chiqadi
              (masalan, «VAKSINA HR JAMOASI»).
            </p>
          ) : (
            groups.data.groups.map((g) => (
              <div
                key={g.chatId}
                className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{g.title || "Guruh"}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.chatId} ·{" "}
                    {g.enabled ? (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">Yoqilgan</span>
                    ) : (
                      <span className="font-medium text-rose-600 dark:text-rose-400">O‘chirilgan</span>
                    )}
                  </p>
                </div>
                <Switch
                  checked={g.enabled}
                  disabled={toggleGroup.isPending}
                  onCheckedChange={() => toggleGroup.mutate(g)}
                  aria-label={`${g.title || "Guruh"}da bot`}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5 text-violet-600" /> Tasdiq kutilayotgan takliflar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.isLoading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </p>
          ) : !pending.length ? (
            <p className="py-4 text-sm text-muted-foreground">Hozircha kutilayotgan taklif yo‘q.</p>
          ) : (
            pending.map((p) => (
              <article key={p.id} className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{AI_KIND_LABEL[p.kind] || p.kind}</Badge>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusClass(p.status))}>
                    {AI_STATUS_LABEL[p.status] || p.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmtDt(p.created_at)}</span>
                  <button
                    type="button"
                    className="ml-auto text-xs font-semibold text-violet-700 underline dark:text-violet-300"
                    onClick={() => setSelectedConv(p.conversation_id)}
                  >
                    Suhbatni ko‘rish
                  </button>
                </div>
                <h3 className="mt-2 font-semibold">{p.title}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Kim: {p.user_full_name || p.display_name || "aniqlanmagan"}
                  {p.user_role ? ` (${p.user_role})` : ""}
                </p>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-white/70 p-2.5 text-sm dark:bg-black/20">{p.summary}</p>
                {Object.keys(p.payload || {}).length ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded-xl bg-slate-900 p-2.5 text-[11px] text-slate-100">
                    {JSON.stringify(p.payload, null, 2)}
                  </pre>
                ) : null}
                <Textarea
                  className="mt-2 bg-white dark:bg-transparent"
                  rows={2}
                  placeholder="Izoh (ixtiyoriy): tasdiqda ichki izoh, radda — xodimga ketadigan xabar"
                  value={notes[p.id] || ""}
                  onChange={(e) => setNotes((s) => ({ ...s, [p.id]: e.target.value }))}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700"
                    disabled={approve.isPending || reject.isPending}
                    onClick={() => approve.mutate(p)}
                  >
                    {approve.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                    Tasdiqlash va bajarish
                  </Button>
                  <Button
                    variant="outline"
                    className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:text-rose-300"
                    disabled={approve.isPending || reject.isPending}
                    onClick={() => reject.mutate(p)}
                  >
                    <X className="mr-1.5 h-4 w-4" /> Rad etish
                  </Button>
                </div>
              </article>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Suhbatlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {!conversations.length ? (
              <p className="py-3 text-sm text-muted-foreground">Hozircha suhbat yo‘q.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedConv(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm",
                    selectedConv === c.id ? "border-violet-400 bg-violet-50 dark:bg-violet-950/30" : "hover:bg-muted/50",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <b>{c.user_full_name || c.display_name || "Foydalanuvchi"}</b>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {c.intent || "suhbat"} · {fmtDt(c.updated_at)}
                    </span>
                  </span>
                  {Number(c.pending_count) > 0 ? (
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
                      {c.pending_count}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Suhbat tarixi</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedConv == null ? (
              <p className="py-3 text-sm text-muted-foreground">Chapdan suhbat tanlang.</p>
            ) : messages.isLoading ? (
              <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
              </p>
            ) : (
              <>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {(messages.data?.messages ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[92%] rounded-2xl px-3 py-2 text-sm",
                        m.role === "user"
                          ? "bg-muted"
                          : m.role === "admin"
                            ? "ml-auto bg-violet-600 text-white"
                            : "ml-auto bg-emerald-50 dark:bg-emerald-950/40",
                      )}
                    >
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      <p className={cn("mt-1 text-[10px]", m.role === "admin" ? "text-violet-200" : "text-muted-foreground")}>
                        {m.role === "user" ? "Xodim" : m.role === "admin" ? "Admin (qo‘lda)" : "Yordamchi"} · {fmtDt(m.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Textarea
                    rows={2}
                    placeholder="Admin sifatida javob yozish (Telegramga ketadi)…"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                  <Button disabled={!replyText.trim() || reply.isPending} onClick={() => reply.mutate()}>
                    {reply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {done.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tarix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {done.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusClass(p.status))}>
                  {AI_STATUS_LABEL[p.status] || p.status}
                </span>
                <span className="font-medium">{p.title}</span>
                <span className="text-xs text-muted-foreground">
                  {p.user_full_name || p.display_name || ""} · {fmtDt(p.created_at)}
                </span>
                {p.execution_result ? <span className="w-full text-xs text-muted-foreground">{p.execution_result}</span> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
