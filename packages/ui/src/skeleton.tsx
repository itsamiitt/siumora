import { cn } from "./cn.ts";

/**
 * Loading placeholder.
 *
 * Shaped like the thing it stands in for, so the layout does not jump when the
 * content lands — a skeleton that reserves the wrong box spends the CLS budget
 * it was meant to protect.
 *
 * The shimmer is a slow opacity breath rather than a sweeping gradient: the
 * kit's motion note is that nothing moves across the surface except the polish
 * sweep on the mark. `prefers-reduced-motion` stops it entirely, via the base
 * layer, leaving a static blush block that still reserves the space.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-siumora-breathe bg-content/8", className)}
      {...props}
    />
  );
}

/** A product card placeholder — image plate, title line, price line. */
export function ProductCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-4/5 w-full" />
      <Skeleton className="mt-4 h-3.5 w-3/4" />
      <Skeleton className="mt-2.5 h-3 w-1/3" />
    </div>
  );
}

/** A run of text lines. The last is short, the way a paragraph ends. */
export function TextSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index === lines - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </div>
  );
}
