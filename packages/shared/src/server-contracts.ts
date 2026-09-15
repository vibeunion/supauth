import { Type, type TSchema, decodeSchema } from './schema.js';

export type ServerRequestKind = 'validated' | 'none' | 'raw-signed' | 'protocol';
export type ServerResponseKind = 'validated' | 'empty' | 'binary' | 'html' | 'redirect' | 'protocol';

export interface ServerResponseContract {
  kind: ServerResponseKind;
  schema?: TSchema;
  contentTypes?: readonly string[];
  headers?: TSchema;
  alternatives?: readonly ServerResponseContract[];
}

export interface ServerRouteContract {
  input: TSchema;
  request: ServerRequestKind;
  responses: Readonly<Record<number, ServerResponseContract>>;
  hidden?: boolean;
  retired?: boolean;
}

export const ServerErrorSchema = Type.Object({
  success: Type.Literal(false),
  error: Type.Object({
    code: Type.Optional(Type.String()),
    message: Type.String(),
    correlation_id: Type.Optional(Type.String()),
    fields: Type.Optional(Type.Array(Type.String())),
    details: Type.Optional(Type.Object({
      field: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      capability: Type.Optional(Type.String()),
      required_action: Type.Optional(Type.String()),
      minimum: Type.Optional(Type.Number()),
      maximum: Type.Optional(Type.Number()),
      fields: Type.Optional(Type.Array(Type.String())),
      allowed_grant_types: Type.Optional(Type.Array(Type.String())),
      unsupported_grant_types: Type.Optional(Type.Array(Type.String())),
      binding_count: Type.Optional(Type.Number()),
    })),
  }),
});

export const commonServerErrorResponse = {
  kind: 'protocol',
  schema: Type.Union([
    ServerErrorSchema,
    Type.Literal('Unauthorized'),
    Type.Literal('Too Many Requests'),
  ]),
  contentTypes: ['application/json', 'text/plain'],
} satisfies ServerResponseContract;

export const commonServerErrors: Readonly<Record<number, ServerResponseContract>> =
  Object.fromEntries([400, 401, 403, 404, 409, 422, 429, 500, 501, 502, 503, 504]
    .map(status => [status, commonServerErrorResponse]));

export const ServerHookVerificationSchema = Type.Object({
  verified: Type.Boolean(),
  consumed: Type.Boolean(),
  reason_code: Type.Union([Type.String(), Type.Null()]),
});

export function decodeServerInput(contract: ServerRouteContract, input: unknown): unknown {
  if (input === undefined) throw new Error('Undefined is not an HTTP input value');
  return decodeSchema(contract.input, input);
}
