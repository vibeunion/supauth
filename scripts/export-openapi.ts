// Export OpenAPI spec from the Elysia app as JSON
// Usage: bun run scripts/export-openapi.ts [output-path] [route-inventory-path]

import { writeFileSync } from 'fs';
import { join } from 'path';
import { createRouteContractInventory } from './type-safety-contract.js';
import { canonicalizeOpenApiReferences } from './openapi-schema-references.js';
import { convertOpenApi30Schemas } from './openapi-30-schema.js';
import { validateOpenApiDocument } from './openapi-validation.js';
import { requireArray, requireRecord } from './tooling-values.js';

async function main() {
  const outputPath = process.argv[2] || join(import.meta.dir, '..', 'openapi.json');

  // Set minimal env vars so config validation doesn't crash
  process.env["PORT"] = '0'; // don't actually bind
  process.env["SUPACLOUD_API_URL"] = 'http://localhost:9090';
  process.env["SUPACLOUD_MASTER_TOKEN"] = 'export-placeholder';
  process.env["PROJECT_REF"] = 'export-placeholder';
  process.env["DATABASE_URL"] = 'postgres://placeholder';
  process.env["HOST"] = '127.0.0.1';

  // Import the app without binding a port; app.handle lets us read the generated
  // Swagger JSON without depending on an external HTTP client.
  const { app } = await import('../packages/auth-server/src/index.js');

  const res = await app.handle(new Request('http://localhost/swagger/json'));
  if (!res.ok) {
    console.error(`Could not access swagger spec: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const spec = requireRecord(await res.json(), 'OpenAPI export');
  const canonical = canonicalizeOpenApiReferences(spec, app.routes.map(createRouteContractInventory));
  const portable = convertOpenApi30Schemas(canonical.spec, canonical.inventory);
  await validateOpenApiDocument(portable.spec);
  writeFileSync(outputPath, JSON.stringify(portable.spec, null, 2));
  const inventoryPath = process.argv[3];
  if (inventoryPath) {
    writeFileSync(inventoryPath, JSON.stringify(portable.inventory, null, 2));
  }
  console.log(`OpenAPI spec exported to ${outputPath}`);
  console.log(`Paths: ${Object.keys(requireRecord(spec['paths'])).length}`);
  console.log(`Tags: ${requireArray(spec['tags'] ?? []).map(tag => requireRecord(tag)['name']).join(', ')}`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('Export failed:', e);
  process.exit(1);
});
