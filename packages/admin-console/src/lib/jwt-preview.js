import {
  SUPABASE_REQUIRED_CLAIMS,
  SUPAOAUTH_APP_METADATA_SCHEMA_VERSION,
  SUPAOAUTH_CLAIM_KEYS,
  SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT,
  SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT,
  SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT,
  SUPAOAUTH_PERMISSION_PROJECTION_LIMIT,
  SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT,
  SUPAOAUTH_ROLE_PROJECTION_LIMIT,
} from '@supauth/shared';

const PERMISSION_SET_FIELD_TYPES = {
  roles: 'string[]',
  roles_count: 'nonNegativeInteger',
  roles_truncated: 'boolean',
  roles_projection_limit: 'nonNegativeInteger',
  permissions: 'string[]',
  permissions_count: 'nonNegativeInteger',
  permissions_truncated: 'boolean',
  permissions_projection_limit: 'nonNegativeInteger',
  scopes: 'string[]',
};

const APPLICATION_FIELD_TYPES = {
  ...PERMISSION_SET_FIELD_TYPES,
  organization_ids: 'string[]',
  organizations: 'record',
};

export const SUPAOAUTH_FIELD_TYPES = {
  ...PERMISSION_SET_FIELD_TYPES,
  rbac_version: 'nonNegativeInteger',
  permissions_version: 'nonNegativeInteger',
  organization_ids: 'string[]',
  organizations: 'record',
  applications: 'record',
  organization_memberships: 'organization[]',
  organization_memberships_total: 'nonNegativeInteger',
  organization_memberships_truncated: 'boolean',
  current_org_id: 'string',
  current_org_role: 'string',
  rbac_synced_at: 'string',
  scopes_count: 'nonNegativeInteger',
  organization_ids_count: 'nonNegativeInteger',
  organizations_count: 'nonNegativeInteger',
  applications_count: 'nonNegativeInteger',
  truncated: 'boolean',
  projection_limit: 'nonNegativeInteger',
  projection_unavailable: 'boolean',
};

const blockedTopLevelClaims = new Set([...SUPABASE_REQUIRED_CLAIMS, ...SUPAOAUTH_CLAIM_KEYS]);
const organizationMembershipFields = new Set(['organization_id', 'slug', 'role']);
const hookMetadataFields = new Set(['version', 'authentication_method', 'processed_at']);
const supaoauthRootFields = new Set(['schema_version', 'projects', 'hook']);
const utf8Encoder = new TextEncoder();
const projectionRules = [
  {
    field: 'roles',
    countField: 'roles_count',
    truncatedField: 'roles_truncated',
    limitField: 'roles_projection_limit',
    limit: SUPAOAUTH_ROLE_PROJECTION_LIMIT,
  },
  {
    field: 'permissions',
    countField: 'permissions_count',
    truncatedField: 'permissions_truncated',
    limitField: 'permissions_projection_limit',
    limit: SUPAOAUTH_PERMISSION_PROJECTION_LIMIT,
  },
];

export function buildJwtExtensionExample(projectRef = "", projection = {}) {
  return JSON.stringify(
    {
      app_metadata: {
        supaoauth: {
          schema_version: SUPAOAUTH_APP_METADATA_SCHEMA_VERSION,
          projects: projectRef ? { [projectRef]: projection } : {},
        },
      },
    },
    null,
    2,
  );
}

function validationError(code, params = {}) {
  return { code, params };
}

function isObjectRecord(candidate) {
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
}

function fieldTypeMatches(fieldValue, expectedType) {
  if (expectedType === 'string[]') {
    return Array.isArray(fieldValue) && fieldValue.every((entry) => typeof entry === 'string');
  }
  if (expectedType === 'nonNegativeInteger') {
    return Number.isInteger(fieldValue) && fieldValue >= 0;
  }
  if (expectedType === 'organization[]') {
    return Array.isArray(fieldValue) && fieldValue.every(organizationMembershipMatches);
  }
  if (expectedType === 'record') return isObjectRecord(fieldValue);
  return typeof fieldValue === expectedType;
}

function organizationMembershipMatches(membership) {
  if (!isObjectRecord(membership)) return false;
  return Object.keys(membership).every((fieldName) => organizationMembershipFields.has(fieldName))
    && membershipFieldMatches(membership.organization_id)
    && membershipFieldMatches(membership.slug)
    && membershipFieldMatches(membership.role);
}

function membershipFieldMatches(fieldValue) {
  return typeof fieldValue === 'string'
    && fieldValue.trim().length > 0
    && fieldValue.length <= SUPAOAUTH_ORGANIZATION_MEMBERSHIP_FIELD_LENGTH_LIMIT;
}

function uniqueNonEmptyStrings(entries) {
  return [...new Set(entries.filter((entry) => entry.length > 0))];
}

function validateProjectionList(projectProjection, projectionRule) {
  const entries = projectProjection[projectionRule.field];
  if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === 'string')) return [];
  const normalizedEntries = uniqueNonEmptyStrings(entries);
  const errors = [];
  if (normalizedEntries.length !== entries.length) {
    errors.push(validationError('projectionNormalization', { field: projectionRule.field }));
  }
  if (normalizedEntries.length > projectionRule.limit) {
    errors.push(validationError('projectionOverflow', {
      field: projectionRule.field,
      limit: projectionRule.limit,
    }));
  }
  return errors;
}

function validateTruncatedProjection(projectProjection, projectionRule) {
  const errors = [];
  const entries = projectProjection[projectionRule.field];
  const count = projectProjection[projectionRule.countField];
  if (!Array.isArray(entries) || entries.length !== 0) {
    errors.push(validationError('projectionTruncatedArray', { field: projectionRule.field }));
  }
  if (!Number.isInteger(count) || count <= projectionRule.limit) {
    errors.push(validationError('projectionTruncatedCount', {
      countField: projectionRule.countField,
      limit: projectionRule.limit,
    }));
  }
  if (projectProjection[projectionRule.limitField] !== projectionRule.limit) {
    errors.push(validationError('projectionLimitMismatch', {
      limitField: projectionRule.limitField,
      limit: projectionRule.limit,
    }));
  }
  return errors;
}

function projectionMarkersPresent(projectProjection, projectionRule) {
  return [projectionRule.countField, projectionRule.truncatedField, projectionRule.limitField]
    .some((fieldName) => projectProjection[fieldName] !== undefined);
}

function validateActiveProjectionMarkers(projectProjection, projectionRule, normalizedCount) {
  const errors = [];
  const declaredCount = projectProjection[projectionRule.countField];
  if (declaredCount !== undefined && declaredCount !== normalizedCount) {
    errors.push(validationError('projectionCountMismatch', {
      countField: projectionRule.countField,
      count: normalizedCount,
    }));
  }
  if (projectProjection[projectionRule.limitField] !== undefined) {
    errors.push(validationError('projectionUnexpectedLimit', { limitField: projectionRule.limitField }));
  }
  return errors;
}

function validateActiveProjection(projectProjection, projectionRule) {
  const entries = projectProjection[projectionRule.field];
  if (entries === undefined) {
    return projectionMarkersPresent(projectProjection, projectionRule)
      ? [validationError('projectionArrayRequired', { field: projectionRule.field })]
      : [];
  }
  if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === 'string')) return [];
  return validateActiveProjectionMarkers(projectProjection, projectionRule, uniqueNonEmptyStrings(entries).length);
}

function validateProjection(projectProjection, projectionRule) {
  const listErrors = validateProjectionList(projectProjection, projectionRule);
  const stateErrors = projectProjection[projectionRule.truncatedField] === true
    ? validateTruncatedProjection(projectProjection, projectionRule)
    : validateActiveProjection(projectProjection, projectionRule);
  return [...listErrors, ...stateErrors];
}

function validateProjectionFields(projection, fieldTypes) {
  return Object.entries(projection).flatMap(([fieldName, fieldValue]) => {
    if (fieldName === 'org_ids') return [validationError('unsupportedOrgIds')];
    const expectedType = fieldTypes[fieldName];
    if (!expectedType) return [validationError('unknownField', { field: fieldName })];
    return fieldTypeMatches(fieldValue, expectedType)
      ? []
      : [validationError('invalidFieldType', { field: fieldName, expectedType })];
  });
}

function validatePermissionSet(permissionSet, fieldTypes = PERMISSION_SET_FIELD_TYPES) {
  return [
    ...validateProjectionFields(permissionSet, fieldTypes),
    ...projectionRules.flatMap((projectionRule) => validateProjection(permissionSet, projectionRule)),
  ];
}

function contextualErrors(errors, context) {
  return errors.map((error) => validationError(error.code, { ...context, ...error.params }));
}

function isCanonicalIsoTimestamp(timestamp) {
  if (typeof timestamp !== 'string') return false;
  const epochMilliseconds = Date.parse(timestamp);
  return Number.isFinite(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === timestamp;
}

function validatePermissionSetRecord(permissionSets, contextField) {
  if (!isObjectRecord(permissionSets)) return [];
  return Object.entries(permissionSets).flatMap(([entryId, permissionSet]) => {
    if (!isObjectRecord(permissionSet)) {
      return [validationError('permissionSetObject', { [contextField]: entryId })];
    }
    return contextualErrors(validatePermissionSet(permissionSet), { [contextField]: entryId });
  });
}

function validateApplicationProjection(applicationProjection, applicationId) {
  const errors = validatePermissionSet(applicationProjection, APPLICATION_FIELD_TYPES);
  const organizationErrors = validatePermissionSetRecord(applicationProjection.organizations, 'organizationId');
  return contextualErrors([...errors, ...organizationErrors], { applicationId });
}

function validateApplications(applications) {
  if (!isObjectRecord(applications)) return [];
  return Object.entries(applications).flatMap(([applicationId, applicationProjection]) => (
    isObjectRecord(applicationProjection)
      ? validateApplicationProjection(applicationProjection, applicationId)
      : [validationError('applicationProjectionObject', { applicationId })]
  ));
}

function emptyCollection(collection) {
  if (Array.isArray(collection)) return collection.length === 0;
  return isObjectRecord(collection) && Object.keys(collection).length === 0;
}

function validateUnavailableProjection(projectProjection) {
  if (projectProjection.projection_unavailable !== true) return [];
  const collectionFields = ['roles', 'permissions', 'scopes', 'organization_ids', 'organizations', 'applications'];
  const countFields = collectionFields.map((fieldName) => `${fieldName}_count`);
  const errors = collectionFields
    .filter((fieldName) => !emptyCollection(projectProjection[fieldName]))
    .map((fieldName) => validationError('unavailableProjectionNotEmpty', { field: fieldName }));
  if (projectProjection.truncated !== true) errors.push(validationError('unavailableProjectionTruncated'));
  if (!Number.isInteger(projectProjection.projection_limit) || projectProjection.projection_limit <= 0) {
    errors.push(validationError('unavailableProjectionLimit'));
  }
  for (const fieldName of countFields) {
    if (!Number.isInteger(projectProjection[fieldName]) || projectProjection[fieldName] < 0) {
      errors.push(validationError('unavailableProjectionCount', { field: fieldName }));
    }
  }
  return errors;
}

function validateOrganizationMembershipProjection(projectProjection) {
  const memberships = projectProjection.organization_memberships;
  const total = projectProjection.organization_memberships_total;
  const truncated = projectProjection.organization_memberships_truncated;
  if (memberships === undefined) {
    return total === undefined && truncated === undefined
      ? []
      : [validationError('organizationMembershipsRequired')];
  }
  if (!Array.isArray(memberships)) return [];
  const errors = [];
  if (memberships.length > SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT) {
    errors.push(validationError('organizationMembershipsOverflow', {
      limit: SUPAOAUTH_ORGANIZATION_MEMBERSHIP_LIMIT,
    }));
  }
  if (!Number.isInteger(total) || total < memberships.length) {
    errors.push(validationError('organizationMembershipsTotal'));
  }
  if (truncated !== (total > memberships.length)) {
    errors.push(validationError('organizationMembershipsTruncated'));
  }
  return errors;
}

function validateProjectProjection(projectProjection) {
  const permissionSetErrors = projectProjection.projection_unavailable === true
    ? validateProjectionFields(projectProjection, SUPAOAUTH_FIELD_TYPES)
    : validatePermissionSet(projectProjection, SUPAOAUTH_FIELD_TYPES);
  return [
    ...permissionSetErrors,
    ...validatePermissionSetRecord(projectProjection.organizations, 'organizationId'),
    ...validateApplications(projectProjection.applications),
    ...validateUnavailableProjection(projectProjection),
    ...validateOrganizationMembershipProjection(projectProjection),
  ];
}

function validateHookMetadata(hookMetadata) {
  if (!isObjectRecord(hookMetadata)) return [validationError('hookObject')];
  const unknownFields = Object.keys(hookMetadata)
    .filter((fieldName) => !hookMetadataFields.has(fieldName))
    .map((fieldName) => validationError('unknownHookField', { field: fieldName }));
  const invalidFields = [];
  if (hookMetadata.version !== 1) invalidFields.push('version');
  if (typeof hookMetadata.authentication_method !== 'string' || !hookMetadata.authentication_method) {
    invalidFields.push('authentication_method');
  }
  if (!isCanonicalIsoTimestamp(hookMetadata.processed_at)) invalidFields.push('processed_at');
  return [...unknownFields, ...invalidFields.map((field) => validationError('invalidHookField', { field }))];
}

function validateProjects(projects) {
  if (!isObjectRecord(projects)) return [validationError('projectsObject')];
  return Object.entries(projects).flatMap(([projectRef, projectProjection]) => {
    if (!projectRef) return [validationError('projectRefRequired')];
    if (!isObjectRecord(projectProjection)) {
      return [validationError('projectProjectionObject', { projectRef })];
    }
    const byteLength = utf8Encoder.encode(JSON.stringify(projectProjection)).byteLength;
    const budgetErrors = byteLength <= SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT
      ? []
      : [validationError('projectProjectionOverflow', {
        projectRef,
        limit: SUPAOAUTH_PROJECT_PROJECTION_BYTE_LIMIT,
      })];
    return [...budgetErrors, ...validateProjectProjection(projectProjection)]
      .map((error) => validationError(error.code, { projectRef, ...error.params }));
  });
}

function validateSupaoauthContainer(supaoauthContainer) {
  const byteLength = utf8Encoder.encode(JSON.stringify(supaoauthContainer)).byteLength;
  const errors = byteLength <= SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT
    ? []
    : [validationError('namespaceProjectionOverflow', {
      limit: SUPAOAUTH_NAMESPACE_PROJECTION_BYTE_LIMIT,
    })];
  errors.push(...Object.keys(supaoauthContainer)
    .filter((fieldName) => !supaoauthRootFields.has(fieldName))
    .map((fieldName) => validationError('unknownRootField', { field: fieldName })));
  if (supaoauthContainer.schema_version !== SUPAOAUTH_APP_METADATA_SCHEMA_VERSION) {
    errors.push(validationError('schemaVersionUnsupported', { expected: SUPAOAUTH_APP_METADATA_SCHEMA_VERSION }));
  }
  errors.push(...validateProjects(supaoauthContainer.projects));
  if (supaoauthContainer.hook !== undefined) errors.push(...validateHookMetadata(supaoauthContainer.hook));
  return errors;
}

function validateTopLevelClaims(parsedDraft) {
  return Object.keys(parsedDraft).flatMap((claimName) => {
    if (claimName === 'app_metadata') return [];
    const code = blockedTopLevelClaims.has(claimName) ? 'blockedTopLevel' : 'topLevelOnly';
    return [validationError(code, { claim: claimName })];
  });
}

function validateAppMetadata(appMetadata) {
  if (!isObjectRecord(appMetadata)) return [validationError('appMetadataObject')];
  const errors = Object.keys(appMetadata)
    .filter((metadataKey) => metadataKey !== 'supaoauth')
    .map((metadataKey) => validationError('appMetadataOnlySupaoauth', { key: metadataKey }));
  if (!Object.hasOwn(appMetadata, 'supaoauth')) errors.push(validationError('namespaceRequired'));
  if (!isObjectRecord(appMetadata.supaoauth)) {
    errors.push(validationError('namespaceObject'));
    return errors;
  }
  return [...errors, ...validateSupaoauthContainer(appMetadata.supaoauth)];
}

export function validateExtensionDraft(rawDraft) {
  let parsedDraft;
  try {
    parsedDraft = JSON.parse(rawDraft);
  } catch (parseError) {
    if (!(parseError instanceof SyntaxError)) throw parseError;
    return { value: null, errors: [validationError('invalidJson', { message: parseError.message })] };
  }
  if (!isObjectRecord(parsedDraft)) {
    return { value: null, errors: [validationError('extensionObject')] };
  }
  const errors = [...validateTopLevelClaims(parsedDraft), ...validateAppMetadata(parsedDraft.app_metadata)];
  return { value: errors.length === 0 ? parsedDraft : null, errors };
}
