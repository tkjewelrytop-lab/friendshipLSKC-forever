import { connect, disconnect, isConnected, loadMemories, publishMemory, addPhotos } from './github-backend.js';

const $=selector=>document.querySelector(selector);
const currentYear=Math.max(2026,new Date().getFullYear());
const form=$('#upload-form');
let selectedFiles=[];
let previewUrls=[];
let memories=[];
let publishing=false;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=new Date();
form.elements.date.value=`${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`;
form.elements.date.max=`${currentYear}-12-31`;
form.elements.title.value=`Our ${localDate.getFullYear()} gathering`;

function setConnected(profile){
  const connected=!!profile;
  $('#connect-form').hidden=connected;
  $('#connected-row').hidden=!connected;
  $('#connection-hint').hidden=connected;
  $('#upload-fields').disabled=!connected||publishing;
  $('#published-panel').hidden=!connected;
  $('#connection-state').textContent=connected?'Connected':'Not connected';
  $('#connection-state').classList.toggle('connected',connected);
  $('#connected-user').textContent=connected?`Connected as ${profile.login} · friendshipLSKC-forever`:'';
  if(connected)$('#token-help').open=false;
}
function setBusy(busy){
  publishing=busy;
  $('#upload-fields').disabled=busy||!isConnected();
  $('#disconnect-button').disabled=busy;
  $('#refresh-memories').disabled=busy;
  $('#publish-progress').hidden=!busy;
}
async function refresh(){
  const result=await loadMemories();
  memories=result.memories;
  renderPublished();
}
function renderPublished(){
  const selected=$('#memory-target').value;
  const ordered=[...memories].sort((a,b)=>b.date.localeCompare(a.date));
  $('#memory-target').innerHTML='<option value="new">A new gathering</option>'+ordered.map(memory=>`<option value="${escapeHtml(memory.id)}">${escapeHtml(memory.date.slice(0,4))} · ${escapeHtml(memory.title)}</option>`).join('');
  if(memories.some(memory=>memory.id===selected))$('#memory-target').value=selected;
  setTarget();
  const photoCount=memories.reduce((sum,memory)=>sum+memory.photos.length,0);
  const yearCount=new Set(memories.map(memory=>memory.date.slice(0,4))).size;
  $('#published-count').textContent=`${photoCount} photos across ${yearCount} ${yearCount===1?'year':'years'}`;
  $('#published-memories').innerHTML=ordered.length?ordered.map(memory=>`<article class="published-memory"><span class="published-year">${escapeHtml(memory.date.slice(0,4))}</span><div class="published-description"><h3>${escapeHtml(memory.title)}</h3><p>${escapeHtml(memory.date)}${memory.location?' · '+escapeHtml(memory.location):''} · ${memory.photos.length} photos</p></div><button class="text-button" data-append="${escapeHtml(memory.id)}">Add more photos</button></article>`).join(''):'<p class="published-empty">Your first memory is waiting to be added.</p>';
}
function setTarget(){
  const existing=$('#memory-target').value!=='new';
  $('#memory-details').hidden=existing;
  for(const field of $('#memory-details').querySelectorAll('input,textarea'))field.disabled=existing;
  $('#publish-memory').textContent=existing?'Publish more photos':'Publish memory';
}
function renderPreviews(){
  previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];
  $('#photo-previews').innerHTML=selectedFiles.map((file,index)=>{
    const url=URL.createObjectURL(file);previewUrls.push(url);
    return `<article class="preview-card"><img src="${url}" alt="${escapeHtml(file.name)}">${index===0&&$('#memory-target').value==='new'?'<span class="cover-badge">Cover photo</span>':''}<p class="preview-name">${escapeHtml(file.name)}</p><div class="preview-actions">${index>0&&$('#memory-target').value==='new'?`<button type="button" class="text-button" data-cover="${index}" aria-label="Make ${escapeHtml(file.name)} the cover">Make cover</button>`:''}<button type="button" class="text-button" data-remove="${index}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button></div></article>`;
  }).join('');
  $('#selection-heading').hidden=!selectedFiles.length;
  $('#selection-count').textContent=`${selectedFiles.length} ${selectedFiles.length===1?'photo':'photos'} selected`;
}
function addFiles(files){
  $('#upload-error').textContent='';
  const incoming=[...files];
  if(incoming.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type))){$('#upload-error').textContent='Choose JPG, PNG, or WebP photos.';return;}
  if(incoming.some(file=>file.size>20*1024*1024)){$('#upload-error').textContent='Each photo must be 20 MB or smaller.';return;}
  const newFiles=incoming.filter(file=>!selectedFiles.some(existing=>existing.name===file.name&&existing.size===file.size&&existing.lastModified===file.lastModified));
  if(selectedFiles.length+newFiles.length>20){$('#upload-error').textContent='Choose up to 20 photos per upload. You can add more to the same year afterward.';return;}
  selectedFiles.push(...newFiles);renderPreviews();
}
$('#connect-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const tokenInput=$('#github-token');const button=$('#connect-button');
  $('#connect-error').textContent='';button.disabled=true;button.textContent='Connecting…';
  try{
    const profile=await connect(tokenInput.value.trim());
    tokenInput.value='';
    await refresh();setConnected(profile);
  }catch(error){tokenInput.value='';disconnect();setConnected(null);$('#connect-error').textContent=error.message||'Could not connect to this repository.';}
  finally{button.disabled=false;button.textContent='Connect';}
});
$('#disconnect-button').addEventListener('click',()=>{
  disconnect();setConnected(null);memories=[];$('#github-token').value='';$('#publish-success').hidden=true;
});
$('#refresh-memories').addEventListener('click',async()=>{
  const button=$('#refresh-memories');button.disabled=true;$('#connect-error').textContent='';
  try{await refresh();}catch(error){if(!isConnected())setConnected(null);$('#connect-error').textContent=error.message||'Could not refresh the album.';}finally{button.disabled=false;}
});
$('#memory-target').addEventListener('change',()=>{setTarget();renderPreviews();});
form.elements.date.addEventListener('change',()=>{
  if(/^Our \d{4} gathering$/.test(form.elements.title.value))form.elements.title.value=`Our ${form.elements.date.value.slice(0,4)} gathering`;
});
$('#photo-files').addEventListener('change',event=>{addFiles(event.target.files);event.target.value='';});
const dropzone=$('#dropzone');
for(const name of ['dragenter','dragover'])dropzone.addEventListener(name,event=>{event.preventDefault();if(isConnected()&&!publishing)dropzone.classList.add('dragover');});
for(const name of ['drop','dragleave'])dropzone.addEventListener(name,event=>{event.preventDefault();dropzone.classList.remove('dragover');});
dropzone.addEventListener('drop',event=>{if(isConnected()&&!publishing)addFiles(event.dataTransfer.files);});
$('#clear-photos').addEventListener('click',()=>{selectedFiles=[];renderPreviews();});
$('#photo-previews').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-remove'))selectedFiles.splice(Number(button.dataset.remove),1);
  if(button.hasAttribute('data-cover')){const [cover]=selectedFiles.splice(Number(button.dataset.cover),1);selectedFiles.unshift(cover);}
  renderPreviews();
});
$('#published-memories').addEventListener('click',event=>{
  const button=event.target.closest('[data-append]');if(!button||publishing)return;
  $('#memory-target').value=button.dataset.append;setTarget();renderPreviews();$('#upload-title').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
});
function onProgress(progress){$('#progress-message').textContent=typeof progress==='string'?progress:progress?.message||'Publishing your memories…';}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!isConnected()||publishing)return;
  $('#upload-error').textContent='';$('#publish-success').hidden=true;
  if(!selectedFiles.length){$('#upload-error').textContent='Choose at least one photo.';return;}
  const target=$('#memory-target').value;
  setBusy(true);onProgress('Preparing your photos…');
  try{
    const result=target==='new'?await publishMemory({title:form.elements.title.value,date:form.elements.date.value,location:form.elements.location.value,description:form.elements.description.value,files:selectedFiles},onProgress):await addPhotos(target,selectedFiles,onProgress);
    selectedFiles=[];renderPreviews();
    $('#published-commit').href=`https://github.com/tkjewelrytop-lab/friendshipLSKC-forever/commit/${encodeURIComponent(result.commitSha)}`;
    $('#publish-success').hidden=false;
    try{await refresh();}catch{if(!isConnected())setConnected(null);$('#connect-error').textContent='Photos were saved. Refresh the album list when your connection is available.';}
  }catch(error){if(!isConnected())setConnected(null);$('#upload-error').textContent=error.message||'Could not publish these photos. Your selection is still here so you can try again.';}
  finally{setBusy(false);setTarget();}
});
window.addEventListener('pagehide',()=>{disconnect();$('#github-token').value='';});
window.addEventListener('pageshow',()=>{if(!isConnected())setConnected(null);});
setConnected(null);
