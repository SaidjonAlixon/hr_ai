import React, { useState } from 'react';
import { useGetCandidate, useUpdateCandidate } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { CandidateReadOnlyBanner } from '../../components/candidates/CandidateReadOnlyBanner';
import { canManageCandidate } from '../../lib/candidate-access';
import { nextStageFormHref } from '../../lib/stage-routes';
import { useI18n } from '../../i18n/I18nProvider';

export default function FinalDecisionPage({ params }: { params: { id: string } }) {
  const candidateId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: candidate, isLoading } = useGetCandidate(candidateId, { query: { enabled: !!candidateId } });
  const updateCandidate = useUpdateCandidate();
  const [notes, setNotes] = useState('');
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const decide = (passed: boolean) => {
    if (!canEdit) {
      toast({ title: t('ui.noAccess'), description: t('hire.noPermEdit'), variant: 'destructive' });
      return;
    }
    updateCandidate.mutate(
      {
        id: candidateId,
        data: passed
          ? { stage: 'offer', status: 'active' }
          : { stage: 'final_decision', status: 'rejected' },
      },
      {
        onSuccess: () => {
          toast({
            title: passed ? t('hire.finalPassToast') : t('hire.finalFailToast'),
            description: passed ? t('hire.finalPassDesc') : t('hire.finalFailDesc'),
          });
          setLocation(passed ? nextStageFormHref(candidateId, 'final_decision')! : `/candidates/${candidateId}`);
        },
        onError: () => toast({ title: t('ui.error'), description: t('hire.saveFail'), variant: 'destructive' }),
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
          <h1 className="text-3xl font-bold tracking-tight">{t('hire.finalTitle')}</h1>
          <p className="text-muted-foreground mt-1">{candidate.fullName} — {t('hire.finalSub')}</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('hire.finalDecision')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t('ui.notes')}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('hire.finalNotePh')} className="min-h-[100px]" disabled={!canEdit} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Button
              variant="destructive"
              className="h-12"
              disabled={updateCandidate.isPending || !canEdit}
              onClick={() => decide(false)}
            >
              <XCircle className="w-4 h-4 mr-2" /> {t('hire.finalFailBtn')}
            </Button>
            <Button
              className="h-12"
              disabled={updateCandidate.isPending || !canEdit}
              onClick={() => decide(true)}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" /> {t('hire.finalPassBtn')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
