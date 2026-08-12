import React from 'react';
import { useGetVacancy, usePublishVacancy, useDeleteVacancy, useUpdateVacancy } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { ArrowLeft, MapPin, Clock, DollarSign, Gift, Share2, Users, Trash2, CheckCircle, CheckCircle2 } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { isHrManager, isHrRole } from '../../lib/roles';
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

export default function VacancyDetails({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: vacancy, isLoading, refetch } = useGetVacancy(id, { query: { enabled: !!id } });
  const { mutate: publish, isPending: isPublishing } = usePublishVacancy();
  const { mutate: removeVacancy, isPending: isDeleting } = useDeleteVacancy();
  const { mutate: updateVacancy, isPending: isClosing } = useUpdateVacancy();
  const { toast } = useToast();
  const [selectedChannels, setSelectedChannels] = React.useState<number[]>([]);
  const autoPublish = new URLSearchParams(window.location.search).get('publish') === '1';
  const [publishOpen, setPublishOpen] = React.useState(autoPublish);
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

  React.useEffect(() => {
    if (autoPublish && vacancy?.status === 'draft' && canPublish) {
      setPublishOpen(true);
    }
  }, [autoPublish, vacancy?.status, canPublish]);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!vacancy) return <div>Ish o'rni topilmadi</div>;

  const handlePublish = () => {
    if (selectedChannels.length === 0) {
      toast({ title: 'Xatolik', description: "Kamida bitta kanalni tanlang", variant: 'destructive' });
      return;
    }

    publish(
      { id, data: { channelIds: selectedChannels } },
      {
        onSuccess: () => {
          toast({ title: 'Qabul qilindi', description: "Ish o'rni faol holatga o'tkazildi" });
          setPublishOpen(false);
          setSelectedChannels([]);
          // URL dan ?publish=1 ni tozalash
          window.history.replaceState({}, '', `/vacancies/${id}`);
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: 'Xatolik',
            description: err?.message || "E'lon qilishda xatolik yuz berdi",
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
          toast({ title: 'O\'chirildi', description: "Ish o'rni o'chirildi" });
          setLocation('/vacancies');
        },
        onError: (err: any) => {
          toast({
            title: 'Xatolik',
            description: err?.message || "O'chirishda xatolik yuz berdi",
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleClose = () => {
    updateVacancy(
      { id, data: { status: 'closed' } },
      {
        onSuccess: () => {
          toast({ title: 'Bajarildi', description: "Ish o'rni yopildi — odam olindi" });
          refetch();
        },
        onError: (err: any) => {
          toast({
            title: 'Xatolik',
            description: err?.message || "Ish o'rinini yopib bo'lmadi",
            variant: 'destructive',
          });
        },
      },
    );
  };

  const publishChannels = [
    { id: 1, name: 'HeadHunter (hh.uz)' },
    { id: 2, name: 'OLX.uz' },
    { id: 3, name: 'Telegram Kanal' },
    { id: 4, name: 'Instagram' },
    { id: 5, name: 'Kompaniya sayti' },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/vacancies">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{vacancy.title}</h1>
              <Badge
                variant="secondary"
                className={
                  vacancy.status === 'published'
                    ? 'bg-emerald-100 text-emerald-800'
                    : vacancy.status === 'draft'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-800 text-white gap-1'
                }
              >
                {vacancy.status === 'published' ? (
                  'Faol'
                ) : vacancy.status === 'draft' ? (
                  'Yangi'
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3" /> Bajarildi
                  </>
                )}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              Ariza #{vacancy.requestId}
              {vacancy.departmentName ? ` · ${vacancy.departmentName}` : ''}
              {' · '}
              {format(new Date(vacancy.createdAt), 'dd.MM.yyyy')}
            </p>
          </div>
        </div>
        
        <div className="flex gap-2 flex-wrap">
          {(user?.role === 'recruiter' || isHrRole(user?.role) || user?.role === 'director' || user?.role === 'admin') &&
            vacancy.status !== 'closed' && (
            <Link href={`/candidates/new?vacancyId=${vacancy.id}`}>
              <Button variant="outline" className="gap-2">
                <Users className="w-4 h-4" /> Nomzod qo'shish
              </Button>
            </Link>
          )}

          {canClose && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={isClosing}>
                  <CheckCircle2 className="w-4 h-4" />
                  {isClosing ? 'Yopilmoqda...' : "Ish o'rinini yopish"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ish o‘rinini yopish?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Odam olindi deb belgilansin. Status <strong>Bajarildi</strong> bo‘ladi.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Bekor</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClose}>Ha, yopish</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          
          {vacancy.status === 'draft' && canPublish && (
            <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-primary">
                  <CheckCircle className="w-4 h-4" /> Qabul qildim
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Qabul qilish va e'lon qilish</DialogTitle>
                  <DialogDescription>
                    Ish o'rnini qabul qiling va qayerlarda e'lon berishingizni tanlang. Tasdiqlangach status Faol bo'ladi.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  <p className="text-sm text-muted-foreground">E'lon kanallari:</p>
                  <div className="space-y-3">
                    {publishChannels.map(channel => (
                      <div key={channel.id} className="flex items-center space-x-2 border p-3 rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => {
                        setSelectedChannels(prev => 
                          prev.includes(channel.id) ? prev.filter(id => id !== channel.id) : [...prev, channel.id]
                        );
                      }}>
                        <Checkbox 
                          id={`channel-${channel.id}`} 
                          checked={selectedChannels.includes(channel.id)}
                          onCheckedChange={(checked) => {
                            setSelectedChannels(prev => 
                              checked ? [...prev, channel.id] : prev.filter(id => id !== channel.id)
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
                  <Button variant="ghost" onClick={() => setPublishOpen(false)}>Bekor qilish</Button>
                  <Button onClick={handlePublish} disabled={isPublishing || selectedChannels.length === 0}>
                    {isPublishing ? 'Saqlanmoqda...' : "Qabul qilish va faollashtirish"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2" disabled={isDeleting}>
                  <Trash2 className="w-4 h-4" /> O'chirish
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ish o'rnini o'chirasizmi?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Bu ish o'rni va unga bog'liq barcha nomzodlar butunlay o'chiriladi. Bu amalni qaytarib bo'lmaydi.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    O'chirish
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle>Kim kerak — Ariza ma'lumoti</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Lavozim</p>
                <p className="font-semibold mt-1">{vacancy.requestPosition || vacancy.title}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Bo'lim</p>
                <p className="font-semibold mt-1">{vacancy.departmentName || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Kerakli soni</p>
                <p className="font-semibold mt-1">{vacancy.requestCount ?? '—'} kishi</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Prioritet</p>
                <p className="font-semibold mt-1">
                  {vacancy.requestPriority === 'urgent' ? 'Shoshilinch' : vacancy.requestPriority || '—'}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Talablar</p>
                <div className="rounded-md bg-muted/40 p-3 whitespace-pre-wrap">
                  {vacancy.requestRequirements || vacancy.requestDescription || 'Kiritilmagan'}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Mas'ul rekruter</p>
                <p className="font-semibold mt-1 text-primary">{vacancy.recruiterName || 'Biriktirilmagan'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Kadr topish muddati</p>
                <p className="font-semibold mt-1">
                  {vacancy.deadline
                    ? format(new Date(vacancy.deadline), 'dd.MM.yyyy HH:mm')
                    : 'Belgilanmagan'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vaqtlar tarixi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b pb-2">
                <span className="text-muted-foreground">HR rekruterga yuborgan</span>
                <span className="font-medium text-right">
                  {(vacancy as any).assignedAt
                    ? format(new Date((vacancy as any).assignedAt), 'dd.MM.yyyy HH:mm')
                    : format(new Date(vacancy.createdAt), 'dd.MM.yyyy HH:mm')}
                </span>
              </div>
              <div className="flex justify-between gap-4 border-b pb-2">
                <span className="text-muted-foreground">Rekruter qabul qilgan</span>
                <span className="font-medium text-right">
                  {(vacancy as any).acceptedAt
                    ? format(new Date((vacancy as any).acceptedAt), 'dd.MM.yyyy HH:mm')
                    : <span className="italic text-muted-foreground">Hali qabul qilinmagan</span>}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">E'lon tasdiqlangan (Faol)</span>
                <span className="font-medium text-right">
                  {(vacancy as any).publishedAt
                    ? format(new Date((vacancy as any).publishedAt), 'dd.MM.yyyy HH:mm')
                    : <span className="italic text-muted-foreground">Hali e'lon qilinmagan</span>}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ish o'rni matni</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                  {vacancy.description || 'Matn kiritilmagan'}
                </div>
              </div>
              
              {vacancy.benefits && (
                <div className="pt-4 border-t">
                  <h4 className="flex items-center gap-2 font-semibold text-lg mb-3">
                    <Gift className="w-5 h-5 text-primary" /> Biz taklif qilamiz:
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
              <CardTitle>Ish sharoitlari</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium block text-foreground">Manzil</span>
                  <span className="text-muted-foreground">{vacancy.location || 'Kiritilmagan'}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium block text-foreground">Grafik</span>
                  <span className="text-muted-foreground">{vacancy.schedule || 'Kiritilmagan'}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium block text-foreground">Maosh</span>
                  <span className="text-muted-foreground">{vacancy.salaryRange || 'Suhbat natijalariga ko\'ra'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {vacancy.channels && vacancy.channels.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>E'lon qilingan kanallar</CardTitle>
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
