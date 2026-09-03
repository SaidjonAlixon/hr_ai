import React, { useState } from 'react';
import { useGetCandidate, useCreateOffer, useGetOffers, useUpdateOffer } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { CandidateReadOnlyBanner } from '../../components/candidates/CandidateReadOnlyBanner';
import { canManageCandidate } from '../../lib/candidate-access';
import { nextStageFormHref } from '../../lib/stage-routes';
import { useI18n } from '../../i18n/I18nProvider';

export default function OfferPage({ params }: { params: { id: string } }) {
  const candidateId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();

  const { data: candidate, isLoading } = useGetCandidate(candidateId, { query: { enabled: !!candidateId } });
  const { data: offers } = useGetOffers({ candidateId });
  const createOffer = useCreateOffer();
  const updateOffer = useUpdateOffer();
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const existing = offers?.[0];

  const [position, setPosition] = useState('');
  const [salary, setSalary] = useState('');
  const [workConditions, setWorkConditions] = useState('');

  React.useEffect(() => {
    if (candidate?.vacancyTitle && !position) setPosition(candidate.vacancyTitle);
    if (candidate?.expectedSalary && !salary) setSalary(candidate.expectedSalary);
  }, [candidate, position, salary]);

  React.useEffect(() => {
    if (!existing) return;
    if (existing.position) setPosition(existing.position);
    if (existing.salary) setSalary(existing.salary);
    if (existing.workConditions) setWorkConditions(existing.workConditions);
  }, [existing]);

  const isPending = createOffer.isPending || updateOffer.isPending;

  const createNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast({ title: t('ui.noAccess'), description: t('hire.noPermEdit'), variant: 'destructive' });
      return;
    }
    if (!position.trim() || !salary.trim()) {
      toast({ title: t('ui.error'), description: t('hire.offerNeedFields'), variant: 'destructive' });
      return;
    }
    createOffer.mutate(
      { data: { candidateId, position, salary, workConditions: workConditions || undefined } },
      {
        onSuccess: () => toast({ title: t('hire.offerCreated'), description: t('hire.offerCreatedDesc') }),
        onError: () => toast({ title: t('ui.error'), description: t('hire.saveFail'), variant: 'destructive' }),
      },
    );
  };

  const decide = (status: 'accepted' | 'rejected') => {
    if (!existing) return;
    updateOffer.mutate(
      { id: existing.id, data: { status } },
      {
        onSuccess: () => {
          toast({
            title: status === 'accepted' ? t('hire.offerAccepted') : t('hire.offerRejected'),
            description: status === 'accepted' ? t('hire.offerAcceptedDesc') : t('hire.offerRejectedDesc'),
          });
          if (status === 'accepted') {
            setLocation(nextStageFormHref(candidateId, 'offer')!);
          } else {
            setLocation(`/candidates/${candidateId}`);
          }
        },
        onError: () => toast({ title: t('ui.error'), description: t('hire.offerUpdateFail'), variant: 'destructive' }),
      },
    );
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!candidate) return <div className="p-8">{t('hire.notFound')}</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {!canEdit && <CandidateReadOnlyBanner assigneeName={candidate.recruiterName} />}
      <div className="flex items-center gap-4">
        <Link href={`/candidates/${candidateId}`}>
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('hire.offerTitle')}</h1>
          <p className="text-muted-foreground mt-1">{candidate.fullName} — {t('hire.offerSub')}</p>
        </div>
      </div>

      {!existing ? (
        <fieldset disabled={!canEdit} className="disabled:opacity-80">
        <form onSubmit={createNew} className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('hire.offerTerms')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('hire.offerPosition')}</Label>
                <Input value={position} onChange={(e) => setPosition(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('hire.offerSalary')}</Label>
                <Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder={t('hire.offerSalaryPh')} />
              </div>
              <div className="space-y-2">
                <Label>{t('hire.offerConditions')}</Label>
                <Textarea value={workConditions} onChange={(e) => setWorkConditions(e.target.value)} className="min-h-[100px]" />
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-end gap-3">
            <Link href={`/candidates/${candidateId}`}><Button type="button" variant="ghost">{t('ui.cancel')}</Button></Link>
            <Button type="submit" disabled={isPending || !canEdit}>{isPending ? t('ui.saving') : t('hire.offerCreate')}</Button>
          </div>
        </form>
        </fieldset>
      ) : (
        <Card>
          <CardHeader><CardTitle>{t('hire.offerNum')} #{existing.id}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-sm text-muted-foreground">{t('ui.position')}</p><p className="font-semibold">{existing.position}</p></div>
            <div><p className="text-sm text-muted-foreground">{t('ui.salary')}</p><p className="font-semibold">{existing.salary}</p></div>
            <div><p className="text-sm text-muted-foreground">{t('hire.offerConditionsShort')}</p><p>{existing.workConditions || '—'}</p></div>
            <div><p className="text-sm text-muted-foreground">{t('ui.status')}</p><p className="font-medium">{existing.status}</p></div>
            {existing.status === 'pending' && (
              <div className="flex gap-3 pt-4 border-t">
                <Button variant="destructive" disabled={isPending || !canEdit} onClick={() => decide('rejected')}>{t('hire.offerReject')}</Button>
                <Button disabled={isPending || !canEdit} onClick={() => decide('accepted')}>{t('hire.offerAcceptBtn')}</Button>
              </div>
            )}
            {existing.status === 'accepted' && (
              <Link href={`/candidates/${candidateId}/documents`}>
                <Button className="w-full">{t('hire.offerToDocs')}</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
