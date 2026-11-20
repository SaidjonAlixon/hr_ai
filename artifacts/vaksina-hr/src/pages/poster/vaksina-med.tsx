import { Download, ExternalLink, FileImage, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

const POSTER_PNG = "/posters/vaksina-med-poster.png";
const POSTER_PDF = "/posters/vaksina-med-poster.pdf";
const QR_LEX = "https://lex.uz/docs/3155768#8319207";

export default function VaksinaMedPosterPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#5D0081]">
            VAKSINA MED
          </p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Mijoz axborot posteri (A4)
          </h1>
          <p className="mt-1 text-muted-foreground">
            Chop etish: A4 albom · 1 listda 2 ta majburiyat · 300 DPI
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

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b bg-[#f7f2fb] px-4 py-2 text-sm text-[#5D0081]">
          <FileImage className="h-4 w-4" />
          Preview · print-ready
        </div>
        <img
          src={POSTER_PNG}
          alt="VAKSINA MED mijoz axborot posteri"
          className="mx-auto block h-auto w-full max-w-[900px] bg-[#f3f0f6]"
        />
      </div>
    </div>
  );
}
