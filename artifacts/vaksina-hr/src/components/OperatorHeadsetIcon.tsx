import { cn } from "@/lib/utils";

/** Operator + quloqchin — yordam tugmasi uchun */
export function OperatorHeadsetIcon({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {/* Quloqchin yoyi */}
      <path
        d="M4.5 12.5V11a7.5 7.5 0 0 1 15 0v1.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Chap quloq */}
      <rect
        x="3.25"
        y="11.5"
        width="3.25"
        height="5.5"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.15"
      />
      {/* O‘ng quloq */}
      <rect
        x="17.5"
        y="11.5"
        width="3.25"
        height="5.5"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.15"
      />
      {/* Operator boshi */}
      <circle cx="12" cy="10.25" r="2.35" fill="currentColor" />
      {/* Yelka / tanasi */}
      <path
        d="M7.5 18.75c.85-2.2 2.55-3.35 4.5-3.35s3.65 1.15 4.5 3.35"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Mikrofon dastagi */}
      <path
        d="M17.75 15.25v2.1a1.6 1.6 0 0 1-1.6 1.6H12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="11.25" cy="18.95" r="1.05" fill="currentColor" />
    </svg>
  );
}
