import React, { useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Shield, Smartphone, Ban } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canViewReviziya } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useReviziyaDoc, useReviziyaMeta, useReviziyaMutations } from "@/lib/reviziya-api";

const STATUS_UZ: Record<string, string> = {
  planned: "Rejalashtirilgan",
  en_route: "Yo‘lda",
  inspecting: "Tekshiruvda",
  reconciling: "Solishtirish",
  signed: "Imzolangan",
  accounting_approved: "Buxgalteriya tasdig‘i",
  closed: "Yopilgan",
  awaiting_explanation: "Tushuntirish kutilmoqda",
  sb_review: "SB tekshiruvi",
  recovery: "Undirish",
  storno: "Storno",
};

const FLOW = ["planned", "en_route", "inspecting", "reconciling", "signed", "accounting_approved", "closed"];

export default function ReviziyaDocPage() {
  const [, params] = useRoute("/reviziya/hujjat/:id");
  const id = Number(params?.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const doc = useReviziyaDoc(id);
  const meta = useReviziyaMeta();
  const mut = useReviziyaMutations();
  const [otp, setOtp] = useState("");
  const [reason, setReason] = useState("");

  if (!canViewReviziya(user?.role)) {
    return <div className="p-8 text-slate-500">Ruxsat yo‘q</div>;
  }
  const row = doc.data;
  if (doc.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!row) return <div className="p-8 text-slate-500">Topilmadi</div>;

  const typeLabel = meta.data?.docTypes?.find((t: { value: string }) => t.value === row.docType)?.label || row.docType;
  const perms = meta.data?.permissions || {};
  const flowIdx = FLOW.indexOf(row.status);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ title: ok });
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : "Xatolik", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-white">
      <div className="bg-gradient-to-br from-[#2e1065] to-[#0b3a5c] px-4 py-5 text-white md:px-6">
        <div className="mx-auto max-w-3xl">
          <Link href="/reviziya">
            <span className="inline-flex items-center text-sm text-violet-200 hover:text-white">
              <ArrowLeft className="mr-1 h-4 w-4" /> Reviziya
            </span>
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-violet-200">{typeLabel}</p>
              <h1 className="text-2xl font-semibold">{row.docNo}</h1>
              <p className="mt-1 text-sm text-violet-100">
                {row.branchName || "Filial"} · {row.responsibleName || "mas’ul kiritilmagan"}
              </p>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
              {STATUS_UZ[row.status] || row.status}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 md:px-6">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Asosiy oqim</p>
          <div className="flex flex-wrap gap-1.5">
            {FLOW.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium",
                  i <= flowIdx ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-500",
                )}
              >
                {STATUS_UZ[s]}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Kamomad: tushuntirish → SB → undirish</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Kamomad / summa</p>
            <p className="text-xl font-semibold tabular-nums">{Math.round(row.shortageAmount || 0)}</p>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Pozitsiyalar</p>
            <p className="text-xl font-semibold">{row.lines?.length || 0}</p>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">Tahrir</p>
            <p className="text-sm font-medium">{row.status === "closed" || row.status === "storno" ? "Yopiq" : "Ochiq"}</p>
          </div>
        </div>

        {(row.lines || []).length ? (
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b px-4 py-3 text-sm font-semibold">Inventarizatsiya qatorlari</div>
            {(row.lines as Array<Record<string, unknown>>).slice(0, 30).map((l, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-2 border-b px-4 py-2.5 text-xs last:border-0">
                <span className="font-mono">{String(l.barcode || "—")}</span>
                <span>
                  hisob {String(l.bookQty)} / haqiqiy {String(l.actualQty)} · farq {String(l.diffQty ?? "")}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-4 shadow-sm">
          <Button size="sm" onClick={() => act(() => mut.advance.mutateAsync({ id }), "Holat yangilandi")}>
            Keyingi holat
          </Button>
          <Button size="sm" variant="secondary" onClick={() => act(() => mut.advance.mutateAsync({ id, status: "awaiting_explanation" }), "Tushuntirish so‘raldi")}>
            Tushuntirish talab
          </Button>
          <Button size="sm" variant="secondary" onClick={() => act(() => mut.advance.mutateAsync({ id, status: "sb_review" }), "SB ga")}>
            SB tekshiruvi
          </Button>
          {perms.storno ? (
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Storno sababi" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 w-40" />
              <Button size="sm" variant="destructive" onClick={() => act(() => mut.storno.mutateAsync({ id, reason }), "Storno")}>
                <Ban className="h-3.5 w-3.5" /> Storno
              </Button>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="h-4 w-4 text-violet-600" /> SMS-OTP tasdiq
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => act(() => mut.otp.mutateAsync(id), "OTP yuborildi")}>
              OTP yuborish
            </Button>
            <Input className="h-9 w-28" placeholder="Kod" value={otp} onChange={(e) => setOtp(e.target.value)} />
            <Button size="sm" onClick={() => act(() => mut.confirmOtp.mutateAsync({ id, code: otp }), "Tasdiqlandi")}>
              Tasdiqlash
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-violet-600" /> Audit log
          </p>
          {(row.audit || []).length ? (
            (row.audit || []).map((a) => (
              <p key={a.id} className="border-t py-1.5 text-xs text-slate-600 first:border-0">
                {new Date(a.createdAt).toLocaleString("uz-UZ")} · {a.action} · {a.detail || ""}
              </p>
            ))
          ) : (
            <p className="text-xs text-slate-400">Hali yozuv yo‘q</p>
          )}
        </div>
      </div>
    </div>
  );
}
