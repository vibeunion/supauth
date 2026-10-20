import { afterEach, describe, expect, test } from 'bun:test';
import { closeDb, getDb, getSql } from '../db/index.js';

const databaseUrl = 'postgres://user:password@127.0.0.1:1/supaoauth';

afterEach(async () => {
  await closeDb().catch(() => {});
  delete process.env['SUPACLOUD_DATABASE_URL'];
  delete process.env['DATABASE_URL'];
});

describe('Bun SQL database connection', () => {
  test('uses the configured Bun SQL connection options', async () => {
    process.env['DATABASE_URL'] = databaseUrl;

    const sql = getSql();
    const options = sql.options as {
      max?: number;
      idleTimeout?: number;
      connectionTimeout?: number;
    };

    expect(options.max).toBe(10);
    expect(options.idleTimeout).toBe(20_000);
    expect(options.connectionTimeout).toBe(2_000);
    await closeDb();
  });

  test('reuses one SQL client and one Drizzle database', async () => {
    process.env['DATABASE_URL'] = databaseUrl;

    expect(getSql()).toBe(getSql());
    expect(getDb()).toBe(getDb());
    await closeDb();
  });

  test('clears state when closing fails and rebuilds on the next access', async () => {
    process.env['DATABASE_URL'] = databaseUrl;

    const firstSql = getSql();
    const originalClose = firstSql.close.bind(firstSql);
    firstSql.close = async () => {
      throw new Error('close failed');
    };

    await expect(closeDb()).rejects.toThrow('close failed');
    expect(getSql()).not.toBe(firstSql);
    await closeDb();
    firstSql.close = originalClose;
  });
});
