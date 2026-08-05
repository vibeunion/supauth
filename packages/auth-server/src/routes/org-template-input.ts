import { ApiContractError } from '../utils/api-contract.js';

export interface OrganizationTemplateRoleInput {
  name: string;
  permissions: string[];
}

export interface OrganizationTemplateScopeInput {
  name: string;
  description?: string;
}

export interface OrganizationTemplateUpdateInput {
  name?: string;
  description?: string;
  template_roles?: OrganizationTemplateRoleInput[];
  template_scopes?: OrganizationTemplateScopeInput[];
  is_default?: boolean;
}

export interface OrganizationTemplateCreateInput extends OrganizationTemplateUpdateInput {
  name: string;
}

const ORGANIZATION_TEMPLATE_FIELDS = new Set([
  'name',
  'description',
  'template_roles',
  'template_scopes',
  'is_default',
]);
const ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH = 255;

function invalidOrganizationTemplate(field: string) {
  return new ApiContractError(
    400,
    'invalid_organization_template',
    `Invalid organization template field: ${field}`,
    { field },
  );
}

function organizationTemplateRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidOrganizationTemplate('body');
  }
  return body as Record<string, unknown>;
}

function nonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

function validOrganizationTemplateName(candidate: unknown): candidate is string {
  return nonEmptyString(candidate) && candidate.length <= ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH;
}

function validTemplateRole(candidate: unknown): candidate is OrganizationTemplateRoleInput {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const role = candidate as Record<string, unknown>;
  return Object.keys(role).every(field => field === 'name' || field === 'permissions')
    && nonEmptyString(role.name)
    && Array.isArray(role.permissions)
    && role.permissions.every(nonEmptyString);
}

function validTemplateScope(candidate: unknown): candidate is OrganizationTemplateScopeInput {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const scope = candidate as Record<string, unknown>;
  return Object.keys(scope).every(field => field === 'name' || field === 'description')
    && nonEmptyString(scope.name)
    && (!Object.hasOwn(scope, 'description') || typeof scope.description === 'string');
}

function assertOrganizationTemplateFields(input: Record<string, unknown>) {
  const unknownField = Object.keys(input).find(field => !ORGANIZATION_TEMPLATE_FIELDS.has(field));
  if (unknownField) throw invalidOrganizationTemplate(unknownField);
  if (Object.hasOwn(input, 'name') && !validOrganizationTemplateName(input.name)) {
    throw invalidOrganizationTemplate('name');
  }
  if (Object.hasOwn(input, 'description') && typeof input.description !== 'string') {
    throw invalidOrganizationTemplate('description');
  }
}

function assertOrganizationTemplateCollections(input: Record<string, unknown>) {
  if (Object.hasOwn(input, 'template_roles')
    && (!Array.isArray(input.template_roles) || !input.template_roles.every(validTemplateRole))) {
    throw invalidOrganizationTemplate('template_roles');
  }
  if (Object.hasOwn(input, 'template_scopes')
    && (!Array.isArray(input.template_scopes) || !input.template_scopes.every(validTemplateScope))) {
    throw invalidOrganizationTemplate('template_scopes');
  }
  if (Object.hasOwn(input, 'is_default') && typeof input.is_default !== 'boolean') {
    throw invalidOrganizationTemplate('is_default');
  }
}

export function organizationTemplateUpdateInput(body: unknown): OrganizationTemplateUpdateInput {
  const input = organizationTemplateRecord(body);
  assertOrganizationTemplateFields(input);
  assertOrganizationTemplateCollections(input);
  if (Object.keys(input).length === 0) throw invalidOrganizationTemplate('body');
  return input as OrganizationTemplateUpdateInput;
}

export function organizationTemplateCreateInput(body: unknown): OrganizationTemplateCreateInput {
  const input = organizationTemplateUpdateInput(body);
  if (!Object.hasOwn(input, 'name')) throw invalidOrganizationTemplate('name');
  return input as OrganizationTemplateCreateInput;
}
