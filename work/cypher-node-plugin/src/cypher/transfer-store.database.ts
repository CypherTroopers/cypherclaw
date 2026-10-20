import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Compilable,
} from "kysely";
import { TRANSFER_SCHEMA, type TransferDatabase } from "./transfer-store.schema.js";

// Kysely owns row SQL; execution stays synchronous inside this worker's transactions.
const dialect = {
  createAdapter: () => new SqliteAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
  createQueryCompiler: () => new SqliteQueryCompiler(),
};
const queries = new WeakMap<DatabaseSync, Kysely<TransferDatabase>>();
export function getTransferQueries(db: DatabaseSync): Kysely<TransferDatabase> {
  let query = queries.get(db);
  if (!query) {
    query = new Kysely<TransferDatabase>({ dialect });
    queries.set(db, query);
  }
  return query;
}

export function executeSqliteQuerySync<R>(db: DatabaseSync, query: Compilable<R>) {
  const compiled = query.compile();
  return {
    rows: db.prepare(compiled.sql).all(...(compiled.parameters as SQLInputValue[])) as R[],
  };
}
export function executeSqliteQueryTakeFirstSync<R>(db: DatabaseSync, query: Compilable<R>) {
  return executeSqliteQuerySync(db, query).rows[0];
}

/** Admission runs once per worker connection; incompatible stores are preserved. */
export function openTransferDatabase(filename: string, create: boolean): DatabaseSync | undefined {
  if (!create && !existsSync(filename)) {
    return undefined;
  }
  if (create) {
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(filename);
  try {
    db.exec("PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;");
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 0) {
      if (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").get()) {
        throw new Error(
          "The Cypher transfer database has an unrecognized schema. Preserve it and restore its matching plugin.",
        );
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(TRANSFER_SCHEMA);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } else if (version !== 1) {
      throw new Error(
        "The Cypher transfer database requires its matching plugin version. Its data was preserved.",
      );
    }
    if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") {
      throw new Error(
        "The Cypher transfer database failed its integrity check. Preserve it for recovery.",
      );
    }
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    chmodSync(filename, 0o600);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
