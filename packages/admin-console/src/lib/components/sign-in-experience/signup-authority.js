const INVALID_SIGNUP_AUTHORITY =
  "GoTrue signup configuration read-back is invalid";

function isRecord(candidate) {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate)
  );
}

function invalidSignupAuthority() {
  return new TypeError(INVALID_SIGNUP_AUTHORITY);
}

function optionalBooleanField(record, fieldName) {
  if (!Object.hasOwn(record, fieldName)) return { present: false };
  const booleanValue = record[fieldName];
  if (typeof booleanValue !== "boolean") throw invalidSignupAuthority();
  return { present: true, booleanValue };
}

export function resolveAuthoritativeSignupEnabled(authConfig) {
  if (!isRecord(authConfig)) throw invalidSignupAuthority();
  const enableSignup = optionalBooleanField(authConfig, "enable_signup");
  const disableSignup = optionalBooleanField(authConfig, "disable_signup");
  if (!enableSignup.present && !disableSignup.present)
    throw invalidSignupAuthority();
  if (
    enableSignup.present &&
    disableSignup.present &&
    enableSignup.booleanValue === disableSignup.booleanValue
  )
    throw invalidSignupAuthority();
  return enableSignup.present
    ? enableSignup.booleanValue
    : !disableSignup.booleanValue;
}
