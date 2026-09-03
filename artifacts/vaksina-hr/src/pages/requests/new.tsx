import React from 'react';
import { useCreateRequest, useGetDepartments } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import { useToast } from '../../hooks/use-toast';
import { useI18n } from '../../i18n/I18nProvider';

const formSchema = z.object({
  departmentId: z.coerce.number({ required_error: "Bo'limni tanlang" }).min(1, "Bo'limni tanlang"),
  position: z.string().min(2, "Lavozim nomi kamida 2ta harf bo'lishi kerak"),
  count: z.coerce.number().min(1, "Kamida 1 kishi kerak"),
  priority: z.enum(['normal', 'urgent']),
  city: z.string().min(2, "Shaharni kiriting"),
  district: z.string().min(2, "Tumanni kiriting"),
  salaryRange: z.string().optional(),
  deadline: z.string().optional(),
  requirements: z.string().min(10, "Talablar batafsil yozilishi kerak"),
  description: z.string().min(10, "Vazifalar batafsil yozilishi kerak"),
  reason: z.string().optional(),
});

export default function NewRequest() {
  const [, setLocation] = useLocation();
  const { t } = useI18n();
  const { toast } = useToast();
  const { mutate, isPending } = useCreateRequest();
  const { data: departments, isLoading: deptsLoading } = useGetDepartments();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      position: '',
      count: 1,
      priority: 'normal',
      city: '',
      district: '',
      salaryRange: '',
      deadline: '',
      requirements: '',
      description: '',
      reason: '',
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    mutate({ data: values as any }, {
      onSuccess: (data) => {
        toast({ title: t('ui.success'), description: t('requests.created') });
        setLocation(`/requests/${data.id}`);
      },
      onError: () => {
        toast({ title: t('ui.error'), description: t('requests.createFail'), variant: 'destructive' });
      }
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/requests">
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('requests.newTitle')}</h1>
          <p className="text-muted-foreground mt-1">{t('requests.newSub')}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.dept')}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger disabled={deptsLoading}>
                            <SelectValue placeholder={t('requests.deptPh')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {departments?.map(dept => (
                            <SelectItem key={dept.id} value={dept.id.toString()}>{dept.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="position"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.position')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('requests.positionPh')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="count"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.count')}</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.priority')}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('requests.priorityPh')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="normal">{t('requests.priorityNormal')}</SelectItem>
                          <SelectItem value="urgent">{t('requests.priorityUrgent')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.city')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('requests.cityPh')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="district"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.district')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('requests.districtPh')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="salaryRange"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.salaryOpt')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('requests.salaryPh')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deadline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.deadlineOpt')}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.duties')}</FormLabel>
                      <FormControl>
                        <Textarea className="h-24" placeholder={t('requests.dutiesPh')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requirements"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.reqs')}</FormLabel>
                      <FormControl>
                        <Textarea className="h-24" placeholder={t('requests.reqsPh')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('requests.reasonOpt')}</FormLabel>
                      <FormControl>
                        <Textarea className="h-16" placeholder={t('requests.reasonPh')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-4 pt-4 border-t">
                <Link href="/requests">
                  <Button variant="ghost" type="button">{t('ui.cancelFull')}</Button>
                </Link>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t('ui.saving') : t('requests.submit')}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
