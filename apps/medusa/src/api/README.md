# Custom API routes

Medusa file-based routes land here (`store/`, `admin/`). The M2 ops surface
(`/admin/metrics`, `/admin/gstr1`, …) and the order-number/accessKey routes
are built in this tree. Empty at M0 by design — the scaffold must boot clean
before it carries behavior.
