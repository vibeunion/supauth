type FileInput = string | URL | ArrayBufferLike | Uint8Array<ArrayBuffer> | number;

/** 分支保留 Bun.file 的每个重载，不用断言把测试回调冒充原始 API。 */
export function strictBunFile(original: typeof Bun.file, inspect: (input: FileInput) => void) {
  return ((input: FileInput, options?: BlobPropertyBag) => {
    inspect(input);
    if (typeof input === 'number') return original(input, options);
    if (typeof input === 'string' || input instanceof URL) return original(input, options);
    return original(input, options);
  }) satisfies typeof Bun.file;
}
