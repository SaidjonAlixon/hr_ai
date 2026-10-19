import React, { useState } from "react";
import { Download, ScanLine, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DocumentScanner } from "@/components/scanner/DocumentScanner";
import { deliverFile } from "@/lib/tg-download";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { canUseDocumentScanner } from "@/lib/roles";

export default function AdminScannerPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);

  const allowed = canUseDocumentScanner(user?.role);

  if (!allowed) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Bu bo‘limga ruxsat yo‘q.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <ScanLine className="h-6 w-6 text-emerald-600" />
          Hujjat skaneri
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A4 skaner: pechat/muhur/imzo ranglari saqlanadi. PDF 1 soat saqlanadi, Tushuntirish xatlari
          bo‘limiga ham yuboriladi.
        </p>
      </div>

      <Card className="overflow-hidden border-emerald-200/60 shadow-sm">
        <CardHeader className="bg-gradient-to-br from-emerald-50 to-transparent dark:from-emerald-950/40">
          <CardTitle className="text-base">Yangi skan</CardTitle>
          <CardDescription>
            Listni ramkaga oling → yashil chetni tuzating → skaner. Muhur/imzo rangli qoladi. PDF 1
            soat ichida TG/yuklash mumkin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Button
            type="button"
            size="lg"
            className="w-full bg-emerald-600 hover:bg-emerald-500 sm:w-auto"
            onClick={() => setOpen(true)}
          >
            <ScanLine className="mr-2 h-5 w-5" />
            Skannerini ochish
          </Button>

          {lastUrl && lastName ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{lastName}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = lastUrl;
                  a.download = lastName;
                  a.click();
                }}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Yuklash
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    const res = await fetch(lastUrl);
                    const blob = await res.blob();
                    const r = await deliverFile(blob, lastName);
                    toast({
                      title: r.via === "telegram" ? "Telegramga yuborildi" : "Yuklandi",
                    });
                  } catch (err: any) {
                    toast({ title: err?.message || "Xatolik", variant: "destructive" });
                  }
                }}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                Telegram
              </Button>
            </div>
          ) : null}

          <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
            <li>Orqa kamera + yuqori aniqlik (imkon qadar)</li>
            <li>Hujjat chetlarini avto-aniqlash va qo‘lda tuzatish</li>
            <li>Perspektivni tuzatib A4 ga yoyish</li>
            <li>Skaner rejimi: oq qog‘oz, qora matn</li>
            <li>Ko‘p sahifali PDF</li>
          </ul>
        </CardContent>
      </Card>

      <DocumentScanner
        open={open}
        onOpenChange={setOpen}
        standalone
        title="Tizim skaneri"
        defaultFileName={`skaner_${new Date().toISOString().slice(0, 10)}.pdf`}
        onComplete={async (blob, filename) => {
          const url = URL.createObjectURL(blob);
          setLastUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          setLastName(filename);
          const r = await deliverFile(blob, filename);
          toast({
            title: "PDF tayyor",
            description:
              r.via === "telegram"
                ? "Telegramga yuborildi"
                : "Kompyuterga yuklab olindi",
          });
        }}
      />
    </div>
  );
}
