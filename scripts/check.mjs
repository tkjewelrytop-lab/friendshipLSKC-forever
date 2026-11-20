import { readFile, readdir, stat } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const problems = [];
let scriptCount = 0;
let referenceCount = 0;

if (typeof vm.SourceTextModule !== 'function') {
  console.error('Run npm run check, or node --experimental-vm-modules scripts/check.mjs.');
  process.exit(1);
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filename) : [filename];
  }));
  return groups.flat();
}

async function checkReference(source, reference) {
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return;
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean) return;
  if (clean.startsWith('/')) {
    problems.push(`${path.relative(root, source)} uses a root-relative URL that breaks repository Pages: ${reference}`);
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(clean); } catch {
    problems.push(`${path.relative(root, source)} contains an invalid URL: ${reference}`);
    return;
  }
  const destination = path.resolve(path.dirname(source), decoded);
  if (!destination.startsWith(`${dist}${path.sep}`) && destination !== dist) {
    problems.push(`${path.relative(root, source)} references a file outside dist: ${reference}`);
    return;
  }
  try {
    const info = await stat(destination);
    if (!info.isFile() && !info.isDirectory()) throw new Error('Not a file');
    referenceCount++;
  } catch {
    problems.push(`${path.relative(root, source)} references a missing local file: ${reference}`);
  }
}

for (const required of ['index.html', 'styles.css', 'app.js', 'memory-store.js', 'data.js']) {
  try { await stat(path.join(dist, required)); } catch { problems.push(`Missing required file: dist/${required}`); }
}

const files = await filesIn(dist);
for (const filename of files) {
  const extension = path.extname(filename);
  if (!['.html', '.css', '.js', '.mjs', '.json'].includes(extension)) continue;
  const content = await readFile(filename, 'utf8');
  if (extension === '.js' || extension === '.mjs') {
    try {
      // Parse without linking, evaluating, or launching a subprocess.
      new vm.SourceTextModule(content, { identifier: filename });
    } catch (error) {
      problems.push(`Invalid JavaScript in ${path.relative(root, filename)}: ${error.message}`);
    }
    scriptCount++;
    for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) await checkReference(filename, match[1]);
    }
  }
  if (extension === '.html') {
    for (const match of content.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) await checkReference(filename, match[1]);
    if (!/<title>[^<]+<\/title>/i.test(content)) problems.push('The homepage needs a page title.');
    if (!/name\s*=\s*["']viewport["']/i.test(content)) problems.push('The homepage needs a viewport meta tag.');
    for (const match of content.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/i.test(match[0])) problems.push(`An image is missing an alt attribute: ${match[0].slice(0, 100)}`);
    }
  }
  if (extension === '.css') {
    for (const match of content.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) await checkReference(filename, match[1]);
  }
  if (path.basename(filename) === 'memories.json') {
    try {
      const parsed = JSON.parse(content);
      const memories = Array.isArray(parsed) ? parsed : parsed.demo === true ? [] : parsed.gatherings;
      if (!Array.isArray(memories)) throw new Error('Expected an array of gatherings.');
      for (const gathering of memories) {
        if (typeof gathering.id !== 'string' || typeof gathering.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(gathering.date) || !Array.isArray(gathering.photos)) {
          throw new Error('Each gathering needs id, title, date (YYYY-MM-DD), and photos.');
        }
        for (const photo of gathering.photos) {
          if (typeof photo.src !== 'string') throw new Error('Each photo needs a src string.');
          await checkReference(filename, photo.src);
        }
      }
    } catch (error) {
      problems.push(`Invalid memories.json: ${error.message}`);
    }
  }
}

if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Passed: ${scriptCount} JavaScript syntax checks, ${referenceCount} local references, and homepage metadata/accessibility checks.`);
}
