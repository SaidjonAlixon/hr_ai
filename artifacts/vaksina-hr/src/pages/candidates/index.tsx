import React, { useMemo, useState } from "react";
import {
  getGetCandidatesQueryKey,
  useDeleteCandidate,
  useGetCandidates,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Link, useLocation } from "wouter";
import { Search, Plus, Filter, User, Briefcase, Phone, PhoneOff, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useAuth } from "../../contexts/AuthContext";
import { isHrManager, isDirectorRole } from "../../lib/roles";
import { canDeleteCandidate } from "../../lib/candidate-access";
import { resolveHireFlow, type HireFlow } from "../../lib/hire-flow";
import { parsePipeline } from "../../lib/hire-pipeline";
import { useI18n } from "../../i18n/I18nProvider";
import { useToast } from "../../hooks/use-toast";
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

const FLOW_STORAGE_KEY = "vaksina-candidates-flow-filter";
const FLOW_VALUES = ["all", "yangi", "jarayonda", "qabul", "rad", "no_answer"] as const;
type FlowFilter = (typeof FLOW_VALUES)[number];

function isFlowFilter(v: string | null | undefined): v is FlowFilter {
  return !!v && (FLOW_VALUES as readonly string[]).includes(v);
}

function readStoredFlow(): FlowFilter {
  if (typeof window === "undefined") return "all";
  try {
    const raw = localStorage.getItem(FLOW_STORAGE_KEY);
    if (isFlowFilter(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "all";
}

function getFlowFromUrl(): FlowFilter | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const flow = params.get("flow");
  if (isFlowFilter(flow)) return flow;
  // Eski linklar
  const status = params.get("status");
  if (status === "hired") return "qabul";
  if (status === "rejected") return "rad";
  if (status === "active") return "jarayonda";
  const stage = params.get("stage");
  if (stage === "new") return "yangi";
  if (stage === "hired") return "qabul";
  if (stage === "rejected") return "rad";
  return null;
}

function initialFlowFilter(): FlowFilter {
  return getFlowFromUrl() ?? readStoredFlow();
}

function noAnswerMeta(candidate: { pipelineJson?: unknown }) {
  const data = parsePipeline(candidate.pipelineJson);
  const na = data.noAnswer;
  if (!na?.attempts?.length) return null;
  return {
    status: na.status,
    count: na.attempts.length,
    waiting: na.status === "waiting",
  };
}

function flowBadge(flow: HireFlow, t: (k: string) => string) {
  const map: Record<HireFlow, { label: string; color: string }> = {
    yangi: { label: t("hire.flow.new"), color: "bg-amber-100 text-amber-900" },
    jarayonda: { label: t("hire.flow.inProgress"), color: "bg-sky-100 text-sky-800" },
    qabul: { label: t("hire.flow.hired"), color: "bg-emerald-100 text-emerald-800" },
    rad: { label: t("hire.flow.rejected"), color: "bg-rose-100 text-rose-800" },
  };
  const s = map[flow];
  return <Badge className={s.color}>{s.label}</Badge>;
}

export default function CandidatesList() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [flowFilter, setFlowFilter] = useState<FlowFilter>(initialFlowFilter);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { mutate: removeCandidate, isPending: isDeleting } = useDeleteCandidate();

  const canAddCandidate =
    user?.role === "recruiter" || isHrManager(user?.role) || isDirectorRole(user?.role);

  const { data: candidates, isLoading } = useGetCandidates({
    search: search || undefined,
  });

  const filtered = useMemo(() => {
    const list = candidates ?? [];
    if (flowFilter === "all") return list;
    if (flowFilter === "no_answer") {
      return list.filter((c) => {
        const meta = noAnswerMeta(c as { pipelineJson?: unknown });
        return meta?.waiting;
      });
    }
    return list.filter((c) => resolveHireFlow(c) === flowFilter);
  }, [candidates, flowFilter]);

  const showActionsCol = filtered.some((c) => canDeleteCandidate(user, c.recruiterId));
  const colSpan = showActionsCol ? 6 : 5;

  const updateFlow = (value: string) => {
    const next: FlowFilter = isFlowFilter(value) ? value : "all";
    setFlowFilter(next);
    try {
      localStorage.setItem(FLOW_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams();
    if (next !== "all") params.set("flow", next);
    const q = params.toString();
    setLocation(q ? `/candidates?${q}` : "/candidates");
  };

  const handleDelete = (id: number) => {
    setDeletingId(id);
    removeCandidate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("ui.deleted"), description: t("hire.deletedCand") });
          void queryClient.invalidateQueries({ queryKey: getGetCandidatesQueryKey() });
          setDeletingId(null);
        },
        onError: (err: any) => {
          toast({
            title: t("ui.error"),
            description: err?.message || t("hire.deleteFail"),
            variant: "destructive",
          });
          setDeletingId(null);
        },
      },
    );
  };

  const titleMap: Record<FlowFilter, string> = {
    all: t("hire.statusAll"),
    yangi: t("hire.flow.new"),
    jarayonda: t("hire.flow.inProgress"),
    qabul: t("hire.flow.hired"),
    rad: t("hire.flow.rejected"),
    no_answer: t("hire.flow.noAnswer"),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("hire.candidates")}</h1>
          <p className="mt-1 text-muted-foreground">{titleMap[flowFilter] || titleMap.all}</p>
        </div>
        {canAddCandidate && (
          <Link href="/candidates/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> {t("hire.newCandidate")}
            </Button>
          </Link>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card/80 p-4 shadow-sm backdrop-blur-sm sm:flex-row">
        <div className="relative w-full flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("hire.searchCand")}
            className="border-transparent bg-background pl-9 focus-visible:bg-card"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={flowFilter} onValueChange={updateFlow}>
          <SelectTrigger className="w-full border-transparent bg-background sm:w-[240px]">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder={t("ui.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("hire.allStatuses")}</SelectItem>
            <SelectItem value="yangi">{t("hire.flow.new")}</SelectItem>
            <SelectItem value="jarayonda">{t("hire.flow.inProgress")}</SelectItem>
            <SelectItem value="no_answer">{t("hire.flow.noAnswer")}</SelectItem>
            <SelectItem value="qabul">{t("hire.flow.hired")}</SelectItem>
            <SelectItem value="rad">{t("hire.flow.rejected")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-6 py-4 font-medium">{t("hire.col.candidate")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.job")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.contact")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.status")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.recruiter")}</th>
                {showActionsCol && <th className="w-14 px-4 py-4 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={colSpan} className="px-6 py-8 text-center text-muted-foreground">
                    {t("ui.loading")}
                  </td>
                </tr>
              ) : filtered.length > 0 ? (
                filtered.map((candidate) => {
                  const flow = resolveHireFlow(candidate);
                  const na = noAnswerMeta(candidate as { pipelineJson?: unknown });
                  const canDelete = canDeleteCandidate(user, candidate.recruiterId);
                  return (
                    <tr
                      key={candidate.id}
                      role="link"
                      tabIndex={0}
                      onClick={() => setLocation(`/candidates/${candidate.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setLocation(`/candidates/${candidate.id}`);
                        }
                      }}
                      className="group cursor-pointer transition-colors hover:bg-muted/30"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-bold text-primary">
                            {candidate.photoUrl ? (
                              <img
                                src={candidate.photoUrl}
                                alt={candidate.fullName}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <User className="h-5 w-5" />
                            )}
                          </div>
                          <div>
                            <span className="block font-semibold text-foreground">{candidate.fullName}</span>
                            {candidate.expectedSalary && (
                              <span className="text-xs text-muted-foreground">
                                Kutilma: {candidate.expectedSalary}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{candidate.vacancyTitle || "—"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{candidate.phone}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {na?.waiting ? (
                            <Badge className="gap-1 bg-amber-100 text-amber-950">
                              <PhoneOff className="h-3 w-3" />
                              {t("hire.pipe.noAnswerStatus")}
                              {na.count > 0 ? (
                                <span className="opacity-80">
                                  · {t("hire.pipe.noAnswerAttempts").replace("{n}", String(na.count))}
                                </span>
                              ) : null}
                            </Badge>
                          ) : na?.status === "cancelled" && flow === "rad" ? (
                            <Badge className="gap-1 bg-rose-100 text-rose-900">
                              <PhoneOff className="h-3 w-3" />
                              {t("hire.pipe.noAnswerCancelled")}
                            </Badge>
                          ) : (
                            flowBadge(flow, t)
                          )}
                          {na?.waiting && flow !== "yangi" ? flowBadge(flow, t) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {candidate.recruiterName || t("ui.unassigned")}
                      </td>
                      {showActionsCol && (
                        <td
                          className="px-4 py-4"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {canDelete ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  disabled={isDeleting && deletingId === candidate.id}
                                  aria-label={t("ui.delete")}
                                  title={t("ui.delete")}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("hire.deleteCand")}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("hire.deleteCandDesc")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("ui.cancelFull")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(candidate.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    {t("ui.delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={colSpan} className="px-6 py-12 text-center text-muted-foreground">
                    {t("ui.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
