import { Type, decodeSchema } from '../packages/shared/src/schema.js';

const optionalText = Type.Optional(Type.String());
const OAuthReplySchema = Type.Union([Type.Null(), Type.Object({
  redirect_url: optionalText,
  error: optionalText,
  error_description: optionalText,
  message: optionalText,
})]);
const TokenReplySchema = Type.Union([Type.Null(), Type.Object({
  access_token: Type.Optional(Type.String({ minLength: 1 })),
  refresh_token: Type.Optional(Type.String({ minLength: 1 })),
  error: optionalText,
})]);
const CreatedUserSchema = Type.Union([Type.Null(), Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  user: Type.Optional(Type.Object({ id: Type.Optional(Type.String({ minLength: 1 })) })),
  message: optionalText,
  error: optionalText,
})]);

export function decodeOAuthReply(value: unknown) {
  return decodeSchema(OAuthReplySchema, value);
}

export function decodeTokenReply(value: unknown) {
  return decodeSchema(TokenReplySchema, value);
}

export function decodeCreatedUser(value: unknown) {
  return decodeSchema(CreatedUserSchema, value);
}
