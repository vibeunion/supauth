// Admin console authentication — simple token-based auth for SupaOAuth admin
// In production, this should use @svadmin/sso or a proper IdP

import { Elysia } from 'elysia';

// Simple admin token auth for development
// In production: integrate with @svadmin/sso
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

interface AdminSession {
  id: string;
  email: string;
  name: string;
  role: string;
  authenticated: boolean;
}

// In-memory session store (replace with DB/Redis in production)
const sessions = new Map<string, AdminSession>();

function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const authRoutes = new Elysia({ prefix: '/v1/auth' })
  .post('/login', async ({ body }) => {
    const { token, email, password } = body as Record<string, string>;

    // Development mode: accept ADMIN_TOKEN directly
    if (ADMIN_TOKEN && token === ADMIN_TOKEN) {
      const sessionToken = generateSessionToken();
      const session: AdminSession = {
        id: 'admin',
        email: 'admin@supaoauth.local',
        name: 'Admin',
        role: 'admin',
        authenticated: true,
      };
      sessions.set(sessionToken, session);
      return { success: true, token: sessionToken };
    }

    // TODO: Integrate @svadmin/sso for production auth
    return { success: false, error: { message: 'Invalid credentials' } };
  })
  .post('/logout', async ({ headers }) => {
    const authHeader = headers.authorization as string;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      sessions.delete(token);
    }
    return { success: true };
  })
  .get('/identity', async ({ headers }) => {
    const authHeader = headers.authorization as string;
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401 });
    }
    const token = authHeader.slice(7);
    const session = sessions.get(token);
    if (!session?.authenticated) {
      return new Response('Unauthorized', { status: 401 });
    }
    return {
      id: session.id,
      name: session.name,
      email: session.email,
      avatar: null,
    };
  })
  .get('/health', () => ({ status: 'ok' }));
