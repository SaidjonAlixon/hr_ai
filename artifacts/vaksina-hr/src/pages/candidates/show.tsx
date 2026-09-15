import React, { useMemo, useState } from "react";
import {
  useGetCandidate,
  useDeleteCandidate,
  useUpdateCandidate,
  useGetUsers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { Textarea } from "../../components/ui/textarea";
import { CandidateReadOnlyBanner } from "../../components/candidates/CandidateReadOnlyBanner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  ArrowLeft,
  User,
  Briefcase,
  GraduationCap,
  FileText,
  Trash2,
  Sparkles,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../hooks/use-toast";
import {
  canManageCandidate,
  canReassignCandidate,
  isAssignableRole,
  roleLabel,
} from "../../lib/candidate-access";
import { isHrRole, isDirectorRole } from "../../lib/roles";
import { hireAiFill, resolveHireFlow, type HireFlow } from "../../lib/hire-flow";
import { cn } from "../../lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useI18n } from "../../i18n/I18nProvider";

function InfoRow({ label, value, empty }: { label: string; value?: string | null; empty: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium whitespace-pre-wrap">{value?.trim() ? value : empty}</p>
    </div>
  );
}

function flowBadgeClass(flow: HireFlow) {
  if (flow === "qabul") return "bg-emerald-100 text-emerald-800";
  if (flow === "rad") return "bg-rose-100 text-rose-800";
  if (flow === "jarayonda") return "bg-sky-100 text-sky-800";
  return "bg-amber-100 text-amber-900";
}

export default function CandidateProfile({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: candidate, isLoading, refetch } = useGetCandidate(id, { query: { enabled: !!id } });
  const { mutate: removeCandidate, isPending: isDeleting } = useDeleteCandidate();
  const { mutate: updateCandidate, isPending: isUpdating } = useUpdateCandidate();
  const { data: allUsers } = useGetUsers(undefined, {
    query: { enabled: canReassignCandidate(user) },
  } as any);

  const [decisionOpen, setDecisionOpen] = useState<"hire" | "reject" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotes, setAiNotes] = useState("");
  const [aiQuestions, setAiQuestions] = useState("");
  const [aiRequirements, setAiRequirements] = useState("");

  const canDelete = isHrRole(user?.role) || isDirectorRole(user?.role);
  const canReassign = canReassignCandidate(user);
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const assignableUsers = useMemo(
    () => (allUsers ?? []).filter((u) => u.status === "active" && isAssignableRole(u.role)),
    [allUsers],
  );

  const flow = candidate
    ? resolveHireFlow({ status: candidate.status, stage: candidate.stage })
    : "yangi";

  const flowLabel =
    flow === "yangi"
      ? t("hire.flow.new")
      : flow === "jarayonda"
        ? t("hire.flow.inProgress")
        : flow === "qabul"
          ? t("hire.flow.hired")
          : t("hire.flow.rejected");

  if (isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!candidate) return <div>{t("hire.notFound")}</div>;

  const handleReassign = (value: string) => {
    const recruiterId = value === "none" ? null : Number(value);
    updateCandidate(
      { id, data: { recruiterId } as any },
      {
        onSuccess: () => {
          toast({ title: t("hire.reassignOk"), description: t("hire.reassignOkDesc") });
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: t("ui.error"),
            description: err?.message || t("hire.reassignFail"),
            variant: "destructive",
          });
        },
      },
    );
  };

  const patchFlow = (data: Record<string, unknown>, okTitle: string) => {
    updateCandidate(
      { id, data: data as any },
      {
        onSuccess: () => {
          toast({ title: okTitle });
          setDecisionOpen(null);
          setDecisionNote("");
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: t("ui.error"),
            description: err?.message || t("ui.error"),
            variant: "destructive",
          });
        },
      },
    );
  };

  const startProgress = () => {
    patchFlow({ stage: "in_progress", status: "active" }, t("hire.flow.started"));
  };

  const confirmDecision = () => {
    if (!decisionOpen) return;
    if (decisionOpen === "reject" && !decisionNote.trim()) {
      toast({ title: t("hire.decisionNoteRequired"), variant: "destructive" });
      return;
    }
    if (decisionOpen === "hire") {
      patchFlow(
        { status: "hired", stage: "hired", decisionNote: decisionNote.trim() || undefined },
        t("hire.flow.hiredOk"),
      );
    } else {
      patchFlow(
        { status: "rejected", decisionNote: decisionNote.trim() },
        t("hire.flow.rejectedOk"),
      );
    }
  };

  const runAi = async () => {
    const position = candidate.vacancyTitle || t("hire.unknownJob");
    setAiLoading(true);
    try {
      const result = await hireAiFill({
        kind: "candidate",
        position,
        context: [
          candidate.fullName,
          candidate.experience,
          candidate.education,
          candidate.notes,
        ]
          .filter(Boolean)
          .join(" · "),
        assigneeId: candidate.recruiterId ?? user?.id,
        candidateId: id,
        createTasks: true,
      });
      setAiNotes(result.notes || "");
      setAiQuestions(result.interviewQuestions || "");
      setAiRequirements(result.requirements || "");
      const mergedNotes = [candidate.notes?.trim(), result.notes, result.interviewQuestions]
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (canEdit && mergedNotes) {
        updateCandidate(
          { id, data: { notes: mergedNotes } as any },
          { onSuccess: () => refetch() },
        );
      }
      toast({
        title: t("hire.ai.done"),
        description: t("hire.ai.doneDesc").replace(
          "{n}",
          String(result.createdTaskIds?.length ?? result.tasks?.length ?? 0),
        ),
      });
    } catch (e: any) {
      toast({
        title: t("ui.error"),
        description: e?.message || t("hire.ai.fail"),
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleDelete = () => {
    removeCandidate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("ui.deleted"), description: t("hire.deletedCand") });
          setLocation("/candidates");
        },
        onError: (err: any) => {
          toast({
            title: t("ui.error"),
            description: err?.message || t("hire.deleteFail"),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {!canEdit && <CandidateReadOnlyBanner assigneeName={candidate.recruiterName} />}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/candidates">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-primary/10 text-2xl font-bold text-primary shadow-md">
              {candidate.photoUrl ? (
                <img src={candidate.photoUrl} alt={candidate.fullName} className="h-full w-full object-cover" />
              ) : (
                <User className="h-8 w-8" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight">{candidate.fullName}</h1>
                <Badge className={flowBadgeClass(flow)}>{flowLabel}</Badge>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                <Briefcase className="h-4 w-4" /> {candidate.vacancyTitle || t("hire.unknownJob")}
                <span>·</span>
                ID: #{candidate.id}
                <span>·</span>
                {t("hire.assigneeLabel")}:{" "}
                <span className="font-medium text-foreground">
                  {candidate.recruiterName || t("ui.unassigned")}
                </span>
              </p>
            </div>
          </div>
        </div>
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2" disabled={isDeleting}>
                <Trash2 className="h-4 w-4" /> {t("ui.delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("hire.deleteCand")}</AlertDialogTitle>
                <AlertDialogDescription>{t("hire.deleteCandDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("ui.cancelFull")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("ui.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {canReassign && (
        <Card className="border-2 border-primary/25 bg-primary/5 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-semibold">{t("hire.reassignTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("hire.reassignHint")}</p>
              </div>
              <div className="w-full shrink-0 sm:w-[320px]">
                <Select
                  value={candidate.recruiterId ? String(candidate.recruiterId) : "none"}
                  onValueChange={handleReassign}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="h-11 border-primary/30 bg-card">
                    <SelectValue placeholder={t("hire.pickAssignee")} />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    <SelectItem value="none">{t("ui.unassigned")}</SelectItem>
                    {assignableUsers.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.fullName} ({roleLabel(u.role)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Jarayon — 3 holat */}
      <Card className="overflow-hidden border-t-4 border-t-primary shadow-md">
        <CardHeader className="bg-muted/30 pb-3">
          <CardTitle className="text-lg">{t("hire.flow.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("hire.flow.sub")}</p>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["yangi", t("hire.flow.new")],
                ["jarayonda", t("hire.flow.inProgress")],
                ["qabul", t("hire.flow.hired")],
                ["rad", t("hire.flow.rejected")],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className={cn(
                  "rounded-xl border px-3 py-3 text-center text-sm font-semibold",
                  flow === key ? flowBadgeClass(key) + " ring-2 ring-offset-2 ring-primary/30" : "bg-muted/40 text-muted-foreground",
                )}
              >
                {label}
              </div>
            ))}
          </div>

          {canEdit && flow !== "qabul" && flow !== "rad" && (
            <div className="flex flex-wrap gap-2 pt-1">
              {flow === "yangi" && (
                <Button onClick={startProgress} disabled={isUpdating} className="gap-2">
                  <Play className="h-4 w-4" />
                  {t("hire.flow.start")}
                </Button>
              )}
              <Button
                variant="default"
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                disabled={isUpdating}
                onClick={() => {
                  setDecisionNote("");
                  setDecisionOpen("hire");
                }}
              >
                <CheckCircle2 className="h-4 w-4" />
                {t("hire.flow.hire")}
              </Button>
              <Button
                variant="destructive"
                className="gap-2"
                disabled={isUpdating}
                onClick={() => {
                  setDecisionNote("");
                  setDecisionOpen("reject");
                }}
              >
                <XCircle className="h-4 w-4" />
                {t("hire.flow.reject")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI tayyorlash */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              {t("hire.ai.title")}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("hire.ai.sub")}</p>
          </div>
          <Button
            type="button"
            onClick={() => void runAi()}
            disabled={aiLoading || !canEdit}
            className="shrink-0 gap-2"
          >
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {aiLoading ? t("hire.ai.loading") : t("hire.ai.fill")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {(aiRequirements || aiQuestions || aiNotes) && (
            <div className="grid gap-3 md:grid-cols-3">
              {aiRequirements ? (
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("hire.ai.requirements")}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{aiRequirements}</p>
                </div>
              ) : null}
              {aiQuestions ? (
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("hire.ai.questions")}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{aiQuestions}</p>
                </div>
              ) : null}
              {aiNotes ? (
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("hire.ai.notes")}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{aiNotes}</p>
                </div>
              ) : null}
            </div>
          )}
          {!aiRequirements && !aiQuestions && !aiNotes && (
            <p className="text-sm text-muted-foreground">{t("hire.ai.empty")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("hire.basicInfo")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("hire.detailSub")}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            <InfoRow label={t("hire.fullName")} value={candidate.fullName} empty={t("ui.notEntered")} />
            <InfoRow label="ID" value={`#${candidate.id}`} empty={t("ui.notEntered")} />
            <InfoRow label={t("ui.status")} value={flowLabel} empty={t("ui.notEntered")} />
            <InfoRow label={t("ui.phone")} value={candidate.phone} empty={t("ui.notEntered")} />
            <InfoRow label={t("ui.address")} value={candidate.address} empty={t("ui.notEntered")} />
            <InfoRow
              label={t("hire.birthDate")}
              value={candidate.birthDate ? format(new Date(candidate.birthDate), "dd.MM.yyyy") : null}
              empty={t("ui.notEntered")}
            />
            <InfoRow label={t("hire.col.job")} value={candidate.vacancyTitle} empty={t("ui.notEntered")} />
            <InfoRow
              label={t("hire.assigneeLabel")}
              value={candidate.recruiterName}
              empty={t("ui.unassigned")}
            />
            <InfoRow
              label={t("hire.registeredAt")}
              value={format(new Date(candidate.createdAt), "dd.MM.yyyy HH:mm")}
              empty={t("ui.notEntered")}
            />
            <InfoRow label={t("hire.expectedSalary")} value={candidate.expectedSalary} empty={t("ui.notEntered")} />
          </div>

          <div className="grid grid-cols-1 gap-5 border-t pt-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Briefcase className="h-4 w-4 text-primary" />
                {t("hire.experience")}
              </div>
              <div className="min-h-[80px] whitespace-pre-wrap rounded-md border bg-card p-3 text-sm">
                {candidate.experience?.trim() || t("ui.notEntered")}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <GraduationCap className="h-4 w-4 text-primary" />
                {t("hire.education")}
              </div>
              <div className="min-h-[80px] whitespace-pre-wrap rounded-md border bg-card p-3 text-sm">
                {candidate.education?.trim() || t("ui.notEntered")}
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-primary" />
              {t("hire.recruiterNotes")}
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-amber-100 bg-amber-50/60 p-3 text-sm">
              {candidate.notes?.trim() || t("hire.noNotesYet")}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!decisionOpen} onOpenChange={(o) => !o && setDecisionOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionOpen === "hire" ? t("hire.flow.hire") : t("hire.flow.reject")}
            </DialogTitle>
            <DialogDescription>
              {decisionOpen === "hire" ? t("hire.flow.hireHint") : t("hire.flow.rejectHint")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder={t("hire.decisionNotePh")}
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecisionOpen(null)}>
              {t("ui.cancelFull")}
            </Button>
            <Button
              variant={decisionOpen === "reject" ? "destructive" : "default"}
              onClick={confirmDecision}
              disabled={isUpdating}
            >
              {t("ui.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
