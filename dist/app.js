import { initialGatherings } from './data.js';
import { loadDrafts, saveGathering, deleteDraft, exportSite } from './memory-store.js';

const $ = (selector) => document.querySelector(selector);
const currentYear = Math.max(2026, new Date().getFullYear());
const years = Array.from({length: currentYear - 2013 + 1}, (_, i) => 2013 + i);
const photoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateFormat = new Intl.DateTimeFormat('en', {month:'short',day:'numeric'});
let published = initialGatherings;
let drafts = [];
let selectedYear = 'all';
let ascending = false;
let openedAlbum = null;
let lightboxPhotos = [];
let lightboxIndex = 0;
let previewUrls = [];
let toastTimer;

function allGatherings() {
  return [...new Map([...published, ...drafts].map(g=>[g.id,g])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}
function yearOf(g) {return Number(g.date.slice(0,4));}
function photoSrc(value) {
  if (typeof value !== 'string') return '';
  if (/^data:image\/(jpeg|png|webp);base64,/i.test(value)) return value;
  try {const u = new URL(value, location.href); return u.origin === location.origin || u.protocol === 'https:' ? u.href : '';} catch {return '';}
}
function notify(message) {$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function openDialog(dialog) {if (!dialog.open) dialog.showModal();}
function validateGathering(g) {
  return g && typeof g.id==='string' && typeof g.title==='string' && typeof g.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(g.date) && Array.isArray(g.photos) && g.photos.length && g.photos.every(p=>p && photoSrc(p.src));
}
function render() {
  const all=allGatherings();
  const ordered=ascending?[...years]:[...years].reverse();
  const chosen=selectedYear==='all'?ordered:[Number(selectedYear)];
  $('#year-tabs').innerHTML='<button class="year-tab '+(selectedYear==='all'?'active':'')+'" data-year="all" aria-pressed="'+(selectedYear==='all')+'">All years</button>'+years.map(y=>'<button class="year-tab '+(Number(selectedYear)===y?'active':'')+'" data-year="'+y+'" aria-pressed="'+(Number(selectedYear)===y)+'">'+y+'</button>').join('');
  $('#year-grid').innerHTML=chosen.map(year=>{
    const memories=all.filter(g=>yearOf(g)===year);
    if(!memories.length) return '<article class="year-card empty-card"><div class="year-heading"><h2>'+year+'</h2><span>'+(year===2013?'Where it began':'')+'</span></div><button class="empty-photo" data-add-year="'+year+'" aria-label="Add '+year+' photos">'+photoIcon+'<span>Add photos</span></button></article>';
    return memories.map(g=>'<article class="year-card"><div class="year-heading"><h2>'+year+'</h2><span>'+ (g.isDraft?'Draft on this device':dateFormat.format(new Date(g.date+'T12:00:00'))) +'</span></div><button class="year-photo" data-album="'+escapeHtml(g.id)+'" aria-label="Open '+escapeHtml(g.title)+'"><img src="'+escapeHtml(photoSrc(g.photos[0].src))+'" alt="'+escapeHtml(g.photos[0].caption||g.title)+'" loading="lazy"><span class="photo-count">'+g.photos.length+' photos</span></button><div class="year-caption"><button class="text-button memory-title" data-album="'+escapeHtml(g.id)+'">'+escapeHtml(g.title)+'</button>'+(g.location?'<p>'+escapeHtml(g.location)+'</p>':'')+'</div></article>').join('');
  }).join('');
  const selected=all.filter(g=>selectedYear==='all'||yearOf(g)===Number(selectedYear));
  const photoCount=selected.reduce((sum,g)=>sum+g.photos.length,0);
  $('#album-count').textContent=(selectedYear==='all'?'2013–'+currentYear:selectedYear)+' · '+photoCount+' '+(photoCount===1?'photo':'photos');
  $('#year-range').textContent='2013–'+currentYear;
  $('#sort-button').innerHTML=(ascending?'Oldest first':'Newest first')+' <span aria-hidden="true">⌄</span>';
}
function openAdd(year) {
  const form=$('#gathering-form');
  if (year) { form.elements.date.value=String(year)+'-01-01'; if(!form.elements.title.value)form.elements.title.value='Our '+year+' gathering'; }
  else if(!form.elements.date.value) form.elements.date.value=new Date().toLocaleDateString('en-CA');
  $('#form-error').textContent='';openDialog($('#add-dialog'));
}
function openAlbum(id) {
  const g=allGatherings().find(g=>g.id===id);if(!g)return;
  openedAlbum=g;
  $('#detail-year').textContent=String(yearOf(g))+' · OUR ANNUAL GATHERING';
  $('#detail-title').textContent=g.title;
  $('#detail-meta').textContent=`${new Intl.DateTimeFormat('en',{month:'long',day:'numeric',year:'numeric'}).format(new Date(`${g.date}T12:00:00`))}${g.location?' · '+g.location:''}`;
  $('#detail-description').textContent=g.description||'Same friends. Same pose. One more year together.';
  $('#detail-photos').innerHTML=g.photos.map((p,i)=>`<figure class="detail-photo"><button data-photo="${i}" aria-label="Enlarge ${escapeHtml(p.caption||`photo ${i+1}`)}"><img src="${escapeHtml(photoSrc(p.src))}" alt="${escapeHtml(p.caption||`${g.title}, photo ${i+1}`)}" loading="lazy"></button><figcaption>${escapeHtml(p.caption|| (i===0?'Our signature pose.':`A little moment from ${yearOf(g)}.`))}</figcaption></figure>`).join('');
  $('#detail-count').textContent=`${g.photos.length} ${g.photos.length===1?'photo':'photos'}`;
  $('#delete-draft').hidden=!g.isDraft;
  openDialog($('#album-dialog'));
}
function showLightbox(index) {
  lightboxIndex=(index+lightboxPhotos.length)%lightboxPhotos.length;
  const p=lightboxPhotos[lightboxIndex];$('#lightbox-image').src=photoSrc(p.src);$('#lightbox-image').alt=p.caption||`Photo ${lightboxIndex+1}`;
  $('#lightbox-caption').textContent=p.caption||'';$('#lightbox-counter').textContent=`${lightboxIndex+1} / ${lightboxPhotos.length}`;
  $('.lightbox-prev').hidden=lightboxPhotos.length<2;$('.lightbox-next').hidden=lightboxPhotos.length<2;
  openDialog($('#lightbox'));
}
function updatePreviews() {
  previewUrls.forEach(URL.revokeObjectURL);previewUrls=[];
  const files=[...$('#photos').files];
  $('#upload-previews').innerHTML='';
  for(const file of files.slice(0,6)) {const src=URL.createObjectURL(file);previewUrls.push(src);const img=document.createElement('img');img.src=src;img.alt=file.name;$('#upload-previews').append(img);}
  if(files.length){const note=document.createElement('span');note.textContent=`${files.length} selected · first photo = signature pose`;$('#upload-previews').append(note);}
  if(files.length>20) $('#form-error').textContent='Choose up to 20 photos per gathering.'; else $('#form-error').textContent='';
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.hasAttribute('data-add'))openAdd(selectedYear!=='all'?selectedYear:null);
  if(button.dataset.addYear)openAdd(button.dataset.addYear);
  if(button.hasAttribute('data-close'))button.closest('dialog').close();
  if(button.dataset.year){selectedYear=button.dataset.year;render();}
  if(button.dataset.album)openAlbum(button.dataset.album);
  if(button.hasAttribute('data-photo')){lightboxPhotos=openedAlbum.photos;showLightbox(Number(button.dataset.photo));}
});
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}));
$('#sort-button').addEventListener('click',()=>{ascending=!ascending;render();});
$('.lightbox-prev').addEventListener('click',()=>showLightbox(lightboxIndex-1));
$('.lightbox-next').addEventListener('click',()=>showLightbox(lightboxIndex+1));
document.addEventListener('keydown',event=>{if(!$('#lightbox').open)return;if(event.key==='ArrowLeft'){event.preventDefault();showLightbox(lightboxIndex-1);}if(event.key==='ArrowRight'){event.preventDefault();showLightbox(lightboxIndex+1);}});
$('#photos').addEventListener('change',updatePreviews);
const dropzone=$('#dropzone');
for(const name of ['dragenter','dragover'])dropzone.addEventListener(name,event=>{event.preventDefault();dropzone.classList.add('dragover');});
for(const name of ['dragleave','drop'])dropzone.addEventListener(name,event=>{event.preventDefault();dropzone.classList.remove('dragover');});
dropzone.addEventListener('drop',event=>{if(event.dataTransfer.files.length){$('#photos').files=event.dataTransfer.files;updatePreviews();}});
$('#gathering-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const submit=form.querySelector('[type=submit]');
  $('#form-error').textContent='';submit.disabled=true;submit.textContent='Keeping your memories…';
  try {
    const fields=new FormData(form);
    const date=String(fields.get('date'));
    if(Number(date.slice(0,4))<2013||Number(date.slice(0,4))>currentYear)throw new Error(`Choose a gathering from 2013 through ${currentYear}.`);
    const saved=await saveGathering({title:String(fields.get('title')).trim(),date,location:String(fields.get('location')).trim(),description:String(fields.get('description')).trim(),files:[...$('#photos').files]});
    drafts.unshift(saved);selectedYear=date.slice(0,4);form.reset();updatePreviews();$('#add-dialog').close();render();notify('Memory saved in this browser. Export when you’re ready to publish.');$('#years').scrollIntoView({behavior:'smooth'});
  }catch(error){$('#form-error').textContent=error.message||'This memory could not be saved. Please try again.';}
  finally{submit.disabled=false;submit.textContent='Save memory';}
});
$('#delete-draft').addEventListener('click',async()=>{
  if(!openedAlbum?.isDraft)return;
  const button=$('#delete-draft');
  if(button.dataset.confirm!==openedAlbum.id){button.dataset.confirm=openedAlbum.id;button.textContent='Click again to delete this draft';return;}
  try{await deleteDraft(openedAlbum.id);drafts=drafts.filter(g=>g.id!==openedAlbum.id);$('#album-dialog').close();render();notify('Local draft deleted.');}catch(error){notify(error.message||'Could not delete this draft.');}
  button.textContent='Delete local draft';button.dataset.confirm='';
});
$('#album-dialog').addEventListener('close',()=>{$('#delete-draft').textContent='Delete local draft';$('#delete-draft').dataset.confirm='';});
$('#publish-button').addEventListener('click',()=>openDialog($('#publish-dialog')));
$('#export-button').addEventListener('click',async()=>{
  const button=$('#export-button');button.disabled=true;$('#export-error').textContent='';$('#export-status').textContent='Packing your website and photos…';
  try{await exportSite(allGatherings());$('#export-status').textContent='Downloaded. Unzip and add the files to your GitHub repository.';notify('Your memory box is ready to publish.');}
  catch(error){$('#export-error').textContent=error.message||'The download could not be created. Please try again.';$('#export-status').textContent='';}
  finally{button.disabled=false;}
});

async function init(){
  
  $('#gathering-form').elements.date.max=`${currentYear}-12-31`;
  const loaded=await Promise.allSettled([fetch('./memories.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null),loadDrafts()]);
  if(loaded[0].status==='fulfilled' && Array.isArray(loaded[0].value)) published=loaded[0].value.filter(validateGathering);
  if(loaded[1].status==='fulfilled') drafts=loaded[1].value.filter(validateGathering);
  else notify('Browser storage is unavailable. You can still explore published memories.');
  render();
}
init();
