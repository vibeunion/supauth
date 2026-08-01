import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const authorizeHtml = readFileSync(
  new URL('../../../admin-console/static/authorize.html', import.meta.url),
  'utf8',
);
const changePasswordHtml = readFileSync(
  new URL('../../../admin-console/static/change-password.html', import.meta.url),
  'utf8',
);

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
      const id = match[2].match(/\bid="([^"]+)"/)?.[1];
      if (!id) continue;
      const element = new FakeElement(id, match[1].toUpperCase());
      const className = match[2].match(/\bclass="([^"]*)"/)?.[1] || '';
      element.className = className;
      element.classList.add(...className.split(/\s+/).filter(Boolean));
      element.disabled = /\bdisabled(?:\s|=|$)/.test(match[2]);
      element.hidden = /\bhidden(?:\s|=|$)/.test(match[2]);
      element.minLength = Number(match[2].match(/\bminlength="(\d+)"/)?.[1] || 0);
      element.style.display = match[2].match(/\bstyle="[^"]*display:\s*([^;" ]+)/)?.[1] || '';
      for (const dataAttribute of match[2].matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/gi)) {
        const key = dataAttribute[1].replace(/-([a-z])/g, (_value, letter) => letter.toUpperCase());
        element.dataset[key] = dataAttribute[2];
      }
      this.elements.set(id, element);
    }

    const passwordForm = this.elements.get('password-form') as (FakeElement & Record<string, FakeElement>) | undefined;
    if (passwordForm) {
      passwordForm.email = this.element('email');
      passwordForm.current_password = this.element('current-password');
      passwordForm.new_password = this.element('new-password');
      passwordForm.confirm_password = this.element('confirm-password');
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
    if (selector === 'meta[name="supaoauth-api-base"]') return null;
    return null;
  }

  querySelectorAll(selector: string) {
    if (!selector.startsWith('.')) return [];
    const className = selector.slice(1);
    return [...this.elements.values()].filter((element) => element.classList.contains(className));
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
  return source;
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
    if (url.includes('/phrases/')) return Response.json({ phrases: {} });
    if (url.includes('/sign-in-experience/resolve')) {
      return Response.json(resolveOutcome.payload, { status: resolveOutcome.status });
    }
    mutationRequests.push({ url, init });
    return Response.json({ success: true, user: { id: 'user-one' } });
  };
  const storage = localStorageStub();
  const context = vm.createContext({
    Array,
    Error,
    Headers,
    JSON,
    Map,
    Promise,
    Response,
    String,
    URL,
    URLSearchParams,
    console,
    document,
    fetch: fetchImpl,
    globalThis: null as unknown,
    localStorage: storage,
    navigator: { language: 'en', languages: ['en'] },
    setTimeout: (callback: () => void) => { callback(); return 1; },
    window,
  });
  context.globalThis = context;
  const initialization = vm.runInContext(inlineBodyScript(html), context);
  await initialization;
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
          payload: { sign_up_enabled: true, password_policy: strongPasswordPolicy },
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
        payload: { sign_up_enabled: true, password_policy: strongPasswordPolicy },
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
