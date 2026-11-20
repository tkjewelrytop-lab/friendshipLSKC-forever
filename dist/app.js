const START_YEAR = 2013;
const currentYear = Math.max(2026, new Date().getFullYear());
const allYears = Array.from({ length: currentYear - START_YEAR + 1 }, (_, i) => START_YEAR + i);
const $ = selector => document.querySelector(selector);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const dateFormat = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' });
const photosByYear = new Map();
let activePhotos = [];
let activeIndex = 0;
let activeYear = null;
let revealObserver;
let scrollFrame = 0;
let touchStart = null;

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}
function safePhotoURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  // Public albums use ordinary files or HTTPS photos; executable and data URLs are rejected.
  try {
    const url = new URL(value, document.baseURI);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === location.origin)) return null;
    return url.href;
  } catch { return null; }
}
function cleanMemories(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== 'object' || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return [];
    const date = new Date(`${row.date}T12:00:00Z`);
    const year = Number(row.date.slice(0, 4));
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date || year < START_YEAR || year > currentYear || !Array.isArray(row.photos)) return [];
    const photos = row.photos.flatMap(photo => {
      const src = safePhotoURL(photo?.src);
      return src ? [{ src, caption: typeof photo.caption === 'string' ? photo.caption.slice(0, 500) : '' }] : [];
    });
    if (!photos.length) return [];
    return [{ id: typeof row.id === 'string' ? row.id : `gathering-${index}`, year, date: row.date, title: typeof row.title === 'string' ? row.title.slice(0, 200) : '', location: typeof row.location === 'string' ? row.location.slice(0, 200) : '', description: typeof row.description === 'string' ? row.description.slice(0, 3000) : '', photos }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}
function photoTile(photo, index, year, title) {
  const figure = textElement('figure', 'memory-photo');
  const button = textElement('button', 'photo-button');
  button.type = 'button';
  button.setAttribute('aria-label', `View ${photo.caption || title || 'gathering photo'}, ${year}`);
  button.dataset.photoIndex = String(index);
  button.dataset.photoYear = String(year);
  const img = document.createElement('img');
  img.src = photo.src;
  img.alt = photo.caption || `${title || 'Our gathering'}, ${year}`;
  img.loading = 'lazy';
  img.decoding = 'async';
  button.append(img);
  figure.append(button);
  return figure;
}
function renderTimeline(memories) {
  const links = $('#year-links');
  const entries = $('#timeline-years');
  links.replaceChildren();
  entries.replaceChildren();
  photosByYear.clear();
  for (const year of allYears) {
    const yearMemories = memories.filter(memory => memory.year === year);
    const yearPhotos = yearMemories.flatMap(memory => memory.photos.map(photo => ({ ...photo, year, title: memory.title })));
    photosByYear.set(year, yearPhotos);
    const link = textElement('a', `year-link${year === currentYear ? ' is-latest' : ''}`, String(year));
    link.href = `#year-${year}`;
    link.dataset.year = String(year);
    links.append(link);
    const section = textElement('section', `timeline-entry${yearPhotos.length ? ' has-photos' : ' is-empty'}`);
    section.id = `year-${year}`;
    section.dataset.year = String(year);
    section.setAttribute('aria-labelledby', `heading-${year}`);
    const label = textElement('div', 'year-marker');
    const heading = textElement('h2', '', String(year));
    heading.id = `heading-${year}`;
    label.append(heading);
    if (year === START_YEAR) label.append(textElement('span', 'year-note', 'The beginning'));
    else if (year === currentYear) label.append(textElement('span', 'year-note', 'And counting'));
    const body = textElement('div', 'entry-body');
    if (!yearPhotos.length) {
      body.append(textElement('p', 'empty-year', 'Photos to come.'));
    } else {
      let photoOffset = 0;
      for (const memory of yearMemories) {
        const article = textElement('article', 'gathering');
        const meta = textElement('div', 'memory-meta');
        meta.append(textElement('time', '', dateFormat.format(new Date(`${memory.date}T12:00:00`))));
        meta.querySelector('time').dateTime = memory.date;
        if (memory.location) meta.append(textElement('span', 'memory-location', memory.location));
        article.append(meta);
        if (memory.title) article.append(textElement('h3', 'memory-title', memory.title));
        if (memory.description) article.append(textElement('p', 'memory-story', memory.description));
        const gallery = textElement('div', `photo-mosaic count-${Math.min(memory.photos.length, 4)}`);
        const visibleCount = Math.min(memory.photos.length, 4);
        for (let i = 0; i < visibleCount; i++) gallery.append(photoTile(memory.photos[i], photoOffset + i, year, memory.title));
        article.append(gallery);
        if (memory.photos.length > 4) {
          const more = textElement('button', 'more-photos', `View all ${memory.photos.length} photos`);
          more.type = 'button';
          more.dataset.photoIndex = String(photoOffset);
          more.dataset.photoYear = String(year);
          article.append(more);
        } else {
          article.append(textElement('p', 'photo-count', `${memory.photos.length} ${memory.photos.length === 1 ? 'photo' : 'photos'}`));
        }
        body.append(article);
        photoOffset += memory.photos.length;
      }
    }
    section.append(label, body);
    entries.append(section);
  }
  $('#year-range').textContent = `${START_YEAR}–${currentYear}`;
  setupReveal();
  updateScrollState();
}
function setupReveal() {
  revealObserver?.disconnect();
  if (!('IntersectionObserver' in window) || reducedMotion.matches) {
    document.documentElement.classList.remove('motion-ready');
    return;
  }
  revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px 8% 0px', threshold: 0.05 });
  document.querySelectorAll('.timeline-entry').forEach(entry => revealObserver.observe(entry));
  document.documentElement.classList.add('motion-ready');
}
function updateScrollState() {
  const sections = [...document.querySelectorAll('.timeline-entry')];
  if (!sections.length) return;
  const threshold = Math.min(window.innerHeight * 0.3, 230);
  const atBottom = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 3;
  let current = atBottom ? sections.at(-1) : sections[0];
  if (!atBottom) for (const section of sections) if (section.getBoundingClientRect().top <= threshold) current = section;
  for (const link of document.querySelectorAll('.year-link')) {
    const active = link.dataset.year === current.dataset.year;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
  }
  const first = sections[0].getBoundingClientRect();
  const last = sections.at(-1).getBoundingClientRect();
  const ratio = atBottom ? 1 : Math.max(0, Math.min(1, (threshold - first.top) / Math.max(1, last.top - first.top)));
  $('#timeline-progress').style.transform = `scaleY(${ratio})`;
  scrollFrame = 0;
}
function showPhoto(index) {
  if (!activePhotos.length) return;
  activeIndex = (index + activePhotos.length) % activePhotos.length;
  const photo = activePhotos[activeIndex];
  $('#lightbox-image').src = photo.src;
  $('#lightbox-image').alt = photo.caption || `${photo.title || 'Our gathering'}, ${photo.year}`;
  $('#lightbox-year').textContent = String(photo.year);
  $('#lightbox-caption').textContent = photo.caption || photo.title || '';
  $('#lightbox-counter').textContent = `${activeIndex + 1} / ${activePhotos.length}`;
  $('#previous-photo').hidden = activePhotos.length < 2;
  $('#next-photo').hidden = activePhotos.length < 2;
  const dialog = $('#lightbox');
  if (!dialog.open) dialog.showModal();
}
document.addEventListener('click', event => {
  const control = event.target.closest('[data-photo-year]');
  if (!control) return;
  activeYear = Number(control.dataset.photoYear);
  activePhotos = photosByYear.get(activeYear) || [];
  showPhoto(Number(control.dataset.photoIndex));
});
$('#close-photo').addEventListener('click', () => $('#lightbox').close());
$('#previous-photo').addEventListener('click', () => showPhoto(activeIndex - 1));
$('#next-photo').addEventListener('click', () => showPhoto(activeIndex + 1));
document.addEventListener('keydown', event => {
  if (!$('#lightbox').open) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    showPhoto(activeIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  }
});
$('#lightbox').addEventListener('click', event => { if (event.target === $('#lightbox')) $('#lightbox').close(); });
$('#lightbox-image').addEventListener('pointerdown', event => { touchStart = { x: event.clientX, y: event.clientY }; });
$('#lightbox-image').addEventListener('pointerup', event => {
  if (!touchStart) return;
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) showPhoto(activeIndex + (dx < 0 ? 1 : -1));
});
window.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollState); }, { passive: true });
window.addEventListener('resize', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollState); });
reducedMotion.addEventListener?.('change', setupReveal);

async function init() {
  try {
    const response = await fetch('./memories.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Unavailable');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid album');
    renderTimeline(cleanMemories(rows));
    $('#timeline-status').hidden = true;
    if (/^#year-\d{4}$/.test(location.hash)) document.querySelector(location.hash)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  } catch {
    $('#timeline-status').textContent = 'Our timeline could not be loaded. Please try refreshing the page.';
    $('#timeline-status').setAttribute('role', 'alert');
  }
}
init();
