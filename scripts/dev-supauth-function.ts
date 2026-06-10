// Local SupaCloud Function emulator for SupAuth.
//
// This is not a standalone SupAuth service entrypoint. It only hosts the same
// fetch handler that SupaCloud Functions invoke, so local development exercises
// the required runtime shape.

import supauthFunction from '../packages/auth-server/src/supacloud-function.js';
import { getConfig, validateConfig } from '../packages/auth-server/src/config/index.js';

const config = getConfig();
const configWarnings = validateConfig(config);

if (configWarnings.length > 0) {
  console.warn('SupAuth function env warnings:', configWarnings.join('; '));
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: (request) => supauthFunction.fetch(request),
});

console.log(`SupAuth SupaCloud Function emulator running at http://${server.hostname}:${server.port}`);
console.log(`Swagger docs at http://${server.hostname}:${server.port}/api/swagger`);
console.log(`Runtime mode: ${config.runtimeMode}`);
