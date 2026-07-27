import type { SVGProps } from "react";

/**
 * Petal & Kernel mark and lockups.
 *
 * Geometry is taken from brand-kit/01-logo. Four circles of Ø0.5x sit on the
 * axes of a 1×1 square; the petals between them are never drawn, they appear
 * from the overlap. The kernel is Ø0.167x, solid, dead centre.
 *
 * Clear space is 0.5x on all four sides and is the caller's responsibility —
 * nothing may enter it.
 */

export type MarkTone = "ink" | "ivory" | "brass" | "mulberry";

const STROKE: Record<MarkTone, string> = {
  ink: "#1C1917",
  ivory: "#F7F3EA",
  brass: "#C79A5C",
  mulberry: "#6B2942",
};

/** The kernel is the one place brass is allowed to be solid. */
const KERNEL: Record<MarkTone, string> = {
  ink: "#6B2942",
  ivory: "#E3C08A",
  brass: "#C79A5C",
  mulberry: "#6B2942",
};

export interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  /** Rendered width in px. Drives the small-size swap. */
  size?: number;
  tone?: MarkTone;
  /** Accessible label. Pass null for decorative marks beside a wordmark. */
  label?: string | null;
}

/**
 * The mark alone — licensed for anything under 90px: favicon, avatar, tag.
 *
 * Below 24px the guidelines require a sturdier cut: the stroke thickens and the
 * kernel grows, or the lattice greys out at favicon sizes. That swap happens
 * here so callers cannot forget it. 16px is the hard floor.
 */
export function SiumoraMark({
  size = 40,
  tone = "ink",
  label = "Siumora",
  ...props
}: MarkProps) {
  const isSmall = size < 24;
  const strokeWidth = isSmall ? 1.6 : 0.75;
  const kernelRadius = isSmall ? 10 : 8.35;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={label ? "img" : "presentation"}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      <g fill="none" stroke={STROKE[tone]} strokeWidth={strokeWidth}>
        <circle cx="50" cy="25" r="25" />
        <circle cx="75" cy="50" r="25" />
        <circle cx="50" cy="75" r="25" />
        <circle cx="25" cy="50" r="25" />
      </g>
      <circle cx="50" cy="50" r={kernelRadius} fill={KERNEL[tone]} />
    </svg>
  );
}

export interface LockupProps {
  /** Mark size in px; the wordmark scales from it. */
  size?: number;
  tone?: MarkTone;
  className?: string;
}

/**
 * Horizontal lockup — for constrained bands: site header, app bar, email.
 *
 * SIUMORA is set in Cormorant Garamond Light, all caps, tracked 0.34em with
 * matching left padding so the word stays optically centred.
 */
export function SiumoraLockupHorizontal({
  size = 32,
  tone = "ink",
  className,
}: LockupProps) {
  return (
    <span className={clsxLike("inline-flex items-center gap-3", className)}>
      <SiumoraMark size={size} tone={tone} label={null} />
      <span
        className="font-display font-light leading-none"
        style={{
          color: STROKE[tone],
          fontSize: size * 0.72,
          letterSpacing: "var(--tracking-wordmark)",
          paddingLeft: "var(--tracking-wordmark)",
        }}
      >
        SIUMORA
      </span>
    </span>
  );
}

/**
 * Stacked lockup — the primary. Use wherever there is room: packaging,
 * campaign closes, the site footer.
 */
export function SiumoraLockupStacked({
  size = 56,
  tone = "ink",
  className,
}: LockupProps) {
  return (
    <span
      className={clsxLike("inline-flex flex-col items-center", className)}
      style={{ gap: size * 0.28 }}
    >
      <SiumoraMark size={size} tone={tone} label={null} />
      <span
        className="font-display font-light leading-none"
        style={{
          color: STROKE[tone],
          fontSize: size * 0.44,
          letterSpacing: "var(--tracking-wordmark)",
          paddingLeft: "var(--tracking-wordmark)",
        }}
      >
        SIUMORA
      </span>
    </span>
  );
}

/** Tiny local join so the logo file carries no runtime dependency. */
function clsxLike(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
