import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Loader2, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { isBoshAdmin } from "@/lib/roles";
import { fetchApiTokenLogs, fetchApiTokens } from "@/lib/api-tokens-api";

function fmt(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  } catch {
    return s;
  }
}

export default function AdminApiDevorPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const allowed = isBoshAdmin(user);
  const [tokenId, setTokenId] = useState<string>("");
  const [path, setPath] = useState("");

  const tokensQ = useQuery({
    queryKey: ["api-tokens", "list"],
    queryFn: fetchApiTokens,
    enabled: allowed,
  });

  const logsQ = useQuery({
    queryKey: ["api-tokens", "logs", tokenId, path],
    queryFn: () =>
      fetchApiTokenLogs({
        tokenId: tokenId ? Number(tokenId) : undefined,
        path: path || undefined,
        limit: 150,
      }),
    enabled: allowed,
    refetchInterval: 5_000,
  });

  if (!allowed) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Faqat bosh admin API Devorni ko‘ra oladi.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-16 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Shield className="h-5 w-5 text-violet-700" />
            API Devor
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Qaysi token / qurilma qaysi endpointga so‘rov yuborayotganini jonli kuzating.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/api-tokens">Tokenlar</Link>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void qc.invalidateQueries({ queryKey: ["api-tokens", "logs"] })}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Yangilash
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtr</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold">Token</label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
            >
              <option value="">Barcha</option>
              {(tokensQ.data?.tokens || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.tokenPrefix}…)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Path qidiruv</label>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/employees" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">So‘rovlar jurnali (har 5 soniyada)</CardTitle>
        </CardHeader>
        <CardContent>
          {logsQ.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (logsQ.data?.logs || []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Hali so‘rov yo‘q.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Vaqt</th>
                    <th className="px-2 py-2">Token</th>
                    <th className="px-2 py-2">Method / Path</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">IP / Qurilma</th>
                    <th className="px-2 py-2">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {(logsQ.data?.logs || []).map((l) => (
                    <tr key={l.id} className="border-b border-border/60 align-top">
                      <td className="px-2 py-2 whitespace-nowrap">{fmt(l.createdAt)}</td>
                      <td className="px-2 py-2">
                        <div className="font-medium">{l.tokenName || `#${l.tokenId}`}</div>
                        <code className="text-[10px] text-muted-foreground">{l.tokenPrefix}…</code>
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-mono">
                          {l.method} {l.path}
                        </div>
                        {l.querySummary ? (
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{l.querySummary}</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <Badge
                          variant="outline"
                          className={
                            l.status >= 500
                              ? "border-rose-300 text-rose-700"
                              : l.status >= 400
                                ? "border-amber-300 text-amber-800"
                                : "border-emerald-300 text-emerald-800"
                          }
                        >
                          {l.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <div>{l.ip || "—"}</div>
                        <div className="truncate text-[10px] text-muted-foreground max-w-[220px]">
                          {l.deviceLabel || l.userAgent || "—"}
                        </div>
                      </td>
                      <td className="px-2 py-2">{l.durationMs ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
