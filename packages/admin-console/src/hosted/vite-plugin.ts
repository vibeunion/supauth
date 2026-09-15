import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { hostedPageNames, renderHostedPage } from './build.js';

export function hostedPagesPlugin(): Plugin {
  let projectRoot = '';
  let building = false;
  let ssrBuild = false;
  return {
    name: 'supauth-checked-hosted-pages',
    // 必须先于 SvelteKit 的静态资源中间件注册；构建收尾另由 closeBundle.order 控制。
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root;
      building = config.command === 'build';
      ssrBuild = Boolean(config.build.ssr);
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const name = hostedPageNames.find((page) => pathname === `/${page}.html` || pathname === `/admin/${page}.html`);
        if (!name) return next();
        try {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(await renderHostedPage(name));
        } catch (error) {
          next(error);
        }
      });
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (!building || !ssrBuild) return;
        // SvelteKit adapter-static 的 build 输出也必须使用同一组受检脚本。
        for (const page of hostedPageNames) {
          await writeFile(resolve(projectRoot, 'build', `${page}.html`), await renderHostedPage(page));
        }
      },
    },
  };
}
