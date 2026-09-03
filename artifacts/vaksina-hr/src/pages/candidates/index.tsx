import React, { useState } from 'react';
import { useGetCandidates, CandidateStage } from '@workspace/api-client-react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Link, useLocation } from 'wouter';
import { Search, Plus, Filter, User, Briefcase, Phone } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { useAuth } from '../../contexts/AuthContext';
import { isHrManager } from '../../lib/roles';
import { useI18n } from '../../i18n/I18nProvider';

function getFiltersFromUrl() {
  if (typeof window === 'undefined') return { stage: 'all', status: 'all' };
  const params = new URLSearchParams(window.location.search);
  let stage = params.get('stage') || 'all';
  let status = params.get('status') || 'all';
  // Eski linklar: stage=rejected/hired → status filter
  if (stage === 'rejected') {
    status = 'rejected';
    stage = 'all';
  } else if (stage === 'hired') {
    status = 'hired';
    stage = 'all';
  }
  return { stage, status };
}

export default function CandidatesList() {
  const { t } = useI18n();
  const { user } = useAuth();
  const STATUS_TITLES: Record<string, string> = {
    all: t("hire.statusAll"),
    active: t("hire.statusActive"),
    hired: t("hire.statusHired"),
    rejected: t("hire.statusRejected"),
  };
  const [, setLocation] = useLocation();
  const initial = getFiltersFromUrl();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>(initial.stage);
  const [statusFilter, setStatusFilter] = useState<string>(initial.status);

  const canAddCandidate =
    user?.role === 'recruiter' ||
    isHrManager(user?.role) ||
    user?.role === 'director';

  const { data: candidates, isLoading } = useGetCandidates({
    search: search || undefined,
    stage: stageFilter !== 'all' ? stageFilter : undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });

  const updateStatus = (value: string) => {
    setStatusFilter(value);
    const params = new URLSearchParams();
    if (value !== 'all') params.set('status', value);
    if (stageFilter !== 'all') params.set('stage', stageFilter);
    const q = params.toString();
    setLocation(q ? `/candidates?${q}` : '/candidates');
  };

  const updateStage = (value: string) => {
    setStageFilter(value);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (value !== 'all') params.set('stage', value);
    const q = params.toString();
    setLocation(q ? `/candidates?${q}` : '/candidates');
  };

  const getStageBadge = (stage: CandidateStage) => {
    const stageMap: Record<string, { label: string, color: string }> = {
      phone_interview: { label: t("hire.phone"), color: 'bg-blue-100 text-blue-800' },
      online_interview: { label: t("hire.online"), color: 'bg-indigo-100 text-indigo-800' },
      preboarding: { label: t("hire.preboarding"), color: 'bg-purple-100 text-purple-800' },
      offline_interview: { label: t("hire.offline"), color: 'bg-orange-100 text-orange-800' },
      final_decision: { label: t("hire.final"), color: 'bg-amber-100 text-amber-800' },
      offer: { label: t("hire.offer"), color: 'bg-teal-100 text-teal-800' },
      documents: { label: t("hire.docs"), color: 'bg-slate-100 text-foreground' },
      internship: { label: t("hire.internship"), color: 'bg-cyan-100 text-cyan-800' },
      hired: { label: t("hire.hired"), color: 'bg-emerald-100 text-emerald-800' },
    };

    const s = stageMap[stage] || { label: stage, color: 'bg-gray-100 text-gray-800' };
    return <Badge variant="secondary" className={s.color}>{s.label}</Badge>;
  };

  const getStatusBadge = (status?: string) => {
    if (status === 'hired') return <Badge className="bg-emerald-100 text-emerald-800">{t("hire.hired")}</Badge>;
    if (status === 'rejected') return <Badge className="bg-rose-100 text-rose-800">{t("hire.rejected")}</Badge>;
    return <Badge className="bg-amber-100 text-amber-800">{t("hire.pending")}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("hire.candidates")}</h1>
          <p className="text-muted-foreground mt-1">
            {STATUS_TITLES[statusFilter] || STATUS_TITLES.all}
          </p>
        </div>
        {canAddCandidate && (
          <Link href="/candidates/new">
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> {t("hire.newCandidate")}
            </Button>
          </Link>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder={t("hire.searchCand")} 
            className="pl-9 bg-background border-transparent focus-visible:bg-card"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto shrink-0 flex-wrap">
          <Select value={statusFilter} onValueChange={updateStatus}>
            <SelectTrigger className="w-full sm:w-[180px] bg-background border-transparent">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder={t("ui.status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("hire.allStatuses")}</SelectItem>
              <SelectItem value="active">{t("hire.pending")}</SelectItem>
              <SelectItem value="hired">{t("hire.hired")}</SelectItem>
              <SelectItem value="rejected">{t("hire.rejected")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={stageFilter} onValueChange={updateStage}>
            <SelectTrigger className="w-full sm:w-[200px] bg-background border-transparent">
              <SelectValue placeholder={t("hire.stage")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("hire.allStages")}</SelectItem>
              <SelectItem value="phone_interview">{t("hire.phone")}</SelectItem>
              <SelectItem value="online_interview">{t("hire.online")}</SelectItem>
              <SelectItem value="preboarding">{t("hire.preboarding")}</SelectItem>
              <SelectItem value="offline_interview">{t("hire.offline")}</SelectItem>
              <SelectItem value="final_decision">{t("hire.final")}</SelectItem>
              <SelectItem value="offer">{t("hire.offer")}</SelectItem>
              <SelectItem value="documents">{t("hire.docs")}</SelectItem>
              <SelectItem value="internship">{t("hire.internship")}</SelectItem>
              <SelectItem value="hired">{t("hire.hired")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground border-b">
              <tr>
                <th className="px-6 py-4 font-medium">{t("hire.col.candidate")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.job")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.contact")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.stage")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.status")}</th>
                <th className="px-6 py-4 font-medium">{t("hire.col.recruiter")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    {t("ui.loading")}
                  </td>
                </tr>
              ) : candidates && candidates.length > 0 ? (
                candidates.map((candidate) => (
                  <tr
                    key={candidate.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => setLocation(`/candidates/${candidate.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setLocation(`/candidates/${candidate.id}`);
                      }
                    }}
                    className="hover:bg-muted/30 transition-colors group cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden shrink-0">
                          {candidate.photoUrl ? (
                            <img src={candidate.photoUrl} alt={candidate.fullName} className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-5 h-5" />
                          )}
                        </div>
                        <div>
                          <span className="font-semibold text-foreground block">
                            {candidate.fullName}
                          </span>
                          {candidate.expectedSalary && (
                            <span className="text-xs text-muted-foreground">Kutilma: {candidate.expectedSalary}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{candidate.vacancyTitle || 'Noma\'lum'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{candidate.phone}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStageBadge(candidate.stage)}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(candidate.status)}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground text-sm">
                      {candidate.recruiterName || 'Biriktirilmagan'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    Hech qanday nomzod topilmadi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
