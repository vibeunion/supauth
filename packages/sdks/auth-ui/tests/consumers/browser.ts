import { resolveSupabaseAuthUiConfig, type ResolveSupabaseAuthUiConfigOptions } from '../../src/index.js';

const options = {
  baseUrl: 'https://auth.example.test',
  fetch: (input, init) => globalThis.fetch(input, init),
  signal: new AbortController().signal,
  timeoutMs: 1_000,
} satisfies ResolveSupabaseAuthUiConfigOptions;
void resolveSupabaseAuthUiConfig(options).then((result) => {
  const title: string | undefined = result.brand.pageTitle;
  document.title = title ?? '';
});

// @ts-expect-error: view 只能使用公开的视图联合类型。
void resolveSupabaseAuthUiConfig({ baseUrl: options.baseUrl, view: 'unsupported' });
// @ts-expect-error: transport 必须返回 Response。
void resolveSupabaseAuthUiConfig({ baseUrl: options.baseUrl, fetch: async () => ({ ok: true }) });
// @ts-expect-error: 浏览器消费声明不能引入 Bun 全局。
void Bun;
