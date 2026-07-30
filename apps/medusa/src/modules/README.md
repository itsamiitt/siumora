# Siumora modules

The India commerce modules from the design doc land here in M2: `gst`,
`cod-rto`, `returns-ndr`, `privacy`, `settings`, `audit-log`, `operator`.
Each owns its tables in the shared `siumora` schema (owned by our migration
chain, not MikroORM). Empty at M0 by design.
