// GitHub is the durable backend. A token is held only in this module's memory.
// It is never written to browser storage, a URL, a commit, or a log.
const API = 'https://api.github.com';
const REPOSITORY = 'tkjewelrytop-lab/friendshipLSKC-forever';
const REPO = `/repos/${REPOSITORY}`;
const BRANCH = 'main';
const MEMORIES_PATH = 'dist/memories.json';
const MAX_FILES = 20;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 2000;
const REQUEST_TIMEOUT = 30000;
let sessionToken = '';
let sessionController = null;
let connection = null;
let generation = 0;
let writing = false;

class GitHubError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'GitHubError'; this.status = status; }
}

function context() {
  if (!sessionToken || !connection || sessionController?.signal.aborted) {
    throw new Error('Connect your GitHub account before managing photos.');
  }
  return { token: sessionToken, signal: sessionController.signal, generation };
}

function assertActive(ctx) {
  if (ctx.signal.aborted || ctx.generation !== generation) {
    throw new Error('The connection was closed. Connect again before publishing.');
  }
}

async function request(path, { method = 'GET', body, allowMissing = false } = {}, ctx = context()) {
  assertActive(ctx);
  // Callers supply only fixed GitHub repository/API paths, never a user URL.
  if (!path.startsWith(`${REPO}/`) && path !== REPO && path !== '/user') {
    throw new Error('This request is outside the photo repository.');
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  ctx.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT);
  try {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${ctx.token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
    } catch {
      if (timedOut) throw new Error('GitHub took too long to respond. Check your connection and try again.');
      assertActive(ctx);
      throw new Error(method === 'PATCH'
        ? 'The connection was interrupted while publishing. Reload the memories to check whether the upload completed before trying again.'
        : 'GitHub could not be reached. Check your connection and try again.');
    }
    assertActive(ctx);
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (response.status === 429 || response.status === 403 && (remaining === '0' || response.headers.has('retry-after'))) {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const wait = Number.isFinite(reset) && reset > Date.now() / 1000
          ? ` Try again in about ${Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000))} minutes.` : ' Please wait a few minutes before trying again.';
        throw new GitHubError(`GitHub's request limit has been reached.${wait}`, response.status);
      }
      if (response.status === 401) {
        disconnect();
        throw new GitHubError('GitHub did not accept this token. Check that it is correct and has not expired.', 401);
      }
      if (response.status === 403) throw new GitHubError('GitHub refused this action. The token needs access to this repository with Contents: Read and write. Check any repository rules as well.', 403);
      if (response.status === 404) throw new GitHubError('GitHub could not find this repository or file. Check that the token can access friendshipLSKC-forever.', 404);
      if (response.status === 409 || response.status === 422) throw new GitHubError('The repository changed or GitHub rejected this update. Reload the memories before trying again.', response.status);
      if (response.status >= 500) throw new GitHubError(method === 'PATCH'
        ? 'GitHub reported a temporary problem while publishing. Reload the memories to check the result before trying again.'
        : 'GitHub is temporarily unavailable. Please try again later.', response.status);
      throw new GitHubError('GitHub could not complete this action. Please try again.', response.status);
    }
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch {
      if (timedOut) throw new Error('GitHub took too long to respond. Please try again.');
      assertActive(ctx);
      throw new Error('GitHub returned an unreadable response. Please try again.');
    }
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', abort);
  }
}

export function disconnect() {
  generation++;
  sessionController?.abort();
  sessionToken = '';
  sessionController = null;
  connection = null;
}

export function isConnected() { return Boolean(sessionToken && connection && !sessionController?.signal.aborted); }

export async function connect(token) {
  disconnect();
  const candidate = typeof token === 'string' ? token.trim() : '';
  if (!candidate || candidate.length > 1024 || /\s/.test(candidate)) throw new Error('Paste a valid GitHub personal access token.');
  const controller = new AbortController();
  const ctx = { token: candidate, signal: controller.signal, generation };
  // Record the controller immediately so disconnect also cancels a pending login.
  sessionController = controller;
  try {
    const user = await request('/user', {}, ctx);
    const repository = await request(REPO, {}, ctx);
    assertActive(ctx);
    if (!repository.permissions?.push) throw new Error('This GitHub account cannot publish to friendshipLSKC-forever. Connect an account with write access.');
    if (repository.archived || repository.disabled) throw new Error('This repository is archived or disabled and cannot accept photo uploads.');
    if (typeof user.login !== 'string' || !user.login) throw new Error('GitHub could not confirm the connected account.');
    sessionToken = candidate;
    connection = { login: user.login, repository: REPOSITORY, branch: BRANCH };
    return { ...connection };
  } catch (error) {
    if (ctx.generation === generation) disconnect();
    throw error;
  }
}

function validDate(value) {
  const date = typeof value === 'string' ? value : '';
  const parsed = new Date(`${date}T12:00:00Z`);
  const year = Number(date.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || year < 2013 || year > Math.max(2026, new Date().getFullYear())) {
    throw new Error('Choose a valid gathering date from 2013 through this year.');
  }
  return date;
}

function text(value, label, max, required = false) {
  const cleaned = String(value ?? '').trim();
  if (required && !cleaned) throw new Error(`Add ${label}.`);
  if (cleaned.length > max) throw new Error(`${label[0].toUpperCase() + label.slice(1)} must be ${max} characters or fewer.`);
  return cleaned;
}

function validateMemories(value) {
  if (!Array.isArray(value)) throw new Error('The published memories file is not an album list. Fix dist/memories.json before uploading so existing photos are preserved.');
  const ids = new Set();
  for (const memory of value) {
    try {
      if (!memory || typeof memory.id !== 'string' || !memory.id || ids.has(memory.id) || typeof memory.title !== 'string' || !memory.title.trim() || !Array.isArray(memory.photos)) throw new Error();
      validDate(memory.date);
      for (const photo of memory.photos) {
        if (!photo || typeof photo.src !== 'string' || !photo.src.trim() || /[\u0000-\u001f]/.test(photo.src)) throw new Error();
      }
      ids.add(memory.id);
    } catch {
      throw new Error('The published memories file contains an invalid or duplicate memory. Fix dist/memories.json before uploading so existing photos are preserved.');
    }
  }
  return value;
}

function decodeBase64Utf8(content) {
  try {
    const binary = atob(content.replace(/\s/g, ''));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  } catch { throw new Error('The memories file could not be decoded. No published photos have been changed.'); }
}

async function readSnapshot(ctx) {
  const ref = await request(`${REPO}/git/ref/heads/${BRANCH}`, {}, ctx);
  const headSha = ref?.object?.sha;
  if (!/^[a-f0-9]{40}$/i.test(headSha || '')) throw new Error('GitHub could not read the main branch.');
  const commit = await request(`${REPO}/git/commits/${headSha}`, {}, ctx);
  const treeSha = commit?.tree?.sha;
  if (!/^[a-f0-9]{40}$/i.test(treeSha || '')) throw new Error('GitHub could not read the current repository files.');
  const file = await request(`${REPO}/contents/${MEMORIES_PATH}?ref=${headSha}`, { allowMissing: true }, ctx);
  let memories = [];
  if (file !== null) {
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new Error('GitHub could not read dist/memories.json. Check that it is a JSON file smaller than 1 MB.');
    }
    let parsed;
    try { parsed = JSON.parse(decodeBase64Utf8(file.content)); }
    catch { throw new Error('The published memories file is not valid JSON. No published photos have been changed.'); }
    memories = validateMemories(parsed);
  }
  return { memories, headSha, treeSha };
}

export async function loadMemories() { return readSnapshot(context()); }

async function imageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('Choose real JPG, PNG, or WebP photos. One selected file is not a supported image.');
}

function bytesBase64(bytes) {
  const pieces = [];
  for (let start = 0; start < bytes.length; start += 32768) pieces.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  return btoa(pieces.join(''));
}

async function compressPhoto(file, ctx) {
  if (!(file instanceof Blob) || !file.size) throw new Error('Choose nonempty JPG, PNG, or WebP photos.');
  if (file.size > MAX_BYTES) throw new Error('Each photo must be 20 MB or smaller.');
  const type = await imageType(file);
  assertActive(ctx);
  let decoded;
  let objectUrl;
  try {
    const blob = new Blob([file], { type });
    if (typeof createImageBitmap === 'function') decoded = await createImageBitmap(blob);
    else {
      objectUrl = URL.createObjectURL(blob);
      decoded = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Image decoding failed.'));
        image.src = objectUrl;
      });
    }
    assertActive(ctx);
    const width = decoded.naturalWidth || decoded.width;
    const height = decoded.naturalHeight || decoded.height;
    if (!width || !height || width > 32000 || height > 32000 || width * height > 80000000) throw new Error('Image dimensions are too large.');
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('Image processing is unavailable.');
    drawing.fillStyle = '#ffffff';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    canvas.width = canvas.height = 0;
    if (!jpeg || jpeg.type !== 'image/jpeg' || !jpeg.size) throw new Error('Image conversion failed.');
    return {
      content: bytesBase64(new Uint8Array(await jpeg.arrayBuffer())),
      caption: String(file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 150),
    };
  } catch {
    assertActive(ctx);
    throw new Error('One photo could not be read. Choose a valid image below 32,000 pixels and 80 megapixels, then try again.');
  } finally {
    decoded?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function chosenFiles(files) {
  const chosen = Array.from(files || []);
  if (!chosen.length) throw new Error('Choose at least one photo.');
  if (chosen.length > MAX_FILES) throw new Error('Choose up to 20 photos per upload. You can add more to the same memory afterward.');
  return chosen;
}

function uniqueId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function progress(callback, stage, message, completed, total) {
  if (typeof callback !== 'function') return;
  try { callback({ stage, message, completed, total, percent: total ? Math.round(completed / total * 100) : 0 }); }
  catch { /* An optional UI callback cannot interrupt an atomic publication. */ }
}

async function uploadPhotos(files, ctx, onProgress) {
  const photos = [];
  const entries = [];
  const group = uniqueId();
  for (const [index, file] of files.entries()) {
    progress(onProgress, 'processing', `Preparing photo ${index + 1} of ${files.length}…`, index, files.length);
    const photo = await compressPhoto(file, ctx);
    progress(onProgress, 'uploading', `Uploading photo ${index + 1} of ${files.length}…`, index, files.length);
    const blob = await request(`${REPO}/git/blobs`, { method: 'POST', body: { content: photo.content, encoding: 'base64' } }, ctx);
    if (!/^[a-f0-9]{40}$/i.test(blob?.sha || '')) throw new Error('GitHub could not confirm the uploaded photo. No album update has been published.');
    const src = `photos/${group}-${index + 1}.jpg`;
    photos.push({ src, caption: photo.caption });
    entries.push({ path: `dist/${src}`, mode: '100644', type: 'blob', sha: blob.sha });
  }
  return { photos, entries };
}

async function publishChange({ files, apply, message }, onProgress) {
  if (writing) throw new Error('Another upload is still running. Wait for it to finish before starting a new one.');
  const ctx = context();
  const chosen = chosenFiles(files);
  writing = true;
  try {
    // Validate the current metadata before creating any photo objects.
    let snapshot = await readSnapshot(ctx);
    apply(snapshot.memories, []);
    const uploaded = await uploadPhotos(chosen, ctx, onProgress);
    for (let attempt = 0; attempt < 2; attempt++) {
      assertActive(ctx);
      const memories = apply(snapshot.memories, uploaded.photos);
      const tree = await request(`${REPO}/git/trees`, { method: 'POST', body: {
        base_tree: snapshot.treeSha,
        tree: [...uploaded.entries, { path: MEMORIES_PATH, mode: '100644', type: 'blob', content: `${JSON.stringify(memories, null, 2)}\n` }],
      } }, ctx);
      if (!/^[a-f0-9]{40}$/i.test(tree?.sha || '')) throw new Error('GitHub could not prepare the updated album.');
      const commit = await request(`${REPO}/git/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [snapshot.headSha] } }, ctx);
      if (!/^[a-f0-9]{40}$/i.test(commit?.sha || '')) throw new Error('GitHub could not prepare the photo commit.');
      progress(onProgress, 'publishing', 'Publishing your memories…', chosen.length, chosen.length);
      try {
        await request(`${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha, force: false } }, ctx);
        progress(onProgress, 'complete', 'Photos published to GitHub. The timeline will update after deployment.', chosen.length, chosen.length);
        return { commitSha: commit.sha, photosAdded: uploaded.photos.length };
      } catch (error) {
        if (!(error instanceof GitHubError) || ![409, 422].includes(error.status)) throw error;
        const latest = await request(`${REPO}/git/ref/heads/${BRANCH}`, {}, ctx);
        if (attempt !== 0 || latest?.object?.sha === snapshot.headSha) {
          throw new Error('GitHub could not safely update the album. Reload the memories and try again; existing photos have been preserved.');
        }
        // Rebuild from the newest metadata/tree instead of overwriting another edit.
        progress(onProgress, 'retry', 'Another memory was added. Combining both updates…', chosen.length, chosen.length);
        snapshot = await readSnapshot(ctx);
      }
    }
    throw new Error('The album changed again. Reload the memories before trying again.');
  } finally { writing = false; }
}

export async function publishMemory({ title, date, location, description, files } = {}, onProgress) {
  const memory = {
    id: `memory-${uniqueId()}`,
    title: text(title, 'a name for this memory', 120, true),
    date: validDate(date),
    location: text(location, 'place', 150),
    description: text(description, 'story', 2000),
    photos: [],
    isDraft: false,
  };
  return publishChange({
    files,
    message: `Add ${memory.date.slice(0, 4)} gathering photos`,
    apply: (existing, photos) => {
      if (existing.some(item => item.id === memory.id)) throw new Error('This memory is already published. Reload the memories before adding more photos.');
      return [...existing, { ...memory, photos }];
    },
  }, onProgress);
}

export async function addPhotos(memoryId, files, onProgress) {
  if (typeof memoryId !== 'string' || !memoryId.trim()) throw new Error('Choose a published memory to add photos to.');
  return publishChange({
    files,
    message: 'Add more gathering photos',
    apply: (existing, photos) => {
      if (!existing.some(item => item.id === memoryId)) throw new Error('This memory is no longer in the album. Reload the memories before adding photos.');
      return existing.map(memory => memory.id === memoryId ? { ...memory, isDraft: false, photos: [...memory.photos, ...photos] } : memory);
    },
  }, onProgress);
}
