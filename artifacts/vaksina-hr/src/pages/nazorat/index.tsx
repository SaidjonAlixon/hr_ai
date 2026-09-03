import React, { useMemo, useState } from 'react';
import { useGetRequests, useGetDepartments, RequestStatus } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Link, useLocation } from 'wouter';
import { Search, Filter, Eye, Briefcase } from 'lucide-react';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { useAuth } from '../../contexts/AuthContext';
import { isHrManager } from '../../lib/roles';
import { useI18n } from '../../i18n/I18nProvider';

export default function NazoratPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  const allowed = isHrManager(user?.role) || user?.role === 'director';

  const { data: requests, isLoading } = useGetRequests({
    search: search || undefined,
    departmentId: departmentFilter !== 'all' ? Number(departmentFilter) : undefined,
  });
  const { data: departments } = useGetDepartments();

  const filtered = useMemo(() => {
    const list = requests ?? [];
    if (statusFilter === 'all') return list;
    return list.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case 'submitted': return <Badge variant="secondary" className="bg-gray-100 text-gray-800">{t("nazorat.status.submitted")}</Badge>;
      case 'reviewing': return <Badge variant="secondary" className="bg-blue-100 text-blue-800">{t("nazorat.status.reviewing")}</Badge>;
      case 'accepted': return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">{t("nazorat.status.accepted")}</Badge>;
      case 'announced': return <Badge variant="secondary" className="bg-purple-100 text-purple-800">{t("nazorat.status.announced")}</Badge>;
      case 'closed': return <Badge variant="secondary" className="bg-gray-800 text-foreground dark:text-white">{t("nazorat.status.closed")}</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  if (!allowed) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {t("nazorat.noAccess")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("nazorat.title")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("nazorat.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t("nazorat.search")}
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder={t("nazorat.dept")} />
              </SelectTrigger>
              <SelectContent className="z-[100]">
                <SelectItem value="all">{t("nazorat.allDepts")}</SelectItem>
                {(departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="z-[100]">
                <SelectItem value="all">{t("nazorat.allStatuses")}</SelectItem>
                <SelectItem value="submitted">{t("nazorat.status.submitted")}</SelectItem>
                <SelectItem value="reviewing">{t("nazorat.status.reviewing")}</SelectItem>
                <SelectItem value="accepted">{t("nazorat.status.accepted")}</SelectItem>
                <SelectItem value="announced">{t("nazorat.status.announced")}</SelectItem>
                <SelectItem value="closed">{t("nazorat.status.closed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.id")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.position")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.dept")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.place")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.applicant")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.status")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.recruiter")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.hrSent")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.recAccepted")}</th>
                  <th className="px-4 py-3 font-medium">{t("nazorat.col.announced")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("nazorat.col.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                      {t("ui.loading")}
                    </td>
                  </tr>
                ) : filtered.length > 0 ? (
                  filtered.map((request) => (
                    <tr
                      key={request.id}
                      role="link"
                      tabIndex={0}
                      onClick={() => setLocation(`/requests/${request.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setLocation(`/requests/${request.id}`);
                        }
                      }}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium">#{request.id}</td>
                      <td className="px-4 py-3 font-semibold">{request.position}</td>
                      <td className="px-4 py-3">{request.departmentName || '—'}</td>
                      <td className="px-4 py-3">
                        {[request.city, request.district].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3">{request.createdByName || '—'}</td>
                      <td className="px-4 py-3">{getStatusBadge(request.status)}</td>
                      <td className="px-4 py-3">{request.assignedToName || '—'}</td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {request.vacancyAssignedAt || request.assignedAt
                          ? format(new Date(request.vacancyAssignedAt || request.assignedAt!), 'dd.MM.yyyy HH:mm')
                          : <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {request.vacancyAcceptedAt
                          ? format(new Date(request.vacancyAcceptedAt), 'dd.MM.yyyy HH:mm')
                          : <span className="text-muted-foreground italic">{t("nazorat.waiting")}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {request.vacancyPublishedAt
                          ? format(new Date(request.vacancyPublishedAt), 'dd.MM.yyyy HH:mm')
                          : <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1"
                            onClick={() => setLocation(`/requests/${request.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {request.vacancyId && (
                            <Link href={`/vacancies/${request.vacancyId}`}>
                              <Button variant="ghost" size="sm" className="h-8 gap-1">
                                <Briefcase className="w-4 h-4" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                      {t("nazorat.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
