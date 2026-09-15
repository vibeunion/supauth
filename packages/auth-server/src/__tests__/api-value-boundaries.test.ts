import { describe, expect, test } from 'bun:test';
import { cursorResponse, pagedResponse } from '../utils/api-contract.js';
import { containsSecret, withoutSecrets } from '../utils/secrets.js';
import { Type, decodeSchema } from '../../../shared/src/schema.js';

describe('unknown API value boundaries', () => {
  test('pagination preserves collection variants without claiming element types', () => {
    for (const upstream of [
      [{ id: 'one' }],
      { items: [{ id: 'one' }] },
      { clients: { items: [{ id: 'one' }], total: 1 } },
    ]) {
      expect(pagedResponse(upstream)).toEqual({ items: [{ id: 'one' }], total: 1, page: 1, limit: 50 });
    }
    const page = pagedResponse([{ id: 123 }]);
    // @ts-expect-error 未解码的分页元素不能宣称为领域 DTO。
    const typed: Array<{ id: string }> = page.items;
    void typed;
    expect(() => decodeSchema(Type.Array(Type.Object({ id: Type.String() })), page.items)).toThrow();
    // @ts-expect-error 调用者不能通过泛型参数伪造领域类型。
    pagedResponse<{ id: string }>([{ id: 123 }]);
  });

  test('cursor metadata is retained while element validation remains explicit', () => {
    const page = cursorResponse({ items: ['untrusted'], total: 8, limit: 2, next_cursor: 'next' });
    expect(page).toEqual({ items: ['untrusted'], total: 8, limit: 2, next_cursor: 'next' });
    // @ts-expect-error 游标工具也不能把 unknown 提升为调用者指定的 T。
    cursorResponse<{ id: string }>({ items: ['untrusted'] });
    expect(() => pagedResponse({ arbitrary: [] })).toThrow();
  });

  test('redaction removes nested secrets without promising the original required keys', () => {
    const input = { id: 'one', password: 'fixture-password', nested: [{ client_secret: 'fixture-secret', name: 'kept' }] };
    const result = withoutSecrets(input);
    // @ts-expect-error 脱敏会删除必需字段，返回值必须重新通过领域 schema 收窄。
    const original: typeof input = result;
    void original;
    expect(result).toEqual({
      id: 'one', nested: [{ name: 'kept', secret_configured: true }], secret_configured: true,
    });
    expect(containsSecret(result)).toBe(false);
    expect(input.password).toBe('fixture-password');
    const schema = Type.Object({ id: Type.String(), secret_configured: Type.Boolean() });
    expect(decodeSchema(schema, result).id).toBe('one');
  });

  test('redaction preserves existing null and empty-secret wire behavior', () => {
    expect(withoutSecrets(null)).toBeNull();
    expect(withoutSecrets(undefined)).toBeUndefined();
    expect(withoutSecrets({ password: '', secret: null, value: 1 })).toEqual({ value: 1 });
  });
});
