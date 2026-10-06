import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft, FileDown, FileSpreadsheet, Loader2, Search, Trash2, UserX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../contexts/AuthContext';
import { canManageUsers, userRoleLabel } from '../../lib/roles';
import { fetchDismissedStaff, purgeDismissed } from '../../lib/dismissed-staff-api';
import { exportDismissedExcel, exportDismissedPdf, fmtDismissedWhen } from '../../lib/dismissed-export';
import { useToast } from '../../hooks/use-toast';
import { displayBranchName } from '../../lib/pharmacy-staff-api';

function fmtDateTime(iso?: string | null): string {
  return fmtDismissedWhen(iso);
}

export default function BoshatilganlarPage() {
  const { user } = useAuth();
  const allowed = canManageUsers(user?.role);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [purgingId, setPurgingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dismissed-staff', debounced],
    queryFn: () => fetchDismissedStaff(debounced),
    enabled: allowed,
    staleTime: 15_000,
  });

  const rows = useMemo(() => data ?? [], [data]);

  async function runExport(kind: 'excel' | 'pdf') {
    if (!rows.length) {
      toast({ title: 'Yuklash uchun ro‘yxat bo‘sh', variant: 'destructive' });
      return;
    }
    setExporting(kind);
    try {
      if (kind === 'excel') await exportDismissedExcel(rows, debounced);
      else await exportDismissedPdf(rows, debounced);
      toast({ title: kind === 'excel' ? 'Excel yuklandi' : 'PDF yuklandi' });
    } catch (err) {
      toast({
        title: 'Yuklab bo‘lmadi',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setExporting(null);
    }
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">Bo‘shatilganlar</h1>
        <p className="mt-2 text-muted-foreground">Bu bo‘lim faqat admin uchun.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <UserX className="h-7 w-7 text-rose-600" />
            Bo‘shatilganlar
          </h1>
          <p className="mt-1 text-muted-foreground">
            O‘chirilgan yoki «Tugatilgan» holati berilgan xodimlar. Login va parol bekor qilingan, boshqa hech qayerda ko‘rinmaydi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={exporting !== null || !rows.length}
            onClick={() => void runExport('excel')}
          >
            {exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 text-emerald-700" />}
            Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={exporting !== null || !rows.length}
            onClick={() => void runExport('pdf')}
          >
            {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4 text-rose-700" />}
            PDF
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/admin/users">
              <ArrowLeft className="h-4 w-4" />
              Foydalanuvchilar
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ism bo‘yicha qidirish"
            className="pl-9"
          />
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ro‘yxat ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yuklanmoqda…
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-destructive">{(error as Error)?.message}</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Hozircha bo‘shatilgan foydalanuvchi yo‘q
            </div>
          ) : (
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5">Xodim</th>
                  <th className="px-3 py-2.5">Rol</th>
                  <th className="px-3 py-2.5">Bo‘lim / filial</th>
                  <th className="px-3 py-2.5">Oldingi login</th>
                  <th className="px-3 py-2.5">Bo‘shatilgan</th>
                  <th className="px-3 py-2.5">Kim tomonidan</th>
                  <th className="px-3 py-2.5">Sabab</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{r.fullName}</div>
                      <div className="text-xs text-muted-foreground">{r.phone || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.role ? (
                        <Badge variant="secondary" className="font-medium">
                          {userRoleLabel(r.role) || r.role}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      <div>{r.departmentName || '—'}</div>
                      {r.location ? <div className="text-xs">{displayBranchName(r.location)}</div> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-muted-foreground line-through">{r.login || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtDateTime(r.dismissedAt)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.dismissedByName || '—'}</td>
                    <td className="max-w-[220px] px-3 py-2.5 text-muted-foreground">
                      <span className="line-clamp-2">{r.reason || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="gap-1"
                        disabled={purgingId === r.id}
                        onClick={() => {
                          const ok = window.confirm(
                            `${r.fullName} arxivdan va qolgan barcha joylardan o‘chadi. Qaytarib bo‘lmaydi. Davom etasizmi?`,
                          );
                          if (!ok) return;
                          setPurgingId(r.id);
                          void purgeDismissed(r.id)
                            .then(() => {
                              toast({ title: 'Butunlay o‘chirildi', description: `${r.fullName} hech qayerda qolmadi` });
                              void queryClient.invalidateQueries({ queryKey: ['dismissed-staff'] });
                            })
                            .catch((err: Error) => {
                              toast({ title: 'Xatolik', description: err?.message || 'O‘chirilmadi', variant: 'destructive' });
                            })
                            .finally(() => setPurgingId(null));
                        }}
                      >
                        {purgingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Butunlay
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
