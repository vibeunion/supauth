import { resolve as resolvePath } from '$app/paths';

const resolveRuntimePath = /** @type {(path: string) => string} */ (resolvePath);

// SvelteKit 3 no longer exposes `base` and types `resolve` as a finite route union.
// Keep dynamic admin links behind this string-based boundary while deriving the
// configured base from the supported root route.
export const base = resolveRuntimePath('').replace(/\/$/, '');

/**
 * @param {string} path
 * @returns {string}
 */
export function resolve(path) {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError('Expected an absolute application path');
  }
  return resolveRuntimePath(path.startsWith('/') ? path.slice(1) : path);
}
