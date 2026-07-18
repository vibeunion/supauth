// SupaOAuth DataProvider for @svadmin/core
// Maps @svadmin/core CRUD operations to the SupaOAuth Management API

import type { DataProvider, GetListParams, GetListResult, GetOneParams, GetOneResult, CreateParams, CreateResult, UpdateParams, UpdateResult, DeleteParams, DeleteResult, BaseRecord, CustomParams, CustomResult } from '@svadmin/core';
import { adminApiRequest } from '../admin-api';

const API_BASE = import.meta.env.VITE_AUTH_SERVER_URL || '/api';

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  return adminApiRequest(path, options);
}

// Map @svadmin/core resource names to API paths
const RESOURCE_PATH_MAP: Record<string, string> = {
  applications: '/v1/applications',
  connectors: '/v1/connectors',
  resources: '/v1/resources',
  users: '/v1/users',
  organizations: '/v1/organizations',
  'sign-in-experience': '/v1/sign-in-experience',
  audit: '/v1/audit',
  webhooks: '/v1/webhooks',
  'auth-config': '/v1/auth-config',
};

function resourcePath(resource: string): string {
  return RESOURCE_PATH_MAP[resource] || `/v1/${resource}`;
}

export const supaoauthDataProvider: DataProvider = {
  getApiUrl: () => API_BASE,

  getList: async <TData extends BaseRecord = BaseRecord>(params: GetListParams): Promise<GetListResult<TData>> => {
    const path = resourcePath(params.resource);
    const res = await request(path) as Record<string, unknown>;
    const data = (res.items || res.data || res.users || res as unknown as unknown[]) as TData[];
    const total = typeof res.total === 'number' ? res.total : data.length;
    return { data, total };
  },

  getOne: async <TData extends BaseRecord = BaseRecord>(params: GetOneParams): Promise<GetOneResult<TData>> => {
    const path = `${resourcePath(params.resource)}/${params.id}`;
    const data = await request(path) as TData;
    return { data };
  },

  create: async <TData extends BaseRecord = BaseRecord, TVariables = unknown>(params: CreateParams<TVariables>): Promise<CreateResult<TData>> => {
    const path = resourcePath(params.resource);
    const data = await request(path, {
      method: 'POST',
      body: JSON.stringify(params.variables),
    }) as TData;
    return { data };
  },

  update: async <TData extends BaseRecord = BaseRecord, TVariables = unknown>(params: UpdateParams<TVariables>): Promise<UpdateResult<TData>> => {
    const path = `${resourcePath(params.resource)}/${params.id}`;
    const method = params.resource === 'connectors' ? 'PATCH' : 'PUT';
    const data = await request(path, {
      method,
      body: JSON.stringify(params.variables),
    }) as TData;
    return { data };
  },

  deleteOne: async <TData extends BaseRecord = BaseRecord, TVariables = unknown>(params: DeleteParams<TVariables>): Promise<DeleteResult<TData>> => {
    const path = `${resourcePath(params.resource)}/${params.id}`;
    const data = await request(path, { method: 'DELETE' }) as TData;
    return { data };
  },

  custom: async <TData = unknown, TVariables = unknown>(params: CustomParams<TVariables>): Promise<CustomResult<TData>> => {
    const data = await request(params.url, {
      method: params.method,
      body: params.payload ? JSON.stringify(params.payload) : undefined,
    }) as TData;
    return { data };
  },
};
