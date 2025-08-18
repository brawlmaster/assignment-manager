// Recreated app entry with cancel button fix

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

const dbPromise = (() => new Promise((resolve, reject) => {
  const req = indexedDB.open('focus-tasks-db', 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('tasks')) {
      const s = db.createObjectStore('tasks', { keyPath: 'id' });
      s.createIndex('due', 'due');
      s.createIndex('completed', 'completed');
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}))();

async function dbTxn(names, mode, op){
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = names.map(n => tx.objectStore(n));
    let result;
    tx.oncomplete = async () => {
      try { resolve(result instanceof Promise ? await result : result); } catch(e){ reject(e); }
    };
    tx.onerror = () => reject(tx.error);
    try { result = op(...stores, tx); } catch(e){ reject(e); }
  });
}

function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function nowMs(){ return Date.now(); }
function toInputDateTime(ms){
  const d = new Date(ms); const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let tasks = [];
let filterMode = 'all';
let searchQuery = '';
const pendingDeletions = new Map();

const taskListEl = document.getElementById('taskList');
const upcomingSectionEl = document.getElementById('upcomingSection');
const upcomingListEl = document.getElementById('upcomingList');
const progressFillEl = document.getElementById('progressFill');
const progressPctEl = document.getElementById('progressPct');
const importanceValueEl = document.getElementById('importanceValue');
const addTaskButton = document.getElementById('addTaskButton');
const dialog = document.getElementById('taskDialog');
const form = document.getElementById('taskForm');
const titleInput = document.getElementById('taskTitle');
const dueInput = document.getElementById('taskDue');
const importanceInput = document.getElementById('taskImportance');
const notesInput = document.getElementById('taskNotes');
const recurrenceInput = document.getElementById('taskRecurrence');
const cancelTaskButton = document.getElementById('cancelTaskButton');
const filterSelect = document.getElementById('filterSelect');
const searchInput = document.getElementById('searchInput');
const exportButton = document.getElementById('exportButton');
const importButton = document.getElementById('importButton');
const importFile = document.getElementById('importFile');
const exportDialog = document.getElementById('exportDialog');
const exportForm = document.getElementById('exportForm');
const exportList = document.getElementById('exportList');
const exportSelectAll = document.getElementById('exportSelectAll');
const exportSelectNone = document.getElementById('exportSelectNone');
const exportConfirm = document.getElementById('exportConfirm');
const exportCancel = document.getElementById('exportCancel');
const toastEl = document.getElementById('toast');
const toastMessageEl = document.getElementById('toastMessage');
const toastUndoEl = document.getElementById('toastUndo');

async function registerSW(){
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register(new URL('sw.js', location.href).toString()); } catch {}
}

async function ensureNotificationPermission(){
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

async function refreshReminders(){
  try{
    const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return;
    const upcoming = tasks.filter(t => !t.completed && t.due - nowMs() <= THREE_DAYS_MS && t.due > nowMs());
    reg.active?.postMessage({ type: 'SET_REMINDERS', tasks: upcoming.map(t => ({ id:t.id, title:t.title, due:t.due })) });
  }catch{}
}

function render(){
  let filtered = tasks.filter(t => {
    if (searchQuery && !(t.title.toLowerCase().includes(searchQuery) || (t.notes||'').toLowerCase().includes(searchQuery))) return false;
    if (filterMode === 'active' && t.completed) return false;
    if (filterMode === 'completed' && !t.completed) return false;
    if (filterMode === 'dueSoon' && (t.completed || (t.due - nowMs() > THREE_DAYS_MS))) return false;
    return true;
  });
  const sorted = [...filtered].sort((a,b)=> a.completed - b.completed || a.due - b.due || b.importance - a.importance);
  taskListEl.innerHTML = '';
  let completedCount = 0; const dueSoon = [];
  for (const t of sorted){
    if (t.completed) completedCount++; if (!t.completed && t.due - nowMs() <= THREE_DAYS_MS) dueSoon.push(t);
    const li = document.createElement('li'); li.className = 'task-item animate-in';
    const checkbox = document.createElement('input'); checkbox.type='checkbox'; checkbox.checked=!!t.completed;
    checkbox.addEventListener('change', async () => { t.completed = checkbox.checked; await saveTask(t); render(); });
    const content = document.createElement('div');
    const title = document.createElement('div'); title.className='title'; title.textContent = t.title;
    const meta = document.createElement('div'); meta.className='meta'; meta.textContent = `Due ${new Date(t.due).toLocaleString()} • Importance ${t.importance}`;
    content.appendChild(title); content.appendChild(meta);
    if (t.notes){ const n=document.createElement('div'); n.className='hint'; n.textContent=t.notes; content.appendChild(n); }
    const right = document.createElement('div'); right.className='badges';
    const soon = t.due - nowMs() <= THREE_DAYS_MS && !t.completed;
    const badge = document.createElement('span'); badge.className = 'badge ' + (soon ? 'alert' : 'ok'); badge.textContent = soon ? 'Due ≤ 3 days' : 'Scheduled';
    right.appendChild(badge);
    const delBtn = document.createElement('button'); delBtn.className='icon-btn icon-danger'; delBtn.title='Delete task';
    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
    delBtn.addEventListener('click', () => softDeleteTask(t)); right.appendChild(delBtn);
    li.appendChild(checkbox); li.appendChild(content); li.appendChild(right); taskListEl.appendChild(li);
  }
  const pct = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);
  progressFillEl.style.transform = `scaleX(${pct/100})`; progressPctEl.textContent = pct + '%';
  upcomingListEl.innerHTML = '';
  if (dueSoon.length>0){ upcomingSectionEl.hidden=false; for (const t of dueSoon.slice(0,10)){
    const li=document.createElement('li'); li.className='task-item'; const label=document.createElement('div'); label.className='title'; label.textContent = `${t.title} — ${new Date(t.due).toLocaleString()}`; li.appendChild(document.createElement('span')); li.appendChild(label); li.appendChild(document.createElement('div')); upcomingListEl.appendChild(li);
  }} else { upcomingSectionEl.hidden=true; }
}

async function loadTasks(){
  tasks = await dbTxn(['tasks'],'readonly',(store)=> new Promise((resolve,reject)=>{
    const out=[]; const c = store.openCursor();
    c.onsuccess = () => { const cur=c.result; if (cur){ out.push(cur.value); cur.continue(); } else resolve(out); };
    c.onerror = () => reject(c.error);
  }));
}

async function saveTask(task){ await dbTxn(['tasks'],'readwrite',(s)=> s.put(task)); await refreshReminders(); }
async function deleteTasks(ids){ await dbTxn(['tasks'],'readwrite',(s)=> ids.forEach(id=> s.delete(id))); await loadTasks(); await refreshReminders(); render(); }

function openDialog(defaults=null){
  form.reset(); document.getElementById('dialogTitle').textContent = defaults ? 'Edit Task' : 'New Task';
  const d = defaults ?? { title:'', due: nowMs()+ONE_DAY_MS, importance:5, notes:'', recurrence:'none' };
  titleInput.value=d.title; dueInput.value=toInputDateTime(d.due); importanceInput.value=d.importance; importanceValueEl.textContent=String(d.importance); recurrenceInput.value=d.recurrence; notesInput.value=d.notes||'';
  dialog.showModal();
}

addTaskButton.addEventListener('click', ()=> openDialog());

form.addEventListener('submit', async (e) => {
  if (!e.submitter || e.submitter.id !== 'saveTaskButton'){ e.preventDefault(); return; }
  e.preventDefault();
  const title = titleInput.value.trim();
  const due = new Date(dueInput.value).getTime();
  const importance = Number(importanceInput.value);
  const recurrence = recurrenceInput.value;
  const notes = notesInput.value.trim();
  if (!title || !Number.isFinite(due)) return;
  const task = { id: uid(), title, due, importance, notes, recurrence, completed:false, createdAt: nowMs() };
  await saveTask(task); tasks.push(task); tasks.sort((a,b)=>a.due-b.due); render(); dialog.close();
});

importanceInput.addEventListener('input', ()=> { importanceValueEl.textContent = importanceInput.value; });

filterSelect?.addEventListener('change', ()=> { filterMode=filterSelect.value; render(); });
searchInput?.addEventListener('input', ()=> { searchQuery=searchInput.value.trim().toLowerCase(); render(); });

exportButton?.addEventListener('click', async () => {
  exportList.innerHTML='';
  const sorted=[...tasks].sort((a,b)=> a.completed-b.completed || a.due-b.due || b.importance-a.importance);
  for (const t of sorted){
    const li=document.createElement('li'); li.className='task-item';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=true; cb.dataset.taskId=t.id;
    const label=document.createElement('div'); label.className='title'; label.textContent = `${t.title} — ${new Date(t.due).toLocaleString()} (imp ${t.importance})`;
    li.appendChild(cb); li.appendChild(label); li.appendChild(document.createElement('div')); exportList.appendChild(li);
  }
  exportDialog.showModal();
});
exportSelectAll?.addEventListener('click', (e)=>{ e.preventDefault(); exportList.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked=true); });
exportSelectNone?.addEventListener('click', (e)=>{ e.preventDefault(); exportList.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked=false); });
exportCancel?.addEventListener('click', ()=> exportDialog.close());
exportConfirm?.addEventListener('click', (e)=>{
  e.preventDefault();
  const ids = Array.from(exportList.querySelectorAll('input[type="checkbox"]')).filter(cb=>cb.checked).map(cb=>cb.dataset.taskId);
  const selected = tasks.filter(t=> ids.includes(t.id));
  const payload = { type:'focus-tasks-backup', version:1, exportedAt: Date.now(), tasks:selected };
  const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
  const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`focus-tasks-${new Date().toISOString().slice(0,10)}.task`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  exportDialog.close();
});
importButton?.addEventListener('click', ()=> importFile?.click());
importFile?.addEventListener('change', async ()=>{
  const file = importFile.files?.[0]; if (!file) return;
  const text = await file.text();
  try{
    const imported = JSON.parse(text); let list = Array.isArray(imported) ? imported : imported?.tasks; if (!list && imported?.type==='focus-tasks-backup') list = imported.tasks;
    if (!Array.isArray(list)) throw new Error('Invalid file');
    const normalized = list.map(t=>({ id: typeof t.id==='string'&&t.id?t.id:uid(), title:String(t.title||'Untitled task'), due: Number.isFinite(+t.due)? +t.due : new Date(t.due).getTime() || (nowMs()+ONE_DAY_MS), importance: Math.min(10, Math.max(1, Number(t.importance??5))), notes:String(t.notes||''), completed:Boolean(t.completed), createdAt: Number.isFinite(+t.createdAt)? +t.createdAt : nowMs(), recurrence: t.recurrence||'none' }));
    await dbTxn(['tasks'],'readwrite',(s)=> { normalized.forEach(t=> s.put(t)); });
    await loadTasks(); render(); await refreshReminders();
  }catch(e){ alert('Import failed: '+ e.message); }
  finally{ importFile.value=''; }
});

function softDeleteTask(task){
  tasks = tasks.filter(x=> x.id !== task.id); render();
  showToast(`Deleted "${task.title}"`, async ()=>{ tasks.push(task); await saveTask(task); render(); });
  const tid = setTimeout(async ()=>{ await deleteTasks([task.id]); }, 5000);
  pendingDeletions.set(task.id, tid);
}

function showToast(message, onUndo){
  toastMessageEl.textContent = message; toastEl.hidden=false; toastEl.classList.add('show');
  let undone=false; const timerId=setTimeout(()=>{ if(!undone) hide(); }, 5200);
  toastUndoEl.onclick = ()=>{ undone=true; const entries=[...pendingDeletions.entries()]; const last=entries[entries.length-1]; if(last){ clearTimeout(last[1]); pendingDeletions.delete(last[0]); } hide(); onUndo?.(); };
  function hide(){ toastEl.classList.remove('show'); clearTimeout(timerId); toastUndoEl.onclick=null; setTimeout(()=>{ toastEl.hidden=true; },200); }
}

(async function init(){
  const min = new Date(nowMs()+30*60*1000); dueInput.min = toInputDateTime(min.getTime());
  await registerSW(); await ensureNotificationPermission(); await loadTasks(); render(); await refreshReminders();
})();

