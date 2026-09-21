import { describe, expect, test } from 'bun:test';
import vm from 'node:vm';
import { renderHostedPage } from '../../../admin-console/src/hosted/build.js';

const authorizeHtml = await renderHostedPage('authorize');
const changePasswordHtml = await renderHostedPage('change-password');

type EventListener = (event: FakeEvent) => unknown;

class FakeClassList {
  readonly names = new Set<string>();

  add(...names: string[]) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names: string[]) {
    names.forEach((name) => this.names.delete(name));
  }

  toggle(name: string, force?: boolean) {
    const enabled = force === undefined ? !this.names.has(name) : force;
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
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
  content = '';
  disabled = false;
  hidden = false;
  href = '';
  minLength = 0;
  rel = '';
  src = '';
  textContent = '';
  type = '';
  value = '';

  constructor(readonly id = '', readonly tagName = 'DIV') {}
  get localName() { return this.tagName.toLowerCase(); }
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';

  matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.localName === selector.toLowerCase();
  }
  readonly controls = new Map<string, FakeElement>();
  readonly elements = { namedItem: (name: string) => this.controls.get(name) ?? null };

  get childElementCount() {
    return this.children.length;
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
    this.children.push(child);
    return child;
  }

  insertAdjacentHTML(_position: string, _markup: string) {}

  replaceChildren(...children: FakeElement[]) {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'minlength') this.minLength = Number(value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  focus() {}

  async dispatch(type: string) {
    const event = { currentTarget: this, preventDefault() {}, target: this };
    const listeners = this.listeners.get(type) || [];
    await Promise.all(listeners.map((listener) => listener(event)));
  }
}

interface FakeEvent {
  currentTarget: FakeElement;
  preventDefault(): void;
  target: FakeElement;
}

class FakeDocument {
  readonly body = new FakeElement('body', 'BODY');
  readonly documentElement = new FakeElement('html', 'HTML');
  readonly head = new FakeElement('head', 'HEAD');
  readonly elements = new Map<string, FakeElement>();
  title = '';

  constructor(html: string) {
    const tagPattern = /<([a-z][\w-]*)\b([^>]*)>/gi;
    for (const match of html.matchAll(tagPattern)) {
      const [, tag, attributes] = match;
      if (!tag || attributes === undefined) continue;
      const id = attributes.match(/\bid="([^"]+)"/)?.[1];
      if (!id) continue;
      const element = new FakeElement(id, tag.toUpperCase());
      const className = attributes.match(/\bclass="([^"]*)"/)?.[1] || '';
      element.className = className;
      element.classList.add(...className.split(/\s+/).filter(Boolean));
      element.disabled = /\bdisabled(?:\s|=|$)/.test(attributes);
      element.hidden = /\bhidden(?:\s|=|$)/.test(attributes);
      element.minLength = Number(attributes.match(/\bminlength="(\d+)"/)?.[1] || 0);
      element.style.display = attributes.match(/\bstyle="[^"]*display:\s*([^;" ]+)/)?.[1] || '';
      for (const dataAttribute of attributes.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/gi)) {
        if (!dataAttribute[1] || dataAttribute[2] === undefined) continue;
        const key = dataAttribute[1].replace(/-([a-z])/g, (_value, letter: string) => letter.toUpperCase());
        element.dataset[key] = dataAttribute[2];
      }
      this.elements.set(id, element);
    }

    const passwordForm = this.elements.get('password-form');
    if (passwordForm) {
      passwordForm.controls.set('email', this.element('email'));
      passwordForm.controls.set('current_password', this.element('current-password'));
      passwordForm.controls.set('new_password', this.element('new-password'));
      passwordForm.controls.set('confirm_password', this.element('confirm-password'));
    }
  }

  element(id: string) {
    const element = this.elements.get(id);
    if (!element) throw new Error(`Hosted page element is missing: ${id}`);
    return element;
  }

  getElementById(id: string) {
    return this.elements.get(id) || null;
  }

  createElement(tagName: string) {
    return new FakeElement('', tagName.toUpperCase());
  }

  querySelector(selector: string) {
    if (selector.startsWith('#')) return this.getElementById(selector.slice(1));
    if (selector === 'meta[name="supaoauth-api-base"]') return null;
    return null;
  }

  querySelectorAll(selector: string) {
    return [...this.elements.values()].filter((element) => element.matches(selector));
  }
}

interface ResolveOutcome {
  status: number;
  payload: unknown;
}

interface PageHarness {
  document: FakeDocument;
  mutationRequests: Array<{ url: string; init?: RequestInit }>;
  submit(password: string): Promise<void>;
}

const strongPasswordPolicy = {
  min_length: 12,
  require_uppercase: true,
  require_lowercase: true,
  require_numbers: true,
  require_symbols: true,
};

function inlineBodyScript(html: string) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const source = scripts.at(-1)?.[1];
  if (!source) throw new Error('Hosted page inline script was not found.');
  // 保留完整 catch 链，让等待器覆盖初始化及其错误处理。
  const initialization = /^[ \t]*(?:void\s+)?((?:init|loadExperience)\(\)(?:\.catch\([\s\S]*?\))?);\s*(\}\)\(\);)\s*$/gm;
  if ([...source.matchAll(initialization)].length !== 1) {
    throw new Error('Expected exactly one terminal hosted page initialization.');
  }
  return source.replace(initialization, 'globalThis.__hostedReady = $1;\n$2');
}

function localStorageStub() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

async function executeHostedPage(
  html: string,
  resolveOutcome: ResolveOutcome,
  mutationResponse?: () => Response,
) {
  const document = new FakeDocument(html);
  const mutationRequests: Array<{ url: string; init?: RequestInit }> = [];
  const pageLocation = {
    href: 'https://auth.example.test/login.html',
    search: '',
    origin: 'https://auth.example.test',
    protocol: 'https:',
    hostname: 'auth.example.test',
    port: '',
  };
  const hostedAuth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInWithPassword: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
  };
  const window = {
    __SUPAOAUTH_PUBLIC_API_BASE__: '/v1/public',
    SupaOAuthHostedAuth: hostedAuth,
    location: pageLocation,
  };
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/phrases/')) return Response.json({ language_tag: 'en', phrases: {} });
    if (url.includes('/sign-in-experience/resolve')) {
      return Response.json(resolveOutcome.payload, { status: resolveOutcome.status });
    }
    mutationRequests.push({ url, ...(init === undefined ? {} : { init }) });
    if (mutationResponse) return mutationResponse();
    return url.includes('/account-password/change')
      ? Response.json({ success: true, status: 'password_changed' })
      : Response.json({
        id: 'user-one', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-08T00:00:00Z',
      });
  };
  const storage = localStorageStub();
  const context = vm.createContext({
    Array,
    Error,
    Headers,
    Map,
    Promise,
    Response,
    String,
    URL,
    URLSearchParams,
    console,
    document,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeElement,
    fetch: fetchImpl,
    globalThis: null,
    localStorage: storage,
    navigator: { language: 'en', languages: ['en'] },
    setTimeout: (callback: () => void) => { callback(); return 1; },
    window,
  });
  context["globalThis"] = context;
  vm.runInContext(inlineBodyScript(html), context);
  await context["__hostedReady"];
  return { document, mutationRequests };
}

async function authorizeHarness(resolveOutcome: ResolveOutcome): Promise<PageHarness> {
  const harness = await executeHostedPage(authorizeHtml, resolveOutcome);
  return {
    ...harness,
    async submit(password: string) {
      harness.document.element('signup-email').value = 'user@example.test';
      harness.document.element('signup-password').value = password;
      await harness.document.element('signup-form').dispatch('submit');
    },
  };
}

async function changePasswordHarness(resolveOutcome: ResolveOutcome): Promise<PageHarness> {
  const harness = await executeHostedPage(changePasswordHtml, resolveOutcome);
  return {
    ...harness,
    async submit(password: string) {
      harness.document.element('email').value = 'user@example.test';
      harness.document.element('current-password').value = 'OldPass123!';
      harness.document.element('new-password').value = password;
      harness.document.element('confirm-password').value = password;
      await harness.document.element('password-form').dispatch('submit');
    },
  };
}

const hostedPages = [
  {
    name: 'authorize signup',
    create: authorizeHarness,
    passwordInputId: 'signup-password',
    hintId: 'signup-password-hint',
    submitId: 'signup-submit',
    mutationPath: '/auth/v1/signup',
  },
  {
    name: 'change password',
    create: changePasswordHarness,
    passwordInputId: 'new-password',
    hintId: 'password-policy-hint',
    submitId: 'submit',
    mutationPath: '/account-password/change',
  },
] as const;

describe('hosted password policy behavior', () => {
  test('signup and recovery do not report malformed 2xx bodies as success', async () => {
    for (const form of ['signup', 'forgot'] as const) {
      const harness = await executeHostedPage(authorizeHtml, {
        status: 200,
        payload: { branding: {}, connectors: [], sign_in_methods: ['password'], sign_up_enabled: true, password_policy: strongPasswordPolicy },
      }, () => Response.json({ error: 'unexpected success body' }));
      harness.document.element(`${form}-email`).value = 'user@example.test';
      if (form === 'signup') harness.document.element('signup-password').value = 'ValidPass12!';
      await harness.document.element(`${form}-form`).dispatch('submit');
      expect(harness.document.element('message').className).toBe('message error');
      expect(harness.document.element('message').textContent).not.toContain('unexpected success body');
      expect(harness.mutationRequests).toHaveLength(1);
    }
  });

  test('recovery accepts the GoTrue empty JSON acknowledgement once', async () => {
    const harness = await executeHostedPage(authorizeHtml, {
      status: 200,
      payload: { branding: {}, connectors: [], sign_in_methods: ['password'], sign_up_enabled: true, password_policy: strongPasswordPolicy },
    }, () => Response.json({}));
    harness.document.element('forgot-email').value = 'user@example.test';
    await harness.document.element('forgot-form').dispatch('submit');
    expect(harness.document.element('message').className).toBe('message ok');
    expect(harness.mutationRequests).toHaveLength(1);
  });

  for (const page of hostedPages) {
    test(`${page.name} blocks each strong policy violation before fetch`, async () => {
      const invalidPasswords = [
        'Short1!',
        'lowercase12!',
        'UPPERCASE12!',
        'NoNumbersHere!',
        'NoSymbols123A',
      ];

      for (const password of invalidPasswords) {
        const harness = await page.create({
          status: 200,
          payload: { branding: {}, connectors: [], sign_in_methods: ['password'], sign_up_enabled: true, password_policy: strongPasswordPolicy },
        });
        expect(harness.document.element(page.passwordInputId).minLength).toBe(12);
        expect(harness.document.element(page.hintId).textContent).toContain('12');

        await harness.submit(password);

        expect(harness.mutationRequests.filter((request) => request.url.includes(page.mutationPath))).toHaveLength(0);
      }
    });

    test(`${page.name} sends a valid strong password only after policy initialization`, async () => {
      const harness = await page.create({
        status: 200,
        payload: { branding: {}, connectors: [], sign_in_methods: ['password'], sign_up_enabled: true, password_policy: strongPasswordPolicy },
      });

      expect(harness.document.element(page.submitId).disabled).toBeFalse();
      await harness.submit('ValidPass12!');

      expect(harness.mutationRequests.filter((request) => request.url.includes(page.mutationPath))).toHaveLength(1);
    });

    test(`${page.name} fails closed when password policy loading fails`, async () => {
      const harness = await page.create({
        status: 503,
        payload: { error: { code: 'password_policy_unavailable' } },
      });

      expect(harness.document.element(page.submitId).disabled).toBeTrue();
      await harness.submit('ValidPass12!');

      expect(harness.mutationRequests.filter((request) => request.url.includes(page.mutationPath))).toHaveLength(0);
    });
  }
});
