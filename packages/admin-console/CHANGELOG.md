# Changelog

## [0.1.0](https://github.com/zuohuadong/supauth/compare/admin-console-v0.0.1...admin-console-v0.1.0) (2026-06-04)


### Features

* add application-specific sign-in experience ([7b865fb](https://github.com/zuohuadong/supauth/commit/7b865fb27de72985db75db644411b67d527c9114))
* add authorization compiler and auth hooks bridge ([d86a298](https://github.com/zuohuadong/supauth/commit/d86a2984165fd141cab1a6e0be4e15ad39981d54))
* add release-please CI, npm publish pipeline, and auth-ui hosted page error handling ([2ef0a8d](https://github.com/zuohuadong/supauth/commit/2ef0a8da34d33aeba0dd617a0206d5e3193b20a8))
* add security policy console ([3b628c0](https://github.com/zuohuadong/supauth/commit/3b628c0e0ec906499a3e6f6c42aa8402940bfb02))
* add Supabase compatibility validation ([a0f5733](https://github.com/zuohuadong/supauth/commit/a0f5733dc9df37141f1f76619081ff096c0a4a8c))
* complete P0-P2 tasks — roles, bindings, webhooks delivery, sync, docs, UI ([3e88b39](https://github.com/zuohuadong/supauth/commit/3e88b39ca20014ad311165998a10afaf3e2bccf4))
* extend IdP capabilities — tenant config, enterprise SSO, consents, org templates, passkeys, provisioning, API versioning, security config, DR scripts, docs ([ac8a49f](https://github.com/zuohuadong/supauth/commit/ac8a49f78f049ed3c27408d91ef8de1fa6c14aaf))
* hosted sign-in page — social login, custom phrases, signup/forgot-password UI, custom UI assets upload ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** custom phrases from tenant_configs ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** custom UI assets zip upload ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** signup and forgot-password forms ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* **hosted-ui:** social login buttons from SupaCloud providers ([206404d](https://github.com/zuohuadong/supauth/commit/206404d5a2576be4fd3e4714fc16c08770db4b5d))
* rename [@supaoauth](https://github.com/supaoauth) to [@supauth](https://github.com/supauth) scope and fix SDK publish build chain ([65ae780](https://github.com/zuohuadong/supauth/commit/65ae780bb074d5a5cbf76888e1235375139e077c))


### Bug Fixes

* **auth:** keep hosted authorize layout on latest ([a35301d](https://github.com/zuohuadong/supauth/commit/a35301d203e0f50774faaf65479fde0c052527ae))
* **auth:** keep hosted authorize layout on latest ([41e5074](https://github.com/zuohuadong/supauth/commit/41e50747fe10a200c4e9018d858d0a46233ea8eb))
* **auth:** make publicApiBase configurable via meta tag ([f60fe01](https://github.com/zuohuadong/supauth/commit/f60fe013895091a3ef4c37df47590d8467bb3673))
* **auth:** serve hosted oauth page with custom domain API base ([7d0e156](https://github.com/zuohuadong/supauth/commit/7d0e1566f92ff6bb3d2b5b406f32df065659a421))
* **auth:** surface signup runtime drift ([5e6d160](https://github.com/zuohuadong/supauth/commit/5e6d1605e01c9f812d054d74e46c1e40fcc824d0))
* **auth:** surface signup runtime drift ([fc8e90e](https://github.com/zuohuadong/supauth/commit/fc8e90ea5160a40b53a70f7702c64a0c2f607c71))
* **hosted-auth:** block expired authorization pages ([6b0ff58](https://github.com/zuohuadong/supauth/commit/6b0ff581421bb530a6e485866e6b5548a2e041c6))
* **hosted-auth:** require explicit connector enablement ([066f69a](https://github.com/zuohuadong/supauth/commit/066f69a82bd23a16fe50b9befc7b8d5893562ffd))
* **port:** use 4010 as default auth-server port ([66546b5](https://github.com/zuohuadong/supauth/commit/66546b56b0a6e5aa8041a0a1e34b953818375402))
