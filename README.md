# Siumora

Single-vendor e-commerce platform for the Indian market. Demi-fine jewellery,
₹1,500–10,000, built to the architecture in [`plan/`](plan/) and the identity in
[`brand-kit/`](brand-kit/).

## Status

Phase 0 (foundation) and the storefront half of Phase 1 are in. The commerce
engine, payments, and logistics are not built yet — see
[`plan/12-roadmap-costs.md`](plan/12-roadmap-costs.md) for the full phasing.

| Area | State |
|---|---|
| Turborepo + pnpm monorepo | done |
| Design system from brand kit | done |
| ₹ formatting, pincode, GST math | done, unit-tested |
| Storefront: home, PLP, PDP | done, renders from a typed fixture |
| Cart / checkout / Razorpay | not started (Phase 2) |
| Medusa API, orders, logistics | not started (Phase 2–3) |

## Layout

```
apps/
  web/            Next.js 16 storefront (App Router, React Compiler, Tailwind v4)
packages/
  ui/             Design system — brand tokens, logo lockups, primitives
  core/           Domain types, Zod schemas, GST engine
  in-locale/      ₹ formatting, Indian states, pincode validation
  config-ts/      Shared tsconfig bases
plan/             Architecture and roadmap documents
brand-kit/        Brand guidelines, logo, tokens, pattern, motion
```

## Getting started

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
pnpm dev          # storefront on http://localhost:3000
```

```bash
pnpm build        # production build, all workspaces
pnpm typecheck    # strict tsc across the monorepo
pnpm test         # unit tests
```

## Brand rules that are enforced in code

The design system encodes the guidelines so they cannot drift:

- **Body is always Kohl Ink on Kagaz Ivory** — set in the base layer, not per page.
- **Mulberry is the one accent per view.** It is the only colour on buttons, the
  focus ring, and the discount chip.
- **Brass is foil only** — a hairline rule or the kernel of the mark. Never a
  large fill, never a gradient.
- **The mark swaps below 24px.** `SiumoraMark` thickens the stroke and grows the
  kernel automatically so small sizes stay legible. 16px is the floor.
- **The lattice never carries the logo.** The jaali band is the pattern the mark
  is made of, so it holds copy instead.
- **Tracked caps settings are for capitals only.** `MicroLabel` and
  `CollectionTitle` bundle the tracking with `uppercase` so the two cannot separate.

Colour and type values live in
[`brand-kit/03-colour-type/siumora-tokens.json`](brand-kit/03-colour-type/siumora-tokens.json)
and are mirrored into `packages/ui/src/theme.css`. Change the brand kit first.

## Money

All money is **paise** (integer minor units) end to end; formatting happens only
at the edge via `@siumora/in-locale`. Displayed prices are **inclusive of GST** —
`extractGst` pulls the tax back out of the price rather than adding it on top,
which is what the invoice and the Legal Metrology rules require.

## Catalog data

`apps/web/src/lib/catalog.ts` reads a local fixture, validated by the Zod schemas
in `@siumora/core` at module load. It is the seam for Medusa: when `apps/api`
comes up, those function bodies call the SDK and every caller keeps working.
