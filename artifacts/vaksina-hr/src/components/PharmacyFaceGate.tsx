import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { isPharmacyDeviceStaff } from "@/lib/roles";
import { fetchFaceIdStatus } from "@/lib/face-id";

/**
 * Dorixona xodimi: Face ID bo‘lmasa /davomat-face?enroll=1 ga yo‘naltiradi.
 * Qurilma tasdiqlangandan keyin ham tizimga to‘liq tanilish shart.
 */
export function PharmacyFaceGate() {
  const { user, isAuthenticated } = useAuth();
  const [location, setLocation] = useLocation();
  const checking = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user || !isPharmacyDeviceStaff(user.role)) return;
    const path = location.split("?")[0] || location;
    if (
      path === "/login" ||
      path === "/tg" ||
      path.startsWith("/davomat-face") ||
      path.startsWith("/davomat/face")
    ) {
      return;
    }
    if (checking.current) return;
    checking.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const st = await fetchFaceIdStatus();
        if (cancelled) return;
        if (!st.registered) {
          setLocation("/davomat-face?enroll=1");
        }
      } catch {
        /* status olinmasa — keyingi navigatsiyada qayta uriniladi */
      } finally {
        checking.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, location, setLocation]);

  return null;
}
