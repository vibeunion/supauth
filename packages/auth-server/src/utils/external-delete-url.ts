const LOCAL_URL_ENVIRONMENTS = new Set(['development', 'test']);
const LOOPBACK_AUTHORITY_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3})(?::\d{1,5})?$/i;
const IPV4_OCTET_PATTERN = /^(?:0|[1-9]\d{0,2})$/;

export type ExternalDeleteAccountUrlValidation =
  | { ok: true; url: string | null }
  | { ok: false };

function isCanonicalIpv4Loopback(hostname: string) {
  const octets = hostname.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.slice(1).every((octet) => IPV4_OCTET_PATTERN.test(octet) && Number(octet) <= 255);
}

function isLiteralLoopbackHttpAuthority(authority: string) {
  if (/^\[::1\](?::\d{1,5})?$/i.test(authority)) return true;
  if (!LOOPBACK_AUTHORITY_PATTERN.test(authority)) return false;
  const hostname = authority.replace(/:\d{1,5}$/, '');
  return hostname.toLowerCase() === 'localhost' || isCanonicalIpv4Loopback(hostname);
}

function authorityFromUrl(urlInput: string) {
  const schemeSeparator = urlInput.indexOf('://');
  if (schemeSeparator < 0) return '';
  return urlInput.slice(schemeSeparator + 3).split(/[/?#]/, 1)[0];
}

function isExplicitExternalUrl(candidate: string) {
  return /^https?:\/\//i.test(candidate)
    && !/[\u0000-\u001f\u007f]/.test(candidate)
    && !candidate.includes('#')
    && !candidate.includes('\\');
}

function parsedExternalDeleteUrl(
  candidate: string,
  nodeEnv: string,
): ExternalDeleteAccountUrlValidation {
  try {
    const url = new URL(candidate);
    const authority = authorityFromUrl(candidate);
    if (authority.includes('@') || url.username || url.password || url.hash) return { ok: false };
    if (url.protocol === 'https:') return { ok: true, url: url.toString() };
    return LOCAL_URL_ENVIRONMENTS.has(nodeEnv) && isLiteralLoopbackHttpAuthority(authority)
      ? { ok: true, url: url.toString() }
      : { ok: false };
  } catch (error) {
    if (error instanceof TypeError) return { ok: false };
    throw error;
  }
}

export function validateExternalDeleteAccountUrl(
  urlInput: unknown,
  nodeEnv: string,
): ExternalDeleteAccountUrlValidation {
  if (urlInput === null || urlInput === undefined || (typeof urlInput === 'string' && !urlInput.trim())) {
    return { ok: true, url: null };
  }
  if (typeof urlInput !== 'string') return { ok: false };

  const candidate = urlInput.trim();
  return isExplicitExternalUrl(candidate) ? parsedExternalDeleteUrl(candidate, nodeEnv) : { ok: false };
}
