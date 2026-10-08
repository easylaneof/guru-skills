import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {render, outputPath} from '../helpers/render.mjs';
import {createEnv} from '../setup.mjs';

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'guru render '));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}

test('existing output groups, variants, family and legacy paths are preserved', () => {
  const cases = [
    ['portrait-minuta-1x1', '1x1', ['prochee', 'portrait', 'minuta-1x1.png']],
    ['piony-v-nebo-2foto-cvety-16x9', '16x9', ['cvety', 'piony-v-nebo', '2foto-cvety-16x9.png']],
    ['belye-rozy-mid-2foto-9x16', '9x16', ['cvety', 'belye-rozy', 'mid', '2foto-9x16.png']],
    ['belye-rozy-2foto-1x1', '1x1', ['cvety', 'belye-rozy', 'base', '2foto-1x1.png']],
    ['old-id', 'vk', ['prochee', 'old-id', 'old-id.png']],
  ];
  for (const [id, platform, parts] of cases) assert.equal(outputPath({id, platform}, 'brief.json', 'still', '/out'), join('/out', ...parts));
});

test('render passes JSON with quotes and paths with spaces as separate arguments', (t) => {
  const dir = temp(t);
  const file = join(dir, 'my brief.json');
  const brief = {id: 'demo-minuta-1x1', template: 'PosterStill', platform: '1x1', copy: {headline: 'Фото "с ИИ" $test'}, render_options: {frame_for_still: 30}};
  writeFileSync(file, JSON.stringify(brief));
  let args;
  const result = render(file, {frame: 0, outputDir: dir, runner: (command, values) => { assert.equal(command, process.execPath); args = values; }});
  assert.deepEqual(JSON.parse(args[args.indexOf('--props') + 1]), brief);
  assert.equal(args[args.indexOf('--frame') + 1], '0');
  assert.equal(args[args.indexOf('--output') + 1], result);
  assert.equal(result, join(dir, 'prochee', 'demo', 'minuta-1x1.png'));
  render(file, {mode: 'video', outputDir: dir, runner: (_, values) => {
    assert.equal(values[1], 'render');
    assert.ok(!values.includes('--frame'));
    assert.ok(values[values.indexOf('--output') + 1].endsWith('.mp4'));
  }});
});

test('render failure is reported instead of returning a successful output path', (t) => {
  const dir = temp(t);
  const file = join(dir, 'brief.json');
  writeFileSync(file, JSON.stringify({template: 'PosterStill'}));
  assert.throws(() => render(file, {outputDir: dir, runner: () => { throw new Error('render failed'); }}), /render failed/);
});

test('setup creates .env once and preserves existing user settings', (t) => {
  const dir = temp(t);
  writeFileSync(join(dir, '.env.example'), 'KIE_AI_API_KEY=\n');
  createEnv(dir);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'KIE_AI_API_KEY=\n');
  writeFileSync(join(dir, '.env'), 'USER_SETTING=keep\n');
  createEnv(dir);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'USER_SETTING=keep\n');
});
