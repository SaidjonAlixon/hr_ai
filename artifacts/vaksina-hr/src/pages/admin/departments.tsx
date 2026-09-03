import React, { useMemo, useState } from "react";
import {
  useGetDepartments,
  useGetUsers,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
  getGetDepartmentsQueryKey,
  type Department,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { isHrManager } from "../../lib/roles";
import { Skeleton } from "../../components/ui/skeleton";
import { useI18n } from "../../i18n/I18nProvider";

export default function AdminDepartmentsPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();

  const canManage = isHrManager(me?.role) || me?.role === "director";

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState("");
  const [headId, setHeadId] = useState<string>("none");
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const { data: departments, isLoading } = useGetDepartments();
  const { data: users } = useGetUsers();
  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();
  const deleteMutation = useDeleteDepartment();

  const headCandidates = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.status === "active")
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz")),
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...(departments ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, "uz"),
    );
    if (!q) return list;
    return list.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.headName || "").toLowerCase().includes(q),
    );
  }, [departments, search]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getGetDepartmentsQueryKey() });
  };

  const openCreate = () => {
    setEditing(null);
    setName("");
    setHeadId("none");
    setDialogOpen(true);
  };

  const openEdit = (d: Department) => {
    setEditing(d);
    setName(d.name);
    setHeadId(d.headId != null ? String(d.headId) : "none");
    setDialogOpen(true);
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      toast({
        title: "Ruxsat yo‘q",
        description: "Faqat HR / admin / direktor boshqaradi",
        variant: "destructive",
      });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Xatolik", description: "Bo‘lim nomini yozing", variant: "destructive" });
      return;
    }

    const payload = {
      name: trimmed,
      headId: headId === "none" ? null : Number(headId),
    };

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast({ title: "Saqlandi", description: "Bo‘lim yangilandi" });
            setDialogOpen(false);
            invalidate();
          },
          onError: (err: any) => {
            toast({
              title: "Xatolik",
              description: err?.message || "Yangilanmadi",
              variant: "destructive",
            });
          },
        },
      );
      return;
    }

    createMutation.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "Yaratildi", description: `«${trimmed}» qo‘shildi` });
          setDialogOpen(false);
          invalidate();
        },
        onError: (err: any) => {
          toast({
            title: "Xatolik",
            description: err?.message || "Yaratilmadi",
            variant: "destructive",
          });
        },
      },
    );
  };

  const onDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          toast({ title: "O‘chirildi", description: `«${deleteTarget.name}»` });
          setDeleteTarget(null);
          invalidate();
        },
        onError: (err: any) => {
          toast({
            title: "O‘chirilmadi",
            description: err?.message || "Xato (bo‘limda xodim/ariza bo‘lishi mumkin)",
            variant: "destructive",
          });
        },
      },
    );
  };

  const pending =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("admin.departments")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("admin.deptSubtitle")}
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t("admin.newDept")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">{t("admin.listCount")} ({filtered.length})</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("ui.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <Building2 className="h-10 w-10 opacity-40" />
              <p>{t("admin.deptEmpty")}</p>
              {canManage && (
                <Button variant="outline" size="sm" onClick={openCreate}>
                  {t("admin.deptAddFirst")}
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {filtered.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{d.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("admin.deptHead")}{" "}
                      {d.headName ? (
                        <span className="text-foreground">{d.headName}</span>
                      ) : (
                        <span className="italic">{t("admin.unassigned")}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      #{d.id}
                    </Badge>
                    {canManage && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(d)}
                          title="Tahrirlash"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-rose-600 hover:text-rose-700"
                          onClick={() => setDeleteTarget(d)}
                          title="O‘chirish"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("admin.editDept") : t("admin.newDept")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Nomi *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Masalan: Sotuv bo‘limi"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Bo‘lim boshlig‘i</Label>
              <Select value={headId} onValueChange={setHeadId}>
                <SelectTrigger>
                  <SelectValue placeholder="Tanlang (ixtiyoriy)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Belgilanmagan</SelectItem>
                  {headCandidates.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                {t("ui.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("ui.saving") : editing ? t("ui.save") : t("ui.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.dept.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteTarget?.name}» o‘chiriladi. Agar unga bog‘langan xodim yoki ariza
              bo‘lsa, xato chiqishi mumkin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("ui.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-rose-600 hover:bg-rose-700"
            >
              O‘chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
