// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { maskPhone } from "@siumora/core";

/**
 * Pure audit logic — no Medusa imports, so node --test can strip-type it
 * (settings module convention). The vocabulary (AuditAction, the closed
 * list) is core's; this file owns the masking and the read envelope.
 */

/**
 * Mask an actor's contact for the read envelope.
 *
 * A phone masks through core's maskPhone (which itself collapses anything
 * that is not a 10-digit number to "••••"). An email keeps its first
 * character and its domain — enough to tell operators apart on the screen,
 * not enough to shoulder-surf an address.
 */
export function maskActorContact(contact: string): string {
  const at = contact.indexOf("@");
  if (at > 0) {
    return `${contact[0]}…@${contact.slice(at + 1)}`;
  }
  return maskPhone(contact);
}

/** The stored row, as the raw SQL read returns it. */
export interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_contact: string;
  actor_role: string;
  action: string;
  subject: string | null;
  detail: unknown;
  ip: string | null;
  created_at: string | Date;
}

/**
 * The read envelope, one entry — camelCase, `actorPhone` masked. The field
 * is named actorPhone (not actorContact) because that is what the Fastify
 * /admin/audit serves and what the ops dashboard renders; on this stack it
 * may carry a masked email instead.
 */
export function auditEntry(row: AuditRow): {
  id: string;
  actorId: string | null;
  actorPhone: string;
  actorRole: string;
  action: string;
  subject: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string | Date;
} {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorPhone: maskActorContact(row.actor_contact),
    actorRole: row.actor_role,
    action: row.action,
    subject: row.subject,
    detail: row.detail,
    ip: row.ip,
    createdAt: row.created_at,
  };
}
