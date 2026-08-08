import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../hooks/use-toast";
import {
  GOAL_ROLES,
  isAfterDailyPromptTime,
  localWorkDate,
  useGoalPromptStatus,
  useSaveGoal,
  useSubmitDailyGoal,
} from "../lib/maqsad-api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Target } from "lucide-react";

/**
 * 17:55 dan keyin oliy maqsad bo‘yicha bugungi natijani majburiy so‘raydi.
 * Yopib bo‘lmaydi — faqat yozib saqlagach yopiladi.
 */
export function DailyGoalPrompt() {
  const { user } = useAuth();
  const { toast } = useToast();
  const eligible = !!user && GOAL_ROLES.has(user.role);
  const [afterTime, setAfterTime] = useState(() => isAfterDailyPromptTime());
  const [open, setOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [content, setContent] = useState("");

  const { data: status, refetch } = useGoalPromptStatus(eligible && afterTime);
  const saveGoal = useSaveGoal();
  const submitDaily = useSubmitDailyGoal();

  useEffect(() => {
    if (!eligible) return;
    const tick = () => setAfterTime(isAfterDailyPromptTime());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [eligible]);

  useEffect(() => {
    if (!eligible || !afterTime || !status?.eligible) return;
    if (status.mustPrompt) {
      setOpen(true);
      if (status.goal) {
        setGoalTitle(status.goal.title);
        setGoalDesc(status.goal.description || "");
      }
    } else {
      setOpen(false);
    }
  }, [eligible, afterTime, status]);

  if (!eligible) return null;

  async function handleSave() {
    try {
      if (!status?.hasGoal) {
        if (!goalTitle.trim()) {
          toast({ title: "Avval oliy maqsadni yozing", variant: "destructive" });
          return;
        }
        await saveGoal.mutateAsync({
          title: goalTitle.trim(),
          description: goalDesc.trim() || null,
        });
      }
      if (!content.trim()) {
        toast({
          title: "Bugun nima qilganingizni yozing",
          variant: "destructive",
        });
        return;
      }
      await submitDaily.mutateAsync({
        content: content.trim(),
        workDate: localWorkDate(),
      });
      setContent("");
      setOpen(false);
      await refetch();
      toast({ title: "Bugungi natija saqlandi" });
    } catch (e: any) {
      toast({ title: "Xato", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Majburiy — yopishga ruxsat yo‘q
        if (!next && status?.mustPrompt) return;
        setOpen(next);
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-amber-600" />
            Kun yakuni (17:55) — majburiy yozuv
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <ol className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            <li>
              <span className="font-semibold text-slate-800">1.</span> Oliy maqsadingizni ko‘ring
            </li>
            <li>
              <span className="font-semibold text-slate-800">2.</span> Bugun shu maqsad uchun nima
              qilganingizni yozing
            </li>
            <li>
              <span className="font-semibold text-slate-800">3.</span> Saqlang — yozuvsiz yopib
              bo‘lmaydi
            </li>
          </ol>

          {status?.hasGoal && status.goal ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Sizning oliy maqsadingiz
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {status.goal.title}
              </p>
              {status.goal.description ? (
                <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">
                  {status.goal.description}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">
                1-qadam: avval oliy maqsadni belgilang
              </p>
              <Input
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                placeholder="Oliy maqsad sarlavhasi"
              />
              <Textarea
                value={goalDesc}
                onChange={(e) => setGoalDesc(e.target.value)}
                placeholder="Qisqa izoh (ixtiyoriy)"
                rows={2}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              2-qadam: bugun shu maqsad uchun nima qildingiz? *
            </p>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"Aniq yozing:\n• Nima qildim\n• Qanday natija"}
              rows={5}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={saveGoal.isPending || submitDaily.isPending}
            className="w-full sm:w-auto"
          >
            Saqlash va yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
