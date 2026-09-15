export function strictDefined<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('Expected a defined test value');
  return value;
}

export function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an object in the test boundary');
  }
}

export function strictRecord(value: unknown): Record<string, unknown> {
  assertRecord(value);
  return value;
}

export function strictArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected an array in the test boundary');
  return value;
}

export function strictString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string in the test boundary');
  return value;
}

/** 白盒测试读取运行时方法；不伪造 private 成员签名，调用结果仍需独立检查。 */
export function strictInvoke(target: unknown, method: string, ...args: unknown[]): unknown {
  const callable = strictRecord(target)[method];
  if (typeof callable !== 'function') throw new TypeError(`Expected callable test member: ${method}`);
  const result: unknown = Reflect.apply(callable, target, args);
  return result;
}

/** 每层先检查容器；叶子仍是 unknown，由调用处保留原来的精确断言。 */
export function strictProperty(value: unknown, ...keys: readonly (string | number)[]): unknown {
  let current = value;
  for (const key of keys) {
    current = typeof key === 'number' ? strictArray(current)[key] : strictRecord(current)[key];
  }
  return current;
}
