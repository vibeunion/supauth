import { describe, expect, test } from 'bun:test';
import { strictDefined, strictInvoke, strictProperty, strictRecord, strictString } from './helpers/strict-values.js';
import vm from 'node:vm';
import { renderHostedPage } from '../../../admin-console/src/hosted/build.js';
import { validateExternalDeleteAccountUrl as validateServerDeleteUrl } from '../utils/external-delete-url.js';
import { validateExternalDeleteAccountUrlDraft as validateAdminDeleteUrl } from '../../../admin-console/src/lib/components/account-center-settings.js';

const accountHtml = await renderHostedPage('account');

type EventListener = (event: FakeEvent) => unknown;
type AccountResponder = (path: string, init: RequestInit) => Response | Promise<Response>;

function assertDeleteUrlResult(value: unknown): asserts value is { ok: boolean; url?: string | null } {
  const record = strictRecord(value);
  if (typeof record['ok'] !== 'boolean'
    || (Object.hasOwn(record, 'url') && record['url'] !== null && typeof record['url'] !== 'string')) {
    throw new TypeError('Invalid hosted delete URL result');
  }
}

class FakeClassList {
  readonly names = new Set<string>();

  add(...names: string[]) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names: string[]) {
    names.forEach((name) => this.names.delete(name));
  }

  contains(name: string) {
    return this.names.has(name);
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, EventListener[]>();
  readonly style = {
    display: '',
    backgroundImage: '',
    setProperty: (_name: string, _value: string) => {},
  };
  className = '';
  disabled = false;
  hidden = false;
  href = '';
  parent: FakeElement | null = null;
  src = '';
  tagName: string;
  textContent = '';
  value = '';

  constructor(readonly id = '', tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  get localName() { return this.tagName.toLowerCase(); }
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';

  matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) {
      const name = selector.slice(1);
      return this.classList.contains(name) || this.className.split(/\s+/).includes(name);
    }
    return this.localName === selector.toLowerCase();
  }

  set innerHTML(_markup: string) {
    this.replaceChildren();
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children.splice(0, this.children.length);
    children.forEach((child) => this.appendChild(child));
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'src') this.src = '';
    if (name === 'href') this.href = '';
  }

  querySelector(selector: string): FakeElement | null {
    if (selector !== 'button') return null;
    return this.descendants().find((element) => element.tagName === 'BUTTON') || null;
  }

  closest(selector: string): FakeElement | null {
    if (selector === 'button[data-action]' && this.tagName === 'BUTTON' && this.dataset["action"]) return this;
    return this.parent?.closest(selector) || null;
  }

  focus() {}

  async dispatch(type: string, target: FakeElement = this) {
    const event = { currentTarget: this, preventDefault() {}, target };
    const listeners = this.listeners.get(type) || [];
    await Promise.all(listeners.map((listener) => listener(event)));
  }

  visibleText(): string {
    return [this.textContent, ...this.children.map((child) => child.visibleText())].join(' ');
  }

  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

interface FakeEvent {
  currentTarget: FakeElement;
  preventDefault(): void;
  target: FakeElement;
}

interface HarnessOptions {
  accountConfigPayload?: unknown;
  brandingPayload?: unknown;
  pageUrl?: string;
  signOutError?: unknown;
}

class FakeDocument {
  readonly body = new FakeElement('body', 'body');
  readonly documentElement = new FakeElement('html', 'html');
  readonly elements = new Map<string, FakeElement>();
  title = 'SupaOAuth 账户中心';

  constructor() {
    for (const match of accountHtml.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const [, tag, id] = match;
      if (tag && id) this.elements.set(id, new FakeElement(id, tag));
    }
    this.elements.set('account-section-grid', new FakeElement('account-section-grid', 'section'));
    this.elements.get('account-section-grid')?.classList.add('account-section-grid');
    for (const id of ['identity-link-form', 'totp-verify-form']) {
      this.elements.get(id)?.appendChild(new FakeElement('', 'button'));
    }
    for (const id of ['delete-account-form', 'delete-account-link-wrap']) {
      const element = this.elements.get(id);
      if (element) element.hidden = true;
    }
  }

  getElementById(id: string) {
    return this.elements.get(id) || null;
  }

  createElement(tagName: string) {
    return new FakeElement('', tagName);
  }

  querySelector(selector: string) {
    if (selector.startsWith('#')) return this.getElementById(selector.slice(1));
    if (selector === '.account-section-grid') return this.elements.get('account-section-grid') || null;
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return [...this.elements.values()].filter(element => element.matches(selector));
  }
}

function inlineAccountScript() {
  const scripts = [...accountHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const source = scripts.at(-1)?.[1];
  if (!source) throw new Error('Hosted account inline script was not found.');
  const initializationMarker = '  (async () => {';
  const initializationMatches = source.split(initializationMarker).length - 1;
  if (initializationMatches !== 1) {
    throw new Error(`Expected one hosted account initialization IIFE, found ${initializationMatches}.`);
  }
  const instrumentedSource = source.replace(
    initializationMarker,
    '  globalThis.__accountPageReady = (async () => {',
  );
  const closing = instrumentedSource.lastIndexOf('})();');
  if (closing < 0) throw new Error('Missing hosted bundle boundary');
  return `${instrumentedSource.slice(0, closing)}
globalThis.__accountPage = { accountFetch: (path) => accountFetch(path, accountResponses.user), validateExternalDeleteAccountUrl };
${instrumentedSource.slice(closing)}`;
}

function jsonResponse(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}

function enabledAccountConfig(
  deleteAccount: { enabled: boolean; url: unknown } = { enabled: false, url: null },
) {
  return {
    success: true,
    capabilities: { provider_linking: { available: false, providers: [], redirect_to: null } },
    config: {
      enabled: true,
      profile: { edit_mode: 'editable', fields: ['name', 'email', 'phone'] },
      security: { password_change: true, mfa: true, email_change: true, phone_change: true },
      grants: { enabled: true },
      identities: { enabled: true },
      delete_account: deleteAccount,
    },
  };
}

function defaultAccountResponder(path: string) {
  if (path === '/account/me') return jsonResponse({ success: true, user: { id: 'user-1' } });
  if (path === '/account/grants') {
    return jsonResponse({ success: true, items: [{ client: { id: 'grant-1', name: 'Test App' } }], total: 1 });
  }
  if (path === '/account/identities') {
    return jsonResponse({ success: true, items: [{ id: 'identity-1', provider: 'github' }], total: 1 });
  }
  if (path === '/account/mfa') return jsonResponse({ success: true, items: [{ id: 'mfa-1' }], total: 1 });
  return jsonResponse({ success: true });
}

async function createHarness(
  accountResponder: AccountResponder,
  options: HarnessOptions = {},
) {
  const document = new FakeDocument();
  const requests: Array<{ path: string; method: string }> = [];
  const signOutScopes: unknown[] = [];
  const hostedAuth = {
    authenticatedFetch: async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, 'https://auth.example.com').pathname.replace('/v1/public', '');
      requests.push({ path, method: init.method || 'GET' });
      return accountResponder(path, init);
    },
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ unsubscribe() {} }),
    setSession: async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null }),
    signOut: async (signOutOptions?: { scope?: unknown }) => {
      signOutScopes.push(signOutOptions?.scope);
      if (options.signOutError !== undefined) throw options.signOutError;
      return { error: null };
    },
  };
  const pageUrl = new URL(options.pageUrl || 'https://auth.example.com/account.html');
  const window = {
    __SUPAOAUTH_PUBLIC_API_BASE__: '/v1/public',
    SupaOAuthHostedAuth: hostedAuth,
    location: {
      href: pageUrl.href,
      protocol: pageUrl.protocol,
      host: pageUrl.host,
      hostname: pageUrl.hostname,
      assign: (_url: string) => {},
    },
  };
  const publicFetch = async (url: string) => {
    if (url.endsWith('/account/config')) {
      return jsonResponse(options.accountConfigPayload ?? enabledAccountConfig());
    }
    return jsonResponse({
      branding: options.brandingPayload ?? {}, sign_in_methods: ['password'], sign_up_enabled: true,
      password_policy: { min_length: 8, require_uppercase: false, require_lowercase: false, require_numbers: false, require_symbols: false },
      connectors: [],
    });
  };
 const context = {
   Headers, Promise, Response, TypeError, URL, URLSearchParams, console, document, fetch: publicFetch,
   HTMLElement: FakeElement, Element: FakeElement, HTMLButtonElement: FakeElement,
   globalThis: {}, window,
   brand: document.getElementById('brand'),
  };
  context.globalThis = context;
  vm.runInNewContext(inlineAccountScript(), context);
  await strictDefined(strictProperty(context, '__accountPageReady'));
  const pageApi = strictDefined(strictProperty(context, '__accountPage'));

  return {
    accountFetch: (path: string) => Promise.resolve(strictInvoke(pageApi, 'accountFetch', path)),
    documentTitle: () => document.title,
    validateExternalDeleteAccountUrl: (urlInput: unknown) => {
      const result = strictInvoke(pageApi, 'validateExternalDeleteAccountUrl', urlInput);
      assertDeleteUrlResult(result);
      return result;
    },
    element: (id: string) => strictDefined(document.getElementById(id)),
    requests,
    signOutScopes,
  };
}

function actionButton(harness: Awaited<ReturnType<typeof createHarness>>, listId: string) {
  const button = harness.element(listId).querySelector('button');
  if (!button) throw new Error(`Action button missing from ${listId}.`);
  return button;
}

async function loadAccount(harness: Awaited<ReturnType<typeof createHarness>>) {
  await harness.element('load-account').dispatch('click');
}

type ExternalDeleteUrlContractCase = {
  name: string;
  urlInput: unknown;
  nodeEnv: string;
  pageUrl: string;
  expected: { ok: true; url: string | null } | { ok: false };
};

const PRODUCTION_HOSTED_PAGE = 'https://auth.example.test/account.html';
const LOCAL_HOSTED_PAGE = 'http://127.0.0.1:4011/account.html';
const externalDeleteUrlContractCases: ExternalDeleteUrlContractCase[] = [
  { name: 'null built-in flow', urlInput: null, nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: true, url: null } },
  { name: 'blank built-in flow', urlInput: '   ', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: true, url: null } },
  { name: 'production HTTPS', urlInput: 'https://example.test/delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: true, url: 'https://example.test/delete' } },
  { name: 'HTTPS query', urlInput: ' https://example.test/delete?return=%2Faccount ', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: true, url: 'https://example.test/delete?return=%2Faccount' } },
  { name: 'development localhost', urlInput: 'http://localhost:3000/delete', nodeEnv: 'development', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: true, url: 'http://localhost:3000/delete' } },
  { name: 'test uppercase localhost', urlInput: 'http://LOCALHOST/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: true, url: 'http://localhost/delete' } },
  { name: 'test canonical 127/8', urlInput: 'http://127.255.0.42/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: true, url: 'http://127.255.0.42/delete' } },
  { name: 'test IPv6 loopback', urlInput: 'http://[::1]:8080/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: true, url: 'http://[::1]:8080/delete' } },
  { name: 'credentials', urlInput: 'https://user:secret@example.test/delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'encoded username', urlInput: 'https://user%40name@example.test/delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'fragment', urlInput: 'https://example.test/delete#confirm', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'empty fragment', urlInput: 'https://example.test/delete#', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'javascript scheme', urlInput: 'javascript:alert(1)', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'data scheme', urlInput: 'data:text/html,delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'relative URL', urlInput: '/delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'protocol-relative URL', urlInput: '//example.test/delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'external HTTP in test', urlInput: 'http://example.test/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'production loopback HTTP', urlInput: 'http://localhost/delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'staging loopback HTTP', urlInput: 'http://127.0.0.1/delete', nodeEnv: 'staging', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'short IPv4', urlInput: 'http://127.1/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'integer IPv4', urlInput: 'http://2130706433/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'hex IPv4', urlInput: 'http://0x7f000001/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'octal IPv4', urlInput: 'http://0177.0.0.1/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'zero-padded IPv4', urlInput: 'http://127.000.000.001/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'localhost suffix', urlInput: 'http://localhost.evil.test/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'localhost trailing dot', urlInput: 'http://localhost./delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'expanded IPv6', urlInput: 'http://[0:0:0:0:0:0:0:1]/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'percent localhost', urlInput: 'http://%6cocalhost/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'percent IPv4 digits', urlInput: 'http://%31%32%37.0.0.1/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'percent IPv4 dots', urlInput: 'http://127%2e0%2e0%2e1/delete', nodeEnv: 'test', pageUrl: LOCAL_HOSTED_PAGE, expected: { ok: false } },
  { name: 'backslash URL', urlInput: 'https://example.test\\@evil.test/delete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'control character', urlInput: 'https://example.test/\ndelete', nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
  { name: 'non-string URL', urlInput: { href: 'https://example.test/delete' }, nodeEnv: 'production', pageUrl: PRODUCTION_HOSTED_PAGE, expected: { ok: false } },
];

describe('hosted account page behavior', () => {
  test('materializes the checked hosted account source deterministically without writing generated files', async () => {
    expect(await renderHostedPage('account')).toBe(accountHtml);
  });

  test('keeps branded document and heading titles in Chinese', async () => {
    const harness = await createHarness(defaultAccountResponder, {
      brandingPayload: { page_title: '测试品牌' },
    });
    await Bun.sleep(0);

    expect(harness.documentTitle()).toBe('测试品牌 账户中心');
    expect(harness.element('account-title').textContent).toBe('测试品牌 账户中心');
  });

  for (const contractCase of externalDeleteUrlContractCases) {
    test(`keeps server, Admin, and hosted delete URL policy aligned: ${contractCase.name}`, async () => {
      const harness = await createHarness(defaultAccountResponder, {
        pageUrl: contractCase.pageUrl,
      });

      expect(validateServerDeleteUrl(contractCase.urlInput, contractCase.nodeEnv)).toEqual(contractCase.expected);
      expect(validateAdminDeleteUrl(contractCase.urlInput, contractCase.nodeEnv)).toEqual(contractCase.expected);
      expect(harness.validateExternalDeleteAccountUrl(contractCase.urlInput)).toEqual(contractCase.expected);
    });
  }

  for (const contractCase of externalDeleteUrlContractCases.filter(({ expected }) => !expected.ok)) {
    test(`fails closed for hostile delete URL response: ${contractCase.name}`, async () => {
      const harness = await createHarness(defaultAccountResponder, {
        pageUrl: contractCase.pageUrl,
        accountConfigPayload: enabledAccountConfig({
          enabled: true,
          url: contractCase.urlInput,
        }),
      });

      expect(harness.element('delete-account-form').hidden).toBeTrue();
      expect(harness.element('delete-account-link-wrap').hidden).toBeTrue();
      expect(harness.element('delete-account-link').href).toBe('');
    });
  }

  test('renders validated external delete URLs and preserves the explicit built-in flow', async () => {
    const externalUrlHarness = await createHarness(defaultAccountResponder, {
      accountConfigPayload: enabledAccountConfig({
        enabled: true,
        url: 'https://delete.example.test/account?return=%2Fprofile',
      }),
    });
    expect(externalUrlHarness.element('delete-account-form').hidden).toBeTrue();
    expect(externalUrlHarness.element('delete-account-link-wrap').hidden).toBeFalse();
    expect(externalUrlHarness.element('delete-account-link').href)
      .toBe('https://delete.example.test/account?return=%2Fprofile');

    const builtInHarness = await createHarness(defaultAccountResponder, {
      accountConfigPayload: enabledAccountConfig({ enabled: true, url: null }),
    });
    expect(builtInHarness.element('delete-account-form').hidden).toBeFalse();
    expect(builtInHarness.element('delete-account-link-wrap').hidden).toBeTrue();
    expect(builtInHarness.element('delete-account-link').href).toBe('');
  });

  test('accountFetch propagates structured, sanitized failures', async () => {
    const internalMessage = 'postgres password leaked from upstream';
    const cases: Array<{ response: AccountResponder; code: string }> = [
      { response: async () => { throw new TypeError(internalMessage); }, code: 'network_error' },
      { response: async () => jsonResponse({ success: false, error: { message: internalMessage } }, 401), code: 'session_expired' },
      { response: async () => jsonResponse({ success: false, error: { message: internalMessage } }, 503), code: 'request_failed' },
      { response: async () => jsonResponse({ success: false, error: { message: internalMessage } }), code: 'request_failed' },
    ];

    for (const failureCase of cases) {
      const harness = await createHarness(failureCase.response);
      try {
        await harness.accountFetch('/account/me');
        throw new Error('accountFetch unexpectedly succeeded.');
      } catch (error) {
        expect(error).toMatchObject({ code: failureCase.code });
        expect(strictString(strictProperty(error, 'message'))).not.toContain(internalMessage);
      }
    }
  });

  test('ends only the local hosted session when the BFF reports user_banned', async () => {
    const harness = await createHarness(async (path) => path === '/account/me'
      ? jsonResponse({
        success: false,
        error: { code: 'user_banned', message: 'private upstream detail' },
      }, 403)
      : defaultAccountResponder(path));

    await loadAccount(harness);

    expect(harness.signOutScopes).toEqual(['local']);
    expect(harness.element('account-status-note').textContent).toContain('未检测到登录状态');
    expect(harness.element('account-message').className).toContain('error');
    expect(harness.element('account-message').textContent).toContain('账号已停用');
    expect(harness.element('account-message').textContent).not.toContain('private upstream detail');
  });

  test('ends the page session when local user_banned cleanup throws', async () => {
    const cleanupError = new Error('private local cleanup detail');
    const harness = await createHarness(async (path) => path === '/account/me'
      ? jsonResponse({ success: false, error: { code: 'user_banned' } }, 403)
      : defaultAccountResponder(path), { signOutError: cleanupError });

    await loadAccount(harness);

    expect(harness.signOutScopes).toEqual(['local']);
    expect(harness.element('account-status-note').textContent).toContain('未检测到登录状态');
    expect(harness.element('account-message').className).toContain('error');
    expect(harness.element('account-message').textContent).toContain('账号已停用');
    expect(harness.element('account-message').textContent).toContain('请清除站点数据');
    expect(harness.element('account-message').textContent).not.toContain(cleanupError.message);
  });

  test('does not end the hosted session for an ordinary 403 response', async () => {
    const harness = await createHarness(async (path) => path === '/account/me'
      ? jsonResponse({
        success: false,
        error: { code: 'upstream_forbidden', message: 'private upstream detail' },
      }, 403)
      : defaultAccountResponder(path));

    await loadAccount(harness);

    expect(harness.signOutScopes).toEqual([]);
    expect(harness.element('account-message').textContent).toContain('账号请求失败');
    expect(harness.element('account-message').textContent).not.toContain('private upstream detail');
  });

  test('does not trust user_banned outside the BFF error envelope', async () => {
    const harness = await createHarness(async (path) => path === '/account/me'
      ? jsonResponse({ code: 'user_banned', message: 'private upstream detail' }, 403)
      : defaultAccountResponder(path));

    await loadAccount(harness);

    expect(harness.signOutScopes).toEqual([]);
    expect(harness.element('account-message').textContent).toContain('账号请求失败');
  });

  test('accountFetch does not disguise unexpected programming errors', async () => {
    const programmingError = new Error('unexpected client invariant');
    const harness = await createHarness(async () => {
      throw programmingError;
    });

    await expect(harness.accountFetch('/account/me')).rejects.toBe(programmingError);
  });

  test('module failures remain distinguishable from empty lists', async () => {
    const harness = await createHarness(async (path, init) => {
      if (path === '/account/grants' && (init.method || 'GET') === 'GET') {
        return jsonResponse({ success: false, error: { message: 'private upstream detail' } }, 502);
      }
      if (path === '/account/identities') return jsonResponse({ success: true, items: [], total: 0 });
      return defaultAccountResponder(path);
    });

    await loadAccount(harness);

    expect(harness.element('grants-list').visibleText()).toContain('加载失败');
    expect(harness.element('grants-list').visibleText()).not.toContain('没有应用授权记录');
    expect(harness.element('identities-list').visibleText()).toContain('没有可管理身份');
    expect(harness.element('account-message').className).toContain('error');
    expect(harness.element('account-message').textContent).not.toBe('账号资料已加载。');
  });

  test('a module 401 keeps the account in signed-out state', async () => {
    const harness = await createHarness(async (path) => {
      if (path === '/account/grants') return jsonResponse({ success: false }, 401);
      return defaultAccountResponder(path);
    });

    await loadAccount(harness);

    expect(harness.element('account-status-note').textContent).toContain('未检测到登录状态');
    expect(harness.element('profile-details').classList.contains('active')).toBeFalse();
    expect(harness.element('account-message').className).toContain('error');
    expect(harness.element('account-message').textContent).toContain('登录状态已失效');
  });

  test('a failed mutation read-back never reports success', async () => {
    let deleted = false;
    const harness = await createHarness(async (path, init) => {
      if (path === '/account/grants/grant-1' && init.method === 'DELETE') {
        deleted = true;
        return jsonResponse({ success: true });
      }
      if (path === '/account/grants' && deleted) return jsonResponse({ success: false }, 503);
      return defaultAccountResponder(path);
    });
    await loadAccount(harness);

    await harness.element('module-grid').dispatch('click', actionButton(harness, 'grants-list'));

    expect(harness.element('account-message').className).toContain('error');
    expect(harness.element('account-message').textContent).not.toContain('已更新');
    expect(harness.element('grants-list').querySelector('button')).not.toBeNull();
  });

  for (const actionCase of [
    { action: 'revoke-grant', listId: 'grants-list', path: '/account/grants', id: 'grant-1' },
    { action: 'unlink-identity', listId: 'identities-list', path: '/account/identities', id: 'identity-1' },
    { action: 'unenroll-mfa', listId: 'mfa-list', path: '/account/mfa', id: 'mfa-1' },
  ]) {
    test(`${actionCase.action} rejects double click and failed DELETE`, async () => {
      const harness = await createHarness(async (path, init) => {
        if (path === `${actionCase.path}/${actionCase.id}` && init.method === 'DELETE') {
          return jsonResponse({ success: false, error: { message: 'internal delete failure' } }, 500);
        }
        return defaultAccountResponder(path);
      });
      await loadAccount(harness);
      const button = actionButton(harness, actionCase.listId);

      await Promise.all([
        harness.element('module-grid').dispatch('click', button),
        harness.element('module-grid').dispatch('click', button),
      ]);

      expect(harness.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
      expect(harness.element('account-message').className).toContain('error');
      expect(harness.element('account-message').textContent).not.toContain('已更新');
      expect(harness.element('account-message').textContent).not.toContain('internal delete failure');
      expect(harness.element(actionCase.listId).querySelector('button')).not.toBeNull();
    });

    test(`${actionCase.action} requires read-back absence before success`, async () => {
      let deleted = false;
      const harness = await createHarness(async (path, init) => {
        if (path === `${actionCase.path}/${actionCase.id}` && init.method === 'DELETE') {
          deleted = true;
          return jsonResponse({ success: true });
        }
        if (path === actionCase.path && deleted) return defaultAccountResponder(path);
        return defaultAccountResponder(path);
      });
      await loadAccount(harness);
      const button = actionButton(harness, actionCase.listId);

      await harness.element('module-grid').dispatch('click', button);

      expect(harness.requests).toContainEqual({ path: actionCase.path, method: 'GET' });
      expect(harness.element('account-message').className).toContain('error');
      expect(harness.element('account-message').textContent).not.toContain('已更新');
    });

    test(`${actionCase.action} succeeds after read-back confirms absence`, async () => {
      let deleted = false;
      const harness = await createHarness(async (path, init) => {
        if (path === `${actionCase.path}/${actionCase.id}` && init.method === 'DELETE') {
          deleted = true;
          return jsonResponse({ success: true });
        }
        if (path === actionCase.path && deleted) return jsonResponse({ success: true, items: [], total: 0 });
        return defaultAccountResponder(path);
      });
      await loadAccount(harness);
      const button = actionButton(harness, actionCase.listId);

      await harness.element('module-grid').dispatch('click', button);

      expect(harness.element('account-message').className).toContain('ok');
      expect(harness.element('account-message').textContent).toBe('账号项目已更新。');
      expect(harness.element(actionCase.listId).querySelector('button')).toBeNull();
    });
  }
});
