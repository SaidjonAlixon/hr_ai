import { Building2, Loader2, Warehouse } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DAVOMAT_SITE_LABEL, useDavomatSiteMutation, type DavomatSite } from "@/lib/distribyutsiya-api";

const OPTIONS: Array<{ key: DavomatSite; icon: typeof Building2 }> = [
  { key: "office", icon: Building2 },
  { key: "tamojni", icon: Warehouse },
];

/** Davomat joyi: Asosiy ofis yoki Tamojni sklad. canChange=false — faqat ko‘rinadi */
export function DavomatSitePicker({
  userId,
  fullName,
  value,
  canChange,
}: {
  userId: number;
  fullName: string;
  value: DavomatSite;
  canChange: boolean;
}) {
  const { toast } = useToast();
  const mut = useDavomatSiteMutation();
  const pendingSite = mut.isPending ? mut.variables?.site : null;

  if (!canChange) {
    const Icon = value === "tamojni" ? Warehouse : Building2;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
          value === "tamojni" ? "bg-amber-500/15 text-amber-800" : "bg-sky-500/15 text-sky-800",
        )}
      >
        <Icon className="h-3 w-3" />
        {DAVOMAT_SITE_LABEL[value]}
      </span>
    );
  }

  const pick = (site: DavomatSite) => {
    if (site === value || mut.isPending) return;
    mut.mutate(
      { userId, site },
      {
        onSuccess: (res) =>
          toast({
            title: "Davomat joyi o‘zgardi ✓",
            description: `${fullName}: endi faqat «${res.label}» hududidan davomat qiladi.`,
          }),
        onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="radiogroup" aria-label="Davomat joyi">
      {OPTIONS.map(({ key, icon: Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={mut.isPending}
            onClick={() => pick(key)}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold transition",
              active
                ? key === "tamojni"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "bg-sky-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
            )}
          >
            {pendingSite === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
            {DAVOMAT_SITE_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}
