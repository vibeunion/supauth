type DefinedFields<T extends object> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

// 可选字段缺省时不构造显式 undefined，保持数据库更新和 JSON 传输的一致语义。
export function definedFields<T extends object>(value: T): DefinedFields<T> {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError('Expected an own-data record');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Expected enumerable string-keyed data fields');
    }
  }
  const entries: Array<[string, unknown]> = Object.entries(value);
  // 不变量：输入已限制为自有可枚举字符串数据属性，仅删除 undefined，其他键和值原样保留。
  // Object.fromEntries 无法表达按 T 的属性是否包含 undefined 计算出的映射类型。
  return Object.fromEntries(entries.filter(([, field]) => field !== undefined)) as DefinedFields<T>;
}

export function requiredRow<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Database mutation did not return its row');
  return value;
}
