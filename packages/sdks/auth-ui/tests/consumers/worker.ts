import { buildHostedLogoutUrl, resolveSupabaseAuthUiConfig } from '../../src/index.js';

const destination: string = buildHostedLogoutUrl({ supauthUrl: 'https://auth.example.test' });
void resolveSupabaseAuthUiConfig({
  baseUrl: 'https://auth.example.test',
  fetch: (input, init) => fetch(input, init),
}).then((result) => self.postMessage({ destination, providers: result.auth.providers }));

// @ts-expect-error: worker 消费不依赖 DOM Window。
void document;
// @ts-expect-error: worker 消费不依赖 Bun。
void Bun;
