import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, symlinkSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../helpers/runtime.mjs';

test('CLI entrypoint works when the repository path contains a symlink and spaces', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'guru cli '));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const link = join(dir, 'linked repository');
  symlinkSync(realpathSync(ROOT), link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [join(link, 'helpers/render.mjs'), '--help'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BRIEF.json/);
});
