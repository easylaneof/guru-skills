import {constants, copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, REMOTION_DIR, REMOTION_CLI, isMain, run, reportError} from './helpers/runtime.mjs';

export function createEnv(root = ROOT) {
  try {
    copyFileSync(join(root, '.env.example'), join(root, '.env'), constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Нужен Node.js 22 или новее с npm.');
  // On Windows npm is a .cmd launcher; this command contains no user-supplied arguments.
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/s', '/c', 'npm ci'], REMOTION_DIR);
  else run('npm', ['ci'], REMOTION_DIR);
  run(process.execPath, [REMOTION_CLI, 'browser', 'ensure'], REMOTION_DIR);
  createEnv();
  run(process.execPath, [join(REMOTION_DIR, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], REMOTION_DIR);
  run(process.execPath, ['--test']);
  for (const format of ['1x1', '16x9', '9x16']) {
    run(process.execPath, ['helpers/render.mjs', `examples/poster-${format}.json`]);
  }
  console.log('Готово. Примеры: output/prochee/example/. Скилл: .agents/skills/guru-photo-creatives/SKILL.md');
  console.log('Для генерации укажите свой KIE_AI_API_KEY в .env. Ключ не нужен для наложения текста.');
}

if (isMain(import.meta.url)) {
  try { main(); } catch (error) { reportError(error); }
}
