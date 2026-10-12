import { useState } from "react";
import { Check, Plus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateStudentGroup, useDeleteStudentGroup } from "@/lib/oquvchilar-api";

type Props = {
  groups: string[];
  counts?: Record<string, number>;
  value: string;
  onChange: (name: string) => void;
  allowDelete?: boolean;
};

export function GroupPicker({ groups, counts, value, onChange, allowDelete }: Props) {
  const { toast } = useToast();
  const createGroup = useCreateStudentGroup();
  const deleteGroup = useDeleteStudentGroup();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const all = value && !groups.includes(value) ? [...groups, value] : groups;

  const submit = () => {
    const name = draft.replace(/\s+/g, " ").trim();
    if (name.length < 2) return;
    if (all.includes(name)) {
      onChange(name);
      setAdding(false);
      setDraft("");
      return;
    }
    createGroup.mutate(name, {
      onSuccess: (r) => {
        onChange(r.name);
        setAdding(false);
        setDraft("");
        toast({ title: `«${r.name}» guruhi yaratildi` });
      },
      onError: (e) => toast({ title: e instanceof Error ? e.message : "Guruh yaratilmadi", variant: "destructive" }),
    });
  };

  const remove = (name: string) => {
    const n = counts?.[name] ?? 0;
    const msg = n
      ? `«${name}» guruhini o‘chirasizmi? ${n} ta o‘quvchi guruhsiz qoladi (o‘quvchilar o‘chmaydi).`
      : `«${name}» guruhini o‘chirasizmi?`;
    if (!window.confirm(msg)) return;
    deleteGroup.mutate(name, {
      onSuccess: () => {
        if (value === name) onChange("");
        toast({ title: "Guruh o‘chirildi" });
      },
      onError: (e) => toast({ title: e instanceof Error ? e.message : "O‘chirilmadi", variant: "destructive" }),
    });
  };

  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
      active
        ? "border-[#0b3a5c] bg-[#0b3a5c] text-white"
        : "border-border bg-card text-foreground hover:border-[#2AABEE]",
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(!value)} onClick={() => onChange("")}>
          Guruhsiz
        </button>
        {all.map((g) => (
          <span key={g} className="group relative inline-flex">
            <button type="button" className={chip(value === g)} onClick={() => onChange(g)}>
              {value === g ? <Check className="h-3 w-3" /> : <Users className="h-3 w-3 opacity-60" />}
              {g}
              {counts?.[g] != null ? <span className="opacity-60">· {counts[g]}</span> : null}
            </button>
            {allowDelete && groups.includes(g) ? (
              <button
                type="button"
                title="Guruhni o‘chirish"
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white group-hover:flex"
                onClick={() => remove(g)}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!adding ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#2AABEE] px-2.5 py-1.5 text-xs font-medium text-[#0b6aa2] hover:bg-[#2AABEE]/10"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3 w-3" /> Yangi guruh
          </button>
        ) : null}
      </div>
      {adding ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            className="h-9"
            value={draft}
            placeholder="Masalan: 2026-oktabr"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setAdding(false);
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-9 bg-[#0b3a5c] hover:bg-[#0a314d]"
            disabled={createGroup.isPending || draft.trim().length < 2}
            onClick={submit}
          >
            {createGroup.isPending ? "…" : "Yaratish"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setAdding(false)}>
            Bekor
          </Button>
        </div>
      ) : null}
    </div>
  );
}
