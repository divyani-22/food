import { describe, it, expect } from "vitest";
import { getTableConfig as getMysqlConfig, MySqlTable } from "drizzle-orm/mysql-core";
import { getTableConfig as getSqliteConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import * as mysqlSchema from "../drizzle/schema";
import * as sqliteSchema from "../drizzle/schema.sqlite";

/**
 * Guards against drift between drizzle/schema.ts (MySQL) and drizzle/schema.sqlite.ts (embedded SQLite).
 * Any schema change must be made in both files (and both migration folders regenerated).
 */

function tables<T>(mod: Record<string, unknown>, cls: new (...a: any[]) => T) {
  const out = new Map<string, { key: string; table: T }>();
  for (const [key, value] of Object.entries(mod)) {
    if (is(value as any, cls as any)) {
      const cfg: any = cls === (MySqlTable as any) ? getMysqlConfig(value as any) : getSqliteConfig(value as any);
      out.set(cfg.name, { key, table: value as T });
    }
  }
  return out;
}

/** Type family: the portable meaning of a column across dialects. */
function family(col: any): string {
  const t: string = col.columnType;
  if (/Boolean/.test(t)) return "boolean";
  if (/Timestamp/.test(t)) return "timestamp";
  if (/Enum/.test(t) || (/Text/.test(t) && col.enumValues)) return "enum";
  if (/Float|Real|Double/.test(t)) return "float";
  if (/Int|Integer|Serial/.test(t)) return "int";
  if (/Varchar|Text|Char/.test(t)) return "text";
  return t;
}

function defaultOf(col: any): string {
  if (!col.hasDefault) return "none";
  const d = col.default;
  if (d === undefined) return "dynamic"; // SQL expression default such as now() / unixepoch()
  if (typeof d === "object" && d !== null && "queryChunks" in d) return "dynamic";
  return JSON.stringify(d);
}

function describeColumns(cfg: any) {
  const out: Record<string, unknown> = {};
  for (const col of cfg.columns) {
    const fam = family(col);
    out[col.name] = {
      family: fam,
      notNull: col.notNull,
      primary: col.primary,
      autoIncrement: col.autoIncrement ?? false,
      unique: col.isUnique ?? false,
      enumValues: fam === "enum" ? col.enumValues : undefined,
      default: defaultOf(col),
    };
  }
  return out;
}

function describeIndexes(cfg: any) {
  return cfg.indexes
    .map((i: any) => ({
      name: i.config.name,
      unique: !!i.config.unique,
      columns: i.config.columns.map((c: any) => c.name),
    }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}

function describeFks(cfg: any) {
  return cfg.foreignKeys
    .map((fk: any) => {
      const ref = fk.reference();
      return {
        columns: ref.columns.map((c: any) => c.name),
        foreignTable: (getMysqlOrSqlite(ref.foreignTable) as any).name,
        foreignColumns: ref.foreignColumns.map((c: any) => c.name),
        onDelete: fk.onDelete ?? "no action",
        onUpdate: fk.onUpdate ?? "no action",
      };
    })
    .sort((a: any, b: any) => a.columns.join().localeCompare(b.columns.join()));
}

function getMysqlOrSqlite(table: any) {
  return is(table, MySqlTable) ? getMysqlConfig(table) : getSqliteConfig(table);
}

const mysqlTables = tables(mysqlSchema as any, MySqlTable as any);
const sqliteTables = tables(sqliteSchema as any, SQLiteTable as any);

describe("schema parity (MySQL vs SQLite)", () => {
  it("defines the same set of tables", () => {
    expect([...sqliteTables.keys()].sort()).toEqual([...mysqlTables.keys()].sort());
    expect(mysqlTables.size).toBeGreaterThan(0);
  });

  it("exports the same table identifiers", () => {
    const keys = (m: Map<string, { key: string }>) => [...m.values()].map(v => v.key).sort();
    expect(keys(sqliteTables)).toEqual(keys(mysqlTables));
  });

  for (const [name, my] of mysqlTables) {
    describe(name, () => {
      const lite = sqliteTables.get(name);

      it("exists in the SQLite schema", () => {
        expect(lite).toBeDefined();
      });

      it("has the same columns (name, type family, nullability, defaults, keys)", () => {
        if (!lite) return;
        const a = describeColumns(getMysqlConfig(my.table as any));
        const b = describeColumns(getSqliteConfig(lite.table as any));
        expect(b).toEqual(a);
      });

      it("has the same indexes and unique constraints", () => {
        if (!lite) return;
        const a = getMysqlConfig(my.table as any);
        const b = getSqliteConfig(lite.table as any);
        // Column-level .unique() becomes a unique constraint in MySQL and a unique index in SQLite;
        // both are compared through the per-column "unique" flag above, so only explicit indexes are compared here.
        expect(describeIndexes(b)).toEqual(describeIndexes(a));
        expect(b.uniqueConstraints.length).toBe(a.uniqueConstraints.length);
      });

      it("has the same foreign keys and ON DELETE behavior", () => {
        if (!lite) return;
        const a = describeFks(getMysqlConfig(my.table as any));
        const b = describeFks(getSqliteConfig(lite.table as any));
        expect(b).toEqual(a);
      });
    });
  }
});
