import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  Phone,
  Plus,
  Save,
  Store,
  Trash2,
  AtSign,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { PhoneInput } from "../../components/ui/phone-input";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useAuth } from "../../contexts/AuthContext";
import { canAccessBoglanish } from "../../lib/roles";
import { cn } from "../../lib/utils";
import {
  isCompleteUzPhone,
  isOptionalUzPhoneValid,
  normalizeUzPhone,
  UZ_PHONE_HINT,
} from "../../lib/phone";
import {
  fetchBoglanishMe,
  saveBoglanishBranch,
  type BoglanishBranch,
} from "../../lib/boglanish-api";

type Draft = {
  primaryPhone: string;
  extraPhones: string[];
  telegramNick: string;
  contactFromHm: string;
  contactToHm: string;
};

function draftFromBranch(b: BoglanishBranch): Draft {
  return {
    primaryPhone: b.primaryPhone || "",
    extraPhones: b.extraPhones.length ? [...b.extraPhones] : [""],
    telegramNick: b.telegramNick || "",
    contactFromHm: b.contactFromHm || "",
    contactToHm: b.contactToHm || "",
  };
}

function normalizeTelegramInput(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  v = v.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "");
  if (!v.startsWith("@")) v = `@${v.replace(/^@+/, "")}`;
  return v;
}

export default function BoglanishPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const allowed = canAccessBoglanish(user?.role);

  const { data, isLoading, error } = useQuery({
    queryKey: ["boglanish", "me"],
    queryFn: fetchBoglanishMe,
    enabled: allowed,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const selected = useMemo(() => {
    if (!data?.branches.length) return null;
    const id = selectedId ?? data.branches[0]!.branchEmployeeId;
    return data.branches.find((b) => b.branchEmployeeId === id) ?? data.branches[0]!;
  }, [data, selectedId]);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft(draftFromBranch(selected));
  }, [selected?.branchEmployeeId, selected?.updatedAt]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selected || !draft) throw new Error(t("boglanish.noBranch"));
      const primary = normalizeUzPhone(draft.primaryPhone);
      if (selected.required && !isCompleteUzPhone(primary)) {
        throw new Error(t("boglanish.primaryRequired"));
      }
      if (primary && !isCompleteUzPhone(primary)) {
        throw new Error(t("boglanish.phoneInvalid"));
      }
      const extras = draft.extraPhones
        .map((p) => normalizeUzPhone(p))
        .filter((p) => p && isCompleteUzPhone(p) && p !== primary);
      for (const p of draft.extraPhones) {
        if (p.trim() && !isOptionalUzPhoneValid(p)) {
          throw new Error(t("boglanish.extraInvalid"));
        }
      }
      const from = draft.contactFromHm.trim();
      const to = draft.contactToHm.trim();
      if ((from && !to) || (!from && to)) {
        throw new Error(t("boglanish.hoursPair"));
      }
      return saveBoglanishBranch(selected.branchEmployeeId, {
        primaryPhone: primary,
        extraPhones: extras,
        telegramNick: normalizeTelegramInput(draft.telegramNick),
        contactFromHm: from,
        contactToHm: to,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["boglanish"] });
      window.dispatchEvent(new Event("boglanish:saved"));
      toast({ title: t("boglanish.saved") });
    },
    onError: (e: Error) => {
      toast({ title: t("boglanish.saveFail"), description: e.message, variant: "destructive" });
    },
  });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">
        {t("boglanish.forbidden")}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t("ui.loading")}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-destructive">
        {(error as Error)?.message || t("boglanish.loadFail")}
      </div>
    );
  }

  const isMudir = data.role === "mudir";

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 pb-24 sm:p-5 sm:pb-8">
      <div className="relative overflow-hidden rounded-2xl border border-[#0a2540]/15 bg-gradient-to-br from-[#0a2540] via-[#0b3a6e] to-[#0b5fff] p-5 text-white shadow-sm sm:p-6">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90 ring-1 ring-white/15">
              <Phone className="h-3.5 w-3.5" />
              {t("boglanish.badge")}
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("boglanish.title")}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/80">
              {isMudir ? t("boglanish.subtitleMudir") : t("boglanish.subtitleCoord")}
            </p>
          </div>
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1",
              data.complete
                ? "bg-emerald-400/15 text-emerald-50 ring-emerald-300/30"
                : "bg-amber-400/15 text-amber-50 ring-amber-300/30",
            )}
          >
            {data.complete ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {data.complete ? t("boglanish.statusOk") : t("boglanish.statusNeed")}
          </div>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      </div>

      <div className={cn("grid gap-4", !isMudir && data.branches.length > 1 && "lg:grid-cols-[240px_1fr]")}>
        {!isMudir && data.branches.length > 0 ? (
          <Card className="h-fit border-border/80 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Store className="h-4 w-4 text-primary" />
                {t("boglanish.branches")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {data.branches.map((b) => {
                const active = selected?.branchEmployeeId === b.branchEmployeeId;
                return (
                  <button
                    key={b.branchEmployeeId}
                    type="button"
                    onClick={() => setSelectedId(b.branchEmployeeId)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition",
                      active
                        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                        : "border-transparent hover:border-border hover:bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                        b.complete ? "bg-emerald-500" : "bg-amber-400",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-foreground">
                        {b.branchName}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {b.mudirName}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!data.branches.length ? (
                <p className="px-1 py-3 text-xs text-muted-foreground">{t("boglanish.noBranches")}</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Phone className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">
                  {selected?.branchName || t("boglanish.noBranch")}
                </span>
                {selected ? (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {isMudir ? t("boglanish.yourBranch") : `${t("boglanish.mudir")}: ${selected.mudirName}`}
                  </span>
                ) : null}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selected || !draft ? (
              <p className="text-sm text-muted-foreground">{t("boglanish.noBranches")}</p>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-semibold">
                      {t("boglanish.primaryPhone")}
                      {selected.required ? (
                        <span className="ml-1 text-destructive">*</span>
                      ) : null}
                    </Label>
                    {selected.required ? (
                      <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        {t("boglanish.requiredTag")}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {t("boglanish.optionalTag")}
                      </span>
                    )}
                  </div>
                  <PhoneInput
                    value={draft.primaryPhone}
                    onChange={(v) => setDraft((d) => (d ? { ...d, primaryPhone: v } : d))}
                  />
                  <p className="text-[11px] text-muted-foreground">{UZ_PHONE_HINT}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">{t("boglanish.extraPhones")}</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={draft.extraPhones.length >= 5}
                      onClick={() =>
                        setDraft((d) =>
                          d ? { ...d, extraPhones: [...d.extraPhones, ""] } : d,
                        )
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("boglanish.addPhone")}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {draft.extraPhones.map((phone, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <PhoneInput
                          value={phone}
                          onChange={(v) =>
                            setDraft((d) => {
                              if (!d) return d;
                              const next = [...d.extraPhones];
                              next[idx] = v;
                              return { ...d, extraPhones: next };
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() =>
                            setDraft((d) => {
                              if (!d) return d;
                              const next = d.extraPhones.filter((_, i) => i !== idx);
                              return { ...d, extraPhones: next.length ? next : [""] };
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-sm font-semibold">
                    <AtSign className="h-3.5 w-3.5" />
                    {t("boglanish.telegram")}
                  </Label>
                  <Input
                    value={draft.telegramNick}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, telegramNick: e.target.value } : d,
                      )
                    }
                    onBlur={() =>
                      setDraft((d) =>
                        d
                          ? { ...d, telegramNick: normalizeTelegramInput(d.telegramNick) }
                          : d,
                      )
                    }
                    placeholder="@filial_username"
                    className="h-10"
                  />
                  <p className="text-[11px] text-muted-foreground">{t("boglanish.telegramHint")}</p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-sm font-semibold">
                    <Clock3 className="h-3.5 w-3.5" />
                    {t("boglanish.hours")}
                  </Label>
                  <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                    <div>
                      <p className="mb-1 text-[11px] text-muted-foreground">{t("boglanish.from")}</p>
                      <Input
                        type="time"
                        value={draft.contactFromHm}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, contactFromHm: e.target.value } : d,
                          )
                        }
                        className="h-10"
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] text-muted-foreground">{t("boglanish.to")}</p>
                      <Input
                        type="time"
                        value={draft.contactToHm}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, contactToHm: e.target.value } : d,
                          )
                        }
                        className="h-10"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("boglanish.hoursHint")}</p>
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11px] text-muted-foreground">
                    {selected.complete
                      ? t("boglanish.editHint")
                      : selected.required
                        ? t("boglanish.mustFill")
                        : t("boglanish.optionalFill")}
                  </p>
                  <Button
                    type="button"
                    className="h-10 gap-2 rounded-xl bg-[#0a2540] px-5 hover:bg-[#0b5fff]"
                    disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate()}
                  >
                    {saveMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {t("boglanish.save")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
