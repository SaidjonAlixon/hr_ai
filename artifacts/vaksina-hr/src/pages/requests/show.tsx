import React, { useState } from 'react';
import {
  useGetRequest,
  useAssignRequest,
  useApproveRequest,
  useGetUsers,
} from '@workspace/api-client-react';
import { useCreateRequestClaim, useRequestClaims } from '../../lib/staffing-api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ArrowLeft, UserPlus, CheckCircle, Briefcase, Hand } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { isHrManager } from '../../lib/roles';
import { useI18n } from '../../i18n/I18nProvider';

export default function RequestDetails({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: request, isLoading, refetch } = useGetRequest(id, { query: { enabled: !!id } });
  const { mutate: assign, isPending: isAssigning } = useAssignRequest();
  const { mutate: approve, isPending: isApproving } = useApproveRequest();
  const { data: recruiters } = useGetUsers({ role: 'recruiter' });
  const { data: claims, refetch: refetchClaims } = useRequestClaims(id);
  const { mutate: createClaim, isPending: claiming } = useCreateRequestClaim();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [approveOpen, setApproveOpen] = useState(false);
  const [recruiterId, setRecruiterId] = useState<string>('');
  const [deadline, setDeadline] = useState('');
  const [claimNote, setClaimNote] = useState('');

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!request) return <div>{t('hire.requestNotFound')}</div>;

  const canApprove = isHrManager(user?.role);
  const isHrLike = canApprove || user?.role === 'director';
  const isRecruiter = user?.role === 'recruiter' || user?.role === 'admin';
  const needsDeadline = !request.deadline;
  const canShowApprove =
    canApprove &&
    !request.vacancyId &&
    (request.status === 'submitted' || request.status === 'reviewing' || request.status === 'accepted');

  const myClaim = (claims ?? []).find((c) => c.recruiterId === user?.id);
  const pendingClaims = (claims ?? []).filter((c) => c.status === 'pending');
  const canClaim =
    user?.role === 'recruiter' &&
    !request.vacancyId &&
    request.status !== 'closed' &&
    request.status !== 'announced' &&
    !myClaim;

  const handleAssignToMe = () => {
    if (!user) return;
    assign({ id, data: { userId: user.id } }, {
      onSuccess: () => {
        toast({ title: t('ui.success'), description: t('requests.assignedOk') });
        refetch();
      }
    });
  };

  const handleClaim = () => {
    createClaim(
      { id, note: claimNote.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: t('requests.claimLeft'), description: t('requests.claimLeftDesc') });
          setClaimNote('');
          refetchClaims();
        },
        onError: (err: Error) => {
          toast({ title: t('ui.error'), description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const openApprove = () => {
    const preferred = pendingClaims[0];
    setRecruiterId(preferred ? String(preferred.recruiterId) : '');
    setDeadline(request.deadline ? String(request.deadline).slice(0, 10) : '');
    setApproveOpen(true);
  };

  const handleApprove = () => {
    if (!recruiterId) {
      toast({ title: t('ui.error'), description: t('requests.pickRecruiter'), variant: 'destructive' });
      return;
    }
    if (needsDeadline && !deadline) {
      toast({ title: t('ui.error'), description: t('requests.setDeadline'), variant: 'destructive' });
      return;
    }

    approve(
      {
        id,
        data: {
          recruiterId: parseInt(recruiterId, 10),
          ...(needsDeadline || deadline ? { deadline } : {}),
        },
      },
      {
        onSuccess: (result) => {
          toast({
            title: t('requests.approved'),
            description: t('requests.approvedDesc'),
          });
          setApproveOpen(false);
          refetch();
          refetchClaims();
          if (result.vacancy?.id) {
            setLocation(`/vacancies/${result.vacancy.id}`);
          }
        },
        onError: (err: any) => {
          toast({
            title: t('ui.error'),
            description: err?.message || t('requests.approveFail'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const statusLabel: Record<string, string> = {
    submitted: t('requests.status.submitted'),
    reviewing: t('requests.status.reviewing'),
    accepted: t('requests.status.accepted'),
    announced: t('requests.status.announced'),
    closed: t('requests.status.closed'),
  };

  const claimStatusLabel: Record<string, string> = {
    pending: t('requests.claim.pending'),
    accepted: t('requests.claim.accepted'),
    rejected: t('requests.claim.rejected'),
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/requests">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{request.position}</h1>
              <Badge variant={request.priority === 'urgent' ? 'destructive' : 'secondary'}>
                {request.priority === 'urgent' ? t('hire.urgent') : t('hire.normal')}
              </Badge>
              <Badge className="bg-primary/10 text-primary hover:bg-primary/20">
                {statusLabel[request.status] || request.status}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              {request.departmentName}
              {request.createdByName ? ` • ${request.createdByName}` : ''}
              {" • "}ID: #{request.id}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {request.status === 'submitted' && isHrLike && canApprove && (
            <Button variant="outline" className="gap-2" onClick={handleAssignToMe} disabled={isAssigning}>
              <UserPlus className="w-4 h-4" /> {t('requests.assignMe')}
            </Button>
          )}
          {canShowApprove && (
            <Button className="gap-2" onClick={openApprove}>
              <CheckCircle className="w-4 h-4" /> {t('requests.approveCreate')}
            </Button>
          )}
          {request.vacancyId && (
            <Link href={`/vacancies/${request.vacancyId}`}>
              <Button variant="secondary" className="gap-2">
                <Briefcase className="w-4 h-4" /> {t('requests.viewVacancy')}
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('requests.basicInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="font-semibold text-sm text-muted-foreground mb-2">{t('requests.dutiesLabel')}</h4>
                <div className="bg-muted/30 p-4 rounded-md text-sm whitespace-pre-wrap">
                  {request.description || t('ui.notEntered')}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm text-muted-foreground mb-2">{t('requests.reqsLabel')}</h4>
                <div className="bg-muted/30 p-4 rounded-md text-sm whitespace-pre-wrap">
                  {request.requirements || t('ui.notEntered')}
                </div>
              </div>

              {request.reason && (
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-2">{t('requests.reasonLabel')}</h4>
                  <p className="text-sm">{request.reason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {(isHrLike || isRecruiter) && (
            <Card>
              <CardHeader>
                <CardTitle>{t('requests.claimsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {canClaim && (
                  <div className="space-y-2 rounded-lg border border-dashed p-3">
                    <p className="text-sm text-muted-foreground">
                      {t('requests.claimHint')}
                    </p>
                    <Textarea
                      value={claimNote}
                      onChange={(e) => setClaimNote(e.target.value)}
                      placeholder={t('requests.claimNotePh')}
                      rows={2}
                    />
                    <Button className="gap-2" onClick={handleClaim} disabled={claiming}>
                      <Hand className="w-4 h-4" />
                      {t('requests.claimBtn')}
                    </Button>
                  </div>
                )}

                {myClaim && user?.role === 'recruiter' && (
                  <p className="text-sm text-muted-foreground">
                    {t('requests.myClaim')}: <strong>{claimStatusLabel[myClaim.status]}</strong>
                    {myClaim.note ? ` — ${myClaim.note}` : ''}
                  </p>
                )}

                {(claims ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">{t('requests.noClaims')}</p>
                ) : (
                  <ul className="space-y-2">
                    {(claims ?? []).map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-medium">{c.recruiterName || `Rekruter #${c.recruiterId}`}</p>
                          {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{claimStatusLabel[c.status]}</Badge>
                          {canShowApprove && c.status === 'pending' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7"
                              onClick={() => {
                                setRecruiterId(String(c.recruiterId));
                                setDeadline(request.deadline ? String(request.deadline).slice(0, 10) : '');
                                setApproveOpen(true);
                              }}
                            >
                              {t('requests.assign')}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('requests.needTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.position')}</span>
                <span className="font-medium text-right">{request.position}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.dept')}</span>
                <span className="font-medium">{request.departmentName || '—'}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.place')}</span>
                <span className="font-medium text-right">
                  {[request.city, request.district].filter(Boolean).join(', ') || '—'}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.author')}</span>
                <span className="font-medium">{request.createdByName || '—'}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.count')}</span>
                <span className="font-medium">{request.count} {t('ui.people')}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.salary')}</span>
                <span className="font-medium">{request.salaryRange || t('requests.negotiable')}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.deadline')}</span>
                <span className="font-medium">
                  {request.deadline
                    ? (() => {
                        const d = new Date(request.deadline);
                        return Number.isNaN(d.getTime()) ? request.deadline : format(d, 'dd.MM.yyyy');
                      })()
                    : t('ui.notSet')}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">{t('requests.lbl.date')}</span>
                <span className="font-medium">{format(new Date(request.createdAt), 'dd.MM.yyyy HH:mm')}</span>
              </div>
              {(request.vacancyAssignedAt || request.assignedAt) && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">{t('requests.lbl.hrSent')}</span>
                  <span className="font-medium">
                    {format(new Date(request.vacancyAssignedAt || request.assignedAt!), 'dd.MM.yyyy HH:mm')}
                  </span>
                </div>
              )}
              {request.vacancyAcceptedAt && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">{t('requests.lbl.recAccepted')}</span>
                  <span className="font-medium">{format(new Date(request.vacancyAcceptedAt), 'dd.MM.yyyy HH:mm')}</span>
                </div>
              )}
              {request.vacancyPublishedAt && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">{t('requests.lbl.pubConfirmed')}</span>
                  <span className="font-medium">{format(new Date(request.vacancyPublishedAt), 'dd.MM.yyyy HH:mm')}</span>
                </div>
              )}
              {!request.vacancyAcceptedAt && request.vacancyId && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">{t('requests.lbl.recAccept')}</span>
                  <span className="font-medium italic text-muted-foreground">{t('hire.pending')}</span>
                </div>
              )}

              <div className="pt-2">
                <span className="text-muted-foreground block mb-1">{t('requests.lbl.assignee')}</span>
                {request.assignedToName ? (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
                      {request.assignedToName.charAt(0)}
                    </div>
                    <span className="font-medium">{request.assignedToName}</span>
                  </div>
                ) : (
                  <div className="p-2 border border-dashed border-gray-300 rounded-md text-center text-muted-foreground italic">
                    {t('requests.notAssignedYet')}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('requests.approveTitle')}</DialogTitle>
            <DialogDescription>
              {t('requests.approveDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {pendingClaims.length > 0 && (
              <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                {t('requests.claimers')}{' '}
                {pendingClaims.map((c) => c.recruiterName || `#${c.recruiterId}`).join(', ')}
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('hire.col.recruiter')}</Label>
              <Select value={recruiterId} onValueChange={setRecruiterId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('hire.ph.recruiter')} />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  {(recruiters ?? [])
                    .filter((u) => u.status === 'active')
                    .map((u) => {
                      const claimed = pendingClaims.some((c) => c.recruiterId === u.id);
                      return (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.fullName}{claimed ? ` · ${t('requests.hasClaim')}` : ''}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                {needsDeadline ? t('requests.deadlineReq') : t('requests.deadlineWith')}
              </Label>
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required={needsDeadline}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={isApproving}>
              {t('ui.cancelFull')}
            </Button>
            <Button onClick={handleApprove} disabled={isApproving}>
              {isApproving ? t('ui.confirming') : t('ui.approve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
