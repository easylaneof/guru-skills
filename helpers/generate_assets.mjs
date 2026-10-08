import {existsSync, readFileSync, writeFileSync, mkdirSync, statSync} from 'node:fs';
import {basename, extname, isAbsolute, join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import {ROOT, isMain, reportError} from './runtime.mjs';

export const ASSETS_DIR = join(ROOT, 'remotion', 'public', 'assets');
const isUrl = (value) => /^https?:\/\//.test(value);
const mimeTypes = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};

// HTTP transport and clock are injected so tests never call the paid API.
export class KieClient {
  constructor({env = process.env, fetchImpl = globalThis.fetch, wait = sleep, now = () => performance.now(), log = console.error} = {}) {
    this.base = (env.KIE_AI_API_BASE || 'https://api.kie.ai').replace(/\/+$/, '');
    this.uploadBase = (env.KIE_AI_UPLOAD_BASE || 'https://kieai.redpandaai.co').replace(/\/+$/, '');
    this.key = env.KIE_AI_API_KEY;
    this.model = env.KIE_AI_MODEL || 'nano-banana-pro';
    this.fetch = fetchImpl;
    this.wait = wait;
    this.now = now;
    this.log = log;
  }

  async request(url, options = {}, timeout = 60000) {
    const response = await this.fetch(url, {...options, signal: AbortSignal.timeout(timeout)});
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).pathname}`);
    return response;
  }

  async api(url, options = {}, timeout = 60000) {
    const response = await this.request(url, {
      ...options,
      headers: {...options.headers, Authorization: `Bearer ${this.key}`},
    }, timeout);
    const payload = await response.json();
    if (payload.code !== 200 || payload.success === false) {
      throw new Error(`Kie.ai: ${payload.msg || payload.message || payload.code}`);
    }
    return payload.data;
  }

  async uploadImage(path) {
    const extension = extname(path).toLowerCase();
    if (!mimeTypes[extension]) throw new Error('Исходник должен быть PNG, JPG или WebP.');
    const form = new FormData();
    form.append('file', new Blob([readFileSync(path)], {type: mimeTypes[extension]}), basename(path));
    form.append('uploadPath', 'photo-creatives');
    form.append('fileName', `${randomUUID().replaceAll('-', '')}${extension}`);
    const data = await this.api(`${this.uploadBase}/api/file-stream-upload`, {method: 'POST', body: form}, 120000);
    if (!data?.downloadUrl) throw new Error('Upload response has no downloadUrl.');
    return data.downloadUrl;
  }

  async resolveImageInput(input, {assetsDir = ASSETS_DIR, cwd = process.cwd()} = {}) {
    if (!input) return null;
    if (isUrl(input)) return input;
    const expanded = input.startsWith('~/') ? join(homedir(), input.slice(2)) : input;
    const local = resolve(cwd, expanded);
    const path = isAbsolute(expanded) || existsSync(local) ? local : join(assetsDir, basename(expanded));
    if (extname(path).toLowerCase() === '.json') {
      const metadata = JSON.parse(readFileSync(path, 'utf8'));
      if (metadata.filename && basename(metadata.filename) === metadata.filename) {
        const original = resolve(path, '..', metadata.filename);
        if (existsSync(original) && statSync(original).isFile()) return this.uploadImage(original);
      }
      if (!metadata.cdn_url || !isUrl(metadata.cdn_url)) {
        throw new Error('В сайдкаре нет локального оригинала или HTTP(S) cdn_url.');
      }
      return metadata.cdn_url;
    }
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Исходное фото не найдено: ${input}`);
    return this.uploadImage(path);
  }

  async createTask({prompt, size = '1:1', model = this.model, imageUrl = null}) {
    const input = {prompt: Array.from(prompt).slice(0, 5000).join(''), output_format: 'png', aspect_ratio: size, resolution: '1K'};
    if (imageUrl) input.image_input = [imageUrl];
    const data = await this.api(`${this.base}/api/v1/jobs/createTask`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model, input}),
    });
    if (!data?.taskId) throw new Error('createTask response has no taskId.');
    this.log(`taskId: ${data.taskId}`);
    return data.taskId;
  }

  async poll(taskId) {
    const deadline = this.now() + 300000;
    while (this.now() < deadline) {
      const data = await this.api(`${this.base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {}, 30000);
      const state = data?.state || 'processing';
      if (state === 'success') {
        const url = JSON.parse(data.resultJson || '{}').resultUrls?.[0];
        if (!url) throw new Error('success state but no resultUrls');
        // Download from the CDN without sending the Kie.ai API key.
        const response = await this.request(url);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) throw new Error('Провайдер вернул пустой файл.');
        return {bytes, url};
      }
      if (state === 'fail') throw new Error(`Generation failed: ${data.failCode || ''} ${data.failMsg || ''}`);
      this.log(`State: ${state} — waiting...`);
      await this.wait(4000);
    }
    throw new Error(`Timeout after 300s (taskId: ${taskId})`);
  }
}

export async function generateAsset({prompt, name, size = '1:1', model, imageInput}, {
  client = new KieClient(), assetsDir = ASSETS_DIR, cwd = process.cwd(),
} = {}) {
  if (!client.key) throw new Error('KIE_AI_API_KEY not set in .env');
  if (!prompt?.trim()) throw new Error('Промпт не должен быть пустым.');
  if (name) {
    if (/[\\/]/.test(name) || ['.', '..'].includes(name)) throw new Error('--name должен быть именем файла, без папок.');
    if (!name.endsWith('.png')) name += '.png';
    if (existsSync(join(assetsDir, name)) || existsSync(join(assetsDir, name.slice(0, -4) + '.json'))) {
      throw new Error('Такой ассет уже существует. Выберите новое --name.');
    }
  }
  model ||= client.model;
  const imageUrl = await client.resolveImageInput(imageInput, {assetsDir, cwd});
  const taskId = await client.createTask({prompt, size, model, imageUrl});
  const {bytes, url} = await client.poll(taskId);
  mkdirSync(assetsDir, {recursive: true});
  name ||= `gen_${taskId.slice(0, 8)}.png`;
  writeFileSync(join(assetsDir, name), bytes);
  const date = new Date();
  const generatedAt = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  writeFileSync(join(assetsDir, name.slice(0, -4) + '.json'), JSON.stringify({
    filename: name, prompt, model, size, task_id: taskId, cdn_url: url,
    image_input: imageInput ?? null, generated_at: generatedAt,
  }, null, 2) + '\n');
  client.log(`Saved: ${join(assetsDir, name)}`);
  return `assets/${name}`;
}

async function main() {
  const {values} = parseArgs({options: {
    prompt: {type: 'string'}, name: {type: 'string'}, size: {type: 'string', default: '1:1'},
    model: {type: 'string'}, 'image-input': {type: 'string'}, help: {type: 'boolean'},
  }});
  if (values.help) {
    console.log('node helpers/generate_assets.mjs --prompt "..." [--image-input FILE_OR_URL] [--name NAME] [--size 1:1] [--model nano-banana-pro]');
    return;
  }
  if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
  console.log(await generateAsset({...values, imageInput: values['image-input']}));
}

if (isMain(import.meta.url)) main().catch(reportError);
