# PostgreSQL backup and transfer

Ce script sert a recuperer un backup complet d'une base PostgreSQL, puis a injecter ses donnees dans une autre base qui possede deja les memes tables et colonnes.

Les URLs de base de donnees contiennent des secrets. Ne les mettez jamais dans Git, `.env.example`, un README public ou un ticket. Passez-les uniquement en variables d'environnement au moment de l'execution.

## Prerequis

Le script utilise automatiquement les clients PostgreSQL locaux s'ils sont disponibles:

- `pg_dump`
- `pg_restore`
- `psql`

S'ils ne sont pas installes, il peut utiliser Docker avec l'image officielle PostgreSQL. Pour forcer Docker:

```bash
POSTGRES_CLIENT_MODE=docker \
SOURCE_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DB' \
  npm run db:backup-transfer -- backup
```

L'image Docker utilisee par defaut est `postgres:17-alpine`. Si la version de PostgreSQL du serveur exige une autre version de client:

```bash
POSTGRES_CLIENT_IMAGE=postgres:16-alpine npm run db:backup-transfer -- backup
```

Sur macOS, pour installer les clients localement au lieu d'utiliser Docker:

```bash
brew install libpq
```

Puis ajouter `libpq` au `PATH` si Homebrew ne l'a pas deja fait.

## Backup source uniquement

```bash
SOURCE_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DB' \
  npm run db:backup-transfer -- backup
```

Le dump est cree par defaut dans `backups/postgres/`, avec:

- le fichier `.dump` au format custom PostgreSQL;
- un inventaire `.dump.list`;
- un checksum `.dump.sha256` si `sha256sum` ou `shasum` est disponible.

## Restore vers la base B

Quand la base B est definie:

```bash
TARGET_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DB_B' \
BACKUP_FILE='./backups/postgres/backup_YYYYMMDDTHHMMSSZ.dump' \
  npm run db:backup-transfer -- restore
```

Par defaut, `RESTORE_MODE=append`: les donnees sont ajoutees aux tables existantes. Si la base cible contient deja des lignes avec les memes cles primaires ou contraintes uniques, PostgreSQL arretera la restauration.

## Remplacer les donnees cible

Pour vider les tables du schema cible avant d'injecter les donnees:

```bash
TARGET_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DB_B' \
BACKUP_FILE='./backups/postgres/backup_YYYYMMDDTHHMMSSZ.dump' \
RESTORE_MODE=replace \
CONFIRM_REPLACE=true \
  npm run db:backup-transfer -- restore
```

Le mode `replace` execute un `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` sur toutes les tables du schema `public` par defaut.

Pour un autre schema:

```bash
SCHEMA_NAME='mon_schema' RESTORE_MODE=replace CONFIRM_REPLACE=true npm run db:backup-transfer -- restore
```

## Backup puis restore direct

```bash
SOURCE_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DB_SOURCE' \
TARGET_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DB_B' \
  npm run db:backup-transfer -- sync
```

Cette commande cree toujours un dump local avant de restaurer. Elle refuse de continuer si la source et la cible ont exactement la meme URL.

## Notes operationnelles

- Le dump est complet, mais la restauration utilise `pg_restore --data-only`, car la base B est supposee avoir le meme schema.
- Pour une base cible non vide, preferer `RESTORE_MODE=replace` apres avoir sauvegarde la cible.
- `DISABLE_TRIGGERS=true` ajoute `pg_restore --disable-triggers`, utile pour certaines contraintes, mais necessite souvent des droits eleves PostgreSQL.
