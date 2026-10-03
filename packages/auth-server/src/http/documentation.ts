export interface DocumentedOperation {
  readonly method: string;
  readonly path: string;
  readonly options: {
    readonly detail?: Record<string, unknown>;
    readonly body?: unknown;
  };
}

const info = {
  title: 'SupaOAuth Management API',
  version: '0.3.0',
  description: 'SupaOAuth is a SupaCloud-hosted enterprise IAM and user-center control plane. In gotrue mode, GoTrue remains the OAuth/OIDC runtime and token issuer; SupaOAuth provides hosted UI, product RBAC, organizations, connectors, audit, configuration, and compatibility tooling.',
};

const tags = [
  { name: 'Health', description: 'Server health and project info' },
  { name: 'Project', description: 'Project-level metadata' },
  { name: 'Runtime', description: 'OIDC runtime (GoTrue) gateway checks' },
  { name: 'Applications', description: 'OAuth client application management' },
  { name: 'Bindings', description: 'Application-resource/scope bindings' },
  { name: 'Connectors', description: 'Social/enterprise SSO provider management' },
  { name: 'Resources', description: 'API resource and scope definitions' },
  { name: 'Scopes', description: 'OAuth scope management' },
  { name: 'Users', description: 'User CRUD and permission resolution' },
  { name: 'Organizations', description: 'Organization and member management' },
  { name: 'Org Templates', description: 'Organization templates for auto-provisioning roles and permissions' },
  { name: 'Members', description: 'Organization member operations' },
  { name: 'RBAC', description: 'Role-based access control — roles, permissions, assignments' },
  { name: 'Permissions', description: 'Permission management under roles' },
  { name: 'Assignments', description: 'Role assignment and revocation' },
  { name: 'Auth Config', description: 'GoTrue auth configuration proxy' },
  { name: 'Sign-in Experience', description: 'Customizable sign-in flow configuration' },
  { name: 'Compatibility', description: 'Supabase compatibility inspector' },
  { name: 'Audit', description: 'Admin action audit log queries' },
  { name: 'Webhooks', description: 'Webhook endpoint management and event delivery' },
  { name: 'Auth', description: 'Admin console authentication' },
  { name: 'Storage', description: 'Avatar and branding asset storage proxy' },
  { name: 'Admin Tools', description: 'RLS migration assistant and SDK tools' },
  { name: 'Consents', description: 'User consent management for OAuth authorization' },
  { name: 'Security', description: 'Production security configuration and enforcement' },
  { name: 'Provisioning', description: 'SupaCloud project provisioning and idempotent reconcile (P0-26: project-scoped)' },
  { name: 'Enterprise SSO', description: 'Enterprise SSO configuration, domain discovery, JIT provisioning' },
  { name: 'API Versions', description: 'API version tracking and breaking change detection' },
  { name: 'Tenant Config', description: 'Captcha, message templates, domains, phrases, branding, and custom profile fields' },
  { name: 'Consent', description: 'Application consent configuration' },
  { name: 'Connector Factory', description: 'Connector provider catalog and factory definitions' },
  { name: 'Invitations', description: 'Organization invitations' },
  { name: 'JIT', description: 'Organization just-in-time provisioning settings' },
  { name: 'Account Center', description: 'Bearer-authenticated user profile, OAuth grants, linked identities, TOTP MFA, and scoped logout' },
  { name: 'Auth Hooks', description: 'Supabase Auth Hooks bridge for signup policy, token shaping, and MFA risk checks' },
  { name: 'RBAC Bridge', description: 'Legacy role migration and compatibility bridge (P0-28)' },
  { name: 'Route Gate', description: 'Route/domain integration gate for deployment verification (P0-29)' },
  { name: 'SSO', description: 'GoTrue-compatible SSO authorization entrypoints' },
  { name: 'Account Provisioning', description: 'Bulk account provisioning, SupaOAuth user creation, and self-service account claiming' },
];

export function openApiPath(path: string): string {
  return path.split('/').map(segment => {
    if (!segment.startsWith(':')) return segment;
    const name = segment.slice(1);
    return `{${name.endsWith('?') ? name.slice(0, -1) : name}}`;
  }).join('/');
}

// 保持 @elysiajs/swagger 1.3.1 的路径分段与首字符大写规则，稳定既有客户端标识。
function generateOperationId(method: string, path: string): string {
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  if (path === '/') return `${method}Index`;
  return method + path.split('/').map(segment =>
    segment.startsWith('{') ? `By${capitalize(segment.slice(1, -1))}` : capitalize(segment),
  ).join('');
}

export function buildSupAuthOpenApi(operations: Iterable<DocumentedOperation>) {
  const paths: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const operation of operations) {
    const detail = operation.options.detail ?? {};
    if (detail['hide'] === true) continue;
    const method = operation.method.toLowerCase();
    if (!['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) {
      throw new Error(`Unsupported OpenAPI method: ${operation.method}`);
    }
    const path = openApiPath(operation.path);
    const pathItem = paths[path] ?? {};
    if (Object.hasOwn(pathItem, method)) throw new Error(`Duplicate OpenAPI operation: ${method} ${path}`);
    // 输入及响应 schema 由领域契约提供；不读取运行时 router 或猜测 schema。
    pathItem[method] = {
      operationId: detail['operationId'] ?? generateOperationId(method, path),
      ...detail,
      // 旧 Swagger 在 detail 之后写入 body：显式运行时 schema 优先，不与较宽文档合并。
      ...(operation.options.body !== undefined ? {
        requestBody: {
          required: true,
          content: Object.fromEntries(
            ['application/json', 'multipart/form-data', 'text/plain']
              .map(mediaType => [mediaType, { schema: operation.options.body }]),
          ),
        },
      } : {}),
    };
    paths[path] = pathItem;
  }
  return { openapi: '3.0.3', info: { ...info }, tags: tags.map(tag => ({ ...tag })), paths };
}

export function swaggerHtml(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SupaOAuth Management API</title></head>
<body>
<script id="api-reference" data-url="/swagger/json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
