import React from 'react';
import {
  useGetVacancy,
  usePublishVacancy,
  useDeleteVacancy,
  useUpdateVacancy,
  useGetCandidates,
  type Candidate,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  ArrowLeft,
  MapPin,
  Clock,
  DollarSign,
  Gift,
  Users,
  Trash2,
  CheckCircle,
  CheckCircle2,
  FileDown,
  Phone,
  GraduationCap,
  Briefcase,
  ExternalLink,
  CalendarClock,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { isHrManager, isHrRole, canExtendVacancy } from '../../lib/roles';
import { openCandidatePdf, openVacancyCandidatesPdf } from '../../lib/candidate-pdf';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '../../components/ui/dialog';
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
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useI18n } from '../../i18n/I18nProvider';


function toLocalInput(iso?: string | null) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addDaysIso(fromIso: string | null | undefined, days: number) {
  const now = new Date();
  const cur = fromIso ? new Date(fromIso) : now;
  const base = !Number.isNaN(cur.getTime()) && cur.getTime() > now.getTime() ? cur : now;
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

function formatMaybeDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'dd.MM.yyyy HH:mm');
  } catch {
    return iso;
  }
}

function toPdfData(
  c: Candidate,
  stageLabels: Record<string, string>,
  statusLabels: Record<string, string>,
) {
  return {
    fullName: c.fullName,
    phone: c.phone,
    birthDate: c.birthDate,
    address: c.address,
    education: c.education,
    experience: c.experience,
    expectedSalary: c.expectedSalary,
    notes: c.notes,
    stage: c.stage,
    stageLabel: stageLabels[c.stage] || c.stage,
    status: c.status,
    statusLabel: statusLabels[c.status || ''] || c.status || '—',
    recruiterName: c.recruiterName,
    createdAt: formatMaybeDate(c.createdAt),
  };
}

export default function VacancyDetails({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: vacancy, isLoading, refetch } = useGetVacancy(id, { query: { enabled: !!id } });
  const { data: candidates, isLoading: candidatesLoading } = useGetCandidates(
    { vacancyId: id },
    { query: { enabled: !!id } } as any,
  );
  const { mutate: publish, isPending: isPublishing } = usePublishVacancy();
  const { mutate: removeVacancy, isPending: isDeleting } = useDeleteVacancy();
  const { mutate: updateVacancy, isPending: isUpdating } = useUpdateVacancy();
  const { toast } = useToast();
  const [selectedChannels, setSelectedChannels] = React.useState<number[]>([]);
  const autoPublish = new URLSearchParams(window.location.search).get('publish') === '1';
  const [publishOpen, setPublishOpen] = React.useState(autoPublish);
  const [extendOpen, setExtendOpen] = React.useState(false);
  const [customDeadline, setCustomDeadline] = React.useState('');
  const [busyKind, setBusyKind] = React.useState<'close' | 'extend' | null>(null);
  const canPublish = isHrManager(user?.role) || user?.role === 'recruiter';
  const canDelete = isHrRole(user?.role) || user?.role === 'director';
  const isAssignedRecruiter =
    user?.role === 'recruiter' && vacancy?.recruiterId === user.id;
  const canClose =
    !!vacancy &&
    vacancy.status === 'published' &&
    (user?.role === 'admin' ||
      isHrRole(user?.role) ||
      user?.role === 'director' ||
      isAssignedRecruiter);
  const canExtend =
    !!vacancy &&
    vacancy.status !== 'closed' &&
    canExtendVacancy(user?.role);

  const STAGE_LABELS: Record<string, string> = {
    phone_interview: t('hire.phone'),
    online_interview: t('hire.online'),
    preboarding: t('hire.preboarding'),
    offline_interview: t('hire.offline'),
    final_decision: t('hire.final'),
    offer: t('hire.offer'),
    documents: t('hire.docs'),
    internship: t('hire.internship'),
    hired: t('hire.hired'),
    rejected: t('hire.rejected'),
  };

  const STATUS_LABELS: Record<string, string> = {
    active: t('ui.active'),
    hired: t('hire.hiredBadge'),
    rejected: t('hire.rejected'),
  };


  React.useEffect(() => {
    if (autoPublish && vacancy?.status === 'draft' && canPublish) {
      setPublishOpen(true);
    }
  }, [autoPublish, vacancy?.status, canPublish]);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!vacancy) return <div>{t('hire.vacancyNotFound')}</div>;

  const vacancyPdfMeta = {
    title: vacancy.title,
    location: vacancy.location,
    salaryRange: vacancy.salaryRange,
    recruiterName: vacancy.recruiterName,
    departmentName: vacancy.departmentName,
  };

  const list = candidates ?? [];

  const handleExportAllPdf = () => {
    const ok = openVacancyCandidatesPdf(list.map((c) => toPdfData(c, STAGE_LABELS, STATUS_LABELS)), vacancyPdfMeta);
    if (!ok) {
      toast({
        title: t('hire.popupBlocked'),
        description: t('hire.popupBlockedDesc'),
        variant: 'destructive',
      });
    }
  };

  const handleExportOnePdf = (c: Candidate) => {
    const ok = openCandidatePdf(toPdfData(c, STAGE_LABELS, STATUS_LABELS), vacancyPdfMeta);
    if (!ok) {
      toast({
        title: t('hire.popupBlocked'),
        description: t('hire.popupBlockedDesc'),
        variant: 'destructive',
      });
    }
  };

  const handlePublish = () => {
    if (selectedChannels.length === 0) {
      toast({ title: t('ui.error'), description: t('hire.vacancyNeedChannel'), variant: 'destructive' });
      return;
    }

    publish(
      { id, data: { channelIds: selectedChannels } },
      {
        onSuccess: () => {
          toast({ title: t('hire.offerAccepted'), description: t('hire.vacancyPublished') });
          setPublishOpen(false);
          setSelectedChannels([]);
          window.history.replaceState({}, '', `/vacancies/${id}`);
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: t('ui.error'),
            description: err?.message || t('hire.vacancyPublishFail'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleDelete = () => {
    removeVacancy(
      { id },
      {
        onSuccess: () => {
          toast({ title: t('ui.deleted'), description: t('hire.vacancyDeleted') });
          setLocation('/vacancies');
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

  const handleClose = () => {
    setBusyKind('close');
    updateVacancy(
      { id, data: { status: 'closed' } },
      {
        onSuccess: () => {
          toast({ title: t('ui.done'), description: t('hire.vacancyClosed') });
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: t('ui.error'),
            description: err?.message || t('hire.vacancyCloseFail'),
            variant: 'destructive',
          });
        },
        onSettled: () => setBusyKind(null),
      },
    );
  };

  const handleExtend = (deadlineIso: string) => {
    setBusyKind('extend');
    updateVacancy(
      { id, data: { deadline: deadlineIso } },
      {
        onSuccess: () => {
          toast({
            title: t('hire.vacancyExtended'),
            description: `${t('hire.vacancyNewDeadline')}: ${format(new Date(deadlineIso), 'dd.MM.yyyy HH:mm')}`,
          });
          setExtendOpen(false);
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: t('ui.error'),
            description: err?.message || t('hire.vacancyExtendFail'),
            variant: 'destructive',
          });
        },
        onSettled: () => setBusyKind(null),
      },
    );
  };

  const isClosing = isUpdating && busyKind === 'close';
  const isExtending = isUpdating && busyKind === 'extend';

  const publishChannels = [
    { id: 1, name: 'HeadHunter (hh.uz)' },
    { id: 2, name: 'OLX.uz' },
    { id: 3, name: 'Telegram Kanal' },
    { id: 4, name: 'Instagram' },
    { id: 5, name: 'Kompaniya sayti' },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/vacancies">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{vacancy.title}</h1>
              <Badge
                variant="secondary"
                className={
                  vacancy.status === 'published'
                    ? 'bg-emerald-100 text-emerald-800'
                    : vacancy.status === 'draft'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-muted dark:bg-slate-800 text-foreground dark:text-white gap-1'
                }
              >
                {vacancy.status === 'published' ? (
                  t('hire.vacancyActive')
                ) : vacancy.status === 'draft' ? (
                  t('hire.vacancyNew')
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3" /> {t('hire.vacancyDone')}
                  </>
                )}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              {t('hire.requestHash')} #{vacancy.requestId}
              {vacancy.departmentName ? ` · ${vacancy.departmentName}` : ''}
              {' · '}
              {format(new Date(vacancy.createdAt), 'dd.MM.yyyy')}
              {' · '}
              {list.length} {t('hire.candCount')}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {list.length > 0 && (
            <Button type="button" variant="outline" className="gap-2" onClick={handleExportAllPdf}>
              <FileDown className="w-4 h-4" /> {t('hire.pdfAll')}
            </Button>
          )}
          {(user?.role === 'recruiter' || isHrRole(user?.role) || user?.role === 'director' || user?.role === 'admin') &&
            vacancy.status !== 'closed' && (
            <Link href={`/candidates/new?vacancyId=${vacancy.id}`}>
              <Button variant="outline" className="gap-2">
                <Users className="w-4 h-4" /> {t('hire.addCand')}
              </Button>
            </Link>
          )}

          {canExtend && (
            <Dialog
              open={extendOpen}
              onOpenChange={(open) => {
                setExtendOpen(open);
                if (open) setCustomDeadline(toLocalInput((vacancy as any).deadline));
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={isExtending}>
                  <CalendarClock className="w-4 h-4" />
                  {isExtending ? t('hire.extending') : t('hire.extendVacancy')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('hire.extendTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('hire.extendCurrent')}:{' '}
                    {(vacancy as any).deadline
                      ? format(new Date((vacancy as any).deadline), 'dd.MM.yyyy HH:mm')
                      : t('ui.notSet')}
                    . {t('hire.extendHint')}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-2">
                  {[3, 7, 14, 30].map((d) => (
                    <Button
                      key={d}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isExtending}
                      onClick={() => handleExtend(addDaysIso((vacancy as any).deadline, d))}
                    >
                      +{d} {t('hire.extendDays')}
                    </Button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label>{t('hire.extendCustom')}</Label>
                  <Input
                    type="datetime-local"
                    value={customDeadline}
                    onChange={(e) => setCustomDeadline(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setExtendOpen(false)}>
                    {t('ui.cancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={isExtending || !customDeadline}
                    onClick={() => handleExtend(new Date(customDeadline).toISOString())}
                  >
                    {t('hire.extendBtn')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canClose && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={isClosing}>
                  <CheckCircle2 className="w-4 h-4" />
                  {isClosing ? t('hire.closing') : t('hire.closeVacancy')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('hire.closeConfirm')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('hire.closeConfirmDesc')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('ui.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClose}>{t('hire.closeYes')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {vacancy.status === 'draft' && canPublish && (
            <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-primary">
                  <CheckCircle className="w-4 h-4" /> {t('hire.acceptPublish')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('hire.acceptPublishTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('hire.acceptPublishDesc')}
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  <p className="text-sm text-muted-foreground">{t('hire.publishChannels')}</p>
                  <div className="space-y-3">
                    {publishChannels.map(channel => (
                      <div key={channel.id} className="flex items-center space-x-2 border p-3 rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => {
                        setSelectedChannels(prev =>
                          prev.includes(channel.id) ? prev.filter(cid => cid !== channel.id) : [...prev, channel.id]
                        );
                      }}>
                        <Checkbox
                          id={`channel-${channel.id}`}
                          checked={selectedChannels.includes(channel.id)}
                          onCheckedChange={(checked) => {
                            setSelectedChannels(prev =>
                              checked ? [...prev, channel.id] : prev.filter(cid => cid !== channel.id)
                            );
                          }}
                        />
                        <label htmlFor={`channel-${channel.id}`} className="text-sm font-medium leading-none cursor-pointer flex-1">
                          {channel.name}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setPublishOpen(false)}>{t('ui.cancelFull')}</Button>
                  <Button onClick={handlePublish} disabled={isPublishing || selectedChannels.length === 0}>
                    {isPublishing ? t('ui.saving') : t('hire.acceptActivate')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2" disabled={isDeleting}>
                  <Trash2 className="w-4 h-4" /> {t('ui.delete')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('hire.deleteVacancy')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('hire.deleteVacancyDesc')}
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

      <Card className="border-[#0b3a5c]/20 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#0b3a5c]" />
              {t('hire.candidates')}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t('hire.candsForVacancy')} — {list.length}
            </p>
          </div>
          {list.length > 0 && (
            <Button type="button" size="sm" variant="secondary" className="gap-2" onClick={handleExportAllPdf}>
              <FileDown className="w-4 h-4" /> {t('hire.pdfDownload')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {candidatesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/60 px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">{t('hire.noCandsYet')}</p>
              {vacancy.status !== 'closed' && (
                <Link href={`/candidates/new?vacancyId=${vacancy.id}`}>
                  <Button className="mt-3" size="sm">{t('hire.addCand')}</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {list.map((c) => (
                <div
                  key={c.id}
                  className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0 space-y-3">
                    <div className="flex min-h-[28px] flex-wrap items-center gap-2">
                      <Link
                        href={`/candidates/${c.id}`}
                        className="truncate text-lg font-semibold text-[#0b3a5c] hover:underline"
                      >
                        {c.fullName}
                      </Link>
                      <Badge variant="secondary" className="shrink-0 bg-sky-50 text-sky-800">
                        {STAGE_LABELS[c.stage] || c.stage}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={
                          c.status === 'hired'
                            ? 'shrink-0 bg-emerald-50 text-emerald-800'
                            : c.status === 'rejected'
                              ? 'shrink-0 bg-red-50 text-red-700'
                              : 'shrink-0 bg-slate-100 text-foreground'
                        }
                      >
                        {STATUS_LABELS[c.status || ''] || c.status || t('ui.active')}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm text-muted-foreground sm:grid-cols-2">
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate">
                        <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.phone || '—'}</span>
                      </p>
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate">
                        <GraduationCap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.education || t('hire.noEducation')}</span>
                      </p>
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate">
                        <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.experience || t('hire.noExperience')}</span>
                      </p>
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.address || t('hire.noAddress')}</span>
                      </p>
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate">
                        <DollarSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.expectedSalary || t('hire.noSalary')}</span>
                      </p>
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {t('hire.born')}: {c.birthDate || '—'}
                      </p>
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {t('hire.addedAt')}: {formatMaybeDate(c.createdAt)}
                      </p>
                      <p className="flex min-h-[20px] items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {t('hire.col.recruiter')}: {c.recruiterName || vacancy.recruiterName || '—'}
                      </p>
                    </div>

                    <div className="min-h-[52px] rounded-lg bg-muted px-3 py-2">
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {c.notes?.trim() || t('hire.noComment')}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-row gap-2 sm:w-[112px] sm:flex-col">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-2 sm:flex-none"
                      onClick={() => handleExportOnePdf(c)}
                    >
                      <FileDown className="w-4 h-4" /> PDF
                    </Button>
                    <Link href={`/candidates/${c.id}`} className="flex-1 sm:flex-none">
                      <Button type="button" size="sm" variant="secondary" className="w-full gap-2">
                        <ExternalLink className="w-4 h-4" /> {t('ui.profile')}
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle>{t('hire.requestInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('ui.position')}</p>
                <p className="font-semibold mt-1">{vacancy.requestPosition || vacancy.title}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('ui.department')}</p>
                <p className="font-semibold mt-1">{vacancy.departmentName || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('hire.neededCount')}</p>
                <p className="font-semibold mt-1">{vacancy.requestCount ?? '—'} {t('ui.people')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('hire.priority')}</p>
                <p className="font-semibold mt-1">
                  {vacancy.requestPriority === 'urgent' ? t('hire.urgent') : vacancy.requestPriority || '—'}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('hire.requirements')}</p>
                <div className="rounded-md bg-muted/40 p-3 whitespace-pre-wrap">
                  {vacancy.requestRequirements || vacancy.requestDescription || t('ui.notEntered')}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('hire.field.recruiter')}</p>
                <p className="font-semibold mt-1 text-primary">{vacancy.recruiterName || t('ui.unassigned')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('hire.deadlineFind')}</p>
                <p className="font-semibold mt-1">
                  {vacancy.deadline
                    ? format(new Date(vacancy.deadline), 'dd.MM.yyyy HH:mm')
                    : t('ui.notSet')}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('hire.timeline')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b pb-2">
                <span className="text-muted-foreground">{t('hire.hrSent')}</span>
                <span className="font-medium text-right">
                  {(vacancy as any).assignedAt
                    ? format(new Date((vacancy as any).assignedAt), 'dd.MM.yyyy HH:mm')
                    : format(new Date(vacancy.createdAt), 'dd.MM.yyyy HH:mm')}
                </span>
              </div>
              <div className="flex justify-between gap-4 border-b pb-2">
                <span className="text-muted-foreground">{t('hire.recAccepted')}</span>
                <span className="font-medium text-right">
                  {(vacancy as any).acceptedAt
                    ? format(new Date((vacancy as any).acceptedAt), 'dd.MM.yyyy HH:mm')
                    : <span className="italic text-muted-foreground">{t('hire.notAcceptedYet')}</span>}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('hire.pubConfirmed')}</span>
                <span className="font-medium text-right">
                  {(vacancy as any).publishedAt
                    ? format(new Date((vacancy as any).publishedAt), 'dd.MM.yyyy HH:mm')
                    : <span className="italic text-muted-foreground">{t('hire.notPublishedYet')}</span>}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('hire.vacancyText')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                  {vacancy.description || t('hire.noText')}
                </div>
              </div>

              {vacancy.benefits && (
                <div className="pt-4 border-t">
                  <h4 className="flex items-center gap-2 font-semibold text-lg mb-3">
                    <Gift className="w-5 h-5 text-primary" /> {t('hire.weOffer')}
                  </h4>
                  <div className="bg-muted/30 p-4 rounded-md text-sm whitespace-pre-wrap">
                    {vacancy.benefits}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('hire.conditions')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium block text-foreground">{t('ui.location')}</span>
                  <span className="text-muted-foreground">{vacancy.location || t('ui.notEntered')}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium block text-foreground">{t('ui.schedule')}</span>
                  <span className="text-muted-foreground">{vacancy.schedule || t('ui.notEntered')}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium block text-foreground">{t('ui.salary')}</span>
                  <span className="text-muted-foreground">{vacancy.salaryRange || t('hire.salaryByInterview')}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {vacancy.channels && vacancy.channels.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('hire.publishedChannels')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {vacancy.channels.map((channel, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
                    <span className="font-medium text-sm">{channel.channelName}</span>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>👀 {channel.views || 0}</span>
                      <span>👥 {channel.applications || 0}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
