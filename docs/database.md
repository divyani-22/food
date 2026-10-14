# Database

IngreScan-AI runs with no database setup. The app picks its database from `DATABASE_URL`:

| `DATABASE_URL` | Database used |
| --- | --- |
| unset or empty | Embedded SQLite file (zero-config default) |
| `file:...` or `sqlite:...` | Embedded SQLite file at that path |
| `mysql://user:pass@host:3306/dbname` | MySQL / MariaDB (the production path) |

## Zero-config default (SQLite)

`git clone && cd IngreScan-AI && pnpm install && pnpm dev` works with no environment variables and no MySQL.

- The database file is `IngreScan-AI/data/ingrescan.db`. The `data/` directory is created automatically and is git-ignored.
- Override the location with `SQLITE_PATH=/some/path/app.db`, or with `DATABASE_URL=file:/some/path/app.db` (an explicit `DATABASE_URL` wins over `SQLITE_PATH`). Relative paths are resolved from the directory the server is started in (`IngreScan-AI/`).
- On every start the server applies any pending migrations from `drizzle-sqlite/` and logs `Using embedded SQLite database at <path>`. A fresh file and an already-migrated file both start cleanly.
- The driver is `@libsql/client`, which installs from npm with no native build step (works on Windows). Foreign keys are enabled on every connection, so `ON DELETE CASCADE` behaves as on MySQL.
- Development without `JWT_SECRET`: a random secret is generated once and stored in `data/.dev-secret` (git-ignored, mode 0600) so sessions survive restarts. In production (`NODE_ENV=production`) a missing `JWT_SECRET` is a startup error.

Backup tip: stop the server (or use SQLite's online backup) and copy `data/ingrescan.db`. The database runs in WAL mode, so while the server is running copy it with `sqlite3 data/ingrescan.db ".backup backup.db"` rather than a plain file copy, or copy the `-wal` and `-shm` files together with the main file.

## Using MySQL

Set `DATABASE_URL` to a `mysql://` URL (for example in `IngreScan-AI/.env`) and create the schema once:

```bash
cd IngreScan-AI
DATABASE_URL=mysql://user:pass@127.0.0.1:3306/ingrescan pnpm db:push   # generate + migrate
# or, to only apply the committed migrations:
DATABASE_URL=mysql://user:pass@127.0.0.1:3306/ingrescan npx drizzle-kit migrate
```

MySQL migrations live in `drizzle/` and are never applied automatically.

## Migration commands

| Dialect | Schema file | Config | Migrations folder | Generate | Apply |
| --- | --- | --- | --- | --- | --- |
| MySQL | `drizzle/schema.ts` | `drizzle.config.ts` | `drizzle/` | `npx drizzle-kit generate` | `npx drizzle-kit migrate` (or `pnpm db:push` for both steps) |
| SQLite | `drizzle/schema.sqlite.ts` | `drizzle.sqlite.config.ts` | `drizzle-sqlite/` | `pnpm db:generate:sqlite` | automatic on server start |

## Rule: every schema change goes in BOTH places

When you change the data model:

1. Edit `drizzle/schema.ts` (MySQL) **and** `drizzle/schema.sqlite.ts` (SQLite) identically: same tables, column names, nullability, defaults, indexes, unique constraints and foreign keys.
2. Generate a migration for each dialect (`npx drizzle-kit generate` and `pnpm db:generate:sqlite`) and commit both migration folders (`drizzle/` and `drizzle-sqlite/`).
3. If you add a query that is not plain portable SQL (upserts, `insertId`, case-sensitive comparisons, raw SQL), put the dialect difference in `server/_core/database.ts` rather than branching in the routers.

The vitest test `server/schema.parity.test.ts` fails when the two schema files drift (table names, column names, type family, nullability, defaults, enum values, indexes, unique constraints, foreign keys and `ON DELETE` actions). `server/db.sqlite.test.ts` runs the real `server/db.ts` functions against a real temporary SQLite file, including the migrations.

## Behavior differences between dialects

- Timestamps: SQLite stores Unix seconds (like MySQL `TIMESTAMP` they have one-second resolution). Lists that sort by time also sort by `id` to break ties.
- `updatedAt` columns: MySQL updates them with `ON UPDATE CURRENT_TIMESTAMP`; on SQLite drizzle's `$onUpdate` and explicit values in `server/db.ts` do the same. Raw SQL updates that bypass drizzle do not touch `updatedAt` on SQLite.
- Text matching: MySQL's default collation is case-insensitive; SQLite is case-sensitive. The ingredient cache lookup (`getIngredientByName`, `upsertIngredient`) explicitly ignores case on SQLite. Other lookups are by numeric id or opaque OpenID and are exact on both.
- Column length limits (`varchar(255)` and so on) are not enforced by SQLite.
- Data is not migrated between dialects automatically; switching `DATABASE_URL` starts with the target database's own contents.

## End-to-end scripts

`e2e/full-journey.mjs` and `e2e/produce-isolation.mjs` use `e2e/lib/db.mjs`, which talks to MySQL through the `mysql` CLI when `DATABASE_URL` is `mysql://...` and otherwise reads the SQLite file (`SQLITE_PATH`, default `IngreScan-AI/data/ingrescan.db`) through Python's `sqlite3`. Point the scripts at a non-default server with `BASE_URL`.

## Before migrating an existing MySQL database

Migrations 0003 and 0004 delete rows that would violate the new constraints: duplicate `user_profiles` (the newest row is kept), and orphan `scan_ingredients`, `alternatives` and `chat_messages`. Check first, and save those rows:

```
cd IngreScan-AI
pnpm db:backup-check      # dry run: counts the rows that would be deleted
pnpm db:migrate:safe      # saves them to backups/pre-migrate-<time>.json, then runs drizzle-kit migrate
```

This only saves the rows that would be deleted. Take a full `mysqldump` as well. The embedded SQLite database never deletes rows during migration.
