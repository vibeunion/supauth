import SwaggerParser from '@apidevtools/swagger-parser';
import { decodeSchema, JsonObjectSchema } from '../packages/shared/src/schema.js';
import { isUnknownArray, requireRecord } from './tooling-values.js';

type Position = 'unknown' | 'data' | 'document' | 'components' | 'paths' | 'pathItem'
  | 'operation' | 'parameter' | 'requestBody' | 'response' | 'media' | 'example'
  | 'encoding' | 'link' | 'callback' | 'schema' | 'metadata' | 'securityScheme' | 'oauthFlows' | 'oauthFlow'
  | 'schemaMap' | 'schemaList' | 'parameterMap' | 'parameterList' | 'responseMap'
  | 'requestBodyMap' | 'mediaMap' | 'exampleMap' | 'encodingMap' | 'linkMap'
  | 'callbackMap' | 'pathItemMap' | 'metadataMap' | 'metadataList' | 'securitySchemeMap';

const entries: Partial<Record<Position, Position>> = {
  schemaMap: 'schema', schemaList: 'schema', parameterMap: 'parameter',
  parameterList: 'parameter', responseMap: 'response', requestBodyMap: 'requestBody',
  mediaMap: 'media', exampleMap: 'example', encodingMap: 'encoding', linkMap: 'link',
  callbackMap: 'callback', pathItemMap: 'pathItem', metadataMap: 'metadata',
  metadataList: 'metadata',
  securitySchemeMap: 'securityScheme',
};
const fields: Partial<Record<Position, Readonly<Record<string, Position>>>> = {
  document: { paths: 'paths', webhooks: 'pathItemMap', components: 'components', info: 'metadata', servers: 'metadataList', tags: 'metadataList', externalDocs: 'metadata' },
  components: { schemas: 'schemaMap', parameters: 'parameterMap', headers: 'parameterMap', responses: 'responseMap', requestBodies: 'requestBodyMap', examples: 'exampleMap', links: 'linkMap', callbacks: 'callbackMap', pathItems: 'pathItemMap', securitySchemes: 'securitySchemeMap' },
  pathItem: { get: 'operation', put: 'operation', post: 'operation', delete: 'operation', patch: 'operation', head: 'operation', options: 'operation', trace: 'operation', parameters: 'parameterList', servers: 'metadataList' },
  operation: { parameters: 'parameterList', requestBody: 'requestBody', responses: 'responseMap', callbacks: 'callbackMap', servers: 'metadataList', externalDocs: 'metadata' },
  parameter: { schema: 'schema', content: 'mediaMap', example: 'data', examples: 'exampleMap' },
  requestBody: { content: 'mediaMap' },
  response: { content: 'mediaMap', headers: 'parameterMap', links: 'linkMap' },
  media: { schema: 'schema', example: 'data', examples: 'exampleMap', encoding: 'encodingMap' },
  example: { value: 'data' },
  encoding: { headers: 'parameterMap' },
  link: { parameters: 'data', requestBody: 'data', server: 'metadata' },
  schema: {
    properties: 'schemaMap', patternProperties: 'schemaMap', $defs: 'schemaMap',
    definitions: 'schemaMap', dependentSchemas: 'schemaMap',
    allOf: 'schemaList', anyOf: 'schemaList', oneOf: 'schemaList', prefixItems: 'schemaList',
    items: 'schema', additionalProperties: 'schema', additionalItems: 'schema',
    unevaluatedProperties: 'schema', unevaluatedItems: 'schema', contains: 'schema',
    propertyNames: 'schema', not: 'schema', if: 'schema', then: 'schema', else: 'schema',
    contentSchema: 'schema', example: 'data', examples: 'data', default: 'data',
    enum: 'data', const: 'data', externalDocs: 'metadata', xml: 'metadata',
  },
  metadata: { contact: 'metadata', license: 'metadata', variables: 'metadataMap', externalDocs: 'metadata' },
  securityScheme: { flows: 'oauthFlows' },
  oauthFlows: { implicit: 'oauthFlow', password: 'oauthFlow', clientCredentials: 'oauthFlow', authorizationCode: 'oauthFlow' },
  oauthFlow: { scopes: 'data' },
};

function childPosition(parent: Position, key: string): Position {
  if (parent === 'data') return 'data';
  // Map 中的 example/value/x-* 是用户选定的名称，不是元数据关键字。
  const entry = entries[parent];
  if (entry) return entry;
  if (parent === 'unknown') return 'unknown';
  if (key.startsWith('x-')) return 'data';
  if (parent === 'paths') return key.startsWith('/') ? 'pathItem' : 'unknown';
  if (parent === 'callback') return key === '$ref' ? 'unknown' : 'pathItem';
  const children = fields[parent];
  return children && Object.hasOwn(children, key) ? children[key] ?? 'unknown' : 'unknown';
}

function dataPath(path: string, root: Position): boolean {
  if (!path.startsWith('#/')) return false;
  let position = root;
  for (const token of path.slice(2).split('/')) {
    position = childPosition(position, token.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (position === 'data') return true;
  }
  return false;
}

function checkReferences(
  value: unknown, position: Position, root: Position, seen = new Set<object>(),
): void {
  if (position === 'data' || value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const children = isUnknownArray(value)
    ? Object.entries(value)
    : Object.entries(requireRecord(value));
  for (const [key, child] of children) {
    if (key === '$ref' && typeof child === 'string') {
      if (!child.startsWith('#')) throw new Error('External reference is not allowed');
      // 不允许把数据区重新当作 Schema 引用，以免间接带入未校验的引用。
      if (dataPath(decodeURIComponent(child), root)) throw new Error('Reference target is ordinary data');
    }
    checkReferences(child, childPosition(position, key), root, seen);
  }
}

export function createOpenApiMemorySource(value: unknown) {
  const document = decodeSchema(JsonObjectSchema, value);
  const root: Position = typeof document['openapi'] === 'string'
    && document['openapi'].startsWith('3.') ? 'document' : 'unknown';
  // 序列化前完成 JSON 与引用校验，避免丢弃非法字段或重新解释普通数据。
  checkReferences(document, root, root);
  const json = JSON.stringify(document);
  const url = 'supauth://openapi/document.json';
  const resolver = {
    order: 1,
    canRead: (file: Pick<SwaggerParser.FileInfo, 'url'>) => file.url === url,
    read(file: Pick<SwaggerParser.FileInfo, 'url'>): string {
      if (file.url !== url) throw new Error('Only the fixed in-memory OpenAPI URL is allowed');
      return json;
    },
  } satisfies SwaggerParser.ResolverOptions;
  return { url, root, resolver };
}

/** 仅供一次检查使用；每次仍校验输入，只复用完全相同 JSON 的成功标准校验。 */
export function createOpenApiValidationSession(): (value: unknown) => Promise<void> {
  const successfulSources = new Set<string>();
  return async value => {
    try {
      const source = createOpenApiMemorySource(value);
      const json = source.resolver.read({ url: source.url });
      if (successfulSources.has(json)) return;
      const options: SwaggerParser.Options = {
        parse: { yaml: false, text: false, binary: false },
        resolve: { external: false, file: false, http: false, memory: source.resolver },
        dereference: { circular: 'ignore', excludedPathMatcher: (path: string) => dataPath(path, source.root) },
      };
      await SwaggerParser.validate(source.url, options);
      // 不存进行中或失败的 Promise，成功前不能给其他输入放行。
      successfulSources.add(json);
    } catch {
      throw new Error('OpenAPI document is invalid or contains an unresolved reference');
    }
  };
}

export async function validateOpenApiDocument(value: unknown): Promise<void> {
  await createOpenApiValidationSession()(value);
}
