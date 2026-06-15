// SupaCloud Functions entrypoint for running SupAuth inside SupaCloud.
//
// Production SupAuth must be invoked through this handler. It intentionally
// does not call listen(); SupaCloud owns the HTTP runtime.

import { handleSupAuthRequest } from './index.js';

const FUNCTION_PREFIXES = ['/functions/v1/supauth', '/supauth'];

function stripPrefix(pathname: string, prefix: string) {
  if (pathname === prefix) return '/';
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length) || '/';
  return pathname;
}

function normalizeSupacloudFunctionPath(request: Request): Request {
  const url = new URL(request.url);

  for (const prefix of FUNCTION_PREFIXES) {
    url.pathname = stripPrefix(url.pathname, prefix);
  }

  if (url.pathname === '/api') {
    url.pathname = '/';
  } else if (url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.slice('/api'.length) || '/';
  }

  return new Request(url, request);
}

export default {
  fetch(request: Request): Response | Promise<Response> {
    return handleSupAuthRequest(normalizeSupacloudFunctionPath(request));
  },
};

export { handleSupAuthRequest };
