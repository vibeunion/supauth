import { base } from '#lib/sveltekit-paths.js';
import { redirect } from '@sveltejs/kit';
import { resolveConsolePath } from './navigation.js';

/**
 * @param {string} targetPath
 * @returns {({ url }: { url: URL }) => never}
 */
export function createLegacyRouteRedirect(targetPath) {
  return ({ url }) => redirect(307, `${resolveConsolePath(targetPath, base)}${url.search}`);
}
