import {mkdirSync, readFileSync} from 'node:fs';
import {basename, extname, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {ROOT, REMOTION_DIR, REMOTION_CLI, isMain, run, reportError} from './runtime.mjs';

const GROUPS = {
  autumn: ['autumn-'], school: ['school-'], 'animals-birthday': ['animals-birthday'],
  'rain-editorial': ['rain-editorial'], 'gold-birthday': ['gold-birthday'],
  'zolotoy-chas': ['zolotoy-chas'], 'buket-roz': ['buket-roz'],
  'nochnoy-portret': ['nochnoy-portret'], 'sredi-roz': ['sredi-roz'], cartoon: ['cartoon'],
  'daisy-field': ['daisy-field'], 'women-4-hairstyles': ['women-4-hairstyles', '2026-06-11-style-grid'],
  personas: ['anna-', 'nataly-', 'sofia-'],
  cvety: ['piony-v-nebo', 'bugenvilleya', 'amarillis', 'zakat-piony', 'belye-rozy', 'nezhnoe-utro', 'nochnaya-elegantnost'],
};
const PREFIXES = Object.entries(GROUPS).flatMap(([group, prefixes]) => prefixes.map(prefix => [prefix, group]))
  .sort((a, b) => b[0].length - a[0].length);
const FORMATS = ['16x9', '1x1', '9x16'];
const VARIANTS = ['2foto-cvety', '2foto', 'versiya', 'minuta'];

export function splitId(id, platform = '') {
  const format = FORMATS.includes(platform) && id.endsWith(`-${platform}`) ? platform : '';
  const stem = format ? id.slice(0, -format.length - 1) : id;
  const variant = VARIANTS.find(value => stem.endsWith(`-${value}`)) || '';
  return [variant ? stem.slice(0, -variant.length - 1) : stem, [variant, format].filter(Boolean).join('-') || stem];
}

export function outputPath(brief, briefFile, mode = 'still', outputDir = join(ROOT, 'output')) {
  const [visual, name] = splitId(brief.id ?? basename(briefFile, extname(briefFile)), brief.platform);
  const group = PREFIXES.find(([prefix]) => visual.startsWith(prefix))?.[1] || 'prochee';
  const family = visual === 'belye-rozy' || visual.startsWith('belye-rozy-');
  const parts = family ? ['belye-rozy', visual.slice('belye-rozy'.length + 1) || 'base'] : [visual];
  const extension = mode === 'still' ? (brief.render_options?.output_format ?? 'png') : 'mp4';
  return join(outputDir, group, ...parts, `${name}.${extension}`);
}

export function render(briefPath, {mode = 'still', frame, runner = run, outputDir} = {}) {
  const briefFile = resolve(ROOT, briefPath);
  const brief = JSON.parse(readFileSync(briefFile, 'utf8'));
  if (!brief.template) throw new Error("brief missing 'template' field");
  const output = outputPath(brief, briefFile, mode, outputDir);
  mkdirSync(resolve(output, '..'), {recursive: true});
  const args = [REMOTION_CLI, mode === 'still' ? 'still' : 'render', '--props', JSON.stringify(brief)];
  if (mode === 'still') args.push('--frame', String(frame ?? brief.render_options?.frame_for_still ?? 0));
  args.push('--output', output, 'src/index.ts', brief.template);
  // Run the local CLI directly: JSON and paths never pass through a shell.
  runner(process.execPath, args, REMOTION_DIR);
  return output;
}

function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    still: {type: 'boolean'}, video: {type: 'boolean'}, frame: {type: 'string'}, help: {type: 'boolean'},
  }});
  if (values.help) {
    console.log('node helpers/render.mjs BRIEF.json [--still|--video] [--frame N]');
    return;
  }
  if (positionals.length !== 1) throw new Error('Укажите один путь к JSON-брифу.');
  if (values.still && values.video) throw new Error('--still и --video нельзя использовать одновременно.');
  const frame = values.frame === undefined ? undefined : Number(values.frame);
  if (frame !== undefined && !Number.isInteger(frame)) throw new Error('--frame должен быть целым числом.');
  console.log(render(positionals[0], {mode: values.video ? 'video' : 'still', frame}));
}

if (isMain(import.meta.url)) {
  try { main(); } catch (error) { reportError(error); }
}
