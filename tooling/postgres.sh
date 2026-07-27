#!/usr/bin/env bash
# Local Postgres for development and tests.
#
# Uses the Postgres already on the machine rather than Docker, so it works in
# containers where the Docker daemon is not running. Production points
# DATABASE_URL at Supabase Mumbai instead; nothing here is deployed.
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDATA="${PGDATA:-/var/lib/postgresql/siumora}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-siumora}"

if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "Postgres binaries not found. Install postgresql, or set PGBIN." >&2
  exit 1
fi

case "${1:-start}" in
  start)
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      mkdir -p "$PGDATA"
      chown postgres:postgres "$PGDATA"
      # Trust auth: this cluster is local-only and never exposed.
      su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U $PGUSER --encoding=UTF8 --locale=C" >/dev/null
    fi
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp' -l $PGDATA/log start" || true
    sleep 2
    echo "DATABASE_URL=postgresql://$PGUSER@localhost:$PGPORT/postgres"
    ;;
  stop)
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop" || true
    ;;
  reset)
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop" 2>/dev/null || true
    rm -rf "$PGDATA"
    "$0" start
    ;;
  *)
    echo "usage: $0 {start|stop|reset}" >&2
    exit 1
    ;;
esac
