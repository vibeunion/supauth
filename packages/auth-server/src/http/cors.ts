function allowedOrigin(request: Request, origins: readonly string[]): string | undefined {
  const origin = request.headers.get('Origin');
  return origin !== null && origin !== '*' && origins.includes(origin) ? origin : undefined;
}

function vary(headers: Headers, name: string): void {
  const values = (headers.get('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!values.includes('*') && !values.some(value => value.toLowerCase() === name.toLowerCase())) {
    values.push(name);
    headers.set('Vary', values.join(', '));
  }
}

export function applyCorsHeaders(
  request: Request,
  response: Response,
  origins: readonly string[],
): Response {
  const headers = new Headers(response.headers);
  // 显式逐条复制，避免代理响应的多个 Set-Cookie 被合并。
  const cookies = response.headers.getSetCookie();
  headers.delete('Set-Cookie');
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  for (const name of [
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Credentials',
    'Access-Control-Allow-Methods',
    'Access-Control-Allow-Headers',
    'Access-Control-Expose-Headers',
    'Access-Control-Max-Age',
  ]) headers.delete(name);
  vary(headers, 'Origin');
  const preflight = request.method === 'OPTIONS';
  const requestHeaderNames = Array.from(request.headers.keys()).join(preflight ? ',' : ', ');
  if (preflight) {
    vary(headers, 'Access-Control-Request-Headers');
    vary(headers, 'Access-Control-Request-Method');
  }
  const origin = allowedOrigin(request, origins);
  if (origin !== undefined) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Expose-Headers', requestHeaderNames);
    const method = preflight ? request.headers.get('Access-Control-Request-Method') : request.method;
    if (method && method !== '*') headers.set('Access-Control-Allow-Methods', method);
    const allowedHeaders = preflight
      ? request.headers.get('Access-Control-Request-Headers')
      : requestHeaderNames;
    if (allowedHeaders && allowedHeaders.trim() !== '*') {
      headers.set('Access-Control-Allow-Headers', allowedHeaders);
    }
    if (preflight) headers.set('Access-Control-Max-Age', '5');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleCorsPreflight(request: Request, origins: readonly string[]): Response | undefined {
  if (request.method !== 'OPTIONS') return undefined;
  return applyCorsHeaders(request, new Response(null, { status: 204 }), origins);
}
