// Export OpenAPI spec from the Elysia app as JSON
// Usage: bun run scripts/export-openapi.ts [output-path]

import { writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const outputPath = process.argv[2] || join(import.meta.dir, '..', 'openapi.json');

  // Set minimal env vars so config validation doesn't crash
  process.env.PORT = '0'; // don't actually bind
  process.env.SUPACLOUD_API_URL = 'http://localhost:9090';
  process.env.SUPACLOUD_MASTER_TOKEN = 'export-placeholder';
  process.env.PROJECT_REF = 'export-placeholder';
  process.env.DATABASE_URL = 'postgres://placeholder';
  process.env.HOST = '127.0.0.1';

  // Import the app. It listens on port 0 with the export env above; app.handle lets us
  // read the generated Swagger JSON without depending on an external HTTP client.
  const { app } = await import('../packages/auth-server/src/index.js');

  const res = await app.handle(new Request('http://localhost/swagger/json'));
  if (!res.ok) {
    app.server?.stop();
    console.error(`Could not access swagger spec: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const spec = await res.json() as { paths?: Record<string, unknown>; tags?: Array<{ name?: string }> };
  writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  console.log(`OpenAPI spec exported to ${outputPath}`);
  console.log(`Paths: ${Object.keys(spec.paths || {}).length}`);
  console.log(`Tags: ${(spec.tags || []).map(t => t.name).join(', ')}`);
  app.server?.stop();

  process.exit(0);
}

main().catch(e => {
  console.error('Export failed:', e);
  process.exit(1);
});
