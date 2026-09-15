function decodeJwtPayload(token: string): { sub: string; role: string } {
  const encodedPayload = token.split('.')[1];
  if (!encodedPayload) throw new Error('Bearer token is not a JWT');
  const normalized = encodedPayload.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const claims: unknown = JSON.parse(atob(padded));
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)
    || !('sub' in claims) || typeof claims.sub !== 'string' || !claims.sub.trim()
    || !('role' in claims) || typeof claims.role !== 'string' || !claims.role.trim()) {
    throw new Error('Bearer token claims are invalid');
  }
  return { sub: claims.sub, role: claims.role };
}

export default {
  fetch(request: Request): Response {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return Response.json({ code: 'missing_bearer_token' }, { status: 401 });
    }

    try {
      const claims = decodeJwtPayload(authorization.slice('Bearer '.length));
      return Response.json({ sub: claims["sub"], role: claims["role"] });
    } catch {
      return Response.json({ code: 'invalid_bearer_token' }, { status: 401 });
    }
  },
};
