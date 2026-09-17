import { useEffect } from "react";
import { useLocation } from "wouter";

/** Eski /davomat-kochma — endi asosiy Davomatda yashirin ishlaydi */
export default function DavomatKochmaPage() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/davomat-face");
  }, [setLocation]);
  return (
    <div className="flex justify-center py-20 text-sm text-muted-foreground">
      Davomat sahifasiga o‘tkazilmoqda…
    </div>
  );
}
