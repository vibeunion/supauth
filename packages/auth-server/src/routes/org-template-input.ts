import { ApiContractError, isRecord } from '../utils/api-contract.js';
import { sdkEndpoints } from '../../../shared/src/sdk-endpoints.js';
import type { Static } from '../../../shared/src/schema.js';

export type OrganizationTemplateCreateInput = Static<typeof sdkEndpoints.createOrgTemplate.input>['body'];
export type OrganizationTemplateUpdateInput = Partial<OrganizationTemplateCreateInput>;
export type OrganizationTemplateRoleInput = NonNullable<OrganizationTemplateCreateInput['template_roles']>[number];
export type OrganizationTemplateScopeInput = NonNullable<OrganizationTemplateCreateInput['template_scopes']>[number];

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
  if (!isRecord(body)) {
    throw invalidOrganizationTemplate('body');
  }
  return body;
}

function nonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

function validOrganizationTemplateName(candidate: unknown): candidate is string {
  return nonEmptyString(candidate) && candidate.length <= ORGANIZATION_TEMPLATE_NAME_MAX_LENGTH;
}

function validTemplateRole(candidate: unknown): candidate is OrganizationTemplateRoleInput {
  if (!isRecord(candidate)) return false;
  const role = candidate;
  return Object.keys(role).every(field => field === 'name' || field === 'permissions')
    && nonEmptyString(role["name"])
    && Array.isArray(role["permissions"])
    && role["permissions"].every(nonEmptyString);
}

function validTemplateScope(candidate: unknown): candidate is OrganizationTemplateScopeInput {
  if (!isRecord(candidate)) return false;
  const scope = candidate;
  return Object.keys(scope).every(field => field === 'name' || field === 'description')
    && nonEmptyString(scope["name"])
    && (!Object.hasOwn(scope, 'description') || typeof scope["description"] === 'string');
}

function assertOrganizationTemplateFields(input: Record<string, unknown>) {
  const result: Pick<OrganizationTemplateUpdateInput, 'name' | 'description'> = {};
  const unknownField = Object.keys(input).find(field => !ORGANIZATION_TEMPLATE_FIELDS.has(field));
  if (unknownField) throw invalidOrganizationTemplate(unknownField);
  if (Object.hasOwn(input, 'name')) {
    const name = input["name"];
    if (!validOrganizationTemplateName(name)) throw invalidOrganizationTemplate('name');
    result.name = name;
  }
  if (Object.hasOwn(input, 'description')) {
    const description = input["description"];
    if (typeof description !== 'string') throw invalidOrganizationTemplate('description');
    result.description = description;
  }
  return result;
}

function assertOrganizationTemplateCollections(input: Record<string, unknown>) {
  const result: Pick<OrganizationTemplateUpdateInput, 'template_roles' | 'template_scopes' | 'is_default'> = {};
  if (Object.hasOwn(input, 'template_roles')) {
    const roles = input["template_roles"];
    if (!Array.isArray(roles) || !roles.every(validTemplateRole)) throw invalidOrganizationTemplate('template_roles');
    result.template_roles = roles;
  }
  if (Object.hasOwn(input, 'template_scopes')) {
    const scopes = input["template_scopes"];
    if (!Array.isArray(scopes) || !scopes.every(validTemplateScope)) throw invalidOrganizationTemplate('template_scopes');
    result.template_scopes = scopes;
  }
  if (Object.hasOwn(input, 'is_default')) {
    const isDefault = input["is_default"];
    if (typeof isDefault !== 'boolean') throw invalidOrganizationTemplate('is_default');
    result.is_default = isDefault;
  }
  return result;
}

export function organizationTemplateUpdateInput(body: unknown): OrganizationTemplateUpdateInput {
  const input = organizationTemplateRecord(body);
  const fields = assertOrganizationTemplateFields(input);
  const collections = assertOrganizationTemplateCollections(input);
  if (Object.keys(input).length === 0) throw invalidOrganizationTemplate('body');
  return { ...fields, ...collections };
}

export function organizationTemplateCreateInput(body: unknown): OrganizationTemplateCreateInput {
  const input = organizationTemplateUpdateInput(body);
  const name = input.name;
  if (name === undefined) throw invalidOrganizationTemplate('name');
  return { ...input, name };
}
