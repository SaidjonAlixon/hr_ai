import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RoutePoint } from "@/components/davomat/MobileRouteMap";
import { googleMapsRouteUrl, yandexMapsRouteUrlFixed } from "@/lib/external-maps";
import { cn } from "@/lib/utils";

type Props = {
  points: RoutePoint[];
  className?: string;
  compact?: boolean;
};

export function ExternalMapsLinks({ points, className, compact }: Props) {
  const google = googleMapsRouteUrl(points);
  const yandex = yandexMapsRouteUrlFixed(points);
  if (!google && !yandex) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {yandex ? (
        <Button
          asChild
          size={compact ? "sm" : "sm"}
          variant="outline"
          className="h-8 rounded-lg border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/40"
        >
          <a href={yandex} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Yandex
          </a>
        </Button>
      ) : null}
      {google ? (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-8 rounded-lg border-emerald-200 bg-white text-xs font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-950/40"
        >
          <a href={google} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Google Maps
          </a>
        </Button>
      ) : null}
    </div>
  );
}
