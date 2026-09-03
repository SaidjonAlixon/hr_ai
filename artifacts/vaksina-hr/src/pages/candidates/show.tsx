import React, { useMemo, useState } from 'react';
import {
  useGetCandidate,
  useGetCandidatePipeline,
  useDeleteCandidate,
  useUpdateCandidate,
  useGetUsers,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Pipeline } from '../../components/ui/pipeline';
import { StageHistory } from '../../components/candidates/StageHistory';
import { CandidateReadOnlyBanner } from '../../components/candidates/CandidateReadOnlyBanner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ArrowLeft, User, Briefcase, GraduationCap, FileText, Trash2 } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import {
  canManageCandidate,
  canReassignCandidate,
  isAssignableRole,
  roleLabel,
} from '../../lib/candidate-access';
import { isHrRole } from '../../lib/roles';
import { stageFormHref } from '../../lib/stage-routes';
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
} from '../../components/ui/alert-dialog';
import { useI18n } from '../../i18n/I18nProvider';

function InfoRow({ label, value, empty }: { label: string; value?: string | null; empty: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium whitespace-pre-wrap break-words">{value?.trim() ? value : empty}</p>
    </div>
  );
}

export default function CandidateProfile({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: candidate, isLoading, refetch } = useGetCandidate(id, { query: { enabled: !!id } });
  const { data: pipeline, isLoading: isPipelineLoading } = useGetCandidatePipeline(id, { query: { enabled: !!id } });
  const { mutate: removeCandidate, isPending: isDeleting } = useDeleteCandidate();
  const { mutate: updateCandidate, isPending: isReassigning } = useUpdateCandidate();
  const { data: allUsers } = useGetUsers(undefined, {
    query: { enabled: canReassignCandidate(user) },
  } as any);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const canDelete = isHrRole(user?.role) || user?.role === 'director';
  const canReassign = canReassignCandidate(user);
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const assignableUsers = useMemo(
    () =>
      (allUsers ?? []).filter(
        (u) => u.status === 'active' && isAssignableRole(u.role),
      ),
    [allUsers],
  );

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!candidate) return <div>{t('hire.notFound')}</div>;

  const activeStage = selectedStage || pipeline?.currentStage || candidate.stage;

  const handleReassign = (value: string) => {
    const recruiterId = value === 'none' ? null : Number(value);
    updateCandidate(
      { id, data: { recruiterId } as any },
      {
        onSuccess: () => {
          toast({ title: t('hire.reassignOk'), description: t('hire.reassignOkDesc') });
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: t('ui.error'),
            description: err?.message || t('hire.reassignFail'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const renderActionButtons = () => {
    if (candidate.status === 'hired' || candidate.stage === 'hired') {
      return <Badge className="bg-emerald-100 text-emerald-800 px-3 py-2 text-sm">{t('hire.hiredBadge')}</Badge>;
    }
    if (candidate.status === 'rejected') {
      return <Badge variant="destructive" className="px-3 py-2 text-sm">{t('hire.rejected')}</Badge>;
    }

    const actions: Record<string, { href: string; label: string; viewLabel: string }> = {
      phone_interview: { href: `/candidates/${id}/phone-interview`, label: t('hire.action.phone'), viewLabel: t('hire.action.phoneView') },
      online_interview: { href: `/candidates/${id}/online-interview`, label: t('hire.action.online'), viewLabel: t('hire.action.onlineView') },
      preboarding: { href: `/candidates/${id}/preboarding`, label: t('hire.action.preboard'), viewLabel: t('hire.action.preboardView') },
      offline_interview: { href: `/candidates/${id}/offline-interview`, label: t('hire.action.offline'), viewLabel: t('hire.action.offlineView') },
      final_decision: { href: `/candidates/${id}/final-decision`, label: t('hire.action.final'), viewLabel: t('hire.action.finalView') },
      offer: { href: `/candidates/${id}/offer`, label: t('hire.action.offer'), viewLabel: t('hire.action.offerView') },
      documents: { href: `/candidates/${id}/documents`, label: t('hire.action.docs'), viewLabel: t('hire.action.docsView') },
      internship: { href: `/candidates/${id}/internship`, label: t('hire.action.intern'), viewLabel: t('hire.action.internView') },
    };
    const action = actions[candidate.stage];
    if (!action) return null;
    return (
      <Link href={action.href}>
        <Button variant={canEdit ? 'default' : 'outline'}>
          {canEdit ? action.label : action.viewLabel}
        </Button>
      </Link>
    );
  };

  const statusLabel =
    candidate.status === 'active' ? t('ui.active') : candidate.status === 'hired' ? t('hire.hiredBadge') : t('hire.rejected');

  const handleDelete = () => {
    removeCandidate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t('ui.deleted'), description: t('hire.deletedCand') });
          setLocation('/candidates');
        },
        onError: (err: any) => {
          toast({
            title: t('ui.error'),
            description: err?.message || t('hire.deleteFail'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {!canEdit && <CandidateReadOnlyBanner assigneeName={candidate.recruiterName} />}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/candidates">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl overflow-hidden shrink-0 border-2 border-white shadow-md">
              {candidate.photoUrl ? (
                <img src={candidate.photoUrl} alt={candidate.fullName} className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold tracking-tight">{candidate.fullName}</h1>
                <Badge
                  variant={candidate.status === 'hired' ? 'default' : candidate.status === 'rejected' ? 'destructive' : 'secondary'}
                  className={candidate.status === 'active' ? 'bg-emerald-100 text-emerald-800' : ''}
                >
                  {statusLabel}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                <Briefcase className="w-4 h-4" /> {candidate.vacancyTitle || t('hire.unknownJob')}
                <span className="mx-1">•</span>
                ID: #{candidate.id}
                <span className="mx-1">•</span>
                <span>
                  {t('hire.assigneeLabel')}:{' '}
                  <span className="font-medium text-foreground">
                    {candidate.recruiterName || t('ui.unassigned')}
                  </span>
                </span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {renderActionButtons()}
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2" disabled={isDeleting}>
                  <Trash2 className="w-4 h-4" /> {t('ui.delete')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('hire.deleteCand')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('hire.deleteCandDesc')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('ui.cancelFull')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t('ui.delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {canReassign && (
        <Card className="border-2 border-primary/25 bg-primary/5 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
              <div className="flex-1 space-y-1.5 min-w-0">
                <p className="text-sm font-semibold text-foreground">{t('hire.reassignTitle')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('hire.reassignHint')}
                </p>
              </div>
              <div className="w-full sm:w-[320px] shrink-0">
                <Select
                  value={candidate.recruiterId ? String(candidate.recruiterId) : 'none'}
                  onValueChange={handleReassign}
                  disabled={isReassigning}
                >
                  <SelectTrigger className="h-11 bg-card border-primary/30">
                    <SelectValue placeholder={t('hire.pickAssignee')} />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    <SelectItem value="none">{t('ui.unassigned')}</SelectItem>
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

      <Card className="border-t-4 border-t-primary shadow-md overflow-hidden">
        <CardHeader className="bg-muted/30 pb-4">
          <CardTitle className="flex justify-between items-center gap-3 flex-wrap">
            <span>{t('hire.stagesTitle')}</span>
            <Badge variant="outline" className="font-normal text-xs bg-card">
              {t('hire.currentStage')}: {pipeline?.currentStage || candidate.stage} ({(pipeline?.stages.findIndex((s) => s.key === (pipeline?.currentStage || candidate.stage)) ?? 0) + 1}/9)
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isPipelineLoading ? (
            <div className="p-8 text-center text-muted-foreground">{t('hire.pipelineLoading')}</div>
          ) : pipeline ? (
            <Pipeline
              stages={pipeline.stages}
              selectedStage={activeStage}
              onSelectStage={(key) => {
                const stage = pipeline.stages.find((s) => s.key === key);
                const href = stageFormHref(id, key);
                if (!href) {
                  setSelectedStage(key);
                  return;
                }
                if (stage?.status === 'pending') {
                  toast({
                    title: t('hire.stageLocked'),
                    description: t('hire.stageLockedDesc'),
                  });
                  setSelectedStage(key);
                  return;
                }
                setLocation(href);
              }}
            />
          ) : (
            <div className="p-8 text-center text-muted-foreground">{t('ui.empty')}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('hire.detailTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('hire.detailSub')}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Asosiy ma'lumotlar — qadamlar boshida */}
          <div className="rounded-xl border bg-muted/20 p-5 space-y-5">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">{t('hire.basicInfo')}</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <InfoRow label={t('hire.fullName')} value={candidate.fullName} empty={t('ui.notEntered')} />
              <InfoRow label="ID" value={`#${candidate.id}`} empty={t('ui.notEntered')} />
              <InfoRow label={t('ui.status')} value={statusLabel} empty={t('ui.notEntered')} />
              <InfoRow label={t('ui.phone')} value={candidate.phone} empty={t('ui.notEntered')} />
              <InfoRow label={t('ui.address')} value={candidate.address} empty={t('ui.notEntered')} />
              <InfoRow
                label={t('hire.birthDate')}
                value={candidate.birthDate ? format(new Date(candidate.birthDate), 'dd.MM.yyyy') : null}
                empty={t('ui.notEntered')}
              />
              <InfoRow label={t('hire.col.job')} value={candidate.vacancyTitle} empty={t('ui.notEntered')} />
              <div className="space-y-1 md:col-span-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('hire.assigneeLabel')}</p>
                {canReassign ? (
                  <Select
                    value={candidate.recruiterId ? String(candidate.recruiterId) : 'none'}
                    onValueChange={handleReassign}
                    disabled={isReassigning}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={t('hire.pickAssignee')} />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      <SelectItem value="none">{t('ui.unassigned')}</SelectItem>
                      {assignableUsers.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.fullName} ({roleLabel(u.role)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium">{candidate.recruiterName || t('ui.unassigned')}</p>
                )}
                {canReassign && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('hire.reassignHrHint')}
                  </p>
                )}
              </div>
              <InfoRow
                label={t('hire.registeredAt')}
                value={format(new Date(candidate.createdAt), 'dd.MM.yyyy HH:mm')}
                empty={t('ui.notEntered')}
              />
              <InfoRow label={t('hire.expectedSalary')} value={candidate.expectedSalary} empty={t('ui.notEntered')} />
              <InfoRow label={t('hire.currentStageField')} value={candidate.stage} empty={t('ui.notEntered')} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Briefcase className="w-4 h-4 text-primary" />
                  {t('hire.experience')}
                </div>
                <div className="rounded-md bg-card border p-3 text-sm whitespace-pre-wrap min-h-[80px]">
                  {candidate.experience?.trim() || t('ui.notEntered')}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <GraduationCap className="w-4 h-4 text-primary" />
                  {t('hire.education')}
                </div>
                <div className="rounded-md bg-card border p-3 text-sm whitespace-pre-wrap min-h-[80px]">
                  {candidate.education?.trim() || t('ui.notEntered')}
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="w-4 h-4 text-primary" />
                {t('hire.recruiterNotes')}
              </div>
              <div className="rounded-md bg-amber-50/60 border border-amber-100 p-3 text-sm whitespace-pre-wrap">
                {candidate.notes?.trim() || t('hire.noNotesYet')}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
              {t('hire.stepsHistory')}
            </h3>
            <StageHistory
              candidateId={id}
              stages={pipeline?.stages}
              selectedStage={activeStage}
              onSelectStage={setSelectedStage}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
