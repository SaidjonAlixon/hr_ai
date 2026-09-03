import React from 'react';
import { useCreateCandidate, useGetVacancies, useGetUsers } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import { useToast } from '../../hooks/use-toast';
import { useAuth } from '../../contexts/AuthContext';
import { PhoneInput } from '../../components/ui/phone-input';
import { isCompleteUzPhone, normalizeUzPhone, UZ_PHONE_HINT } from '../../lib/phone';
import { isHrManager } from '../../lib/roles';
import { useI18n } from '../../i18n/I18nProvider';

const formSchema = z.object({
  fullName: z.string().min(5, "To'liq ismni kiriting"),
  phone: z
    .string()
    .refine(isCompleteUzPhone, { message: UZ_PHONE_HINT }),
  vacancyId: z.coerce.number({ required_error: "Ish o'rnini tanlang" }).min(1, "Ish o'rnini tanlang"),
  recruiterId: z.coerce.number().optional(),
  birthDate: z.string().optional(),
  address: z.string().optional(),
  education: z.string().optional(),
  experience: z.string().optional(),
  expectedSalary: z.string().optional(),
  notes: z.string().optional(),
});

export default function NewCandidate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();
  const { mutate, isPending } = useCreateCandidate();

  const canAdd =
    user?.role === 'recruiter' ||
    isHrManager(user?.role) ||
    user?.role === 'director';

  const { data: vacancies, isLoading: vacsLoading } = useGetVacancies({ status: 'published' });
  const { data: recruiters, isLoading: recsLoading } = useGetUsers({ role: 'recruiter' });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: '',
      phone: '',
      vacancyId: undefined as unknown as number,
      recruiterId: user?.role === 'recruiter' ? user.id : undefined,
      birthDate: '',
      address: '',
      education: '',
      experience: '',
      expectedSalary: '',
      notes: '',
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    mutate(
      {
        data: {
          ...values,
          phone: normalizeUzPhone(values.phone),
        } as any,
      },
      {
      onSuccess: (data) => {
        toast({ title: t('ui.success'), description: t('hire.newOk') });
        setLocation(`/candidates/${data.id}`);
      },
      onError: () => {
        toast({ title: t('ui.error'), description: t('hire.newFail'), variant: 'destructive' });
      }
    });
  };

  if (!canAdd) {
    return (
      <div className="max-w-lg mx-auto rounded-xl border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">{t('ui.noAccess')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('hire.newNoAccess')}
        </p>
        <Link href="/candidates">
          <Button className="mt-4" variant="outline">{t('ui.back')}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/candidates">
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{t('hire.newStep')}</p>
          <h1 className="text-3xl font-bold tracking-tight">{t('hire.newTitle')}</h1>
          <p className="text-muted-foreground mt-1">{t('hire.newSub')}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              <div className="space-y-4">
                <h3 className="text-lg font-medium border-b pb-2">{t('hire.section.basic')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.fullName')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('hire.ph.fullName')} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.phone')}</FormLabel>
                        <FormControl>
                          <PhoneInput
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">{UZ_PHONE_HINT}</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="vacancyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.vacancy')}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value?.toString() || ''}>
                          <FormControl>
                            <SelectTrigger disabled={vacsLoading}>
                              <SelectValue placeholder={t('hire.ph.vacancy')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {vacancies?.map(vac => (
                              <SelectItem key={vac.id} value={vac.id.toString()}>{vac.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="recruiterId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.recruiter')}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value?.toString() || ''}>
                          <FormControl>
                            <SelectTrigger disabled={recsLoading}>
                              <SelectValue placeholder={t('hire.ph.recruiter')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {recruiters?.map(rec => (
                              <SelectItem key={rec.id} value={rec.id.toString()}>{rec.fullName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="birthDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.birthOpt')}</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="expectedSalary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.salaryOpt')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('hire.ph.salary')} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium border-b pb-2">{t('hire.section.extra')}</h3>
                <div className="grid grid-cols-1 gap-6">
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.addressOpt')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('hire.ph.address')} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="experience"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.expOpt')}</FormLabel>
                        <FormControl>
                          <Textarea className="h-24" placeholder={t('hire.ph.experience')} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="education"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.eduOpt')}</FormLabel>
                        <FormControl>
                          <Textarea className="h-24" placeholder={t('hire.ph.education')} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('hire.field.notesOpt')}</FormLabel>
                        <FormControl>
                          <Textarea className="h-20" placeholder={t('hire.ph.notes')} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4 border-t">
                <Link href="/candidates">
                  <Button variant="ghost" type="button">{t('ui.cancelFull')}</Button>
                </Link>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t('ui.saving') : t('hire.addCandidate')}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
