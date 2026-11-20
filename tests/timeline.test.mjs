import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// A small DOM contract harness runs the shipped public script without fetching data.
// It exercises grouping, validation, rendering and lightbox navigation together.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.open = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelector(selector) { return this.children.find(child => child.tagName === selector.toUpperCase()) || null; }
  addEventListener() {}
  getBoundingClientRect() { return { top: this.top ?? 0 }; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function createTimeline() {
  const rootIds = ['year-links', 'timeline-years', 'year-range', 'timeline-progress', 'lightbox-image', 'lightbox-year', 'lightbox-caption', 'lightbox-counter', 'previous-photo', 'next-photo', 'lightbox', 'close-photo', 'timeline-status'];
  const roots = new Map(rootIds.map(id => [id, new Element()]));
  const document = {
    baseURI: 'https://tkjewelrytop-lab.github.io/friendshipLSKC-forever/',
    documentElement: new Element(),
    createElement: tag => new Element(tag),
    querySelector: selector => roots.get(selector.slice(1)),
    querySelectorAll: selector => selector === '.timeline-entry' ? roots.get('timeline-years').children : selector === '.year-link' ? roots.get('year-links').children : [],
    addEventListener() {},
  };
  const context = vm.createContext({
    document,
    window: { matchMedia: () => ({ matches: true, addEventListener() {} }), innerHeight: 800, addEventListener() {} },
    location: { origin: 'https://tkjewelrytop-lab.github.io', hash: '' },
    URL, Intl, Date, Map, Number, Array, Math,
    requestAnimationFrame: () => 1,
    console,
  });
  const code = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8').replace(/init\(\);\s*$/, '');
  vm.runInContext(code, context);
  return { context, roots, run: code => vm.runInContext(code, context) };
}

test('timeline validates records and groups every gathering and photo by year', () => {
  const { context, roots, run } = createTimeline();
  context.rows = [
    { id: 'a', date: '2013-06-01', title: 'First gathering', photos: [{ src: 'photos/first.jpg', caption: 'Same pose' }, { src: 'photos/table.jpg' }] },
    { id: 'b', date: '2013-06-02', title: 'Another moment', photos: [{ src: 'photos/next.jpg' }] },
    { id: 'unsafe', date: '2014-01-01', photos: [{ src: 'javascript:alert(1)' }] },
    { id: 'invalid-date', date: '2015-02-30', photos: [{ src: 'photos/no.jpg' }] },
  ];
  assert.equal(run('cleanMemories(rows).length'), 2);
  run('renderTimeline(cleanMemories(rows))');
  assert.ok(roots.get('year-links').children.length >= 14);
  assert.equal(roots.get('timeline-years').children.length, roots.get('year-links').children.length);
  const firstYear = roots.get('timeline-years').children[0];
  assert.equal(firstYear.id, 'year-2013');
  assert.equal(firstYear.children[1].children.length, 2);
  assert.equal(run('photosByYear.get(2013).length'), 3);
});

test('four-photo preview keeps the entire album accessible and navigation wraps', () => {
  const { context, roots, run } = createTimeline();
  context.rows = [{ id: 'six', date: '2026-05-01', photos: Array.from({ length: 6 }, (_, index) => ({ src: `photos/${index}.jpg` })) }];
  run('renderTimeline(cleanMemories(rows))');
  const year2026 = roots.get('timeline-years').children.find(year => year.id === 'year-2026');
  const gathering = year2026.children[1].children[0];
  const mosaic = gathering.children.find(child => child.className.startsWith('photo-mosaic'));
  assert.equal(mosaic.children.length, 4);
  assert.equal(gathering.children.at(-1).textContent, 'View all 6 photos');
  run('activePhotos = photosByYear.get(2026); showPhoto(5)');
  assert.equal(roots.get('lightbox-counter').textContent, '6 / 6');
  assert.equal(roots.get('lightbox').open, true);
  run('showPhoto(6)');
  assert.equal(roots.get('lightbox-counter').textContent, '1 / 6');
  run('showPhoto(-1)');
  assert.equal(roots.get('lightbox-counter').textContent, '6 / 6');
});

test('public timeline contains no photo-management or authentication controls', () => {
  const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /type=["'](?:file|password)["']|admin\.html|Export site|Add photos/i);
  assert.doesNotMatch(script, /memory-store\.js|github-backend\.js|indexedDB|localStorage/);
});


test('reaching the bottom selects the final year and completes the timeline line', () => {
  const { context, roots, run } = createTimeline();
  run('renderTimeline([])');
  roots.get('timeline-years').children.forEach((entry, index) => { entry.top = index * 100 - 700; });
  context.document.documentElement.scrollHeight = 2000;
  context.window.scrollY = 1200;
  run('updateScrollState()');
  assert.equal(roots.get('year-links').children.at(-1).attributes['aria-current'], 'true');
  assert.equal(roots.get('timeline-progress').style.transform, 'scaleY(1)');
});
