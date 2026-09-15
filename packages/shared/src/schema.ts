import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Check } from '@sinclair/typebox/value';

export { Type, TypeGuard, type Static, type TSchema } from '@sinclair/typebox';

// 包含换行符的 JSON 键也必须触发 Record 的值校验。
export const StringKeySchema = Type.String({ pattern: '^[\\s\\S]*$' });

export const JsonValueSchema = Type.Recursive(
  (Self) => Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Array(Self),
    Type.Record(StringKeySchema, Self),
  ]),
  { $id: 'SupAuthJsonValue' },
);
export type JsonValue = Static<typeof JsonValueSchema>;

export const JsonObjectSchema = Type.Record(StringKeySchema, JsonValueSchema);
export type JsonObject = Static<typeof JsonObjectSchema>;

export class SchemaDecodeError extends Error {
  readonly code = 'SCHEMA_VALIDATION_FAILED';

  constructor() {
    super('Response does not match the expected schema.');
    this.name = 'SchemaDecodeError';
  }
}

function isJsonData(value: unknown, active: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) return false;
  active.add(value);
  try {
    const array = Array.isArray(value);
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) return false;
    for (const key of keys) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // 不调用访问器；隐藏字段也会参与类型收窄，不能忽略。
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
      if (array && key === 'length') continue;
      if (!descriptor.enumerable) return false;
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
      const propertyValue: unknown = descriptor.value;
      if (!isJsonData(propertyValue, active)) return false;
    }
    return true;
  } finally {
    active.delete(value);
  }
}

/**
 * 校验公开 JSON 边界，不接受会在跨端序列化中丢失的值。
 * undefined 仅用于顶层空回执；可选字段必须省略，不能显式写 undefined。
 */
export function decodeSchema<S extends TSchema>(schema: S, value: unknown): Static<S> {
  try {
    if (value !== undefined && !isJsonData(value, new Set())) throw new SchemaDecodeError();
    if (Check(schema, value)) return value;
  } catch {
    // 校验器异常也使用固定错误，避免保留输入、敏感字段路径或原始 cause。
  }
  throw new SchemaDecodeError();
}
