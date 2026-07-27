import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * Type helpers that keep the guidelines' tracking rules attached to the styles.
 *
 * Tracked caps settings are for capitals only — applying them to lowercase
 * text is the most common way this system gets broken.
 */

export interface TextProps {
  children: ReactNode;
  className?: string;
}

/** Cormorant Light. Headlines sit in the 32–62px band. */
export function Display({
  children,
  className,
  size = "md",
  as: Tag = "h2",
}: TextProps & {
  size?: "sm" | "md" | "lg";
  as?: "h1" | "h2" | "h3" | "p";
}) {
  // These are the utilities Tailwind generates from the display font-size
  // tokens in theme.css. Do not rewrite them into the arbitrary-value form
  // wrapping the CSS variable: that form is ambiguous, Tailwind resolves it as
  // a colour, and the heading silently falls back to the inherited 16px.
  const sizes = {
    sm: "text-display-sm",
    md: "text-display-md",
    lg: "text-display-lg",
  } as const;

  return (
    <Tag
      className={cn(
        "font-display font-light leading-[1.12] text-balance text-ink",
        sizes[size],
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Marcellus roman capitals — collection names, section headers. */
export function CollectionTitle({ children, className }: TextProps) {
  return (
    <span
      className={cn("font-heading uppercase text-ink", className)}
      style={{ letterSpacing: "var(--tracking-collection)" }}
    >
      {children}
    </span>
  );
}

/** Jost Medium micro label — "GIFT & REWARD", "NEW IN". */
export function MicroLabel({
  children,
  className,
  tone = "ink",
}: TextProps & { tone?: "ink" | "mulberry" | "brass" }) {
  const tones = {
    ink: "text-ink-muted",
    mulberry: "text-mulberry",
    brass: "text-brass",
  } as const;

  return (
    <span
      className={cn(
        "font-body text-[11px] font-medium uppercase",
        tones[tone],
        className,
      )}
      style={{ letterSpacing: "var(--tracking-caps)" }}
    >
      {children}
    </span>
  );
}
