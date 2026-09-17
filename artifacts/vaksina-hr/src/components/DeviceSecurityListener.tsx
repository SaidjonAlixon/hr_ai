import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

/** API 403 DEVICE_* / SESSION_REVOKED — toast + login */
export function DeviceSecurityListener() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setUser } = useAuth();

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ code: string; message: string }>).detail;
      if (!detail?.code) return;
      toast({
        title:
          detail.code === "SESSION_REVOKED"
            ? "Sessiya tugatildi"
            : detail.code === "DEVICE_PENDING"
              ? "Qurilma kutilmoqda"
              : "Qurilma ruxsati yo‘q",
        description: detail.message,
        variant: "destructive",
      });
      if (detail.code === "DEVICE_NOT_AUTHORIZED" || detail.code === "SESSION_REVOKED") {
        setUser(null);
        setLocation("/login");
      }
    };
    window.addEventListener("vaksina-device-security", handler);
    return () => window.removeEventListener("vaksina-device-security", handler);
  }, [toast, setLocation, setUser]);

  return null;
}
