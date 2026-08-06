import React, { useState } from 'react';
import { useGetCandidate, useCreatePreboarding } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
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

const DEFAULT_CHECKLIST = [
  { label: 'Lavozim vazifalari bilan tanishtirish', completed: false },
  { label: 'Ish tartibi va qoidalar', completed: false },
  { label: 'Kompaniya qadriyatlari', completed: false },
  { label: 'Xavfsizlik qoidalari', completed: false },
  { label: 'Jamoaviy tuzilma', completed: false },
];

export default function PreboardingPage({ params }: { params: { id: string } }) {
  const candidateId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: candidate, isLoading } = useGetCandidate(candidateId, {
    query: { enabled: !!candidateId },
  });
  const { mutate, isPending } = useCreatePreboarding();
  const canEdit = canManageCandidate(user, candidate?.recruiterId);

  const [checklist, setChecklist] = useState(DEFAULT_CHECKLIST);
  const [notes, setNotes] = useState('');

  const toggleItem = (index: number) => {
    setChecklist((prev) =>
      prev.map((item, i) => (i === index ? { ...item, completed: !item.completed } : item)),
    );
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast({ title: 'Ruxsat yo\'q', description: 'Faqat mas\'ul va HR o\'zgartira oladi', variant: 'destructive' });
      return;
    }
    const done = checklist.filter((i) => i.completed).length;
    if (done === 0) {
      toast({
        title: 'Xatolik',
        description: 'Kamida bitta checklist bandini belgilang',
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
        },
      },
      {
        onSuccess: () => {
          toast({
            title: 'Saqlandi',
            description: 'Pre-boarding yakunlandi — offline suhbat bosqichiga o\'tdi',
          });
          setLocation(nextStageFormHref(candidateId, 'preboarding')!);
        },
        onError: () => {
          toast({ title: 'Xatolik', description: 'Saqlashda xatolik', variant: 'destructive' });
        },
      },
    );
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!candidate) return <div className="p-8">Nomzod topilmadi</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {!canEdit && <CandidateReadOnlyBanner assigneeName={candidate.recruiterName} />}
      <div className="flex items-center gap-4">
        <Link href={`/candidates/${candidateId}`}>
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pre-boarding</h1>
          <p className="text-muted-foreground mt-1">{candidate.fullName} — lavozim va qoidalar bilan tanishtirish</p>
        </div>
      </div>

      <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-80">
      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {checklist.map((item, index) => (
              <label
                key={item.label}
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
            <CardTitle>Izoh</CardTitle>
          </CardHeader>
          <CardContent>
            <Label className="sr-only">Izoh</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Pre-boarding bo'yicha qaydlar..."
              className="min-h-[100px]"
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href={`/candidates/${candidateId}`}>
            <Button type="button" variant="ghost">Bekor qilish</Button>
          </Link>
          <Button type="submit" disabled={isPending || !canEdit}>
            {isPending ? 'Saqlanmoqda...' : 'Yakunlash → Offline suhbat'}
          </Button>
        </div>
      </form>
      </fieldset>
    </div>
  );
}
