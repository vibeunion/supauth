import type { HostedAuthApi } from './session-client.js';
import { isUnknownRecord } from '../lib/unknown-value.js';

declare global {
  interface Window {
    __SUPAOAUTH_PUBLIC_API_BASE__: string | null;
    __SUPAOAUTH_POST_LOGOUT_REDIRECT__: string | null;
  }
}

export function requiredElement<K extends keyof HTMLElementTagNameMap>(
  selector: string,
  tag: K,
  root: ParentNode = document,
): HTMLElementTagNameMap[K] {
  const selected = root.querySelector(selector);
  const element = Array.from(root.querySelectorAll(tag)).find((candidate) =>
    candidate === selected && candidate.namespaceURI === 'http://www.w3.org/1999/xhtml',
  );
  if (!element) {
    throw new Error(`Hosted page is missing ${tag}: ${selector}`);
  }
  return element;
}

export function requiredInput(form: HTMLFormElement, name: string): HTMLInputElement {
  const control = form.elements.namedItem(name);
  if (!(control instanceof HTMLInputElement)) throw new Error(`Missing form input: ${name}`);
  return control;
}

export function htmlElements(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)).map((element) => {
    if (!(element instanceof HTMLElement)) throw new Error(`Expected HTML element: ${selector}`);
    return element;
  });
}

export function requiredHostedAuth(): HostedAuthApi {
  if (!window.SupaOAuthHostedAuth) throw new Error('Hosted authentication is unavailable');
  return window.SupaOAuthHostedAuth;
}

export function errorRecord(value: unknown): Record<string, unknown> {
  return isUnknownRecord(value) ? value : {};
}

export function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
