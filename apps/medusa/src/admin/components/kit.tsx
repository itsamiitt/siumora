import { EllipsisHorizontal } from "@medusajs/icons";
import {
  Button,
  Container,
  Drawer,
  DropdownMenu,
  Heading,
  IconButton,
  Skeleton,
  StatusBadge,
  Switch,
  Text,
  clx,
} from "@medusajs/ui";
import { Fragment, type ReactNode } from "react";

/**
 * The Siumora admin kit (plan 16 Phase E) — the native Medusa dashboard's
 * own patterns, so a Siumora card reads like the page it sits on:
 *
 * - a Container with a header row (Heading + "⋯" ActionMenu) and divide-y
 *   sections, never a stack of padded boxes;
 * - values shown read-only as key/value rows; editing happens in a Drawer
 *   with Cancel / Save in its footer, never in always-live inputs;
 * - states as StatusBadges with human words, never snake_case;
 * - a skeleton while loading, never a blank space.
 */

export interface Action {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** The "⋯" menu in a section header — native ActionMenu, groups divided. */
export function ActionMenu({ groups }: { groups: Action[][] }) {
  const visible = groups.filter((group) => group.length > 0);
  if (visible.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <IconButton size="small" variant="transparent" aria-label="Actions">
          <EllipsisHorizontal />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {visible.map((group, index) => (
          <Fragment key={index}>
            {index > 0 && <DropdownMenu.Separator />}
            <DropdownMenu.Group>
              {group.map((action) => (
                <DropdownMenu.Item
                  key={action.label}
                  disabled={action.disabled}
                  onClick={action.onClick}
                  className={clx(
                    "flex items-center gap-x-2 [&_svg]:text-ui-fg-subtle",
                    action.destructive && "text-ui-fg-error [&_svg]:text-ui-fg-error",
                  )}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          </Fragment>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

/** A card's header row: title, optional subtitle and badge, the action menu. */
export function SectionHeader({
  title,
  subtitle,
  badge,
  actions,
  level = "h2",
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: Action[][];
  level?: "h1" | "h2";
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">
      <div>
        <Heading level={level}>{title}</Heading>
        {subtitle && (
          <Text size="small" className="text-ui-fg-subtle">
            {subtitle}
          </Text>
        )}
      </div>
      <div className="flex items-center gap-x-2">
        {badge}
        {actions && <ActionMenu groups={actions} />}
      </div>
    </div>
  );
}

/** One read-only value row, the native "General" section look. */
export function KeyValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-start px-6 py-4 text-ui-fg-subtle">
      <Text size="small" weight="plus" leading="compact">
        {label}
      </Text>
      <Text size="small" leading="compact" className="text-pretty text-ui-fg-base">
        {children ?? "—"}
      </Text>
    </div>
  );
}

/** Edit in a drawer: the form in the body, Cancel / Save in the footer. */
export function EditDrawer({
  open,
  onOpenChange,
  title,
  description,
  saving,
  onSave,
  saveLabel = "Save",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  saving?: boolean;
  onSave: () => void;
  saveLabel?: string;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
          {description && <Drawer.Description>{description}</Drawer.Description>}
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">{children}</Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary" disabled={saving}>
              Cancel
            </Button>
          </Drawer.Close>
          <Button size="small" onClick={onSave} isLoading={saving}>
            {saveLabel}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  );
}

/** A field in a drawer form: label, the control, a hint under it. */
export function FormField({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center gap-x-1">
        <Text size="small" weight="plus" leading="compact">
          {label}
        </Text>
        {optional && (
          <Text size="small" leading="compact" className="text-ui-fg-muted">
            (Optional)
          </Text>
        )}
      </div>
      {children}
      {hint && (
        <Text size="xsmall" className="text-ui-fg-subtle">
          {hint}
        </Text>
      )}
    </div>
  );
}

/** An on/off setting in a drawer form: the words on the left, the switch on the right. */
export function SwitchField({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-x-4">
      <div className="flex flex-col gap-y-1">
        <Text size="small" weight="plus" leading="compact">
          {label}
        </Text>
        {hint && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            {hint}
          </Text>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** Loading: the card's shape, breathing — never a blank space. */
export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Skeleton className="h-5 w-40" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-2 px-6 py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </Container>
  );
}

/** A refusal from the API, said plainly in the card it belongs to. */
export function CardError({ title, message }: { title: string; message: string }) {
  return (
    <Container className="divide-y p-0">
      <SectionHeader title={title} />
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {message}
        </Text>
      </div>
    </Container>
  );
}

// ── Words and colours for states ──────────────────────────────────────────

const ORDER_STATUS: Record<string, { label: string; color: "green" | "orange" | "red" | "blue" | "grey" | "purple" }> = {
  pending_payment: { label: "Awaiting payment", color: "orange" },
  awaiting_cod_confirmation: { label: "Awaiting COD confirmation", color: "orange" },
  confirmed: { label: "Confirmed", color: "blue" },
  processing: { label: "Packed · courier booked", color: "blue" },
  shipped: { label: "Shipped", color: "blue" },
  out_for_delivery: { label: "Out for delivery", color: "purple" },
  delivered: { label: "Delivered", color: "green" },
  ndr: { label: "Delivery failed", color: "orange" },
  rto: { label: "Returning to us", color: "red" },
  cancelled: { label: "Cancelled", color: "grey" },
  returned: { label: "Returned", color: "grey" },
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS[status]?.label ?? status.replaceAll("_", " ");
}

export function OrderStatusBadge({ status }: { status: string }) {
  const known = ORDER_STATUS[status];
  return <StatusBadge color={known?.color ?? "grey"}>{orderStatusLabel(status)}</StatusBadge>;
}

/** "customer_unavailable" → "Customer unavailable". */
export function humanize(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Integer paise to the rupee string the cards render. */
export function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** A rupee amount typed by a person → whole paise, or undefined. */
export function rupeesToPaise(raw: string): number | undefined {
  const value = Number(raw.replaceAll(",", "").replace("₹", "").trim());
  if (raw.trim() === "" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
