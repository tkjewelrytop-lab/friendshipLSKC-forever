import test from 'node:test';
import assert from 'node:assert/strict';

const PREFIX = '/repos/tkjewelrytop-lab/friendshipLSKC-forever';
const TOKEN = 'test-token-held-in-memory';
const SHA = letter => letter.repeat(40);
const memory = (id = 'existing', year = '2013') => ({
  id, title: 'Our gathering', date: `${year}-06-20`, location: 'A shared table',
  description: 'A story to keep. 你好', photos: [{ src: `photos/${id}.jpg`, caption: 'Same pose' }],
});
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function harness(options = {}) {
  const calls = [];
  const trees = [];
  const commits = [];
  const dimensions = [];
  let head = SHA('a');
  let tree = SHA('c');
  let records = options.memories ?? [memory()];
  let patches = 0;
  let serial = 1;
  const originals = new Map(['fetch', 'createImageBitmap', 'document', 'localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  install('fetch', async (url, init = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    const call = { path, url, method: init.method || 'GET', body, headers: init.headers };
    calls.push(call);
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers['X-GitHub-Api-Version'], '2026-03-10');
    assert.equal(url.includes(TOKEN), false);
    assert.equal(String(init.body || '').includes(TOKEN), false);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    if (options.respond) {
      const response = await options.respond(call);
      if (response) return response;
    }
    if (path === '/user') return json({ login: 'album-owner' });
    if (path === PREFIX) return json({ permissions: { push: options.push !== false }, archived: false });
    if (path === `${PREFIX}/git/ref/heads/main`) return json({ object: { sha: head } });
    if (path.startsWith(`${PREFIX}/git/commits/`) && call.method === 'GET') return json({ tree: { sha: tree } });
    if (path === `${PREFIX}/contents/dist/memories.json`) {
      return options.missing ? json({}, 404) : json({ type: 'file', encoding: 'base64', content: Buffer.from(options.rawJson ?? JSON.stringify(records)).toString('base64') });
    }
    if (path === `${PREFIX}/git/blobs`) return json({ sha: (serial++).toString(16).padStart(40, '0') }, 201);
    if (path === `${PREFIX}/git/trees`) { trees.push(body); return json({ sha: (serial++).toString(16).padStart(40, '0') }, 201); }
    if (path === `${PREFIX}/git/commits`) { commits.push(body); return json({ sha: (serial++).toString(16).padStart(40, '0') }, 201); }
    if (path === `${PREFIX}/git/refs/heads/main`) {
      patches++;
      assert.equal(body.force, false);
      if (options.conflict && patches === 1) {
        if (options.advance !== false) { head = SHA('b'); tree = SHA('d'); records = [...records, memory('concurrent', '2020')]; }
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      head = body.sha;
      return json({ object: { sha: head } });
    }
    throw new Error(`Unexpected API route in test: ${call.method} ${path}`);
  });
  install('createImageBitmap', async () => ({ width: 4000, height: 3000, close() {} }));
  install('document', { createElement(type) {
    assert.equal(type, 'canvas');
    return { width: 0, height: 0, getContext() { return { fillRect() {}, drawImage() {} }; },
      toBlob(done, type, quality) { dimensions.push({ width: this.width, height: this.height }); assert.equal(type, 'image/jpeg'); assert.equal(quality, 0.88); done(new Blob([new Uint8Array([255, 216, 255, 0])], { type })); },
    };
  } });
  install('localStorage', new Proxy({}, { get() { throw new Error('Token storage is forbidden.'); } }));
  install('sessionStorage', new Proxy({}, { get() { throw new Error('Token storage is forbidden.'); } }));
  const backend = await import(`../dist/github-backend.js?test=${Date.now()}-${Math.random()}`);
  return {
    backend, calls, trees, commits, dimensions,
    get patches() { return patches; },
    async close() {
      backend.disconnect();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

function photo(name = 'same_pose.png') {
  const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])], { type: 'image/png' });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

test('connect verifies write access, keeps credentials out of returned data and storage, and disconnects', async () => {
  const h = await harness();
  try {
    assert.equal(h.backend.isConnected(), false);
    await assert.rejects(h.backend.loadMemories(), /Connect your GitHub/);
    const connected = await h.backend.connect(TOKEN);
    assert.deepEqual(connected, { login: 'album-owner', repository: 'tkjewelrytop-lab/friendshipLSKC-forever', branch: 'main' });
    assert.equal(JSON.stringify(connected).includes(TOKEN), false);
    assert.equal(h.backend.isConnected(), true);
    const loaded = await h.backend.loadMemories();
    assert.equal(loaded.memories[0].description, 'A story to keep. 你好');
    assert.equal(loaded.headSha, SHA('a'));
    h.backend.disconnect();
    assert.equal(h.backend.isConnected(), false);
    await assert.rejects(h.backend.loadMemories(), /Connect your GitHub/);
  } finally { await h.close(); }
});

test('readonly account is refused before any publication', async () => {
  const h = await harness({ push: false });
  try {
    await assert.rejects(h.backend.connect(TOKEN), /cannot publish/);
    assert.equal(h.backend.isConnected(), false);
    assert.equal(h.calls.some(call => call.method !== 'GET'), false);
  } finally { await h.close(); }
});

test('publishes multiple photos and UTF-8 metadata in one commit preserving existing files and memories', async () => {
  const h = await harness();
  try {
    await h.backend.connect(TOKEN);
    const progress = [];
    const result = await h.backend.publishMemory({ title: 'Our 2026 gathering', date: '2026-08-20', location: '朋友', description: 'Same pose, another year.', files: [photo(), photo('friends.png')] }, item => progress.push(item));
    assert.equal(result.photosAdded, 2);
    assert.match(result.commitSha, /^[a-f0-9]{40}$/);
    assert.equal(h.patches, 1);
    assert.equal(h.commits.length, 1);
    assert.deepEqual(h.commits[0].parents, [SHA('a')]);
    assert.deepEqual(h.dimensions, [{ width: 2000, height: 1500 }, { width: 2000, height: 1500 }]);
    assert.equal(h.trees[0].base_tree, SHA('c'));
    assert.equal(h.trees[0].tree.length, 3);
    const published = JSON.parse(h.trees[0].tree.find(entry => entry.path === 'dist/memories.json').content);
    assert.equal(published.length, 2);
    assert.deepEqual(published[0], memory());
    assert.equal(published[1].location, '朋友');
    assert.equal(published[1].isDraft, false);
    assert.equal(published[1].photos.length, 2);
    assert.match(published[1].photos[0].src, /^photos\/.+\.jpg$/);
    assert.equal(published[1].photos[0].caption, 'same pose');
    assert.equal(progress.at(-1).stage, 'complete');
    assert.equal(progress.at(-1).percent, 100);
    assert.equal(JSON.stringify(h.trees).includes(TOKEN), false);
  } finally { await h.close(); }
});

test('concurrent branch change rebases once onto newest metadata without reuploading photo blobs', async () => {
  const h = await harness({ conflict: true });
  try {
    await h.backend.connect(TOKEN);
    await h.backend.publishMemory({ title: 'New memory', date: '2026-05-10', files: [photo()] });
    assert.equal(h.patches, 2);
    assert.equal(h.trees.length, 2);
    assert.equal(h.calls.filter(call => call.path.endsWith('/git/blobs')).length, 1);
    assert.equal(h.trees[1].base_tree, SHA('d'));
    assert.deepEqual(h.commits[1].parents, [SHA('b')]);
    const final = JSON.parse(h.trees[1].tree.find(entry => entry.path === 'dist/memories.json').content);
    assert.equal(final.length, 3);
    assert.deepEqual(final.slice(0, 2).map(record => record.id), ['existing', 'concurrent']);
  } finally { await h.close(); }
});

test('rejected reference with unchanged head is not retried', async () => {
  const h = await harness({ conflict: true, advance: false });
  try {
    await h.backend.connect(TOKEN);
    await assert.rejects(h.backend.publishMemory({ title: 'New memory', date: '2026-05-10', files: [photo()] }), /safely update/);
    assert.equal(h.patches, 1);
    assert.equal(h.commits.length, 1);
  } finally { await h.close(); }
});

test('append keeps signature photo first and refuses a removed memory', async () => {
  const h = await harness();
  try {
    await h.backend.connect(TOKEN);
    await h.backend.addPhotos('existing', [photo()]);
    const final = JSON.parse(h.trees[0].tree.find(entry => entry.path === 'dist/memories.json').content);
    assert.equal(final.length, 1);
    assert.equal(final[0].photos.length, 2);
    assert.deepEqual(final[0].photos[0], memory().photos[0]);
    const before = h.calls.filter(call => call.method === 'POST').length;
    await assert.rejects(h.backend.addPhotos('missing-id', [photo()]), /no longer in the album/);
    assert.equal(h.calls.filter(call => call.method === 'POST').length, before);
  } finally { await h.close(); }
});

test('invalid metadata, dates, and fake image files fail before advancing a branch', async () => {
  const h = await harness({ rawJson: '{broken' });
  try {
    await h.backend.connect(TOKEN);
    await assert.rejects(h.backend.publishMemory({ title: 'New memory', date: '2026-05-10', files: [photo()] }), /not valid JSON/);
    assert.equal(h.calls.some(call => call.method !== 'GET'), false);
    await assert.rejects(h.backend.publishMemory({ title: 'New memory', date: '2012-05-10', files: [photo()] }), /2013/);
    await assert.rejects(h.backend.publishMemory({ title: 'New memory', date: '2026-02-30', files: [photo()] }), /valid gathering date/);
  } finally { await h.close(); }
  const clean = await harness();
  try {
    await clean.backend.connect(TOKEN);
    await assert.rejects(clean.backend.publishMemory({ title: 'New memory', date: '2026-05-10', files: [new Blob(['not a photo'], { type: 'image/png' })] }), /not a supported image/);
    assert.equal(clean.calls.some(call => call.method !== 'GET'), false);
    await assert.rejects(clean.backend.publishMemory({ title: 'New memory', date: '2026-05-10', files: Array.from({ length: 21 }, () => photo()) }), /up to 20/);
  } finally { await clean.close(); }
});

test('rate limit errors are useful and never echo a raw server response', async () => {
  const h = await harness({ respond: call => call.path === '/user' ? json({ message: `Server debug contains ${TOKEN}` }, 403, { 'x-ratelimit-remaining': '0' }) : null });
  try {
    await assert.rejects(h.backend.connect(TOKEN), error => {
      assert.match(error.message, /request limit/);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(h.backend.isConnected(), false);
  } finally { await h.close(); }
});

test('invalid tokens disconnect and redact server error details', async () => {
  const h = await harness({ respond: call => call.path === '/user' ? json({ message: `Invalid token: ${TOKEN}` }, 401) : null });
  try {
    await assert.rejects(h.backend.connect(TOKEN), error => {
      assert.match(error.message, /did not accept this token/);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(h.backend.isConnected(), false);
    assert.equal(h.calls.length, 1);
  } finally { await h.close(); }
});

test('a token without Contents write receives a useful error and never advances main', async () => {
  const h = await harness({ respond: call => call.path.endsWith('/git/blobs') ? json({ message: `Resource not accessible. ${TOKEN}` }, 403) : null });
  try {
    await h.backend.connect(TOKEN);
    await assert.rejects(h.backend.publishMemory({ title: 'New memory', date: '2026-05-10', files: [photo()] }), error => {
      assert.match(error.message, /Contents: Read and write/);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(h.trees.length, 0);
    assert.equal(h.commits.length, 0);
    assert.equal(h.patches, 0);
  } finally { await h.close(); }
});

test('disconnect aborts a pending request and blocks following writes', async () => {
  let waiting;
  const h = await harness({ respond: call => {
    if (call.path === `${PREFIX}/git/ref/heads/main`) return new Promise(resolve => { waiting = resolve; });
    return null;
  } });
  try {
    await h.backend.connect(TOKEN);
    const pending = h.backend.loadMemories();
    await new Promise(resolve => setImmediate(resolve));
    h.backend.disconnect();
    waiting(json({ object: { sha: SHA('a') } }));
    await assert.rejects(pending, /connection was closed/);
    assert.equal(h.calls.some(call => call.method !== 'GET'), false);
  } finally { await h.close(); }
});
