import { decodeSchema, StringKeySchema, Type } from '@supauth/shared';

const operation = Type.Optional(Type.Object({}));
const PathItemSchema = Type.Object({
  get: operation, post: operation, put: operation, patch: operation,
  delete: operation, head: operation, options: operation, trace: operation,
});
const CoverageDocumentSchema = Type.Object({
  paths: Type.Record(StringKeySchema, PathItemSchema),
});

export function decodeCoverageDocument(value: unknown) {
  return decodeSchema(CoverageDocumentSchema, value);
}
