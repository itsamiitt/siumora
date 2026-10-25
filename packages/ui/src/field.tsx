import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * Form fields for checkout and the account pages (plan 16 Phase C).
 *
 * The label sits above the field and never doubles as a placeholder; help
 * and errors sit below it, tied to the input by aria-describedby so a screen
 * reader hears them with the field. An error is mulberry type with a mark,
 * so it does not rely on colour alone. Optional fields say so — Baymard
 * found most sites mark neither, and shoppers guess wrong both ways.
 */

/** The one input look: 48px, the ground behind it, a hairline that turns mulberry on focus. */
export const inputClassName =
  "h-12 w-full border border-content/20 bg-ground px-3 text-[15px] text-content outline-none " +
  "transition-colors duration-200 ease-[var(--ease-siumora)] placeholder:text-content-faint " +
  "focus:border-accent-ink focus:ring-1 focus:ring-inset focus:ring-accent-ink " +
  "aria-[invalid=true]:border-accent-ink disabled:opacity-60";

export function Field({
  label,
  htmlFor,
  optional,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        {optional && <span className="text-xs text-content-faint">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-message`} className="mt-1.5 flex items-baseline gap-1.5 text-xs text-accent-ink">
          <span aria-hidden className="inline-block size-1 shrink-0 translate-y-[-2px] rounded-full bg-accent-ink" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-message`} className="mt-1.5 text-xs text-content-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** An input wired to its Field's message: pass the same id and whether it is in error. */
export function TextInput({
  id,
  invalid,
  hasMessage,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  invalid?: boolean;
  /** True when the Field shows a hint or error for this input. */
  hasMessage?: boolean;
}) {
  return (
    <input
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={hasMessage ? `${id}-message` : undefined}
      className={cn(inputClassName, className)}
      {...props}
    />
  );
}
