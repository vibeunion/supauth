import { fileURLToPath } from 'node:url';
import { isHostedEntryName } from './build.js';

const name = process.argv[2];
if (!name || !isHostedEntryName(name)) throw new Error(`Unknown hosted entry: ${name}`);
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL(`${name}.ts`, import.meta.url))],
  target: 'browser',
  format: 'iife',
  minify: false,
  sourcemap: 'none',
});
const output = result.outputs[0];
if (!result.success || result.outputs.length !== 1 || !output) {
  throw new Error(`Failed to compile hosted entry ${name}: ${result.logs.map((log) => log.message).join('\n')}`);
}
// 内联代码不得提前闭合 script 标签；模板配置赋值仍由服务端替换。
process.stdout.write((await output.text()).replace(/<\/script/gi, '<\\/script'));
