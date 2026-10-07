import { defineSupacloudConfig } from '@supacloud/compiler';

export default defineSupacloudConfig({
  root: 'src/app',
  include: ['**/*.ts'],
  outDir: 'generated',
  strict: true,
  generateClient: false,
  generateOpenApi: false,
  generatePermissions: true,
  moduleBoundaryPreset: 'modular-monolith',
  typeSafety: {
    scanProductionSource: true,
    noAnyInGenerated: true,
  },
});
