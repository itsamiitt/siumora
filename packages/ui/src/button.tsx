import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn.ts";

/**
 * Buttons are set in Jost Medium, all caps, tracked — "ADD TO BAG".
 *
 * Mulberry is the one accent per view, so a view should carry at most one
 * primary button. Brass appears only as a hairline stroke, never as a fill.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-ivory hover:bg-accent/90 disabled:bg-accent/40",
  secondary:
    "border border-content/20 text-content hover:border-content/40 hover:bg-content/[0.03] disabled:text-content/40",
  quiet: "text-content underline-offset-8 hover:underline disabled:text-content/40",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[11px]",
  md: "h-11 px-6 text-xs",
  lg: "h-14 px-9 text-[13px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-body font-medium uppercase",
        "transition-colors duration-200 ease-[var(--ease-siumora)]",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      style={{ letterSpacing: "var(--tracking-caps)" }}
      {...props}
    />
  );
}
