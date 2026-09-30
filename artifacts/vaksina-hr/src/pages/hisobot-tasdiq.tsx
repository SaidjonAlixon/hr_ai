import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { fetchVerifiedHisobot, publicVerifyUrl, type XodimVerified } from "../lib/xodim-hisobot-api";
import { XodimHisobotSheet } from "./admin/xodim-hisobot-sheet";

export default function HisobotTasdiqPage() {
  const [, params] = useRoute("/hisobot/tasdiq/:token");
  const token = params?.token || "";
  const [data, setData] = useState<XodimVerified | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let live = true;
    void fetchVerifiedHisobot(token)
      .then((row) => {
        if (live) setData(row);
      })
      .catch((err: Error) => {
        if (live) setError(err.message || "Topilmadi");
      });
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#e7eef3] px-3 py-8 text-slate-900">
      <div className="mx-auto max-w-[210mm]">
        {!data && !error ? <p className="text-center text-sm text-slate-500">Hisobot ochilmoqda…</p> : null}
        {error ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-base font-semibold">Hisobot topilmadi</p>
            <p className="mt-1 text-sm text-slate-500">{error}</p>
          </div>
        ) : null}
        {data ? (
          <XodimHisobotSheet
            report={data.report}
            seal={{
              sealedAt: data.sealedAt,
              title: data.title || "Hisobot VAKSINAMEDHR",
              approverLine: data.approverLine || "Tasdiqlaydi platforma masʼuli Saidmuhammadalixon",
              verifyUrl: publicVerifyUrl(window.location.href),
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
