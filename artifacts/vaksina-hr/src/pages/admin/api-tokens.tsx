import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Copy, Ban, RefreshCw, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { isBoshAdmin } from "@/lib/roles";
import {
  createApiToken,
  fetchApiScopes,
  fetchApiTokens,
  revokeApiToken,
} from "@/lib/api-tokens-api";

function fmt(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  } catch {
    return s;
  }
}

export default function AdminApiTokensPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const allowed = isBoshAdmin(user);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const scopesQ = useQuery({
    queryKey: ["api-tokens", "scopes"],
    queryFn: fetchApiScopes,
    enabled: allowed,
  });
  const tokensQ = useQuery({
    queryKey: ["api-tokens", "list"],
    queryFn: fetchApiTokens,
    enabled: allowed,
    refetchInterval: 20_000,
  });

  const allScopeIds = useMemo(() => scopesQ.data?.scopes.map((s) => s.id) ?? [], [scopesQ.data]);

  const createMut = useMutation({
    mutationFn: createApiToken,
    onSuccess: (data) => {
      setCreatedToken(data.token);
      toast({ title: "Token yaratildi", description: data.warning });
      setName("");
      setNote("");
      setExpiresInDays("");
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e: Error) => toast({ title: "Xato", description: e.message, variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: () => {
      toast({ title: "Token bekor qilindi" });
      void qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e: Error) => toast({ title: "Xato", description: e.message, variant: "destructive" }),
  });

  if (!allowed) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Faqat bosh admin API token berishi mumkin.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-16 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <KeyRound className="h-5 w-5 text-violet-700" />
            API Tokenlar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only tashqi API. Token faqat ma’lumot oladi — o‘zgartira olmaydi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/api-docs">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Dokumentatsiya
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/api-devor">API Devor</Link>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void qc.invalidateQueries({ queryKey: ["api-tokens"] })}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Yangilash
          </Button>
        </div>
      </div>

      {createdToken ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-950">Yangi token (faqat bir marta)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="block break-all rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-amber-200">
              {createdToken}
            </code>
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(createdToken);
                toast({ title: "Nusxa olindi" });
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Nusxa olish
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Yangi token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold">Nom</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: 1C integratsiya" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Muddat (kun, bo‘sh = doimiy)</label>
              <Input
                type="number"
                min={1}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="Masalan: 90"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Izoh</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Kim uchun / qayerda ishlatiladi" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold">Ruxsatlar (scope)</label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(selected.length === allScopeIds.length ? [] : allScopeIds)}
              >
                {selected.length === allScopeIds.length ? "Tozalash" : "Hammasini tanlash"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(scopesQ.data?.scopes || []).map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setSelected((prev) => (on ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                    }
                    className={`rounded-xl border px-3 py-2 text-left transition ${
                      on ? "border-violet-500 bg-violet-50" : "border-border bg-card hover:bg-muted/40"
                    }`}
                  >
                    <div className="text-sm font-semibold">{s.label}</div>
                    <div className="text-[11px] text-muted-foreground">{s.description}</div>
                    <code className="mt-1 block text-[10px] text-violet-700">{s.id}</code>
                  </button>
                );
              })}
            </div>
          </div>
          <Button
            disabled={createMut.isPending || !name.trim() || !selected.length}
            onClick={() =>
              createMut.mutate({
                name: name.trim(),
                scopes: selected,
                note: note.trim() || null,
                expiresInDays: expiresInDays ? Number(expiresInDays) : null,
              })
            }
          >
            {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Token yaratish
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mavjud tokenlar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tokensQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (tokensQ.data?.tokens || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Hali token yo‘q.</p>
          ) : (
            (tokensQ.data?.tokens || []).map((t) => (
              <div
                key={t.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t.name}</span>
                    <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Faol" : "Yopiq"}</Badge>
                    <code className="text-[11px] text-muted-foreground">{t.tokenPrefix}…</code>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(t.scopes || []).map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Yaratilgan: {fmt(t.createdAt)} · Oxirgi foydalanish: {fmt(t.lastUsedAt)} · Muddat:{" "}
                    {t.expiresAt ? fmt(t.expiresAt) : "doimiy"}
                    {t.revokedAt ? ` · Bekor: ${fmt(t.revokedAt)}` : ""}
                  </p>
                </div>
                {!t.revokedAt ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={revokeMut.isPending}
                    onClick={() => {
                      if (confirm(`«${t.name}» tokenini bekor qilasizmi?`)) revokeMut.mutate(t.id);
                    }}
                  >
                    <Ban className="mr-1.5 h-3.5 w-3.5" />
                    Bekor qilish
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
