import React, { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  CalendarDays,
  Copy,
  Download,
  FileText,
  Loader2,
  Plus,
  Save,
  ScanLine,
  Send,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import type { Employee } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatPersonName } from "@/lib/person-name";
import { deliverFileFromUrl } from "@/lib/tg-download";
import { DocumentScanner } from "@/components/scanner/DocumentScanner";
import { AddressMapField } from "@/components/employees/AddressMapField";
import { A4DocPreview } from "@/components/employees/A4DocPreview";
import { fileToDossierPdf, imagesToA4Pdf } from "@/lib/images-to-a4-pdf";
import {
  DOC_KEYS,
  DOC_LABELS,
  RELATION_PRESETS,
  deleteDossierFile,
  type DocKey,
  type FamilyContacts,
  emptyAddress,
  newRelativeId,
  normalizeFamily,
  uploadDossierFile,
  useEmployeeDossier,
  usePatchEmployeeDossier,
} from "@/lib/employee-dossier-api";

type Props = {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
};

function absoluteUploadUrl(path: string) {
  if (path.startsWith("http")) return path;
  return `${window.location.origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatDateUz(raw?: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [y, m, day] = raw.slice(0, 10).split("-");
      return `${day}.${m}.${y}`;
    }
    return raw;
  }
  return d.toLocaleDateString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusLabelUz(st?: string | null) {
  const map: Record<string, string> = {
    working: "Ishlayapti",
    new: "Yangi",
    dismissed: "Bo‘shatilgan",
    on_leave: "Ta’tilda",
    need_hire: "Xodim kerak",
    searching: "Qidirilmoqda",
    no_manager: "Mudir yo‘q",
  };
  return (st && map[st]) || st || "—";
}

export function EmployeeDossierSheet({ employee, open, onOpenChange, canEdit }: Props) {
  const { toast } = useToast();
  const empId = employee?.id ?? null;
  const { data, isLoading, isError, error, refetch } = useEmployeeDossier(open ? empId : null);
  const patchMut = usePatchEmployeeDossier(empId || 0);

  const [family, setFamily] = useState<FamilyContacts | null>(null);
  const [notes, setNotes] = useState<Partial<Record<DocKey, string>>>({});
  const [scannerKey, setScannerKey] = useState<DocKey | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    setFamily(normalizeFamily(data.family));
    const n: Partial<Record<DocKey, string>> = {};
    for (const k of DOC_KEYS) n[k] = data.documents[k]?.notes || "";
    setNotes(n);
    setDirty(false);
  }, [data]);

  const phone = useMemo(() => {
    const e = employee as Employee & { phone?: string | null; userPhone?: string | null };
    return e?.phone || e?.userPhone || "";
  }, [employee]);

  const hiredAt = data?.employment?.hiredAt || employee?.hiredAt || null;
  const employmentStatus =
    data?.employment?.employmentStatus || employee?.employmentStatus || null;
  const dismissedAt = data?.employment?.dismissedAt ?? null;
  const isDismissed = employmentStatus === "dismissed" || Boolean(dismissedAt);

  const touchFamily = (updater: (f: FamilyContacts) => FamilyContacts) => {
    setFamily((prev) => {
      if (!prev) return prev;
      setDirty(true);
      return updater(prev);
    });
  };

  const saveAll = async () => {
    if (!empId || !family) return;
    try {
      const documents: Partial<Record<DocKey, { notes: string }>> = {};
      for (const k of DOC_KEYS) {
        documents[k] = { notes: notes[k] || "" };
      }
      await patchMut.mutateAsync({ family, documents });
      setDirty(false);
      toast({
        title: "Saqlandi",
        description: "Barcha ma’lumotlar shu xodimga yozildi",
      });
      await refetch();
    } catch (err: any) {
      toast({ title: err?.message || "Saqlash xatosi", variant: "destructive" });
    }
  };

  const onScanComplete = async (blob: Blob, filename: string) => {
    if (!empId || !scannerKey) return;
    setBusyKey(scannerKey);
    try {
      await uploadDossierFile(empId, scannerKey, blob, filename || `${scannerKey}.pdf`);
      await refetch();
      toast({ title: "PDF saqlandi", description: "A4 sahifalar kartochkada ko‘rinadi" });
    } catch (err: any) {
      toast({ title: err?.message || "Yuklash xatosi", variant: "destructive" });
    } finally {
      setBusyKey(null);
      setScannerKey(null);
    }
  };

  const onUploadFile = async (key: DocKey, fileList: FileList | File[]) => {
    if (!empId) return;
    const files = Array.from(fileList);
    if (!files.length) return;
    setBusyKey(key);
    try {
      const baseName = `${key}_${employee ? formatPersonName(employee.fullName).replace(/\s+/g, "_") : "hujjat"}.pdf`;
      let blob: Blob;
      let filename: string;

      const images = files.filter((f) => f.type.startsWith("image/"));
      const pdfs = files.filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );

      if (images.length > 0 && pdfs.length === 0) {
        toast({ title: "A4 PDF tayyorlanmoqda…", description: `${images.length} sahifa` });
        const converted = await imagesToA4Pdf(images, baseName);
        blob = converted.blob;
        filename = converted.filename;
      } else if (pdfs.length === 1 && images.length === 0) {
        const converted = await fileToDossierPdf(pdfs[0]!, baseName);
        blob = converted.blob;
        filename = converted.filename;
      } else if (pdfs.length === 1) {
        const converted = await fileToDossierPdf(pdfs[0]!, baseName);
        blob = converted.blob;
        filename = converted.filename;
      } else {
        throw new Error("Bitta PDF yoki bir nechta rasm tanlang");
      }

      await uploadDossierFile(empId, key, blob, filename);
      await refetch();
      toast({ title: "PDF saqlandi", description: "A4 ko‘rinishida kartochkada ochildi" });
    } catch (err: any) {
      toast({ title: err?.message || "Yuklash xatosi", variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };

  const downloadFile = async (key: DocKey) => {
    const file = data?.documents[key]?.file;
    if (!file?.url) return;
    setBusyKey(`dl-${key}`);
    try {
      const href = file.url.includes("?") ? `${file.url}&download=1` : `${file.url}?download=1`;
      const res = await fetch(href, { credentials: "include" });
      if (!res.ok) throw new Error("Yuklab bo‘lmadi");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name || `${key}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Yuklab olindi" });
    } catch (err: any) {
      toast({ title: err?.message || "Yuklash xatosi", variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };

  const removeFile = async (key: DocKey) => {
    if (!empId || !confirm("PDF o‘chirilsinmi?")) return;
    setBusyKey(key);
    try {
      await deleteDossierFile(empId, key);
      await refetch();
      toast({ title: "Fayl o‘chirildi" });
    } catch (err: any) {
      toast({ title: err?.message || "Xatolik", variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };

  const shareFile = async (key: DocKey) => {
    const file = data?.documents[key]?.file;
    if (!file?.url) return;
    setBusyKey(`share-${key}`);
    try {
      const r = await deliverFileFromUrl(file.url, file.name);
      toast({
        title: r.via === "telegram" ? "Telegramga yuborildi" : "Yuklab olindi",
      });
    } catch (err: any) {
      toast({ title: err?.message || "Ulashish xatosi", variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };

  const copyLink = async (key: DocKey) => {
    const file = data?.documents[key]?.file;
    if (!file?.url) return;
    try {
      await navigator.clipboard.writeText(absoluteUploadUrl(file.url));
      toast({
        title: "Havola nusxalandi",
        description: "Kirish uchun tizimga login kerak — Telegramga fayl yuborishni tavsiya qilamiz",
      });
    } catch {
      toast({ title: "Nusxalanmadi", variant: "destructive" });
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl md:max-w-2xl"
        >
          <SheetHeader className="shrink-0 space-y-1 border-b px-4 py-3 text-left">
            <SheetTitle className="text-base leading-snug">
              {employee ? formatPersonName(employee.fullName) : "Xodim"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {[employee?.position, employee?.departmentName, phone].filter(Boolean).join(" · ") ||
                "Shaxsiy hujjatlar va oila ma’lumotlari"}
            </SheetDescription>
          </SheetHeader>

          <div className="shrink-0 border-b bg-slate-50/90 px-4 py-3 dark:bg-slate-950/40">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <CalendarDays className="h-3 w-3" />
                  Ishga kirgan
                </p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatDateUz(hiredAt)}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Briefcase className="h-3 w-3" />
                  Holat
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-sm font-semibold",
                    isDismissed ? "text-red-600" : "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {statusLabelUz(employmentStatus)}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <CalendarDays className="h-3 w-3" />
                  Bo‘shatilgan
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-sm font-semibold tabular-nums",
                    isDismissed ? "text-red-600" : "text-muted-foreground",
                  )}
                >
                  {isDismissed ? formatDateUz(dismissedAt) : "—"}
                </p>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-24">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : isError ? (
              <div className="space-y-2 py-8 text-center">
                <p className="text-sm text-red-600">{(error as Error)?.message}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
                  Qayta urinish
                </Button>
              </div>
            ) : (
              <>
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight">Hujjatlar</h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Skaner yoki rasm → avtomatik A4 PDF. Tayyor sahifa kartochkada ko‘rinadi.
                    </p>
                  </div>
                  {DOC_KEYS.map((key) => {
                    const slot = data?.documents[key];
                    const file = slot?.file;
                    const busy =
                      busyKey === key ||
                      busyKey === `share-${key}` ||
                      busyKey === `dl-${key}`;
                    return (
                      <div
                        key={key}
                        className={cn(
                          "overflow-hidden rounded-xl border bg-card shadow-sm",
                          file
                            ? "border-emerald-200/80 dark:border-emerald-900/50"
                            : "border-border/80",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 border-b border-border/50 bg-muted/20 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-snug">{DOC_LABELS[key]}</p>
                            {file ? (
                              <p className="mt-0.5 truncate text-[11px] text-emerald-700 dark:text-emerald-400">
                                Tayyor · {file.name} · {(file.size / 1024).toFixed(0)} KB
                              </p>
                            ) : (
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Hali yuklanmagan
                              </p>
                            )}
                          </div>
                          <div
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                              file
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            <FileText className="h-4 w-4" />
                          </div>
                        </div>

                        <div className="space-y-3 p-3">
                          {file ? (
                            <div className="rounded-lg bg-gradient-to-b from-slate-100/80 to-slate-50/40 px-2 py-3 dark:from-slate-900/40 dark:to-slate-950/20">
                              <A4DocPreview
                                url={file.url}
                                name={file.name}
                                mimeType={file.mimeType}
                              />
                            </div>
                          ) : (
                            <div className="flex aspect-[210/160] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 text-center">
                              <FileText className="mb-2 h-8 w-8 text-muted-foreground/35" />
                              <p className="text-xs text-muted-foreground">
                                Skaner yoki PDF/rasm yuklang — A4 varaq shu yerda ochiladi
                              </p>
                            </div>
                          )}

                          {canEdit ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-xs">Izoh</Label>
                                {(notes[key] || "").trim() ? (
                                  <button
                                    type="button"
                                    className="text-[11px] text-red-600 hover:underline"
                                    onClick={() => {
                                      setNotes((n) => ({ ...n, [key]: "" }));
                                      setDirty(true);
                                    }}
                                  >
                                    Tozalash
                                  </button>
                                ) : null}
                              </div>
                              <Textarea
                                value={notes[key] ?? ""}
                                onChange={(e) => {
                                  setNotes((n) => ({ ...n, [key]: e.target.value }));
                                  setDirty(true);
                                }}
                                placeholder="Qo‘lda yoziladigan ma’lumot / izoh… (oxirida saqlanadi)"
                                className="min-h-[52px] text-sm"
                              />
                            </div>
                          ) : slot?.notes ? (
                            <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 text-sm text-muted-foreground">
                              {slot.notes}
                            </p>
                          ) : null}

                          <div className="flex flex-wrap gap-1.5">
                            {canEdit ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="bg-slate-900 hover:bg-slate-800"
                                  disabled={busy}
                                  onClick={() => setScannerKey(key)}
                                >
                                  {busy && busyKey === key ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <ScanLine className="mr-1 h-3.5 w-3.5" />
                                  )}
                                  Skaner
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => {
                                    const input = document.createElement("input");
                                    input.type = "file";
                                    input.accept = "application/pdf,image/*";
                                    input.multiple = true;
                                    input.onchange = () => {
                                      if (input.files?.length) void onUploadFile(key, input.files);
                                    };
                                    input.click();
                                  }}
                                >
                                  <Upload className="mr-1 h-3.5 w-3.5" />
                                  PDF / rasm
                                </Button>
                              </>
                            ) : null}
                            {file ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => void downloadFile(key)}
                                >
                                  {busyKey === `dl-${key}` ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Download className="mr-1 h-3.5 w-3.5" />
                                  )}
                                  Yuklab olish
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => void shareFile(key)}
                                >
                                  <Send className="mr-1 h-3.5 w-3.5" />
                                  Telegram
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void copyLink(key)}
                                >
                                  <Copy className="mr-1 h-3.5 w-3.5" />
                                  Link
                                </Button>
                                {canEdit ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-600"
                                    disabled={busy}
                                    onClick={() => void removeFile(key)}
                                  >
                                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                                    O‘chirish
                                  </Button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>

                <Separator />

                <section className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                        <Users className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                        Oila va aloqa
                      </h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Kerakligini qo‘shing, keraksizini o‘chiring — hammasi oxirida saqlanadi
                      </p>
                    </div>
                    {canEdit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 border-teal-700/30 text-teal-800 hover:bg-teal-50 dark:text-teal-300"
                        onClick={() =>
                          touchFamily((f) => ({
                            ...f,
                            relatives: [
                              ...f.relatives,
                              {
                                id: newRelativeId(),
                                relation: "Ota",
                                fullName: "",
                                phone: "",
                              },
                            ],
                          }))
                        }
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Qo‘shish
                      </Button>
                    ) : null}
                  </div>

                  {family ? (
                    <div className="space-y-3">
                      {family.relatives.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-8 text-center">
                          <p className="text-sm text-muted-foreground">Hali qarindosh qo‘shilmagan</p>
                          {canEdit ? (
                            <Button
                              type="button"
                              size="sm"
                              className="mt-3"
                              onClick={() =>
                                touchFamily((f) => ({
                                  ...f,
                                  relatives: [
                                    {
                                      id: newRelativeId(),
                                      relation: "Ona",
                                      fullName: "",
                                      phone: "",
                                    },
                                  ],
                                }))
                              }
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              Birinchi kontakt
                            </Button>
                          ) : null}
                        </div>
                      ) : null}

                      {family.relatives.map((rel, idx) => (
                        <div
                          key={rel.id}
                          className="relative space-y-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm ring-1 ring-black/[0.02]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800/80 dark:text-teal-300/90">
                              Kontakt #{idx + 1}
                            </span>
                            {canEdit ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() =>
                                  touchFamily((f) => ({
                                    ...f,
                                    relatives: f.relatives.filter((r) => r.id !== rel.id),
                                  }))
                                }
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                O‘chirish
                              </Button>
                            ) : null}
                          </div>

                          <div className="grid gap-3 sm:grid-cols-6">
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs">Qarindoshlik</Label>
                              {canEdit ? (
                                <>
                                  <Select
                                    value={
                                      (RELATION_PRESETS as readonly string[]).includes(rel.relation)
                                        ? rel.relation
                                        : "__custom__"
                                    }
                                    onValueChange={(v) =>
                                      touchFamily((f) => ({
                                        ...f,
                                        relatives: f.relatives.map((r) =>
                                          r.id === rel.id
                                            ? {
                                                ...r,
                                                relation:
                                                  v === "__custom__"
                                                    ? (RELATION_PRESETS as readonly string[]).includes(
                                                        r.relation,
                                                      )
                                                      ? ""
                                                      : r.relation
                                                    : v,
                                              }
                                            : r,
                                        ),
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-9 bg-background text-sm">
                                      <SelectValue placeholder="Tanlang" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {RELATION_PRESETS.map((p) => (
                                        <SelectItem key={p} value={p}>
                                          {p}
                                        </SelectItem>
                                      ))}
                                      <SelectItem value="__custom__">Boshqa (yozish)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {!(RELATION_PRESETS as readonly string[]).includes(rel.relation) ? (
                                    <Input
                                      className="mt-1.5 h-9 text-sm"
                                      placeholder="Masalan: qaynota, do‘st…"
                                      value={rel.relation}
                                      onChange={(e) =>
                                        touchFamily((f) => ({
                                          ...f,
                                          relatives: f.relatives.map((r) =>
                                            r.id === rel.id
                                              ? { ...r, relation: e.target.value }
                                              : r,
                                          ),
                                        }))
                                      }
                                    />
                                  ) : null}
                                </>
                              ) : (
                                <Input value={rel.relation} disabled className="h-9" />
                              )}
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs">F.I.Sh.</Label>
                              <Input
                                className="h-9 bg-background"
                                placeholder="Ism Familiya"
                                value={rel.fullName}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  touchFamily((f) => ({
                                    ...f,
                                    relatives: f.relatives.map((r) =>
                                      r.id === rel.id ? { ...r, fullName: e.target.value } : r,
                                    ),
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs">Telefon</Label>
                              <PhoneInput
                                className="h-9 bg-background"
                                value={rel.phone}
                                disabled={!canEdit}
                                onChange={(phone) =>
                                  touchFamily((f) => ({
                                    ...f,
                                    relatives: f.relatives.map((r) =>
                                      r.id === rel.id ? { ...r, phone } : r,
                                    ),
                                  }))
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      <AddressMapField
                        label="Yashash manzili"
                        value={family.homeAddress}
                        disabled={!canEdit}
                        onChange={(homeAddress) => touchFamily((f) => ({ ...f, homeAddress }))}
                        onClear={() => touchFamily((f) => ({ ...f, homeAddress: emptyAddress() }))}
                      />
                      <AddressMapField
                        label="Ro‘yxatdan o‘tgan manzil"
                        value={family.registrationAddress}
                        disabled={!canEdit}
                        onChange={(registrationAddress) =>
                          touchFamily((f) => ({ ...f, registrationAddress }))
                        }
                        onClear={() =>
                          touchFamily((f) => ({ ...f, registrationAddress: emptyAddress() }))
                        }
                      />

                      <div className="space-y-1.5 rounded-xl border border-border/60 bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs">Qo‘shimcha izoh</Label>
                          {canEdit && family.notes.trim() ? (
                            <button
                              type="button"
                              className="text-[11px] text-red-600 hover:underline"
                              onClick={() => touchFamily((f) => ({ ...f, notes: "" }))}
                            >
                              Tozalash
                            </button>
                          ) : null}
                        </div>
                        <Textarea
                          value={family.notes}
                          disabled={!canEdit}
                          className="min-h-[56px] bg-background"
                          placeholder="Ixtiyoriy eslatma… (oxirida saqlanadi)"
                          onChange={(e) => touchFamily((f) => ({ ...f, notes: e.target.value }))}
                        />
                      </div>
                    </div>
                  ) : null}

                  {data?.updatedAt ? (
                    <p className="text-[11px] text-muted-foreground">
                      Oxirgi yangilanish: {new Date(data.updatedAt).toLocaleString("uz-UZ")}
                      {data.updatedByName ? ` · ${data.updatedByName}` : ""}
                    </p>
                  ) : null}
                </section>
              </>
            )}
          </div>

          {canEdit ? (
            <div className="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-muted-foreground">
                  {dirty
                    ? "Saqlanmagan o‘zgarishlar bor — pastdagi tugma bilan yozing"
                    : "O‘zgarishlar saqlangan. PDF/skaner darhol yoziladi."}
                </p>
                <Button
                  type="button"
                  className="w-full bg-teal-800 hover:bg-teal-900 sm:w-auto"
                  onClick={() => void saveAll()}
                  disabled={patchMut.isPending || !family}
                >
                  {patchMut.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-4 w-4" />
                  )}
                  Hammasini saqlash
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <DocumentScanner
        open={scannerKey != null}
        onOpenChange={(o) => {
          if (!o) setScannerKey(null);
        }}
        title={scannerKey ? DOC_LABELS[scannerKey] : "Skaner"}
        defaultFileName={
          scannerKey && employee
            ? `${scannerKey}_${formatPersonName(employee.fullName).replace(/\s+/g, "_")}.pdf`
            : "hujjat.pdf"
        }
        onComplete={onScanComplete}
      />
    </>
  );
}
