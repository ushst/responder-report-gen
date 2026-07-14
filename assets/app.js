'use strict';

const STORAGE_KEY = 'responder-report-gen:v1';

const NBTNS_SERVICES = ["Workstation/Redirector","Domain Master Browser","Domain Controller","Local Master Browser","Browser Election","File Server","Browser"];

const MODULES = ["SMB","HTTP","HTTPS","MSSQL","LDAP","LDAPS","RDP","DCE-RPC","Proxy-Auth","WinRM","IMAP","POP3","SMTP","FTP","MQTT"];

// Per-module auth "type" values, verified against Responder's servers/*.py SaveToDb() calls.
const MODULE_TYPES = {
  'SMB':        ['NTLMv1-SSP','NTLMv2-SSP','NTLMv1','NTLMv2'],
  'HTTP':       ['NTLMv1','NTLMv2','Basic'],
  'HTTPS':      ['NTLMv1','NTLMv2','Basic'],
  'MSSQL':      ['NTLMv1','NTLMv2','Cleartext'],
  'LDAP':       ['NTLMv1-SSP','NTLMv2-SSP','PLAIN-SASL','Cleartext','DIGEST-MD5'],
  'LDAPS':      ['NTLMv1-SSP','NTLMv2-SSP','PLAIN-SASL','Cleartext','DIGEST-MD5'],
  'RDP':        ['NTLMv1-SSP','NTLMv2-SSP'],
  'DCE-RPC':    ['NTLMv1-SSP','NTLMv2-SSP'],
  'Proxy-Auth': ['Basic'],
  'WinRM':      ['NTLMv1','NTLMv2','Basic'],
  'IMAP':       ['Cleartext','NetNTLMv1','NetNTLMv2'],
  'POP3':       ['APOP','AUTH-PLAIN','AUTH-LOGIN','CRAM-MD5','Cleartext','NTLMv1-SSP','NTLMv2-SSP'],
  'SMTP':       ['AUTH-PLAIN','AUTH-LOGIN','CRAM-MD5','DIGEST-MD5','NTLMv2-SSP'],
  'FTP':        ['Cleartext'],
  'MQTT':       ['Cleartext'],
};

// Types whose SaveToDb() result carries a `cleartext` value -> rendered as a "Password :" line.
// Everything else carries a `hash`/`fullhash` value -> rendered as a "Hash     :" line.
const PASSWORD_TYPES = new Set(['Basic','Cleartext','PLAIN-SASL','AUTH-PLAIN','AUTH-LOGIN']);

let entries = [];
let uid = 1;
let saveTimer = null;

function defaultSettings(){
  return { theme:'theme-kali', fontsize:'14', showBar:true,
    barTitle:'root@kali: ~/Responder — python3 Responder.py -I eth0' };
}
let settings = defaultSettings();

function makePoison(){ return {id:uid++, kind:'poison', proto:'LLMNR', client:'192.168.1.50', name:'FILESRV01', service:'File Server'}; }
function makeCapture(){
  return {id:uid++, kind:'capture', module:'SMB', type:'NTLMv2-SSP', client:'192.168.1.50',
    showHost:false, hostname:'', username:'CONTOSO\\jdoe',
    hash:'jdoe::CONTOSO:1122334455667788:9F5C79...:0101000000000000...', password:''};
}
function makeRaw(){ return {id:uid++, kind:'raw', text:'[*] Responder is now listening', color:'muted'}; }
function makeBlank(){ return {id:uid++, kind:'blank'}; }

function addPoison(){ entries.push(makePoison()); render(); }
function addCapture(){ entries.push(makeCapture()); render(); }
function addRaw(){ entries.push(makeRaw()); render(); }
function addBlank(){ entries.push(makeBlank()); render(); }
function duplicateEntry(id){
  const i = entries.findIndex(e=>e.id===id);
  if(i<0) return;
  const copy = JSON.parse(JSON.stringify(entries[i]));
  copy.id = uid++;
  entries.splice(i+1, 0, copy);
  render();
}
function removeEntry(id){ entries = entries.filter(e=>e.id!==id); render(); }
function moveEntry(id, dir){
  const i = entries.findIndex(e=>e.id===id);
  const j = i+dir;
  if(j<0 || j>=entries.length) return;
  [entries[i], entries[j]] = [entries[j], entries[i]];
  render();
}

function el(tag, attrs, children){
  const e = document.createElement(tag);
  for(const k in (attrs||{})){
    if(k==='class') e.className = attrs[k];
    else if(k==='style') e.style.cssText = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  (children||[]).forEach(c=> e.appendChild(typeof c==='string'? document.createTextNode(c): c));
  return e;
}
function selectEl(options, value, onchange){
  const s = document.createElement('select');
  options.forEach(o=>{
    const opt = document.createElement('option');
    opt.value=o; opt.textContent=o; if(o===value) opt.selected=true;
    s.appendChild(opt);
  });
  s.addEventListener('change', e=>onchange(e.target.value));
  return s;
}
function textEl(value, onInput, placeholder){
  const i = document.createElement('input');
  i.type='text'; i.value=value||''; if(placeholder) i.placeholder=placeholder;
  i.addEventListener('input', e=>onInput(e.target.value));
  return i;
}
function taEl(value, onInput, rows){
  const t = document.createElement('textarea');
  t.value = value||''; t.rows = rows||2;
  t.addEventListener('input', e=>onInput(e.target.value));
  return t;
}
function field(labelText, inputNode){
  return el('div',{class:'field'},[el('label',{},[labelText]), inputNode]);
}
function cardHead(title, entry){
  const head = el('div',{class:'card-head'});
  head.appendChild(el('span',{},[title]));
  const btns = el('div',{style:'display:flex;gap:4px;'});
  btns.appendChild(el('button',{class:'move-btn', type:'button', title:'Вверх'},['↑']));
  btns.appendChild(el('button',{class:'move-btn', type:'button', title:'Вниз'},['↓']));
  btns.appendChild(el('button',{class:'dup-btn', type:'button', title:'Дублировать'},['⧉']));
  btns.appendChild(el('button',{class:'icon-btn', type:'button', title:'Удалить'},['✕']));
  const [up, down, dup, del] = btns.children;
  up.addEventListener('click', ()=>moveEntry(entry.id,-1));
  down.addEventListener('click', ()=>moveEntry(entry.id,1));
  dup.addEventListener('click', ()=>duplicateEntry(entry.id));
  del.addEventListener('click', ()=>removeEntry(entry.id));
  head.appendChild(btns);
  return head;
}

function typesForModule(mod){ return MODULE_TYPES[mod] || ['NTLMv1-SSP','NTLMv2-SSP','Basic']; }

function renderEntries(){
  const box = document.getElementById('entries');
  box.innerHTML = '';
  entries.forEach(entry=>{
    const card = el('div',{class:'card'});
    if(entry.kind==='poison'){
      card.appendChild(cardHead('Poison — '+entry.proto, entry));
      const row = el('div',{class:'row'});
      row.appendChild(field('Протокол', selectEl(['LLMNR','NBT-NS','MDNS'], entry.proto, v=>{entry.proto=v; render();})));
      row.appendChild(field('Client IP', textEl(entry.client, v=>{entry.client=v; renderPreview();})));
      card.appendChild(row);
      card.appendChild(field('Запрошенное имя (Name)', textEl(entry.name, v=>{entry.name=v; renderPreview();})));
      if(entry.proto==='NBT-NS'){
        card.appendChild(field('Service', selectEl(NBTNS_SERVICES, entry.service, v=>{entry.service=v; renderPreview();})));
      }
    } else if(entry.kind==='capture'){
      const allowedTypes = typesForModule(entry.module);
      if(!allowedTypes.includes(entry.type)) entry.type = allowedTypes[0];
      card.appendChild(cardHead(entry.module+' / '+entry.type, entry));
      const row1 = el('div',{class:'row'});
      row1.appendChild(field('Модуль', selectEl(MODULES, entry.module, v=>{entry.module=v; render();})));
      row1.appendChild(field('Тип', selectEl(allowedTypes, entry.type, v=>{entry.type=v; render();})));
      card.appendChild(row1);
      card.appendChild(field('Client IP', textEl(entry.client, v=>{entry.client=v; renderPreview();})));
      const hostChk = document.createElement('input');
      hostChk.type='checkbox'; hostChk.checked=entry.showHost;
      hostChk.addEventListener('change', e=>{entry.showHost=e.target.checked; render();});
      card.appendChild(el('label',{class:'chk'},[hostChk, 'показать строку Hostname']));
      if(entry.showHost){
        card.appendChild(field('Hostname', textEl(entry.hostname, v=>{entry.hostname=v; renderPreview();})));
      }
      card.appendChild(field('Username (напр. DOMAIN\\\\user)', textEl(entry.username, v=>{entry.username=v; renderPreview();})));
      if(PASSWORD_TYPES.has(entry.type)){
        card.appendChild(field('Password (cleartext)', textEl(entry.password, v=>{entry.password=v; renderPreview();})));
      } else {
        card.appendChild(field('Hash (полная строка, как в логах Responder)', taEl(entry.hash, v=>{entry.hash=v; renderPreview();}, 3)));
      }
    } else if(entry.kind==='raw'){
      card.appendChild(cardHead('Произвольная строка', entry));
      card.appendChild(field('Текст', textEl(entry.text, v=>{entry.text=v; renderPreview();})));
      card.appendChild(field('Цвет', selectEl(['muted','white','yellow','green','blue','red'], entry.color, v=>{entry.color=v; renderPreview();})));
    } else if(entry.kind==='blank'){
      card.appendChild(cardHead('Пустая строка', entry));
    }
    box.appendChild(card);
  });
}

function line(...spans){
  const div = document.createElement('div');
  spans.forEach(s=>{
    if(typeof s==='string'){ div.appendChild(document.createTextNode(s)); return; }
    div.appendChild(el('span',{class:s.cls},[s.t]));
  });
  if(spans.length===0) div.innerHTML='&nbsp;';
  return div;
}

function renderPreview(){
  const term = document.getElementById('terminal');
  term.innerHTML = '';
  entries.forEach(entry=>{
    if(entry.kind==='poison'){
      let text;
      if(entry.proto==='LLMNR'){
        text = `[*] [LLMNR]  Poisoned answer sent to ${entry.client} for name ${entry.name}`;
      } else if(entry.proto==='NBT-NS'){
        text = `[*] [NBT-NS] Poisoned answer sent to ${entry.client} for name ${entry.name} (service: ${entry.service})`;
      } else {
        const padded = entry.client + ' '.repeat(Math.max(0,15-entry.client.length));
        text = `[*] [MDNS] Poisoned answer sent to ${padded} for name ${entry.name}`;
      }
      term.appendChild(line({cls:'c-green', t:text}));
    } else if(entry.kind==='capture'){
      const bracket = `[${entry.module}]`;
      const isPw = PASSWORD_TYPES.has(entry.type);
      if(entry.client){
        term.appendChild(line({cls:'c-blue', t:bracket}, ` ${entry.type} `, 'Client   : ', {cls:'c-yellow', t:entry.client}));
      }
      if(entry.showHost && entry.hostname){
        term.appendChild(line({cls:'c-blue', t:bracket}, ` ${entry.type} `, 'Hostname : ', {cls:'c-yellow', t:entry.hostname}));
      }
      if(entry.username){
        term.appendChild(line({cls:'c-blue', t:bracket}, ` ${entry.type} `, 'Username : ', {cls:'c-yellow', t:entry.username}));
      }
      if(isPw){
        if(entry.password) term.appendChild(line({cls:'c-blue', t:bracket}, ` ${entry.type} `, 'Password : ', {cls:'c-yellow', t:entry.password}));
      } else if(entry.hash){
        term.appendChild(line({cls:'c-blue', t:bracket}, ` ${entry.type} `, 'Hash     : ', {cls:'c-yellow', t:entry.hash}));
      }
    } else if(entry.kind==='raw'){
      const clsMap = {muted:'c-muted', white:'c-white', yellow:'c-yellow', green:'c-green', blue:'c-blue', red:'c-red'};
      term.appendChild(line({cls:clsMap[entry.color]||'c-white', t:entry.text}));
    } else if(entry.kind==='blank'){
      term.appendChild(line());
    }
  });

  document.getElementById('termWrap').className = settings.theme;
  term.style.fontSize = settings.fontsize+'px';

  document.getElementById('termbar').style.display = settings.showBar? 'flex':'none';
  document.getElementById('termbarTitle').textContent = settings.barTitle;
  term.style.borderRadius = settings.showBar? '0 0 8px 8px' : '8px';

  scheduleSave();
}

function render(){ renderEntries(); renderPreview(); saveState(); }

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}
function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, settings, uid }));
  }catch(e){ /* localStorage unavailable (private mode / quota) — silently skip persistence */ }
}
function loadState(){
  let raw;
  try{ raw = localStorage.getItem(STORAGE_KEY); }catch(e){ raw = null; }
  if(!raw) return false;
  try{
    const data = JSON.parse(raw);
    if(!Array.isArray(data.entries)) return false;
    entries = data.entries;
    settings = Object.assign(defaultSettings(), data.settings||{});
    uid = data.uid || (Math.max(0, ...entries.map(e=>e.id||0)) + 1);
    return true;
  }catch(e){ return false; }
}

function applySettingsToControls(){
  document.getElementById('theme').value = settings.theme;
  document.getElementById('fontsize').value = settings.fontsize;
  document.getElementById('showBar').checked = settings.showBar;
  document.getElementById('barTitle').value = settings.barTitle;
}

function fallbackCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try{ ok = document.execCommand('copy'); }catch(e){ ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function copyText(e){
  const text = Array.from(document.getElementById('terminal').children).map(d=>d.textContent).join('\n');
  const btn = e.currentTarget;
  const flash = (label)=>{ const old = btn.textContent; btn.textContent = label; setTimeout(()=>btn.textContent=old, 1400); };

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(()=>flash('Скопировано ✓')).catch(()=>{
      flash(fallbackCopy(text) ? 'Скопировано ✓' : 'Не удалось скопировать');
    });
  } else {
    flash(fallbackCopy(text) ? 'Скопировано ✓' : 'Не удалось скопировать');
  }
}

function resetAll(){
  if(!confirm('Удалить все строки?')) return;
  entries = [];
  render();
}

function exportJSON(){
  const data = JSON.stringify({ entries, settings }, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'responder-report-scenario.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!Array.isArray(data.entries)) throw new Error('bad format');
      entries = data.entries;
      settings = Object.assign(defaultSettings(), data.settings||{});
      uid = Math.max(0, ...entries.map(e=>e.id||0)) + 1;
      applySettingsToControls();
      render();
    }catch(e){
      alert('Не удалось прочитать файл сценария: неверный формат JSON.');
    }
  };
  reader.readAsText(file);
}

function wireControls(){
  document.getElementById('btnAddPoison').addEventListener('click', addPoison);
  document.getElementById('btnAddCapture').addEventListener('click', addCapture);
  document.getElementById('btnAddRaw').addEventListener('click', addRaw);
  document.getElementById('btnAddBlank').addEventListener('click', addBlank);
  document.getElementById('btnCopy').addEventListener('click', copyText);
  document.getElementById('btnReset').addEventListener('click', resetAll);
  document.getElementById('btnExport').addEventListener('click', exportJSON);

  const fileInput = document.getElementById('fileImport');
  document.getElementById('btnImport').addEventListener('click', ()=>fileInput.click());
  fileInput.addEventListener('change', ()=>{
    if(fileInput.files[0]) importJSON(fileInput.files[0]);
    fileInput.value = '';
  });

  document.getElementById('theme').addEventListener('change', e=>{settings.theme=e.target.value; renderPreview();});
  document.getElementById('fontsize').addEventListener('change', e=>{settings.fontsize=e.target.value; renderPreview();});
  document.getElementById('showBar').addEventListener('change', e=>{settings.showBar=e.target.checked; renderPreview();});
  document.getElementById('barTitle').addEventListener('input', e=>{settings.barTitle=e.target.value; renderPreview();});
}

function init(){
  wireControls();
  const restored = loadState();
  if(!restored){
    entries = [makePoison(), makeCapture()];
  }
  applySettingsToControls();
  render();

  // Flush any pending debounced save immediately before the tab is closed/hidden/refreshed.
  window.addEventListener('beforeunload', saveState);
  document.addEventListener('visibilitychange', () => { if(document.hidden) saveState(); });
}

document.addEventListener('DOMContentLoaded', init);
