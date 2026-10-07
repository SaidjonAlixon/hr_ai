import { useAuth } from "@/contexts/AuthContext";
import { canManageSettings } from "@/lib/roles";
import { LetterTestCard } from "@/components/explanation-letter/LetterTestCard";

export default function AdminTestPage() {
  const { user } = useAuth();
  const allowed = canManageSettings(user?.role);

  if (!allowed) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Faqat admin / direktor uchun.</div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tushuntirish xati oqimini real foydalanuvchida sinash.
        </p>
      </div>

      <LetterTestCard />
    </div>
  );
}
