import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, BadgeCheck, BookOpen, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { canManageDarsliklar } from "@/lib/roles";
import {
  ATTESTATSIYA_TRACKS,
  useAttestBank,
  useSaveAttestBank,
  type AttestQuestion,
  type AttestTrack,
} from "@/lib/atestatsiya-api";

function emptyQuestion(): AttestQuestion {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text: "",
    options: ["", "", "", ""],
    correctIndex: 0,
  };
}

export default function AtestatsiyaBazaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageDarsliklar(user?.role);
  const [track, setTrack] = useState<AttestTrack>("stajyor");
  const bankQ = useAttestBank(track, allowed);
  const save = useSaveAttestBank();
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<AttestQuestion[]>([emptyQuestion()]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDirty(false);
  }, [track]);

  useEffect(() => {
    if (!bankQ.data?.bank || dirty) return;
    const b = bankQ.data.bank;
    setTitle(b.title);
    setQuestions(b.questions.length ? b.questions.map((q) => ({ ...q, options: [...q.options] })) : [emptyQuestion()]);
  }, [bankQ.data, dirty]);

  if (!allowed) {
    return <div className="flex h-full items-center justify-center p-8 text-muted-foreground">Bu bo‘lim faqat admin va trener uchun.</div>;
  }

  const setQ = (i: number, patch: Partial<AttestQuestion>) => {
    setDirty(true);
    setQuestions((prev) => prev.map((q, n) => (n === i ? { ...q, ...patch } : q)));
  };

  const onSave = async () => {
    const cleaned = questions
      .map((q) => {
        const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
        return {
          id: q.id,
          text: q.text.trim(),
          options: kept.map((x) => x.o),
          correctIndex: Math.max(0, kept.findIndex((x) => x.i === q.correctIndex)),
        };
      })
      .filter((q) => q.text);
    try {
      await save.mutateAsync({ track, title: title.trim(), questions: cleaned });
      setDirty(false);
      toast({ title: "Baza saqlandi", description: `${cleaned.length} ta savol · ${ATTESTATSIYA_TRACKS.find((t) => t.key === track)?.label}` });
    } catch (e) {
      toast({ title: "Saqlanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const filled = questions.filter((q) => q.text.trim()).length;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-8">
        <section className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-600 to-indigo-700 p-5 text-white shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                <BookOpen className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-xl font-bold sm:text-2xl">Test bazasi</h1>
                <p className="mt-1 max-w-lg text-sm text-white/85">
                  Savollar shu yerda kiritiladi. Atestatsiya bo‘limida faqat bazadan test tuzib e’lon qilasiz.
                </p>
              </div>
            </div>
            <Link
              href="/admin/atestatsiya"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/25 hover:bg-white/25"
            >
              <BadgeCheck className="h-4 w-4" /> Atestatsiyalar
            </Link>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-2">
          {ATTESTATSIYA_TRACKS.map((t) => {
            const count = t.key === track ? filled : bankQ.data && track !== t.key ? undefined : undefined;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  if (dirty && !window.confirm("Saqlanmagan o‘zgarishlar yo‘qoladi. Davom etasizmi?")) return;
                  setTrack(t.key);
                }}
                className={cn(
                  "rounded-2xl border p-3 text-left transition",
                  track === t.key
                    ? "border-violet-500 bg-violet-50 shadow-sm dark:bg-violet-950/40"
                    : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950",
                )}
              >
                <p className="text-sm font-bold">{t.label}</p>
                <p className="text-xs text-muted-foreground">
                  {track === t.key ? `${filled} savol` : "Baza"}
                  {count != null ? "" : ""}
                </p>
              </button>
            );
          })}
        </div>

        {bankQ.isLoading ? (
          <Skeleton className="h-64 rounded-3xl" />
        ) : bankQ.isError ? (
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{(bankQ.error as Error).message}</p>
        ) : (
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-white/10 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">
                  {ATTESTATSIYA_TRACKS.find((t) => t.key === track)?.label} bazasi
                </h2>
                <p className="text-xs text-muted-foreground">
                  Bu savollardan atestatsiya tuziladi. Har bir xodimga random tanlanadi.
                </p>
              </div>
              <Button className="bg-violet-600 hover:bg-violet-700" disabled={save.isPending} onClick={() => void onSave()}>
                {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                Saqlash · {filled}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Baza nomi</Label>
              <Input
                value={title}
                maxLength={200}
                onChange={(e) => {
                  setDirty(true);
                  setTitle(e.target.value);
                }}
                placeholder="Masalan: Mudir savol bazasi"
              />
            </div>

            <div className="space-y-3">
              {questions.map((q, qi) => (
                <div key={q.id} className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="flex gap-2">
                    <span className="mt-2 text-sm font-bold text-violet-600">{qi + 1}.</span>
                    <Textarea
                      rows={2}
                      value={q.text}
                      placeholder="Savol matni"
                      onChange={(e) => setQ(qi, { text: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-600"
                      disabled={questions.length <= 1}
                      onClick={() => {
                        setDirty(true);
                        setQuestions((prev) => prev.filter((_, i) => i !== qi));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {q.options.map((opt, oi) => (
                      <label
                        key={oi}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 dark:bg-slate-900",
                          q.correctIndex === oi && "border-emerald-500",
                        )}
                      >
                        <input
                          type="radio"
                          name={`c-${q.id}`}
                          checked={q.correctIndex === oi}
                          onChange={() => setQ(qi, { correctIndex: oi })}
                          className="accent-emerald-600"
                        />
                        <span className="text-xs font-bold text-muted-foreground">{String.fromCharCode(65 + oi)}</span>
                        <input
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                          value={opt}
                          placeholder={`Variant ${String.fromCharCode(65 + oi)}`}
                          onChange={(e) =>
                            setQ(qi, { options: q.options.map((o, i) => (i === oi ? e.target.value : o)) })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={() => {
                setDirty(true);
                setQuestions((prev) => [...prev, emptyQuestion()]);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Savol qo‘shish
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-white/10">
              <Link href="/admin/atestatsiya" className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700">
                <ArrowLeft className="h-4 w-4" /> Atestatsiya yaratishga o‘tish
              </Link>
              <Button className="bg-violet-600 hover:bg-violet-700" disabled={save.isPending} onClick={() => void onSave()}>
                <Save className="mr-1.5 h-4 w-4" /> Saqlash
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
