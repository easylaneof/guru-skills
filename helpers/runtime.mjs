import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REMOTION_DIR = join(ROOT, 'remotion');
export const REMOTION_CLI = join(REMOTION_DIR, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

export function isMain(url) {
  return Boolean(process.argv[1]) && fileURLToPath(url) === realpathSync(process.argv[1]);
}

export function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Команда завершилась с ошибкой: ${command} (код ${result.status ?? result.signal})`);
}

export function reportError(error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
