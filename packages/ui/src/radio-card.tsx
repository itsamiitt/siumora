import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * A choice that reads as a card — payment methods, saved addresses.
 *
 * A real radio inside a label, so arrow keys, the group's name and screen
 * readers all behave natively. Selected is the mulberry hairline and a
 * faint wash; disabled is faint type and a reason in the note, never a
 * choice that silently vanishes.
 */
export function RadioCard({
  name,
  value,
  checked,
  disabled,
  onSelect,
  title,
  note,
  aside,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: ReactNode;
  note?: ReactNode;
  /** Right-aligned detail — a fee, "Recommended". */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 border p-4 transition-colors duration-200 ease-[var(--ease-siumora)]",
        disabled
          ? "cursor-not-allowed border-content/10 text-content-faint"
          : checked
            ? "border-accent-ink bg-accent/[0.04]"
            : "border-content/20 hover:border-content/40",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1 accent-accent"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {note && <span className="mt-0.5 block text-xs text-content-muted">{note}</span>}
      </span>
      {aside && <span className="shrink-0 text-xs text-content-muted">{aside}</span>}
    </label>
  );
}
