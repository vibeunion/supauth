# Changelog

## [0.1.1](https://github.com/zuohuadong/supauth/compare/auth-server-v0.1.0...auth-server-v0.1.1) (2026-06-04)


### Bug Fixes

* **auth-server:** export connector provider type ([0a1151d](https://github.com/zuohuadong/supauth/commit/0a1151d5765abd918413163dd5dbf08ddc028fdd))
* **auth-server:** export connector provider type ([21b61f7](https://github.com/zuohuadong/supauth/commit/21b61f7e3ab919d4277554739c0c31db25a702b4))

## [0.1.0](https://github.com/zuohuadong/supauth/compare/auth-server-v0.0.1...auth-server-v0.1.0) (2026-06-04)


### Features

* add application-specific sign-in experience ([7b865fb](https://github.com/zuohuadong/supauth/commit/7b865fb27de72985db75db644411b67d527c9114))
* add authorization compiler and auth hooks bridge ([d86a298](https://github.com/zuohuadong/supauth/commit/d86a2984165fd141cab1a6e0be4e15ad39981d54))
* add gotrue-compatible sso authorize entry ([d774a06](https://github.com/zuohuadong/supauth/commit/d774a064f3a4ea0adee18c8d5bbac5369337c854))
* add release-please CI, npm publish pipeline, and auth-ui hosted page error handling ([2ef0a8d](https://github.com/zuohuadong/supauth/commit/2ef0a8da34d33aeba0dd617a0206d5e3193b20a8))
* add Supabase compatibility validation ([a0f5733](https://github.com/zuohuadong/supauth/commit/a0f5733dc9df37141f1f76619081ff096c0a4a8c))
* complete P0-25~P0-29 — adapter live contract, project-scoped reconcile, app_metadata merge safety, RBAC bridge, route gate ([610ecec](https://github.com/zuohuadong/supauth/commit/610ececf0c4ceb6c90826bd13c8ab5a9259b486c))
* complete P0-P2 tasks — roles, bindings, webhooks delivery, sync, docs, UI ([3e88b39](https://github.com/zuohuadong/supauth/commit/3e88b39ca20014ad311165998a10afaf3e2bccf4))
* extend IdP capabilities — tenant config, enterprise SSO, consents, org templates, passkeys, provisioning, API versioning, security config, DR scripts, docs ([ac8a49f](https://github.com/zuohuadong/supauth/commit/ac8a49f78f049ed3c27408d91ef8de1fa6c14aaf))
* hosted sign-in page — social login, custom phrases, signup/forgot-password UI, custom UI assets upload ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** custom phrases from tenant_configs ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** custom UI assets zip upload ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** signup and forgot-password forms ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** social login buttons from SupaCloud providers ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* rename [@supaoauth](https://github.com/supaoauth) to [@supauth](https://github.com/supauth) scope and fix SDK publish build chain ([65ae780](https://github.com/zuohuadong/supauth/commit/65ae780bb074d5a5cbf76888e1235375139e077c))


### Bug Fixes

* address PR review findings ([94222ba](https://github.com/zuohuadong/supauth/commit/94222bae80ca6c43cc02efef24eb7b541f0966d2))
* **auth-server:** harden hosted page path resolution ([e0bb7f8](https://github.com/zuohuadong/supauth/commit/e0bb7f8492937e742819d755a7c10f7e91c85251))
* **auth-server:** harden sso client lookup ([aeadd22](https://github.com/zuohuadong/supauth/commit/aeadd22b41ded7c615ea4912a93779f67be8d84b))
* **auth-server:** only show enabled connectors on login page ([f0e40ca](https://github.com/zuohuadong/supauth/commit/f0e40ca5d1d45fa58c9001e854b19c73bf6c22c8))
* **auth-server:** resolve admin-console build path for Bun bundle ([bf40d31](https://github.com/zuohuadong/supauth/commit/bf40d314e9f3557d22c6aaaba31243b1215e6fac))
* **auth:** harden project-scoped runtime reconciliation ([9cc85df](https://github.com/zuohuadong/supauth/commit/9cc85df70c4ee60f5646d0f324c823947fbc5282))
* **auth:** serve hosted oauth page with custom domain API base ([7d0e156](https://github.com/zuohuadong/supauth/commit/7d0e1566f92ff6bb3d2b5b406f32df065659a421))
* **auth:** surface signup runtime drift ([5e6d160](https://github.com/zuohuadong/supauth/commit/5e6d1605e01c9f812d054d74e46c1e40fcc824d0))
* **auth:** surface signup runtime drift ([fc8e90e](https://github.com/zuohuadong/supauth/commit/fc8e90ea5160a40b53a70f7702c64a0c2f607c71))
* **hosted-auth:** block expired authorization pages ([6b0ff58](https://github.com/zuohuadong/supauth/commit/6b0ff581421bb530a6e485866e6b5548a2e041c6))
* **hosted-auth:** require explicit connector enablement ([066f69a](https://github.com/zuohuadong/supauth/commit/066f69a82bd23a16fe50b9befc7b8d5893562ffd))
* **hosted-auth:** serve favicon on hosted pages ([effcd14](https://github.com/zuohuadong/supauth/commit/effcd14b13f2bc42e116f4566a5d0260c0fe2a34))
* **port:** use 4010 as default auth-server port ([66546b5](https://github.com/zuohuadong/supauth/commit/66546b56b0a6e5aa8041a0a1e34b953818375402))


### Elegance & Refactoring

* **auth-server:** move hosted pages to dedicated route module ([#5](https://github.com/zuohuadong/supauth/issues/5)) ([2f4e256](https://github.com/zuohuadong/supauth/commit/2f4e25624e3ee1b74eb8160befb0eb60b143799f))


### CI

* publish server and console release artifacts ([1e66299](https://github.com/zuohuadong/supauth/commit/1e66299fc8ea2938a7b31d495668e08ed48c5960))
