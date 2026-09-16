import React, { useEffect, useMemo, useState } from "react";
import { useCreateCandidate, useGetVacancies, useGetUsers } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { ArrowLeft, ArrowRight, Loader2, UserPlus } from "lucide-react";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { PhoneInput } from "../../components/ui/phone-input";
import { isCompleteUzPhone, normalizeUzPhone, UZ_PHONE_HINT } from "../../lib/phone";
import { isHrManager, isDirectorRole } from "../../lib/roles";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";

const formSchema = z.object({
  fullName: z.string().min(5, "To'liq ismni kiriting"),
  phone: z.string().refine(isCompleteUzPhone, { message: UZ_PHONE_HINT }),
  vacancyId: z.coerce.number({ required_error: "Ish o'rnini tanlang" }).min(1, "Ish o'rnini tanlang"),
  recruiterId: z.coerce.number().optional(),
  birthDate: z.string().optional(),
  address: z.string().optional(),
  education: z.string().optional(),
  experience: z.string().optional(),
  expectedSalary: z.string().optional(),
  notes: z.string().optional(),
});

function readVacancyQuery(): number | undefined {
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = q.get("vacancyId");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export default function NewCandidate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();
  const { mutate, isPending } = useCreateCandidate();
  const [showExtra, setShowExtra] = useState(false);

  const canAdd =
    user?.role === "recruiter" || isHrManager(user?.role) || isDirectorRole(user?.role);

  const { data: vacancies, isLoading: vacsLoading } = useGetVacancies({ status: "published" });
  const { data: recruiters, isLoading: recsLoading } = useGetUsers({ role: "recruiter" });

  const preVacancy = useMemo(() => readVacancyQuery(), []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      vacancyId: preVacancy as unknown as number,
      recruiterId: user?.role === "recruiter" ? user.id : undefined,
      birthDate: "",
      address: "",
      education: "",
      experience: "",
      expectedSalary: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (preVacancy) form.setValue("vacancyId", preVacancy);
  }, [preVacancy, form]);

  const selectedVacancy = vacancies?.find((v) => v.id === Number(form.watch("vacancyId")));

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
          toast({ title: t("ui.success"), description: t("hire.newOk") });
          setLocation(`/candidates/${data.id}`);
        },
        onError: () => {
          toast({ title: t("ui.error"), description: t("hire.newFail"), variant: "destructive" });
        },
      },
    );
  };

  if (!canAdd) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">{t("ui.noAccess")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("hire.newNoAccess")}</p>
        <Link href="/candidates">
          <Button className="mt-4" variant="outline">
            {t("ui.back")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-1 pb-10">
      <div className="flex items-start gap-3">
        <Link href="/candidates">
          <Button variant="outline" size="icon" className="mt-0.5 shrink-0 rounded-xl">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{t("hire.newStep")}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("hire.newTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("hire.newSub")}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-sky-200/80 bg-gradient-to-b from-sky-50/90 to-white shadow-sm dark:border-sky-900/40 dark:from-sky-950/40 dark:to-card">
        <div className="flex items-center gap-3 border-b border-sky-100 px-5 py-4 dark:border-sky-900/50">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-600 text-white">
            <UserPlus className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">{t("hire.newCardTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("hire.newCardSub")}</p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 px-5 py-5">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hire.field.fullName")}</FormLabel>
                  <FormControl>
                    <Input className="h-11 rounded-xl" placeholder={t("hire.ph.fullName")} {...field} />
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
                  <FormLabel>{t("hire.field.phone")}</FormLabel>
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
                  <FormLabel>{t("hire.field.vacancy")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                    <FormControl>
                      <SelectTrigger className="h-11 rounded-xl" disabled={vacsLoading}>
                        <SelectValue placeholder={t("hire.ph.vacancy")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {vacancies?.map((vac) => (
                        <SelectItem key={vac.id} value={vac.id.toString()}>
                          {vac.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedVacancy?.description ? (
                    <p className="mt-2 line-clamp-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      {selectedVacancy.description}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            {user?.role !== "recruiter" && (
              <FormField
                control={form.control}
                name="recruiterId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("hire.field.recruiter")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                      <FormControl>
                        <SelectTrigger className="h-11 rounded-xl" disabled={recsLoading}>
                          <SelectValue placeholder={t("hire.ph.recruiter")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {recruiters?.map((rec) => (
                          <SelectItem key={rec.id} value={rec.id.toString()}>
                            {rec.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <button
              type="button"
              className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              onClick={() => setShowExtra((v) => !v)}
            >
              {showExtra ? t("hire.newHideExtra") : t("hire.newShowExtra")}
            </button>

            <div className={cn("space-y-4", !showExtra && "hidden")}>
              <FormField
                control={form.control}
                name="experience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("hire.field.expOpt")}</FormLabel>
                    <FormControl>
                      <Textarea className="rounded-xl" rows={2} placeholder={t("hire.ph.exp")} {...field} />
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
                    <FormLabel>{t("hire.field.eduOpt")}</FormLabel>
                    <FormControl>
                      <Input className="h-11 rounded-xl" placeholder={t("hire.ph.edu")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="expectedSalary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("hire.field.salaryOpt")}</FormLabel>
                      <FormControl>
                        <Input className="h-11 rounded-xl" placeholder={t("hire.ph.salary")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="birthDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("hire.field.birthOpt")}</FormLabel>
                      <FormControl>
                        <Input className="h-11 rounded-xl" type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("hire.field.addressOpt")}</FormLabel>
                    <FormControl>
                      <Input className="h-11 rounded-xl" placeholder={t("hire.ph.address")} {...field} />
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
                    <FormLabel>{t("hire.field.notesOpt")}</FormLabel>
                    <FormControl>
                      <Textarea className="rounded-xl" rows={2} placeholder={t("hire.ph.notes")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" size="lg" className="h-12 w-full rounded-2xl text-base" disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-5 w-5" />
              )}
              {t("hire.newSubmit")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("hire.newAfterHint")}</p>
          </form>
        </Form>
      </div>
    </div>
  );
}
