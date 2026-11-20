import { Download, ExternalLink, FileText, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const POSTER_PNG = "/posters/vaksina-med-poster.png";
const POSTER_PDF = "/posters/vaksina-med-poster.pdf";
const QR_LEX = "https://lex.uz/docs/3155768#8319207";

export default function MajburiyatPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 md:gap-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#5D0081]">
            Apteka tarmog‘i
          </p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Majburiyat</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Mijozlar uchun axborot listi (A4 albom, 2 ta / 1 list). Kirganda PDF ochiladi —
            chop etib, yarimdan kesib dorixonaga yopishtiring.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="bg-[#5D0081] hover:bg-[#4a0068]">
            <a href={POSTER_PDF} download="vaksina-med-poster.pdf">
              <FileText className="mr-2 h-4 w-4" />
              PDF yuklab olish
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={POSTER_PNG} download="vaksina-med-poster.png">
              <Download className="mr-2 h-4 w-4" />
              PNG
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={QR_LEX} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Lex.uz 39-band
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-[#5D0081]" />
              Huquqiy asos
            </CardTitle>
            <CardDescription>
              185-son qaror · 39-band
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Dorixonadan sotilgan dori vositalari va tibbiy jihozlar qaytarib olinmaydi va
            almashtirilmaydi.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-[#5D0081]" />
              PDF yuklash
            </CardTitle>
            <CardDescription>A4 albom · 2 ta majburiyat</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" className="bg-[#5D0081] hover:bg-[#4a0068]">
              <a href={POSTER_PDF} download="vaksina-med-poster.pdf">
                Yuklab olish
              </a>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4 text-[#5D0081]" />
              PNG
            </CardTitle>
            <CardDescription>3508×2480 · 300 DPI</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" variant="outline">
              <a href={POSTER_PNG} download="vaksina-med-poster.png">
                Yuklab olish
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[#f7f2fb] px-4 py-2 text-sm text-[#5D0081]">
          <span className="inline-flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4" />
            PDF ko‘rinishi
          </span>
          <Button asChild size="sm" variant="outline" className="h-8 border-[#5D0081]/50 text-[#5D0081]">
            <a href={POSTER_PDF} download="vaksina-med-poster.pdf">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              PDF yuklab olish
            </a>
          </Button>
        </div>
        <div className="bg-[#ece7f1] p-2 md:p-3">
          <iframe
            title="VAKSINA MED majburiyat PDF"
            src={`${POSTER_PDF}#toolbar=1&navpanes=0&view=FitH`}
            className="h-[72vh] min-h-[480px] w-full rounded-xl border bg-white shadow-sm"
          />
        </div>
      </div>
    </div>
  );
}
