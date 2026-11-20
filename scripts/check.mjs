import { readFile, readdir, stat } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const problems = [];
const modules = new Map();
let scriptCount = 0;
let referenceCount = 0;
let pageCount = 0;
let gatheringCount = 0;
let linkedCount = 0;

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

for (const required of ['index.html', 'styles.css', 'app.js', 'admin.html', 'admin.css', 'admin.js', 'github-backend.js', 'memories.json']) {
  try { await stat(path.join(dist, required)); } catch { problems.push(`Missing required file: dist/${required}`); }
}

const files = await filesIn(dist);
for (const filename of files) {
  const extension = path.extname(filename);
  if (!['.html', '.css', '.js', '.mjs', '.json'].includes(extension)) continue;
  const content = await readFile(filename, 'utf8');
  if (extension === '.js' || extension === '.mjs') {
    try {
      // Parse without evaluating or launching a subprocess.
      const module = new vm.SourceTextModule(content, { identifier: filename });
      modules.set(filename, module);
      for (const dependency of module.dependencySpecifiers) {
        if (dependency.startsWith('.')) await checkReference(filename, dependency);
      }
    } catch (error) {
      problems.push(`Invalid JavaScript in ${path.relative(root, filename)}: ${error.message}`);
    }
    scriptCount++;
    for (const match of content.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (match[1].startsWith('.')) await checkReference(filename, match[1]);
    }
  }
  if (extension === '.html') {
    pageCount++;
    for (const match of content.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) await checkReference(filename, match[1]);
    if (!/<title>[^<]+<\/title>/i.test(content)) problems.push(`${path.relative(root, filename)} needs a page title.`);
    if (!/name\s*=\s*["']viewport["']/i.test(content)) problems.push(`${path.relative(root, filename)} needs a viewport meta tag.`);
    for (const match of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
      if (/\btype\s*=\s*['"](?:application\/ld\+json|application\/json)['"]/i.test(match[1])) continue;
      try {
        if (/\btype\s*=\s*['"]module['"]/i.test(match[1])) {
          new vm.SourceTextModule(match[2], { identifier: filename });
        } else {
          new vm.Script(match[2], { filename });
        }
        scriptCount++;
      } catch (error) {
        problems.push(`Invalid inline JavaScript in ${path.relative(root, filename)}: ${error.message}`);
      }
    }
    for (const match of content.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/i.test(match[0])) problems.push(`An image is missing an alt attribute: ${match[0].slice(0, 100)}`);
    }
  }
  if (extension === '.css') {
    for (const match of content.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) await checkReference(filename, match[1]);
  }
  if (path.basename(filename) === 'memories.json') {
    try {
      const memories = JSON.parse(content);
      if (!Array.isArray(memories)) throw new Error('Expected an array of gatherings (an empty archive is []).');
      const ids = new Set();
      for (const gathering of memories) {
        if (typeof gathering.id !== 'string' || !gathering.id.trim() || typeof gathering.title !== 'string' || !gathering.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(gathering.date) || !Array.isArray(gathering.photos)) {
          throw new Error('Each gathering needs id, title, date (YYYY-MM-DD), and photos.');
        }
        if (ids.has(gathering.id)) throw new Error(`Duplicate gathering id: ${gathering.id}`);
        ids.add(gathering.id);
        const date = new Date(`${gathering.date}T00:00:00.000Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== gathering.date) {
          throw new Error(`Invalid calendar date: ${gathering.date}`);
        }
        // Multiple distinct gatherings in the same year are valid.
        for (const photo of gathering.photos) {
          if (typeof photo.src !== 'string') throw new Error('Each photo needs a src string.');
          await checkReference(filename, photo.src);
        }
        gatheringCount++;
      }
    } catch (error) {
      problems.push(`Invalid memories.json: ${error.message}`);
    }
  }
}

// Linking verifies that local imports name exports that actually exist.
// Module bodies are never evaluated, so this does not run browser code.
function hasLocalDependenciesOnly(module, visited = new Set()) {
  if (visited.has(module.identifier)) return true;
  visited.add(module.identifier);
  return module.dependencySpecifiers.every((dependency) => {
    if (!dependency.startsWith('.')) return false;
    const target = modules.get(path.resolve(path.dirname(module.identifier), dependency));
    return target && hasLocalDependenciesOnly(target, visited);
  });
}

for (const module of modules.values()) {
  if (module.status !== 'unlinked' || !hasLocalDependenciesOnly(module)) continue;
  try {
    await module.link((dependency, importer) => modules.get(path.resolve(path.dirname(importer.identifier), dependency)));
  } catch (error) {
    problems.push(`Invalid module imports in ${path.relative(root, module.identifier)}: ${error.message}`);
  }
}
linkedCount = [...modules.values()].filter((module) => module.status === 'linked').length;

if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Passed: ${scriptCount} JavaScript syntax checks, ${linkedCount} module import/export checks, ${referenceCount} local references, ${pageCount} page metadata/accessibility checks, and ${gatheringCount} published gatherings.`);
}
