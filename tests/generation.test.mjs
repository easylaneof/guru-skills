import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {KieClient, generateAsset} from '../helpers/generate_assets.mjs';

const env = {KIE_AI_API_KEY: 'test-only'};
const reply = (data) => Response.json({code: 200, data});
const noNetwork = () => assert.fail('Unexpected network request');
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'guru-skills-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function client(fetchImpl = noNetwork, options = {}) {
  return new KieClient({env, fetchImpl, log: () => {}, ...options});
}

test('URL input is passed through without an upload', async () => {
  assert.equal(await client().resolveImageInput('https://example.com/photo.jpg'), 'https://example.com/photo.jpg');
});

test('local file upload, generation, download and sidecar retain the existing contract', async (t) => {
  const dir = temp(t);
  const source = join(dir, 'source.jpg');
  writeFileSync(source, 'original-image-content');
  const calls = [];
  const kie = client(async (url, options) => {
    calls.push(url);
    const path = new URL(url).pathname;
    if (path === '/api/file-stream-upload') {
      assert.equal(await options.body.get('file').text(), 'original-image-content');
      assert.equal(options.body.get('file').type, 'image/jpeg');
      assert.equal(options.body.get('uploadPath'), 'photo-creatives');
      assert.equal(options.headers.Authorization, 'Bearer test-only');
      return reply({downloadUrl: 'https://example.com/upload.png'});
    }
    if (path === '/api/v1/jobs/createTask') {
      assert.deepEqual(JSON.parse(options.body), {model: 'nano-banana-pro', input: {
        prompt: 'Keep the same person', aspect_ratio: '9:16', resolution: '1K', output_format: 'png',
        image_input: ['https://example.com/upload.png'],
      }});
      return reply({taskId: 'test-task'});
    }
    if (path === '/api/v1/jobs/recordInfo') {
      assert.equal(new URL(url).searchParams.get('taskId'), 'test-task');
      return reply({state: 'success', resultJson: JSON.stringify({resultUrls: ['https://example.com/result.png']})});
    }
    assert.equal(path, '/result.png');
    assert.equal(options.headers?.Authorization, undefined);
    return new Response('rendered-image');
  });
  const assetsDir = join(dir, 'assets');
  assert.equal(await generateAsset({prompt: 'Keep the same person', imageInput: source, name: 'roses', size: '9:16'}, {client: kie, assetsDir}), 'assets/roses.png');
  assert.equal(readFileSync(join(assetsDir, 'roses.png'), 'utf8'), 'rendered-image');
  const sidecar = JSON.parse(readFileSync(join(assetsDir, 'roses.json'), 'utf8'));
  assert.equal(sidecar.image_input, source);
  assert.equal(sidecar.task_id, 'test-task');
  assert.equal(sidecar.filename, 'roses.png');
  assert.equal(sidecar.prompt, 'Keep the same person');
  assert.equal(sidecar.model, 'nano-banana-pro');
  assert.equal(sidecar.size, '9:16');
  assert.match(sidecar.generated_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(calls.length, 4);
});

test('native fetch serializes a local photo as multipart data', async (t) => {
  const dir = temp(t);
  const source = join(dir, 'source.webp');
  writeFileSync(source, 'local-photo-bytes');
  let received;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = {headers: req.headers, body: Buffer.concat(chunks).toString()};
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({code: 200, data: {downloadUrl: 'https://example.com/upload.webp'}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const kie = new KieClient({env: {...env, KIE_AI_UPLOAD_BASE: `http://127.0.0.1:${server.address().port}`}, log: () => {}});
  assert.equal(await kie.uploadImage(source), 'https://example.com/upload.webp');
  assert.match(received.headers['content-type'], /multipart\/form-data; boundary=/);
  assert.match(received.body, /name="file"; filename="source.webp"/);
  assert.match(received.body, /local-photo-bytes/);
  assert.equal(received.headers.authorization, 'Bearer test-only');
});

test('sidecar reuploads saved photo before using a potentially expired URL', async (t) => {
  const dir = temp(t);
  writeFileSync(join(dir, 'source.png'), 'image');
  const sidecar = join(dir, 'source.json');
  writeFileSync(sidecar, JSON.stringify({filename: 'source.png', cdn_url: 'https://example.com/expired.png'}));
  const kie = client(async url => {
    assert.match(url, /file-stream-upload$/);
    return reply({downloadUrl: 'https://example.com/fresh.png'});
  });
  assert.equal(await kie.resolveImageInput(sidecar), 'https://example.com/fresh.png');
  rmSync(join(dir, 'source.png'));
  assert.equal(await client().resolveImageInput(sidecar), 'https://example.com/expired.png');
});

test('API errors in HTTP 200 and HTTP failures are surfaced', async () => {
  const kie = client(async () => Response.json({code: 401, msg: 'Invalid key'}));
  await assert.rejects(kie.poll('task'), /Invalid key/);
  await assert.rejects(kie.createTask({prompt: 'photo'}), /Invalid key/);
  await assert.rejects(client(async () => new Response('', {status: 503})).poll('task'), /HTTP 503/);
});

test('failed upload stops before a paid generation and produces no output', async (t) => {
  const dir = temp(t);
  const source = join(dir, 'source.jpg');
  writeFileSync(source, 'image');
  let requests = 0;
  const kie = client(async url => {
    requests++;
    assert.match(url, /file-stream-upload$/);
    return Response.json({code: 400, msg: 'Bad upload'});
  });
  await assert.rejects(generateAsset({prompt: 'photo', imageInput: source}, {client: kie, assetsDir: dir}), /Bad upload/);
  assert.equal(requests, 1);
  assert.deepEqual(readdirSync(dir), ['source.jpg']);
});

test('missing source, missing key and existing asset fail before network requests', async (t) => {
  const dir = temp(t);
  await assert.rejects(client().resolveImageInput(join(dir, 'missing.jpg'), {assetsDir: dir}), /не найдено/);
  await assert.rejects(generateAsset({prompt: 'photo'}, {client: client(noNetwork, {env: {}}), assetsDir: dir}), /KIE_AI_API_KEY/);
  writeFileSync(join(dir, 'existing.png'), 'keep');
  await assert.rejects(generateAsset({prompt: 'photo', name: 'existing'}, {client: client(), assetsDir: dir}), /уже существует/);
  assert.equal(readFileSync(join(dir, 'existing.png'), 'utf8'), 'keep');
  await assert.rejects(generateAsset({prompt: 'photo', name: '../escape'}, {client: client(), assetsDir: dir}), /без папок/);
});

test('pending task is polled without creating a second generation', async () => {
  let calls = 0;
  const waits = [];
  const kie = client(async url => {
    assert.match(url, /recordInfo/);
    calls++;
    return reply(calls === 1 ? {state: 'processing'} : {state: 'fail', failMsg: 'Provider error'});
  }, {wait: async ms => waits.push(ms)});
  await assert.rejects(kie.poll('task'), /Provider error/);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [4000]);
});

test('polling is bounded and preserves task ID in timeout', async () => {
  let now = 0;
  const kie = client(async () => reply({state: 'processing'}), {now: () => now, wait: async () => { now += 300000; }});
  await assert.rejects(kie.poll('saved-task'), /Timeout.*saved-task/);
});
