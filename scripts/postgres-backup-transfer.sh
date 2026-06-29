#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

COMMAND="${1:-}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
BACKUP_FILE="${BACKUP_FILE:-}"
RESTORE_MODE="${RESTORE_MODE:-append}"
SCHEMA_NAME="${SCHEMA_NAME:-public}"
CONFIRM_REPLACE="${CONFIRM_REPLACE:-false}"
DISABLE_TRIGGERS="${DISABLE_TRIGGERS:-false}"
POSTGRES_CLIENT_MODE="${POSTGRES_CLIENT_MODE:-auto}"
POSTGRES_CLIENT_IMAGE="${POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"
POSTGRES_CLIENT_ACTIVE_MODE=""

usage() {
  cat <<'EOF'
Usage:
  npm run db:backup-transfer -- backup
  npm run db:backup-transfer -- restore
  npm run db:backup-transfer -- sync

Commands:
  backup   Cree un dump complet depuis SOURCE_DATABASE_URL.
  restore  Restaure les donnees du dump vers TARGET_DATABASE_URL.
  sync     Fait backup puis restore dans la meme execution.

Variables:
  SOURCE_DATABASE_URL   URL Postgres source. Requise pour backup/sync.
  TARGET_DATABASE_URL   URL Postgres cible. Requise pour restore/sync.
  BACKUP_FILE           Chemin du dump a creer ou restaurer. Optionnel pour backup/sync, requis pour restore.
  BACKUP_DIR            Dossier de sortie si BACKUP_FILE n'est pas defini. Defaut: backups/postgres.
  RESTORE_MODE          append | replace. Defaut: append.
  SCHEMA_NAME           Schema cible a vider en mode replace. Defaut: public.
  CONFIRM_REPLACE       Mettre true pour autoriser RESTORE_MODE=replace.
  DISABLE_TRIGGERS      Mettre true pour pg_restore --disable-triggers si l'utilisateur cible a les droits.
  POSTGRES_CLIENT_MODE  auto | local | docker. Defaut: auto.
  POSTGRES_CLIENT_IMAGE Image Docker utilisee en mode docker. Defaut: postgres:17-alpine.

Exemples:
  SOURCE_DATABASE_URL='postgres://...' npm run db:backup-transfer -- backup
  TARGET_DATABASE_URL='postgres://...' BACKUP_FILE='./backups/postgres/source.dump' npm run db:backup-transfer -- restore
  SOURCE_DATABASE_URL='postgres://...' TARGET_DATABASE_URL='postgres://...' npm run db:backup-transfer -- sync
  POSTGRES_CLIENT_MODE=docker SOURCE_DATABASE_URL='postgres://...' npm run db:backup-transfer -- backup
EOF
}

log() {
  printf '[postgres-transfer] %s\n' "$*"
}

fail() {
  printf '[postgres-transfer] ERREUR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

has_local_postgres_clients() {
  require_command pg_dump && require_command pg_restore && require_command psql
}

select_postgres_client() {
  case "$POSTGRES_CLIENT_MODE" in
    auto)
      if has_local_postgres_clients; then
        POSTGRES_CLIENT_ACTIVE_MODE="local"
      elif require_command docker; then
        POSTGRES_CLIENT_ACTIVE_MODE="docker"
      else
        fail "Clients PostgreSQL introuvables et Docker introuvable. Installez PostgreSQL client ou Docker, puis relancez."
      fi
      ;;
    local)
      has_local_postgres_clients || fail "Clients PostgreSQL introuvables. Sur macOS: brew install libpq puis ajoutez libpq au PATH, ou utilisez POSTGRES_CLIENT_MODE=docker."
      POSTGRES_CLIENT_ACTIVE_MODE="local"
      ;;
    docker)
      require_command docker || fail "Docker est introuvable. Installez Docker ou utilisez POSTGRES_CLIENT_MODE=local avec pg_dump/pg_restore/psql installes."
      POSTGRES_CLIENT_ACTIVE_MODE="docker"
      ;;
    *)
      fail "POSTGRES_CLIENT_MODE invalide: $POSTGRES_CLIENT_MODE. Valeurs acceptees: auto, local, docker."
      ;;
  esac

  if [ "$POSTGRES_CLIENT_ACTIVE_MODE" = "docker" ]; then
    log "Client PostgreSQL: docker ($POSTGRES_CLIENT_IMAGE)"
  else
    log "Client PostgreSQL: local"
  fi
}

docker_postgres_client() {
  docker run --rm -i "$POSTGRES_CLIENT_IMAGE" "$@"
}

run_psql() {
  if [ "$POSTGRES_CLIENT_ACTIVE_MODE" = "local" ]; then
    psql "$@"
  else
    docker_postgres_client psql "$@"
  fi
}

run_pg_dump_to_file() {
  local file="$1"
  shift

  if [ "$POSTGRES_CLIENT_ACTIVE_MODE" = "local" ]; then
    pg_dump --file "$file" "$@"
  else
    docker_postgres_client pg_dump "$@" > "$file"
  fi
}

run_pg_restore_list() {
  local file="$1"

  if [ "$POSTGRES_CLIENT_ACTIVE_MODE" = "local" ]; then
    pg_restore --list "$file"
  else
    docker_postgres_client pg_restore --list < "$file"
  fi
}

run_pg_restore_from_file() {
  local file="$1"
  shift

  if [ "$POSTGRES_CLIENT_ACTIVE_MODE" = "local" ]; then
    pg_restore "$@" "$file"
  else
    docker_postgres_client pg_restore "$@" < "$file"
  fi
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "$name est requis. Passez-le en variable d'environnement, sans le committer."
  fi
}

write_checksum() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" > "$file.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" > "$file.sha256"
  else
    log "Checksum ignore: sha256sum/shasum introuvable."
  fi
}

resolve_backup_file() {
  if [ -n "$BACKUP_FILE" ]; then
    printf '%s\n' "$BACKUP_FILE"
    return
  fi

  mkdir -p "$BACKUP_DIR"
  printf '%s/backup_%s.dump\n' "$BACKUP_DIR" "$(date -u +%Y%m%dT%H%M%SZ)"
}

assert_not_same_database() {
  if [ "${SOURCE_DATABASE_URL:-}" = "${TARGET_DATABASE_URL:-}" ]; then
    fail "SOURCE_DATABASE_URL et TARGET_DATABASE_URL pointent vers la meme valeur. Abandon pour eviter d'ecraser la source."
  fi
}

validate_schema_name() {
  case "$SCHEMA_NAME" in
    ''|*[!A-Za-z0-9_]*)
      fail "SCHEMA_NAME invalide: $SCHEMA_NAME. Utilisez un nom de schema PostgreSQL simple, par exemple public."
      ;;
  esac
}

backup_source() {
  require_env SOURCE_DATABASE_URL

  local file
  file="$(resolve_backup_file)"
  mkdir -p "$(dirname -- "$file")"
  local tmp_file="$file.tmp.$$"

  log "Creation du dump complet source vers: $file"
  if ! run_pg_dump_to_file "$tmp_file" \
    --format=custom \
    --blobs \
    --no-owner \
    --no-privileges \
    "$SOURCE_DATABASE_URL"; then
    rm -f "$tmp_file"
    fail "Creation du dump echouee."
  fi
  mv "$tmp_file" "$file"

  run_pg_restore_list "$file" > "$file.list"
  write_checksum "$file"

  log "Backup termine: $file"
  log "Inventaire: $file.list"
  [ -f "$file.sha256" ] && log "Checksum: $file.sha256"

  BACKUP_FILE="$file"
}

target_table_list() {
  validate_schema_name
  run_psql "$TARGET_DATABASE_URL" \
    --no-align \
    --tuples-only \
    --quiet \
    --set=ON_ERROR_STOP=1 \
    --command="SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename) FROM pg_tables WHERE schemaname = '$SCHEMA_NAME';"
}

truncate_target_schema() {
  local tables
  tables="$(target_table_list)"

  if [ -z "$tables" ]; then
    log "Aucune table a tronquer dans le schema $SCHEMA_NAME."
    return
  fi

  log "Vidage du schema $SCHEMA_NAME sur la cible avant restauration."
  run_psql "$TARGET_DATABASE_URL" \
    --quiet \
    --set=ON_ERROR_STOP=1 \
    --command="TRUNCATE TABLE $tables RESTART IDENTITY CASCADE;"
}

restore_target() {
  require_env TARGET_DATABASE_URL
  [ -n "$BACKUP_FILE" ] || fail "BACKUP_FILE est requis pour restore, sauf avec la commande sync."
  [ -f "$BACKUP_FILE" ] || fail "Dump introuvable: $BACKUP_FILE"

  run_psql "$TARGET_DATABASE_URL" --quiet --set=ON_ERROR_STOP=1 --command="SELECT 1;" >/dev/null

  case "$RESTORE_MODE" in
    append)
      log "Restauration en mode append: les lignes sont ajoutees aux tables existantes."
      ;;
    replace)
      [ "$CONFIRM_REPLACE" = "true" ] || fail "RESTORE_MODE=replace exige CONFIRM_REPLACE=true."
      truncate_target_schema
      ;;
    *)
      fail "RESTORE_MODE invalide: $RESTORE_MODE. Valeurs acceptees: append, replace."
      ;;
  esac

  local restore_args=(
    --data-only
    --no-owner
    --no-privileges
    --single-transaction
    --exit-on-error
    --dbname "$TARGET_DATABASE_URL"
  )

  if [ "$DISABLE_TRIGGERS" = "true" ]; then
    restore_args+=(--disable-triggers)
  fi

  log "Restauration des donnees depuis: $BACKUP_FILE"
  run_pg_restore_from_file "$BACKUP_FILE" "${restore_args[@]}"
  log "Restauration terminee."
}

main() {
  case "$COMMAND" in
    backup|restore|sync)
      ;;
    -h|--help|help|'')
      usage
      exit 0
      ;;
    *)
      usage
      fail "Commande inconnue: $COMMAND"
      ;;
  esac

  select_postgres_client

  case "$COMMAND" in
    backup)
      backup_source
      ;;
    restore)
      restore_target
      ;;
    sync)
      require_env SOURCE_DATABASE_URL
      require_env TARGET_DATABASE_URL
      assert_not_same_database
      backup_source
      restore_target
      ;;
  esac
}

main "$@"
