# Registering the `audit` module

Registered in `medusa-config.ts` as part of the M2 wave-B ops surface. This
file records what the config owner needs to know.

## 1. medusa-config.ts snippet

```ts
{
  // Operator audit log (M2 wave B): every /admin/siumora write route
  // testifies here. The table stores the full actor contact for
  // accountability; every read masks it (module audit.ts).
  resolve: "./src/modules/audit",
},
```

## 2. Migration

`pnpm db:migrate` picks up `migrations/Migration20260826090000.ts`, which
creates `siumora_audit_log` (id, actor_id, actor_contact, actor_role,
action, subject, detail jsonb, ip, timestamps). Idempotent
(`create table if not exists`). Hand-written — **no MikroORM snapshot**; do
not run `medusa db:generate` against it; write further migrations by hand.

## 3. Semantics

- Writes go through `data.ts recordAudit`, which never throws to its caller:
  the action it records has already happened (Fastify `audit()` posture — a
  failed write is logged loudly instead).
- Reads go through `data.ts readAudit` (newest first, limit 200) and every
  entry passes `audit.ts auditEntry`, which masks the actor contact
  (`maskActorContact`: phones via core `maskPhone`, emails keep first char +
  domain). Parity row: "shows an operator the log without the phone numbers".
- The action vocabulary is core's `AuditAction` (closed list); the route
  offers no way to change or delete an entry.

## 4. Endpoints

`GET /admin/siumora/audit` (operator gate, `audit:read` — owner only) serves
`{ entries: [...] }`, `Cache-Control: no-store`. Target for
`SiumoraClient.getAuditLog()`.
