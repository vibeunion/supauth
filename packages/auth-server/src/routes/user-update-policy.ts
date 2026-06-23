type UserUpdatePolicyFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  fields?: string[];
};

type UserUpdatePolicySuccess = {
  ok: true;
  data: Record<string, unknown>;
};

type UserUpdatePolicyResult = UserUpdatePolicySuccess | UserUpdatePolicyFailure;

const BLOCKED_ADMIN_UPDATE_KEYS = new Set([
  'aal',
  'aud',
  'current_org_id',
  'current_org_role',
  'id',
  'iss',
  'organizations',
  'permissions',
  'permissions_count',
  'permissions_projection_limit',
  'permissions_truncated',
  'permissions_version',
  'rbac_version',
  'role',
  'roles',
  'session_id',
  'sub',
  'supaoauth',
]);

const BLOCKED_APP_METADATA_KEYS = new Set([
  'permissions',
  'role',
  'roles',
  'supaoauth',
]);

const BLOCKED_PROFILE_KEYS = new Set([
  'app_metadata',
  'aud',
  'email',
  'encrypted_password',
  'id',
  'password',
  'phone',
  'role',
  'supaoauth',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitiveProfileValue(value: unknown) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function blockedAdminUpdateFields(input: Record<string, unknown>) {
  const fields: string[] = [];

  for (const key of Object.keys(input)) {
    if (BLOCKED_ADMIN_UPDATE_KEYS.has(key) || key.startsWith('supaoauth:')) {
      fields.push(key);
    }
  }

  if (isRecord(input.app_metadata)) {
    for (const key of Object.keys(input.app_metadata)) {
      if (BLOCKED_APP_METADATA_KEYS.has(key) || key.startsWith('supaoauth:')) {
        fields.push(`app_metadata.${key}`);
      }
    }
  }

  return fields;
}

function unwrapUserRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  for (const key of ['user', 'data']) {
    const nested = value[key];
    if (isRecord(nested) && typeof nested.id === 'string') return nested;
  }
  return value;
}

export function sanitizeAdminUserUpdatePayload(body: unknown): UserUpdatePolicyResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_user_update_payload',
      message: 'User update payload must be a JSON object.',
    };
  }

  const fields = blockedAdminUpdateFields(body);
  if (fields.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'reserved_user_update_field',
      message: 'Use SupaCloud RBAC and metadata sync APIs for roles, permissions, and SupaOAuth claims.',
      fields,
    };
  }

  if ('app_metadata' in body && !isRecord(body.app_metadata)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_app_metadata',
      message: 'app_metadata must be an object; SupaOAuth metadata is preserved by the sync APIs.',
    };
  }

  if (Object.keys(body).length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'empty_user_update',
      message: 'Provide at least one user field to update.',
    };
  }

  return { ok: true, data: { ...body } };
}

export function mergeAdminUserAppMetadata(
  payload: Record<string, unknown>,
  existingUserResponse: unknown,
): Record<string, unknown> {
  if (!isRecord(payload.app_metadata)) return payload;

  const existingUser = unwrapUserRecord(existingUserResponse);
  const existingAppMetadata = isRecord(existingUser.app_metadata) ? existingUser.app_metadata : {};
  const existingSupaOAuth = existingAppMetadata.supaoauth;
  return {
    ...payload,
    app_metadata: {
      ...existingAppMetadata,
      ...payload.app_metadata,
      ...(existingSupaOAuth === undefined ? {} : { supaoauth: existingSupaOAuth }),
    },
  };
}

export function sanitizeSelfProfileUpdatePayload(body: unknown): UserUpdatePolicyResult {
  const input = isRecord(body) ? body : {};
  const source = isRecord(input.data)
    ? input.data
    : isRecord(input.user_metadata)
      ? input.user_metadata
      : input;
  const userMetadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (BLOCKED_PROFILE_KEYS.has(key) || key.startsWith('supaoauth:')) continue;
    if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(key)) continue;
    if (!isPrimitiveProfileValue(value)) continue;
    if (typeof value === 'string' && value.length > 1000) continue;
    userMetadata[key] = value;
  }

  if (Object.keys(userMetadata).length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_profile_data',
      message: 'Provide at least one safe profile metadata field.',
    };
  }

  if (Object.keys(userMetadata).length > 30) {
    return {
      ok: false,
      status: 400,
      code: 'profile_data_too_large',
      message: 'Profile metadata contains too many fields.',
    };
  }

  return { ok: true, data: { user_metadata: userMetadata } };
}

export function userUpdateFailureBody(failure: UserUpdatePolicyFailure) {
  return {
    success: false,
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.fields ? { fields: failure.fields } : {}),
    },
  };
}
