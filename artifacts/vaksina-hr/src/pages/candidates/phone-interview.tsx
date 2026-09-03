import React, { useEffect, useState } from 'react';
import {
  useGetCandidate,
  useGetUsers,
  useGetPhoneInterviews,
  useCreatePhoneInterview,
  useUpdatePhoneInterview,
} from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useAuth } from '../../contexts/AuthContext';
import { Skeleton } from '../../components/ui/skeleton';
import { CandidateReadOnlyBanner } from '../../components/candidates/CandidateReadOnlyBanner';
import { canManageCandidate } from '../../lib/candidate-access';
import { nextStageFormHref } from '../../lib/stage-routes';
import { useI18n } from '../../i18n/I18nProvider';

export default function PhoneInterviewPage({ params }: { params: { id: string } }) {
  const candidateId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();

  const { data: candidate, isLoading } = useGetCandidate(candidateId, {
    query: { enabled: !!candidateId },
  });
  const { data: existingList, isLoading: existingLoading } = useGetPhoneInterviews(
    { candidateId },
    { query: { enabled: !!candidateId } },
  );
  const existing = existingList?.[0];
  const { data: recruiters, isLoading: recruitersLoading } = useGetUsers({ role: 'recruiter' });
  const { mutate: createInterview, isPending: creating } = useCreatePhoneInterview();
  const { mutate: updateInterview, isPending: updating } = useUpdatePhoneInterview();
  const isPending = creating || updating;
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const [recruiterId, setRecruiterId] = useState('');
  const [interviewDate, setInterviewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!recruiterId && user?.role === 'recruiter') {
      setRecruiterId(String(user.id));
    } else if (!recruiterId && candidate?.recruiterId) {
      setRecruiterId(String(candidate.recruiterId));
    }
  }, [user, candidate, recruiterId]);

  useEffect(() => {
    if (hydrated || !existing) return;
    if (existing.recruiterId) setRecruiterId(String(existing.recruiterId));
    if (existing.interviewDate) setInterviewDate(String(existing.interviewDate).slice(0, 10));
    if (existing.status) setStatus(existing.status);
    if (existing.notes) setNotes(existing.notes);
    if (existing.rejectReason) setRejectReason(existing.rejectReason);
    setHydrated(true);
  }, [existing, hydrated]);

  const finishOk = (resultStatus: string) => {
    if (resultStatus === 'suitable') {
      toast({
        title: t('ui.saved'),
        description: t('hire.phoneOkNext'),
      });
      setLocation(nextStageFormHref(candidateId, 'phone_interview')!);
    } else if (resultStatus === 'not_suitable') {
      toast({ title: t('ui.saved'), description: t('hire.phoneOkReject') });
      setLocation(`/candidates/${candidateId}`);
    } else {
      toast({ title: t('ui.saved'), description: t('hire.phoneOkPending') });
      setLocation(`/candidates/${candidateId}`);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast({ title: t('ui.noAccess'), description: t('hire.noPermEdit'), variant: 'destructive' });
      return;
    }
    if (!recruiterId) {
      toast({ title: t('ui.error'), description: t('hire.phoneNeedWho'), variant: 'destructive' });
      return;
    }
    if (!status) {
      toast({ title: t('ui.error'), description: t('hire.phoneNeedResult'), variant: 'destructive' });
      return;
    }
    if (status === 'not_suitable' && !rejectReason.trim()) {
      toast({ title: t('ui.error'), description: t('hire.phoneNeedReject'), variant: 'destructive' });
      return;
    }

    if (existing?.id) {
      updateInterview(
        {
          id: existing.id,
          data: {
            interviewDate: interviewDate || undefined,
            notes: notes || undefined,
            status,
            rejectReason: status === 'not_suitable' ? rejectReason : undefined,
          },
        },
        {
          onSuccess: () => finishOk(status),
          onError: () => {
            toast({ title: t('ui.error'), description: t('hire.saveFailLong'), variant: 'destructive' });
          },
        },
      );
    } else {
      createInterview(
        {
          data: {
            candidateId,
            recruiterId: Number(recruiterId),
            interviewDate: interviewDate || undefined,
            notes: notes || undefined,
            status,
            rejectReason: status === 'not_suitable' ? rejectReason : undefined,
          },
        },
        {
          onSuccess: () => finishOk(status),
          onError: () => {
            toast({ title: t('ui.error'), description: t('hire.saveFailLong'), variant: 'destructive' });
          },
        },
      );
    }
  };

  if (isLoading || existingLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!candidate) return <div className="p-8">{t('hire.notFound')}</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {!canEdit && <CandidateReadOnlyBanner assigneeName={candidate.recruiterName} />}
      <div className="flex items-center gap-4">
        <Link href={`/candidates/${candidateId}`}>
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{t('hire.phoneStep')}</p>
          <h1 className="text-3xl font-bold tracking-tight">{t('hire.phoneResultTitle')}</h1>
          <p className="text-muted-foreground mt-1">{candidate.fullName}</p>
        </div>
      </div>

      <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-80">
      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('hire.phoneResultTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('hire.phoneWho')}</Label>
              <Select
                value={recruiterId}
                onValueChange={setRecruiterId}
                disabled={recruitersLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={recruitersLoading ? t('ui.loading') : t('hire.ph.recruiter')} />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  {(recruiters ?? []).filter((u) => u.status === 'active').map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('hire.phoneDate')}</Label>
              <Input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>{t('hire.phoneResult')}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder={t('hire.phoneResultPh')} />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  <SelectItem value="suitable">{t('hire.phoneSuitable')}</SelectItem>
                  <SelectItem value="not_suitable">{t('hire.phoneNotSuitable')}</SelectItem>
                  <SelectItem value="pending">{t('hire.result.pending')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {status === 'not_suitable' && (
              <div className="space-y-2">
                <Label>{t('hire.phoneRejectReason')}</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t('hire.phoneRejectPh')}
                  className="min-h-[80px]"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>{t('hire.phoneNotes')}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('hire.phoneNotesPh')}
                className="min-h-[100px]"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href={`/candidates/${candidateId}`}>
            <Button type="button" variant="ghost">{t('ui.cancelFull')}</Button>
          </Link>
          <Button type="submit" disabled={isPending || !canEdit}>
            {isPending ? t('ui.saving') : existing ? t('ui.update') : t('hire.phoneSaveResult')}
          </Button>
        </div>
      </form>
      </fieldset>
    </div>
  );
}
