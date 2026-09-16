/** Brauzer orqali PDF (Chop etish → PDF sifatida saqlash) */

import {
  pipelineHistoryFromJson,
  type Translate,
} from "@/lib/hire-pipeline-history-blocks";

export type CandidatePdfData = {
  fullName: string;
  phone?: string | null;
  birthDate?: string | null;
  address?: string | null;
  education?: string | null;
  experience?: string | null;
  expectedSalary?: string | null;
  notes?: string | null;
  stage?: string | null;
  stageLabel?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  recruiterName?: string | null;
  createdAt?: string | null;
};

export type VacancyPdfMeta = {
  title: string;
  location?: string | null;
  salaryRange?: string | null;
  recruiterName?: string | null;
  departmentName?: string | null;
};

function esc(s: string | null | undefined) {
  if (!s) return "—";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function row(label: string, value: string | null | undefined) {
  return `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;width:34%;font-size:12px;">${esc(label)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:600;">${esc(value)}</td>
  </tr>`;
}

function candidateBlock(c: CandidatePdfData, vacancy: VacancyPdfMeta, index?: number) {
  const title =
    index != null ? `${index + 1}. ${c.fullName}` : c.fullName;
  return `
  <section style="page-break-inside:avoid;margin-bottom:28px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#0b3a5c;color:#fff;padding:14px 16px;">
      <div style="font-size:16px;font-weight:700;">${esc(title)}</div>
      <div style="font-size:12px;opacity:.85;margin-top:4px;">Ish o'rni: ${esc(vacancy.title)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      ${row("Telefon", c.phone)}
      ${row("Tug'ilgan sana", c.birthDate)}
      ${row("Manzil", c.address)}
      ${row("Ta'lim", c.education)}
      ${row("Tajriba", c.experience)}
      ${row("Kutilayotgan maosh", c.expectedSalary)}
      ${row("Bosqich", c.stageLabel || c.stage)}
      ${row("Holat", c.statusLabel || c.status)}
      ${row("Rekruter", c.recruiterName || vacancy.recruiterName)}
      ${row("Qo'shilgan", c.createdAt)}
      ${row("Izoh", c.notes)}
    </table>
  </section>`;
}

function wrapHtml(body: string, heading: string) {
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <title>${esc(heading)}</title>
  <style>
    @page { margin: 16mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 6px; color: #0b3a5c; }
    .meta { font-size: 12px; color: #64748b; margin-bottom: 20px; }
    .actions { margin-bottom: 16px; }
    @media print { .actions { display: none; } }
  </style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()" style="padding:10px 16px;background:#0b3a5c;color:#fff;border:0;border-radius:8px;cursor:pointer;font-weight:600;">
      PDF sifatida saqlash / Chop etish
    </button>
  </div>
  <h1>${esc(heading)}</h1>
  ${body}
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body>
</html>`;
}

export function openCandidatePdf(candidate: CandidatePdfData, vacancy: VacancyPdfMeta) {
  const meta = `
    <div class="meta">
      ${esc(vacancy.departmentName || "")}
      ${vacancy.location ? ` · ${esc(vacancy.location)}` : ""}
      ${vacancy.salaryRange ? ` · ${esc(vacancy.salaryRange)}` : ""}
    </div>`;
  const html = wrapHtml(meta + candidateBlock(candidate, vacancy), `Nomzod — ${candidate.fullName}`);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

function pipelineBlockHtmlTone(
  title: string,
  at: string,
  lines: { label?: string; value: string }[],
  tone: "sky" | "amber" = "sky",
) {
  const accent = tone === "amber" ? "#f59e0b" : "#0ea5e9";
  const body = lines
    .map((line) => {
      const label = line.label
        ? `<div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-top:8px;">${esc(line.label)}</div>`
        : "";
      return `${label}<div style="font-size:13px;color:#0f172a;margin-top:2px;white-space:pre-wrap;">${esc(line.value)}</div>`;
    })
    .join("");
  return `
  <section style="page-break-inside:avoid;margin-bottom:16px;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;border-left:4px solid ${accent};">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <div style="font-size:14px;font-weight:700;color:#0b3a5c;">${esc(title)}</div>
      ${at ? `<div style="font-size:10px;color:#64748b;">${esc(at)}</div>` : ""}
    </div>
    <div style="margin-top:8px;">${body}</div>
  </section>`;
}

export type CandidateAnketaInput = {
  candidate: CandidatePdfData & {
    id?: number;
    vacancyTitle?: string | null;
    vacancyDescription?: string | null;
  };
  vacancy: VacancyPdfMeta;
  pipelineJson?: unknown;
  flowLabel?: string | null;
  t: Translate;
};

export function openCandidateAnketaPdf(input: CandidateAnketaInput) {
  const { candidate, vacancy, pipelineJson, flowLabel, t } = input;
  const c = candidate;
  const meta = `
    <div class="meta">
      Ish o'rni: ${esc(c.vacancyTitle || vacancy.title)}
      ${vacancy.location ? ` · ${esc(vacancy.location)}` : ""}
      ${vacancy.salaryRange ? ` · ${esc(vacancy.salaryRange)}` : ""}
      ${c.id != null ? ` · ID #${c.id}` : ""}
    </div>`;

  const desc =
    c.vacancyDescription?.trim() ?
      `<p style="font-size:12px;color:#475569;margin:0 0 16px;line-height:1.5;">${esc(c.vacancyDescription.trim())}</p>`
    : "";

  const basic = candidateBlock(
    {
      ...c,
      stageLabel: flowLabel || c.stageLabel,
    },
    vacancy,
  );

  const steps = pipelineHistoryFromJson(pipelineJson, t);
  const stepsHtml =
    steps.length > 0 ?
      `<h2 style="font-size:15px;color:#0b3a5c;margin:24px 0 12px;">${esc(t("hire.pipe.historyTitle"))}</h2>` +
      steps
        .map((s) =>
          pipelineBlockHtmlTone(
            s.title,
            s.at,
            s.lines,
            s.step === "no_answer" ? "amber" : "sky",
          ),
        )
        .join("\n")
    : `<p style="font-size:12px;color:#64748b;">${esc(t("hire.pdfAnketaNoSteps"))}</p>`;

  const html = wrapHtml(
    meta + desc + basic + stepsHtml,
    t("hire.pdfAnketaTitle").replace("{name}", c.fullName),
  );
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

export function openVacancyCandidatesPdf(
  candidates: CandidatePdfData[],
  vacancy: VacancyPdfMeta,
) {
  const meta = `
    <div class="meta">
      Jami: ${candidates.length} ta nomzod
      ${vacancy.recruiterName ? ` · Rekruter: ${esc(vacancy.recruiterName)}` : ""}
      ${vacancy.location ? ` · ${esc(vacancy.location)}` : ""}
      ${vacancy.salaryRange ? ` · ${esc(vacancy.salaryRange)}` : ""}
    </div>`;
  const blocks = candidates
    .map((c, i) => candidateBlock(c, vacancy, i))
    .join("\n");
  const html = wrapHtml(
    meta + (blocks || "<p>Nomzod yo'q</p>"),
    `Nomzodlar — ${vacancy.title}`,
  );
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
