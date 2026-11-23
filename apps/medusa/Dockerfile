# Medusa server and worker (plan 18 L2.2). One image, two roles:
#   MEDUSA_WORKER_MODE=server  — the HTTP API, admin dashboard, webhooks
#   MEDUSA_WORKER_MODE=worker  — scheduled jobs (payment and GST recon, cart
#                                reminders) and event subscribers
# Migrations run as a one-off of the same image:
#   docker run --rm --env-file prod.env <image> npx medusa db:migrate
#
# Built from the repository root:
#   docker build -f apps/medusa/Dockerfile -t siumora-medusa .
#
# Medusa's build output names workspace packages (`workspace:*`), so it cannot
# be installed on its own. The image keeps the pnpm workspace and runs
# `medusa start` from source — the same source-run the README documents —
# with the admin bundle the build copies into apps/medusa/public/admin.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# The whole workspace (trimmed by .dockerignore): pnpm's frozen install needs
# every importer the lockfile names, and the build needs the shared packages.
COPY . .
RUN pnpm install --frozen-lockfile

# Builds @siumora/core, analytics and messaging first (turbo ^build), then
# the server and the admin bundle.
RUN pnpm turbo run build --filter=@siumora/medusa

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/medusa
EXPOSE 9000
# Only the server answers HTTP; a worker-mode container should override or
# disable this check on the host.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://localhost:9000/health || exit 1
CMD ["npx", "medusa", "start"]
