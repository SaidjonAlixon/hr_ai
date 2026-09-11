import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatUzPhoneInput,
  formatUzPhoneLocalPart,
  parseUzPhoneDigits,
  UZ_PHONE_PLACEHOLDER,
  UZ_PHONE_PREFIX_DISPLAY,
  digitsOnly,
} from "@/lib/phone";

type PhoneInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type" | "inputMode"
> & {
  value?: string;
  onChange?: (value: string) => void;
};

/**
 * O‘zbekiston raqami: chapda qotgan +998, o‘ngda 9 raqam.
 * To‘liq nomer paste qilinsa kod avtomatik ajratiladi.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value = "", onChange, className, onFocus, onBlur, onPaste, ...props }, ref) => {
    const local = formatUzPhoneLocalPart(value);

    const commitRaw = (raw: string) => {
      const digits = parseUzPhoneDigits(raw);
      if (!digits || digits === "998") {
        onChange?.("");
        return;
      }
      onChange?.(formatUzPhoneInput(digits));
    };

    return (
      <div
        className={cn(
          "flex h-10 w-full items-stretch overflow-hidden rounded-md border border-input bg-background shadow-xs transition",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40",
          className,
        )}
      >
        <span className="flex shrink-0 items-center border-r border-input bg-muted/50 px-2.5 text-sm font-semibold tabular-nums text-foreground">
          {UZ_PHONE_PREFIX_DISPLAY}
        </span>
        <Input
          ref={ref}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={UZ_PHONE_PLACEHOLDER}
          className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:ring-0"
          value={local}
          onFocus={(e) => {
            if (!digitsOnly(value)) {
              onChange?.(formatUzPhoneInput("998"));
            }
            onFocus?.(e);
          }}
          onChange={(e) => {
            const raw = e.target.value;
            const only = digitsOnly(raw);
            if (!only) {
              onChange?.("");
              return;
            }
            // Lokal qismga yozilganda 998 prefiksini qo‘shamiz
            commitRaw(`998${only}`);
          }}
          onPaste={(e) => {
            const text = e.clipboardData?.getData("text") ?? "";
            if (text && /\d/.test(text)) {
              e.preventDefault();
              commitRaw(text);
            }
            onPaste?.(e);
          }}
          onBlur={(e) => {
            const d = parseUzPhoneDigits(e.target.value ? `998${digitsOnly(e.target.value)}` : value);
            if (!d || d === "998") onChange?.("");
            onBlur?.(e);
          }}
          maxLength={14}
          {...props}
        />
      </div>
    );
  },
);
PhoneInput.displayName = "PhoneInput";
