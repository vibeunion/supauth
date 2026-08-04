import { expect, test } from 'bun:test';
import postgres from 'postgres';

test('postgres sql.file fails explicitly in the Edge Runtime build', async () => {
  const sql = postgres('postgres://127.0.0.1:1/unused');
  let fileError: unknown;

  try {
    await sql.file('/tmp/query.sql');
  } catch (error) {
    fileError = error;
  } finally {
    await sql.end({ timeout: 0 });
  }

  expect(fileError).toBeInstanceOf(Error);
  expect((fileError as Error).message).toBe(
    'postgres.sql.file() is unavailable in the SupaCloud Edge Runtime',
  );
});
