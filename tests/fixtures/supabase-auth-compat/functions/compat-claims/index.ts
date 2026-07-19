declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function decodeJwtPayload(token: string): Record<string, unknown> {
  const encodedPayload = token.split('.')[1];
  if (!encodedPayload) throw new Error('Bearer token is not a JWT');
  const normalized = encodedPayload.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

Deno.serve((request) => {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ code: 'missing_bearer_token' }, { status: 401 });
  }

  try {
    const claims = decodeJwtPayload(authorization.slice('Bearer '.length));
    return Response.json({ sub: claims.sub, role: claims.role });
  } catch {
    return Response.json({ code: 'invalid_bearer_token' }, { status: 401 });
  }
});
