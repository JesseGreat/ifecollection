#!/usr/bin/env bash
# Start a throw-away local Postgres for the database tests (no Docker needed).
# Usage: scripts/local-pg.sh start|stop|status
# Then:  TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/pg_ctl" ] || PGBIN="$(dirname "$(command -v pg_ctl)")"
DATA="${PGDATA_DIR:-.pgdata}"
PORT="${PGPORT:-54329}"

case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 >/dev/null
    fi
    "$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
      -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c timezone=UTC" start
    echo "Postgres running: postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)   "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  status) "$PGBIN/pg_ctl" -D "$DATA" status ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
