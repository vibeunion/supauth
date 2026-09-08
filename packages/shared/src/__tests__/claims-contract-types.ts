import type { SupaOAuthJWTClaims } from '../index.js';

const withoutAuthorizedParty: SupaOAuthJWTClaims = {
  sub: 'user-id',
  role: 'authenticated',
  aud: 'authenticated',
  iss: 'https://auth.example.test',
  exp: 2,
  iat: 1,
  aal: 'aal1',
  session_id: 'session-id',
  is_anonymous: false,
};

const withAuthorizedParty: SupaOAuthJWTClaims = {
  ...withoutAuthorizedParty,
  azp: 'client-id',
};

const nonStringAuthorizedParty: SupaOAuthJWTClaims = {
  ...withoutAuthorizedParty,
  // @ts-expect-error Authorized-party metadata must be a string.
  azp: 123,
};

const nullAuthorizedParty: SupaOAuthJWTClaims = {
  ...withoutAuthorizedParty,
  // @ts-expect-error Null is not authorized-party metadata.
  azp: null,
};

const authorizedParty: string | undefined = withAuthorizedParty.azp;
void authorizedParty;
void nonStringAuthorizedParty;
void nullAuthorizedParty;
