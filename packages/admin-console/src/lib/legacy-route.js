import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';

export function createLegacyRouteRedirect(targetPath) {
  return ({ url }) => redirect(307, `${resolve(targetPath)}${url.search}`);
}
