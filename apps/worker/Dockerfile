# The outbox worker (plan 18 L2.2): drains the Medusa outbox to WhatsApp/SMS,
# GA4 and Meta CAPI. No HTTP port; one long-running process.
#
# Built from the repository root:
#   docker build -f apps/worker/Dockerfile -t siumora-worker .
# Needs MEDUSA_DATABASE_URL (OUTBOX_BACKEND defaults to medusa) plus the
# provider credentials in .env.example's worker block.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# The worker runs its TypeScript directly (strip-types); its workspace
# dependencies are imported from their built dist/.
RUN pnpm turbo run build --filter=@siumora/worker

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/worker
CMD ["node", "--experimental-strip-types", "src/main.ts"]
