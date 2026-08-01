const INVALID_ACCOUNT_CENTER_READ_BACK =
  "Account Center read-back has an invalid tenant-config payload";
const LOCAL_DELETE_URL_MODES = new Set(["development", "test"]);
const LOOPBACK_AUTHORITY_PATTERN =
  /^(?:localhost|127(?:\.\d{1,3}){3})(?::\d{1,5})?$/i;
const IPV4_OCTET_PATTERN = /^(?:0|[1-9]\d{0,2})$/;

function isRecord(candidate) {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate)
  );
}

function invalidAccountCenterReadBack() {
  return new TypeError(INVALID_ACCOUNT_CENTER_READ_BACK);
}

function isCanonicalIpv4Loopback(hostname) {
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets
      .slice(1)
      .every(
        (octet) => IPV4_OCTET_PATTERN.test(octet) && Number(octet) <= 255,
      )
  );
}

function isLiteralLoopbackHttpAuthority(authority) {
  if (/^\[::1\](?::\d{1,5})?$/i.test(authority)) return true;
  if (!LOOPBACK_AUTHORITY_PATTERN.test(authority)) return false;
  const hostname = authority.replace(/:\d{1,5}$/, "");
  return (
    hostname.toLowerCase() === "localhost" ||
    isCanonicalIpv4Loopback(hostname)
  );
}

function authorityFromUrl(urlInput) {
  const schemeSeparator = urlInput.indexOf("://");
  if (schemeSeparator < 0) return "";
  return urlInput.slice(schemeSeparator + 3).split(/[/?#]/, 1)[0];
}

function isExplicitExternalUrl(candidate) {
  return (
    /^https?:\/\//i.test(candidate) &&
    !/[\u0000-\u001f\u007f]/.test(candidate) &&
    !candidate.includes("#") &&
    !candidate.includes("\\")
  );
}

function parsedExternalDeleteUrl(candidate, buildMode) {
  try {
    const url = new URL(candidate);
    const authority = authorityFromUrl(candidate);
    if (authority.includes("@") || url.username || url.password || url.hash)
      return { ok: false };
    if (url.protocol === "https:") return { ok: true, url: url.toString() };
    return LOCAL_DELETE_URL_MODES.has(buildMode) &&
      isLiteralLoopbackHttpAuthority(authority)
      ? { ok: true, url: url.toString() }
      : { ok: false };
  } catch (error) {
    if (error instanceof TypeError) return { ok: false };
    throw error;
  }
}

export function validateExternalDeleteAccountUrlDraft(urlInput, buildMode) {
  if (urlInput === null || urlInput === undefined)
    return { ok: true, url: null };
  if (typeof urlInput !== "string") return { ok: false };
  const candidate = urlInput.trim();
  if (!candidate) return { ok: true, url: null };
  return isExplicitExternalUrl(candidate)
    ? parsedExternalDeleteUrl(candidate, buildMode)
    : { ok: false };
}

function validatedAccountCenterRow(candidate) {
  if (!isRecord(candidate)) throw invalidAccountCenterReadBack();
  if (candidate.configType !== "account_center")
    throw invalidAccountCenterReadBack();
  if (typeof candidate.key !== "string" || candidate.key.length === 0)
    throw invalidAccountCenterReadBack();
  if (typeof candidate.enabled !== "boolean")
    throw invalidAccountCenterReadBack();
  if (!isRecord(candidate.value)) throw invalidAccountCenterReadBack();
  return candidate;
}

function accountCenterConfigFromEnvelope(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.items))
    throw invalidAccountCenterReadBack();

  const rows = payload.items.map(validatedAccountCenterRow);
  const matchingRows = rows.filter((row) => row.key === "default");
  if (matchingRows.length > 1) throw invalidAccountCenterReadBack();
  return matchingRows[0] || null;
}

export async function readAccountCenterConfig(listTenantConfigs) {
  const response = await listTenantConfigs("account_center");
  return accountCenterConfigFromEnvelope(response);
}
