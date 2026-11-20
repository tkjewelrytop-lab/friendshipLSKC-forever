// Photo drafts stay in this browser until you export and publish the archive.
const DATABASE = 'the-good-years';
const STORE = 'gatherings';
const MAX_FILES = 20;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 2000;
const encoder = new TextEncoder();
let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('This browser cannot save photo drafts. Open this site in a current browser with storage enabled.'));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); databasePromise = null; };
        resolve(database);
      };
      request.onerror = () => { databasePromise = null; reject(storageError(request.error)); };
      request.onblocked = () => { databasePromise = null; reject(new Error('Close other tabs of this site, then try saving again.')); };
    });
  }
  return databasePromise;
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError') {
    return new Error('Your browser storage is full. Export your memories, then remove older drafts or choose fewer photos.');
  }
  return new Error('Photo drafts could not be saved in this browser. Check that browser storage is enabled and try again.');
}

async function transaction(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    let result;
    const request = operation(tx.objectStore(STORE));
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(storageError(tx.error));
    tx.onerror = () => reject(storageError(tx.error));
  });
}

export async function loadDrafts() {
  const rows = await transaction('readonly', store => store.getAll());
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function deleteDraft(id) {
  if (typeof id !== 'string' || !id) throw new Error('Choose a saved draft to remove.');
  await transaction('readwrite', store => store.delete(id));
}

function cleanText(value, label, limit, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`Add ${label.toLowerCase()}.`);
  if (text.length > limit) throw new Error(`${label} must be ${limit} characters or fewer.`);
  return text;
}

function validateDate(value) {
  const date = String(value ?? '');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Choose a valid gathering date.');
  }
  return date;
}

async function detectedImageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error(`“${file.name || 'This file'}” is not a JPEG, PNG, or WebP photo.`);
}

async function compressPhoto(file) {
  const label = file.name || 'This photo';
  if (!(file instanceof Blob) || !file.size) throw new Error('Choose nonempty JPEG, PNG, or WebP photos.');
  if (file.size > MAX_BYTES) throw new Error(`“${label}” is larger than 20 MB. Choose a smaller copy.`);
  const type = await detectedImageType(file);
  const blob = new Blob([file], { type });
  let decoded;
  let objectURL;
  try {
    if (typeof createImageBitmap === 'function') {
      decoded = await createImageBitmap(blob);
    } else {
      objectURL = URL.createObjectURL(blob);
      decoded = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image could not be decoded.'));
        img.src = objectURL;
      });
    }
    const width = decoded.naturalWidth || decoded.width;
    const height = decoded.naturalHeight || decoded.height;
    if (!width || !height || width > 32000 || height > 32000 || width * height > 80000000) {
      throw new Error('Image dimensions are too large.');
    }
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const src = canvas.toDataURL('image/jpeg', 0.88);
    if (!src.startsWith('data:image/jpeg;base64,')) throw new Error('Image conversion failed.');
    canvas.width = canvas.height = 0;
    return { src, caption: label.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 150) };
  } catch (error) {
    throw new Error(`“${label}” could not be read. Choose a valid photo with dimensions below 32,000 pixels and 80 megapixels.`);
  } finally {
    if (decoded && typeof decoded.close === 'function') decoded.close();
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}

export async function saveGathering({ title, date, location, description, files } = {}) {
  const gathering = {
    id: `memory-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    title: cleanText(title, 'A gathering title', 100, true),
    date: validateDate(date),
    location: cleanText(location, 'Location', 150),
    description: cleanText(description, 'Story', 2000),
    photos: [],
    isDraft: true,
  };
  const chosen = Array.from(files || []);
  if (!chosen.length) throw new Error('Choose at least one photo for this gathering.');
  if (chosen.length > MAX_FILES) throw new Error('Choose up to 20 photos per gathering.');
  // Process one at a time so a large selection does not decode into memory at once.
  for (const file of chosen) gathering.photos.push(await compressPhoto(file));
  await transaction('readwrite', store => store.put(gathering));
  return gathering;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipArchive(files) {
  if (files.length > 65535) throw new Error('This archive contains too many files. Export a smaller selection.');
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralSize = 0;
  const now = new Date();
  const year = Math.max(1980, Math.min(2107, now.getFullYear()));
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, bytes } of files) {
    const path = encoder.encode(name);
    const checksum = crc32(bytes);
    if (path.length > 65535 || bytes.length > 0xffffffff || offset + bytes.length > 0xffffffff) {
      throw new Error('This archive is too large. Export fewer gatherings.');
    }
    const local = new Uint8Array(30 + path.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, checksum, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, path.length, true);
    local.set(path, 30);
    localParts.push(local, bytes);
    const central = new Uint8Array(46 + path.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(12, time, true);
    record.setUint16(14, date, true);
    record.setUint32(16, checksum, true);
    record.setUint32(20, bytes.length, true);
    record.setUint32(24, bytes.length, true);
    record.setUint16(28, path.length, true);
    record.setUint32(42, offset, true);
    central.set(path, 46);
    centralParts.push(central);
    centralSize += central.length;
    offset += local.length + bytes.length;
  }
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, centralSize, true);
  footer.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

const workflow = `name: Publish friendship archive
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

const readme = `# The Good Years

A friendship photo archive, organized by year. Everything in dist/ is a static website.

## Publish on GitHub Pages

1. Create a public GitHub repository.
2. Upload this folder's contents, including dist/ and .github/ (or use Git).
3. In the repository, open Settings > Pages and choose GitHub Actions as the source.
4. Push to the main branch, or run the Publish friendship archive workflow from Actions.
5. Find your public address in Settings > Pages after the workflow succeeds.

## Add another gathering

Open the site, choose Add photos, and Save memory. Choose your annual matching-pose photo first: it becomes that year's cover. Photo drafts stay on that device until you publish. Choose Export site, then Download website & photos to export an updated ZIP. Replace the repository's dist/ folder with the exported dist/ folder and commit. Visitors will see the photos after GitHub Pages deploys again.

Export regularly: clearing browser data removes unexported drafts. Only publish photos you want people visiting your public site to see.

For local preview, serve dist/ with an HTTP server, for example: npx serve dist
`;

function safePath(path) {
  const clean = path.replace(/^\.\//, '').split(/[?#]/)[0];
  if (!clean || clean.startsWith('/') || clean.split('/').some(part => part === '..') || /^[a-z]+:/i.test(clean)) return null;
  return clean;
}

async function readResource(path) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`Could not download ${path}. Check your connection and try exporting again.`);
  return response;
}

function dataImageBytes(src) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(src);
  if (!match) throw new Error('A saved photo is invalid. Remove that draft and add the original photo again.');
  const binary = atob(match[2]);
  return { bytes: Uint8Array.from(binary, character => character.charCodeAt(0)), extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

export async function exportSite(gatherings) {
  if (!Array.isArray(gatherings)) throw new Error('The memories could not be loaded. Reload this page before exporting.');
  const files = new Map();
  const imagePaths = new Map();
  const texts = new Map();
  const addText = (name, value) => files.set(name, encoder.encode(value));
  // Download the exact served site, so an export includes the current design too.
  for (const name of ['index.html', 'styles.css', 'app.js', 'memory-store.js', 'data.js']) {
    const text = await (await readResource(name)).text();
    texts.set(name, text);
    addText(`dist/${name}`, text);
  }
  const assets = new Set();
  for (const text of texts.values()) {
    for (const match of text.matchAll(/(?:\.\/)?assets\/[A-Za-z0-9_./%+\-]+/g)) {
      const path = safePath(match[0]);
      if (path && /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ttf|otf|ico)$/i.test(path)) assets.add(path);
    }
  }
  try {
    const manifestResponse = await fetch(new URL('assets/manifest.json', document.baseURI));
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      if (Array.isArray(manifest)) {
        addText('dist/assets/manifest.json', JSON.stringify(manifest, null, 2));
        for (const path of manifest) {
          const safe = typeof path === 'string' ? safePath(path) : null;
          if (safe) assets.add(safe);
        }
      }
    }
  } catch { /* An optional asset manifest is not needed for regular image references. */ }
  for (const path of assets) {
    files.set(`dist/${path}`, new Uint8Array(await (await readResource(path)).arrayBuffer()));
  }
  const published = [];
  for (const [index, gathering] of gatherings.entries()) {
    const copy = { ...gathering, isDraft: false, photos: [] };
    const id = String(gathering.id || index).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 70) || String(index);
    for (const [photoIndex, photo] of (gathering.photos || []).entries()) {
      if (!photo || typeof photo.src !== 'string') throw new Error(`A photo in “${gathering.title || 'this gathering'}” is missing.`);
      let path = imagePaths.get(photo.src);
      const localPath = safePath(photo.src);
      if (!path && localPath && files.has(`dist/${localPath}`)) {
        path = localPath;
        imagePaths.set(photo.src, path);
      }
      if (!path) {
        let bytes;
        let extension;
        if (photo.src.startsWith('data:')) {
          ({ bytes, extension } = dataImageBytes(photo.src));
        } else {
          let response;
          try { response = await readResource(photo.src); }
          catch { throw new Error(`A photo in “${gathering.title || 'this gathering'}” could not be downloaded. Check your connection and try again.`); }
          const type = response.headers.get('content-type')?.split(';')[0];
          if (type === 'text/html' || !response.headers.get('content-length') && response.status === 204) {
            throw new Error(`A photo in “${gathering.title || 'this gathering'}” is unavailable. Add the original photo and try exporting again.`);
          }
          extension = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg' })[type] || 'jpg';
          bytes = new Uint8Array(await response.arrayBuffer());
        }
        path = `photos/${id}-${index + 1}-${photoIndex + 1}.${extension}`;
        files.set(`dist/${path}`, bytes);
        imagePaths.set(photo.src, path);
      }
      copy.photos.push({ ...photo, src: path });
    }
    published.push(copy);
  }
  addText('dist/memories.json', JSON.stringify(published, null, 2));
  addText('dist/.nojekyll', '');
  addText('.github/workflows/pages.yml', workflow);
  addText('README.md', readme);
  const archive = zipArchive(Array.from(files, ([name, bytes]) => ({ name, bytes })));
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `the-good-years-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give browsers time to start the download before releasing its backing Blob.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
