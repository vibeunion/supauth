// Frozen migration metadata captured before extracting the historical SQL.
// Keep recorded versions unchanged; new SQL requires a new migration.
export const HOSTED_MIGRATION_CATALOG = [
  {
    name: 'supauth-overlay-schema-v1',
    version: '1',
    sha256: '1005f2d0f5cd77ad86e2d954a77d42a93c96bf530029c59fdd10f8f451d8bf17',
    checksum: 'fdda1e63f910ca9df16f73dc351c31260d65fd646beb8475bfa8d55bf54496ad',
  },
  {
    name: 'supauth-overlay-hardening-v4',
    version: '4',
    sha256: 'be1281ef23755cebe3a04fa897216de85bc44bba3aedc61963824800882e1c59',
    checksum: 'dba2c63f9f64610a5c4bec16f33b9f560ea862d64792700f08a49e5281725637',
  },
  {
    name: 'supauth-overlay-provisioning-v5',
    version: '5',
    sha256: 'c6048ca18e880abe4e13e0b1edc46863476228f3514a6421a1b72b6cb95cbf18',
    checksum: '46485606e337aec58a7a194204eef8fd97c246cc65da5011c47d46beafd5ec4d',
  },
  {
    name: 'supauth-overlay-gotrue-authority-v6',
    version: '6',
    sha256: '58cbb87278a8d30a4c19726b066a458619f8625c7c38fe6b5be560d4e41f898f',
    checksum: '3413ad789f079513f9f446bc731e522580cf0d1b06e8c762d561a83f40246fe2',
  },
  {
    name: 'supauth-overlay-function-access-v7',
    version: '7',
    sha256: '6d190c9707e2b27de6b8860dca44d266475f5fddef62aca3f9b05d62844b5bb3',
    checksum: 'ac1b92c92348c86516d6631ca44432c9c1af55e0779cfb179662bef7187ba0e3',
  },
  {
    name: 'supauth-overlay-project-claims-v8',
    version: '8',
    sha256: 'babc7287cac9d03416bd01ef1c6db4e4c8023e03bbb8c44adfb4bce4162f8998',
    checksum: 'b315424dde1b7799e9be159f06482a2779d7b4452496654561996d407024cef5',
  },
  {
    name: 'supauth-overlay-legacy-webhook-revoke-v9',
    version: '9',
    sha256: '3e00daa8021e901b22884ede6a0ba8e128e28e7e994e902cbad5d0d82549eaf2',
    checksum: '31f89d9df38e44f6707bcf35137480658b25c3ef44d5d8383949f8828b08948f',
  },
  {
    name: 'supauth-overlay-legacy-webhook-retirement-v10',
    version: '10',
    sha256: 'a19a760893640820ab30f5e6d0061e110a4baf49b2d46332d139de77ceca511c',
    checksum: '8ace844e8c548f806f54d2dd194fa2ade7109764406b2d3e1d1928b91afb706c',
  },
  {
    name: 'supauth-overlay-application-permissions-v11',
    version: '11',
    sha256: '3bda7ae11a5666fe74c0e1df956f4059ac22750c954e2408c389fa3434412670',
    checksum: '3a85f3ad18baae12fb95de030a277bb24ab51b8061bec161d76f7487832f255a',
  },
  {
    name: 'supauth-overlay-account-claim-state-v12',
    version: '12',
    sha256: '76bb06a933c64f80cee24c0969114e1e3f465b3c95bcbaf452270559d7fa542c',
    checksum: '396a15ac360b40a00051a469041ccba0b1bdbc3726573e40ee54b5e912b881d0',
  },
  {
    name: 'supauth-overlay-rls-permission-projection-v13',
    version: '13',
    sha256: '91139b9ac626411f28864230122e82278374a9951c655a513bc8ad0aebb0d3fc',
    checksum: '2896ed464aa5c8669ef138b074458f7154b62e63f2ebfa4548ff0351c35de904',
  },
  {
    name: 'supauth-overlay-connector-runtime-kind-v14',
    version: '14',
    sha256: '7d0d081f7943e8276c7a9c9f6cd246b4bea599bed86cd1494e0f2bcad1f337a9',
    checksum: '37f7c68ba32e772e3f2fad55b4186b0329cd5671ba4698e91e24615d57c24260',
  },
  {
    name: 'supauth-overlay-connector-runtime-kind-repair-v15',
    version: '15',
    sha256: '9268e1bf61c4385175394d3f2fbc3105cd5785f666333db5eb66a915985d16ec',
    checksum: '3f6c724b8b2327c6786d94cbe72ae63fdd1bbfe3d5ecd1f22d302fdce4130a19',
  },
  {
    name: 'supauth-overlay-function-access-repair-v16',
    version: '16',
    sha256: '6d190c9707e2b27de6b8860dca44d266475f5fddef62aca3f9b05d62844b5bb3',
    checksum: '8bd1b7c53affa4d6974025898937d045151d2b090e56ba50bb945feae5cd2c76',
  },
  {
    name: 'supauth-overlay-organization-template-default-v17',
    version: '17',
    sha256: '26946bcba446e98257231f679c1166b30d0279ffd148d63149b14f94cb99d464',
    checksum: 'c3df1c34e2bc64fd9651536340daa3777b9c5fe0a541d04635027054db7d8d43',
  },
  {
    name: 'supauth-overlay-organization-template-idempotency-v18',
    version: '18',
    sha256: '109a7363218fbd46ce1ee487ad54e678263c9247245563448f48b4203b3ce6a2',
    checksum: '7466285cfc27f25274b0c96c07295aced68d78610cc89271ef07b90aa26226df',
  },
] as const;
