import React, { useMemo, useState } from 'react';
import { useGetCandidate, useCreatePreboarding } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { CandidateReadOnlyBanner } from '../../components/candidates/CandidateReadOnlyBanner';
import { canManageCandidate } from '../../lib/candidate-access';
import { nextStageFormHref } from '../../lib/stage-routes';
import { useI18n } from '../../i18n/I18nProvider';

export default function PreboardingPage({ params }: { params: { id: string } }) {
  const candidateId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();

  const defaultChecklist = useMemo(
    () => [
      { label: t('hire.pre.c1'), completed: false },
      { label: t('hire.pre.c2'), completed: false },
      { label: t('hire.pre.c3'), completed: false },
      { label: t('hire.pre.c4'), completed: false },
      { label: t('hire.pre.c5'), completed: false },
    ],
    [t],
  );

  const { data: candidate, isLoading } = useGetCandidate(candidateId, {
    query: { enabled: !!candidateId },
  });
  const { mutate, isPending } = useCreatePreboarding();
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const [checklist, setChecklist] = useState(defaultChecklist);
  const [notes, setNotes] = useState('');
  const [scheduledDate, setScheduledDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [scheduledTime, setScheduledTime] = useState('10:00');

  React.useEffect(() => {
    setChecklist(defaultChecklist);
  }, [defaultChecklist]);

  const toggleItem = (index: number) => {
    setChecklist((prev) =>
      prev.map((item, i) => (i === index ? { ...item, completed: !item.completed } : item)),
    );
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast({ title: t('ui.noAccess'), description: t('hire.noPermEdit'), variant: 'destructive' });
      return;
    }
    const done = checklist.filter((i) => i.completed).length;
    if (done === 0) {
      toast({
        title: t('ui.error'),
        description: t('hire.preboardNeedCheck'),
        variant: 'destructive',
      });
      return;
    }
    if (!scheduledDate) {
      toast({
        title: t('ui.error'),
        description: t('hire.preboardNeedDate'),
        variant: 'destructive',
      });
      return;
    }

    mutate(
      {
        data: {
          candidateId,
          checklist,
          notes: notes || undefined,
          scheduledDate,
          scheduledTime: scheduledTime || '10:00',
        } as any,
      },
      {
        onSuccess: () => {
          toast({
            title: t('ui.saved'),
            description: `${t('hire.preboardSaved')} (${scheduledDate} ${scheduledTime || ''})`,
          });
          setLocation(nextStageFormHref(candidateId, 'preboarding')!);
        },
        onError: (err: any) => {
          toast({
            title: t('ui.error'),
            description: err?.message || t('hire.saveFail'),
            variant: 'destructive',
          });
        },
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
          <h1 className="text-3xl font-bold tracking-tight">{t('hire.preboardTitle')}</h1>
          <p className="text-muted-foreground mt-1">{candidate.fullName} — {t('hire.preboardSub')}</p>
        </div>
      </div>

      <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-80">
      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('hire.preboardChecklist')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {checklist.map((item, index) => (
              <label
                key={`${item.label}-${index}`}
                className="flex items-start gap-3 p-3 rounded-md border bg-muted/20 cursor-pointer hover:bg-muted/40"
              >
                <Checkbox
                  checked={item.completed}
                  onCheckedChange={() => toggleItem(index)}
                  className="mt-0.5"
                />
                <span className={item.completed ? 'line-through text-muted-foreground' : ''}>
                  {item.label}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('hire.preboardOffline')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('hire.preboardDate')}</Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('hire.preboardTime')}</Label>
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                required
              />
            </div>
            <p className="md:col-span-2 text-sm text-muted-foreground">
              {t('hire.preboardHint')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('ui.notes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Label className="sr-only">{t('ui.notes')}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('hire.preboardNotePh')}
              className="min-h-[100px]"
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href={`/candidates/${candidateId}`}>
            <Button type="button" variant="ghost">{t('ui.cancelFull')}</Button>
          </Link>
          <Button type="submit" disabled={isPending || !canEdit}>
            {isPending ? t('ui.saving') : t('hire.preboardFinish')}
          </Button>
        </div>
      </form>
      </fieldset>
    </div>
  );
}
