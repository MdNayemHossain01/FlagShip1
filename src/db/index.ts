import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { FLAGSHIP_SCHEMA_DDL } from './bootstrap.ts';
import * as schema from './schema.ts';

declare global {
  var _flagshipPgPool: Pool | undefined;
  var _flagshipPglite: PGlite | undefined;
  var _flagshipDbReadyPromise: Promise<void> | undefined;
}

const useExternalLocalPostgres = Boolean(
  process.env.DATABASE_URL || process.env.PGHOST || process.env.POSTGRES_HOST
);

export const dbEngineMode: 'postgres-local' | 'pglite-local' = useExternalLocalPostgres
  ? 'postgres-local'
  : 'pglite-local';

function initNodePg(): { pool: Pool; db: NodePgDatabase<typeof schema> } {
  if (!global._flagshipPgPool) {
    global._flagshipPgPool = process.env.DATABASE_URL
      ? new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 10,
          connectionTimeoutMillis: 15000,
        })
      : new Pool({
          host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
          port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
          user: process.env.PGUSER || process.env.POSTGRES_USER || 'flagship_app',
          password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'flagship_dev_pass',
          database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'flagship',
          max: 10,
          connectionTimeoutMillis: 15000,
        });

    global._flagshipPgPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL pool client:', err);
    });
  }

  return {
    pool: global._flagshipPgPool,
    db: drizzleNodePg(global._flagshipPgPool, { schema }),
  };
}

function initEmbeddedPglite(): { client: PGlite; db: NodePgDatabase<typeof schema> } {
  if (!global._flagshipPglite) {
    const dataDir = path.resolve(process.cwd(), process.env.FLAGSHIP_DATA_DIR || '.flagship-data/pgdata');
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    global._flagshipPglite = new PGlite(dataDir);
  }

  const pgliteDb = drizzlePglite(global._flagshipPglite, { schema });
  return {
    client: global._flagshipPglite,
    db: pgliteDb as unknown as NodePgDatabase<typeof schema>,
  };
}

const activeConnection = useExternalLocalPostgres ? initNodePg() : initEmbeddedPglite();

export const db: NodePgDatabase<typeof schema> = activeConnection.db;

export async function ensureDatabaseReady(): Promise<void> {
  if (!global._flagshipDbReadyPromise) {
    global._flagshipDbReadyPromise = (async () => {
      if (useExternalLocalPostgres && global._flagshipPgPool) {
        await global._flagshipPgPool.query(FLAGSHIP_SCHEMA_DDL);
      } else if (global._flagshipPglite) {
        await global._flagshipPglite.waitReady;
        await global._flagshipPglite.exec(FLAGSHIP_SCHEMA_DDL);
      }
    })().catch((err) => {
      global._flagshipDbReadyPromise = undefined;
      throw err;
    });
  }
  return global._flagshipDbReadyPromise;
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errObj = error as { code?: string; cause?: { code?: string } };
  return errObj.code === '23505' || errObj.cause?.code === '23505';
}
