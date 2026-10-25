import {
  MAX_NOTIFICATION_ATTEMPTS,
  MAX_SEND_ATTEMPTS,
  claimDueNotifications,
  claimPendingTrackingEvents,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped,
  markTrackingEventFailed,
  markTrackingEventSent,
  reclaimStalledNotifications,
  reclaimStalledTrackingEvents,
  type Database,
} from "@siumora/db";
import type { Channel } from "@siumora/core";

/**
 * Where the outbox lives (plan 16 Phase G).
 *
 * The drains — claim, send, record, back off — are the part of the worker
 * worth keeping, and they do not care which database holds the queue. Two
 * stores implement the same handful of operations with the same semantics:
 * the Fastify ledger (`tracking_events`, `notifications`, via @siumora/db)
 * and the Medusa outbox (`siumora_tracking_events`, `siumora_notifications`,
 * medusa-store.ts). The worker picks one at startup; at the launch gate the
 * Fastify store goes with Fastify.
 */

/** Where a conversion goes. Owned here, not by @siumora/db, so the worker outlives Fastify. */
export type TrackingDestination = "ga4" | "meta";

export interface ConversionRow {
  readonly id: string;
  readonly destination: string;
  readonly attempts: number;
  readonly payload: unknown;
}

export interface MessageRow {
  readonly id: string;
  readonly templateKey: string;
  readonly recipient: string;
  readonly variables: unknown;
  readonly attempts: number;
}

export interface FailOptions {
  error?: string;
  permanent?: boolean;
  now?: Date;
}

export interface OutboxStore {
  readonly name: string;
  readonly maxConversionAttempts: number;
  readonly maxMessageAttempts: number;
  reclaimConversions(now: Date): Promise<number>;
  claimConversions(limit: number, now: Date): Promise<ConversionRow[]>;
  markConversionSent(id: string, now: Date): Promise<void>;
  markConversionFailed(id: string, options: FailOptions): Promise<void>;
  reclaimMessages(now: Date): Promise<number>;
  claimMessages(limit: number, now: Date): Promise<MessageRow[]>;
  markMessageSent(id: string, options: { channel: Channel; providerMessageId?: string; now?: Date }): Promise<void>;
  markMessageSkipped(id: string, reason: string): Promise<void>;
  markMessageFailed(id: string, options: FailOptions): Promise<void>;
}

/** The Fastify ledger, through the @siumora/db repositories it always used. */
export function drizzleStore(db: Database): OutboxStore {
  return {
    name: "fastify",
    maxConversionAttempts: MAX_SEND_ATTEMPTS,
    maxMessageAttempts: MAX_NOTIFICATION_ATTEMPTS,
    reclaimConversions: (now) => reclaimStalledTrackingEvents(db, now),
    claimConversions: (limit, now) => claimPendingTrackingEvents(db, limit, now),
    markConversionSent: (id, now) => markTrackingEventSent(db, id, now),
    markConversionFailed: (id, options) => markTrackingEventFailed(db, id, options),
    reclaimMessages: (now) => reclaimStalledNotifications(db, now),
    claimMessages: (limit, now) => claimDueNotifications(db, limit, now),
    markMessageSent: (id, options) => markNotificationSent(db, id, options),
    markMessageSkipped: (id, reason) => markNotificationSkipped(db, id, reason),
    markMessageFailed: (id, options) => markNotificationFailed(db, id, options),
  };
}
