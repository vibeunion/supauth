# Changelog

## [0.5.0](https://github.com/zuohuadong/supauth/compare/sdk-typescript-v0.4.0...sdk-typescript-v0.5.0) (2026-07-30)


### Features

* **rbac:** scope role management by application ([318323c](https://github.com/zuohuadong/supauth/commit/318323c7769a61437977088f8b2be6d11b1a9779))

## [0.4.0](https://github.com/zuohuadong/supauth/compare/sdk-typescript-v0.3.0...sdk-typescript-v0.4.0) (2026-07-29)


### Features

* add application-specific sign-in experience ([7b865fb](https://github.com/zuohuadong/supauth/commit/7b865fb27de72985db75db644411b67d527c9114))
* add authorization compiler and auth hooks bridge ([d86a298](https://github.com/zuohuadong/supauth/commit/d86a2984165fd141cab1a6e0be4e15ad39981d54))
* add release-please CI, npm publish pipeline, and auth-ui hosted page error handling ([db46032](https://github.com/zuohuadong/supauth/commit/db460328a23b0803bbcebaf958fd20b87e5d8481))
* add supabase auth-ui bridge sdk ([2f834c2](https://github.com/zuohuadong/supauth/commit/2f834c2af151eb7bf191f5f85b068bb15bd8da51))
* add Supabase compatibility validation ([a0f5733](https://github.com/zuohuadong/supauth/commit/a0f5733dc9df37141f1f76619081ff096c0a4a8c))
* **admin-console:** improve SupaCloud-backed diagnostics ([#19](https://github.com/zuohuadong/supauth/issues/19)) ([aabec40](https://github.com/zuohuadong/supauth/commit/aabec405c07a4df26f54aeb2bf2ae49162a1f0cf))
* **auth-ui:** add @supaoauth/sdk-auth-ui bridge package ([2f834c2](https://github.com/zuohuadong/supauth/commit/2f834c2af151eb7bf191f5f85b068bb15bd8da51))
* **auth:** ship GoTrue-only SupaOAuth 0.3.0 ([ab78f72](https://github.com/zuohuadong/supauth/commit/ab78f7220c451d42630a6b4d724550c98e041361))
* complete P0-P2 tasks — roles, bindings, webhooks delivery, sync, docs, UI ([3e88b39](https://github.com/zuohuadong/supauth/commit/3e88b39ca20014ad311165998a10afaf3e2bccf4))
* extend IdP capabilities — tenant config, enterprise SSO, consents, org templates, passkeys, provisioning, API versioning, security config, DR scripts, docs ([ac8a49f](https://github.com/zuohuadong/supauth/commit/ac8a49f78f049ed3c27408d91ef8de1fa6c14aaf))
* mature hosted auth customization and rbac console ([2883a6a](https://github.com/zuohuadong/supauth/commit/2883a6aba37c852c2a4d78382ea93d53db38dd29))
* rename [@supaoauth](https://github.com/supaoauth) to [@supauth](https://github.com/supauth) scope and fix SDK publish build chain ([894ad52](https://github.com/zuohuadong/supauth/commit/894ad525b6270e54a69699460f2384166fa265f1))
* **sdk:** extend public auth contract ([2f834c2](https://github.com/zuohuadong/supauth/commit/2f834c2af151eb7bf191f5f85b068bb15bd8da51))


### Bug Fixes

* **port:** use 4010 as default auth-server port ([6c61115](https://github.com/zuohuadong/supauth/commit/6c6111511e3c53fb9769aa6526a3c81b7ea4ab4d))
* rename [@supaoauth](https://github.com/supaoauth) to [@supauth](https://github.com/supauth) scope in SDK package.json files ([c13d369](https://github.com/zuohuadong/supauth/commit/c13d369bb87d3f327219f4086cd835cf1881ebc7))


### Documentation

* add SDK usage to README and per-package README files ([e3e10a1](https://github.com/zuohuadong/supauth/commit/e3e10a17dc05efc04b21dfb7a13f16ec7e3360d2))


### Miscellaneous Chores

* release main ([15fe62b](https://github.com/zuohuadong/supauth/commit/15fe62b9516e5a913ff1638ca47b7484422f1314))
* release main ([9a4afbc](https://github.com/zuohuadong/supauth/commit/9a4afbcd5f4ec8bb5501690000064e3c6267d874))
* release main ([#17](https://github.com/zuohuadong/supauth/issues/17)) ([19a118f](https://github.com/zuohuadong/supauth/commit/19a118f67c0caae73f99b3262948dd5d7084bbb6))
* upgrade Supabase and SupaCloud SDK compatibility ([b9e9ac8](https://github.com/zuohuadong/supauth/commit/b9e9ac821e617e88443921ae789e7633363395f3))

## [0.2.0](https://github.com/zuohuadong/supauth/compare/sdk-typescript-v0.1.0...sdk-typescript-v0.2.0) (2026-06-19)


### Features

* **admin-console:** improve SupaCloud-backed diagnostics ([#19](https://github.com/zuohuadong/supauth/issues/19)) ([aabec40](https://github.com/zuohuadong/supauth/commit/aabec405c07a4df26f54aeb2bf2ae49162a1f0cf))

## [0.1.0](https://github.com/zuohuadong/supauth/compare/sdk-typescript-v0.0.1...sdk-typescript-v0.1.0) (2026-06-04)


### Features

* add application-specific sign-in experience ([7b865fb](https://github.com/zuohuadong/supauth/commit/7b865fb27de72985db75db644411b67d527c9114))
* add authorization compiler and auth hooks bridge ([d86a298](https://github.com/zuohuadong/supauth/commit/d86a2984165fd141cab1a6e0be4e15ad39981d54))
* add release-please CI, npm publish pipeline, and auth-ui hosted page error handling ([2ef0a8d](https://github.com/zuohuadong/supauth/commit/2ef0a8da34d33aeba0dd617a0206d5e3193b20a8))
* add supabase auth-ui bridge sdk ([3b911c1](https://github.com/zuohuadong/supauth/commit/3b911c14048010c021160e8dfbaf455152f9761c))
* add Supabase compatibility validation ([a0f5733](https://github.com/zuohuadong/supauth/commit/a0f5733dc9df37141f1f76619081ff096c0a4a8c))
* **auth-ui:** add @supaoauth/sdk-auth-ui bridge package ([3b911c1](https://github.com/zuohuadong/supauth/commit/3b911c14048010c021160e8dfbaf455152f9761c))
* complete P0-P2 tasks — roles, bindings, webhooks delivery, sync, docs, UI ([3e88b39](https://github.com/zuohuadong/supauth/commit/3e88b39ca20014ad311165998a10afaf3e2bccf4))
* extend IdP capabilities — tenant config, enterprise SSO, consents, org templates, passkeys, provisioning, API versioning, security config, DR scripts, docs ([ac8a49f](https://github.com/zuohuadong/supauth/commit/ac8a49f78f049ed3c27408d91ef8de1fa6c14aaf))
* rename [@supaoauth](https://github.com/supaoauth) to [@supauth](https://github.com/supauth) scope and fix SDK publish build chain ([65ae780](https://github.com/zuohuadong/supauth/commit/65ae780bb074d5a5cbf76888e1235375139e077c))
* **sdk:** extend public auth contract ([3b911c1](https://github.com/zuohuadong/supauth/commit/3b911c14048010c021160e8dfbaf455152f9761c))


### Bug Fixes

* **port:** use 4010 as default auth-server port ([66546b5](https://github.com/zuohuadong/supauth/commit/66546b56b0a6e5aa8041a0a1e34b953818375402))
* rename [@supaoauth](https://github.com/supaoauth) to [@supauth](https://github.com/supauth) scope in SDK package.json files ([dbaf9b3](https://github.com/zuohuadong/supauth/commit/dbaf9b3a6f03ffaad64a98544c39a81785a32179))


### Documentation

* add SDK usage to README and per-package README files ([3ff54f2](https://github.com/zuohuadong/supauth/commit/3ff54f25805915a102bd9ed6a120286bda6b24f4))
