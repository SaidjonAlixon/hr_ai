import type { ReactNode } from "react";
import { GraduationCap, LogOut } from "lucide-react";
import { useLogout } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

/** O‘quvchi uchun minimal oyna: faqat Kirish darslari, boshqa menyu yo‘q */
export function StudentShell({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const logout = useLogout();

  const onLogout = () => {
    const done = () => {
      setUser(null);
      window.location.href = "/login";
    };
    logout.mutate(undefined, { onSuccess: done, onError: done });
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-[#0b3a5c] px-4 py-2.5 text-white shadow-sm">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">Kirish darslari</p>
          <p className="truncate text-xs text-sky-100/80">{user?.fullName}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 rounded-xl text-white hover:bg-white/15 hover:text-white"
          onClick={onLogout}
          disabled={logout.isPending}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Chiqish</span>
        </Button>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
