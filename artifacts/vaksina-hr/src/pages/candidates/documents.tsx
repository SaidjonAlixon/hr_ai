import React, { useEffect, useMemo, useState } from 'react';
import { useGetCandidate, useGetOffers, useUpdateOffer, useUpdateCandidate, ChecklistItem } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { CandidateReadOnlyBanner } from '../../components/candidates/CandidateReadOnlyBanner';
import { canManageCandidate } from '../../lib/candidate-access';
import { nextStageFormHref } from '../../lib/stage-routes';
import { useI18n } from '../../i18n/I18nProvider';

export default function DocumentsPage({ params }: { params: { id: string } }) {
  const candidateId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();

  const defaultDocs = useMemo<ChecklistItem[]>(
    () => [
      { label: t('hire.doc.passport'), completed: false },
      { label: t('hire.doc.diploma'), completed: false },
      { label: t('hire.doc.workbook'), completed: false },
      { label: t('hire.doc.medical'), completed: false },
      { label: t('hire.doc.photo'), completed: false },
    ],
    [t],
  );

  const { data: candidate, isLoading } = useGetCandidate(candidateId, { query: { enabled: !!candidateId } });
  const { data: offers, refetch } = useGetOffers({ candidateId });
  const updateOffer = useUpdateOffer();
  const updateCandidate = useUpdateCandidate();
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const offer = offers?.[0];
  const [docs, setDocs] = useState<ChecklistItem[]>(defaultDocs);

  useEffect(() => {
    if (offer?.documentsChecklist?.length) {
      setDocs(offer.documentsChecklist as ChecklistItem[]);
    } else {
      setDocs(defaultDocs);
    }
  }, [offer, defaultDocs]);

  const toggle = (index: number) => {
    setDocs((prev) => prev.map((d, i) => (i === index ? { ...d, completed: !d.completed } : d)));
  };

  const save = () => {
    if (!offer) {
      toast({ title: t('ui.error'), description: t('hire.docsNeedOffer'), variant: 'destructive' });
      return;
    }
    const allDone = docs.every((d) => d.completed);
    updateOffer.mutate(
      { id: offer.id, data: { documentsChecklist: docs } },
      {
        onSuccess: () => {
          if (allDone) {
            updateCandidate.mutate(
              { id: candidateId, data: { stage: 'internship' } },
              {
                onSuccess: () => {
                  toast({ title: t('hire.docsComplete'), description: t('hire.docsToIntern') });
                  setLocation(nextStageFormHref(candidateId, 'documents')!);
                },
              },
            );
          } else {
            toast({ title: t('ui.saved'), description: t('hire.docsSaved') });
            refetch();
          }
        },
        onError: () => toast({ title: t('ui.error'), description: t('hire.saveFail'), variant: 'destructive' }),
      },
    );
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!candidate) return <div className="p-8">{t('hire.notFound')}</div>;

  const doneCount = docs.filter((d) => d.completed).length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {!canEdit && <CandidateReadOnlyBanner assigneeName={candidate.recruiterName} />}
      <div className="flex items-center gap-4">
        <Link href={`/candidates/${candidateId}`}>
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('hire.docsTitle')}</h1>
          <p className="text-muted-foreground mt-1">{candidate.fullName} — {doneCount}/{docs.length} {t('hire.docsReady')}</p>
        </div>
      </div>

      <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-80">
      <Card>
        <CardHeader><CardTitle>{t('hire.docsChecklist')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {docs.map((item, index) => (
            <label key={`${item.label}-${index}`} className="flex items-start gap-3 p-3 rounded-md border bg-muted/20 cursor-pointer hover:bg-muted/40">
              <Checkbox checked={item.completed} onCheckedChange={() => toggle(index)} className="mt-0.5" />
              <span className={item.completed ? 'line-through text-muted-foreground' : ''}>{item.label}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href={`/candidates/${candidateId}`}><Button variant="ghost">{t('ui.cancel')}</Button></Link>
        <Button onClick={save} disabled={!canEdit || updateOffer.isPending || updateCandidate.isPending}>
          {docs.every((d) => d.completed) ? t('hire.docsFinish') : t('ui.save')}
        </Button>
      </div>
      </fieldset>
    </div>
  );
}
