import { base } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { resolveConsolePath } from './navigation.js';

/**
 * @param {import('$app/types').Pathname} targetPath
 * @returns {({ url }: { url: URL }) => never}
 */
export function createLegacyRouteRedirect(targetPath) {
  return ({ url }) => redirect(307, `${resolveConsolePath(targetPath, base)}${url.search}`);
}
