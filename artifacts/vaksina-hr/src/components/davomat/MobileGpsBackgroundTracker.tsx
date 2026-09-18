import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  MOBILE_GPS_GRANTED_EVENT,
  startMobileGpsKeepalive,
  stopMobileGpsKeepalive,
} from "@/lib/mobile-gps-keepalive";

export { MOBILE_GPS_GRANTED_EVENT };

/**
 * Layout ichida — GPS kuzatuvni ishga tushiradi / logout’da to‘xtatadi.
 * Asosiy mantiq singleton: React remount’da o‘chib qolmaydi.
 */
export function MobileGpsBackgroundTracker() {
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      stopMobileGpsKeepalive();
      return;
    }
    startMobileGpsKeepalive();
    // Cleanup’da to‘xtatMAYMIZ — remount/StrictMode kuzatuvni o‘chirmasin.
    // Faqat logout (yuqoridagi branch) to‘xtatadi.
  }, [isAuthenticated, user?.id]);

  return null;
}
