// Focus Tasks app – with cancel fix, importance label sync, colored importance dot, and immediate delete with undo

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

// IndexedDB helpers
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
    let res;
    tx.oncomplete = async () => { try { resolve(res instanceof Promise ? await res : res); } catch(e){ reject(e); } };
    tx.onerror = () => reject(tx.error);
    try { res = op(...stores, tx); } catch(e){ reject(e); }
  });
}

// Utils
function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function nowMs(){ return Date.now(); }
function toInputDateTime(ms){ const d=new Date(ms); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

// State
let tasks = [];
let filterMode = 'all';
let searchQuery = '';

// Elements
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
const tagsInput = document.getElementById('taskTags');
// Insights elements
const todayCountEl = document.getElementById('todayCount');
const overdueCountEl = document.getElementById('overdueCount');
const streakDaysEl = document.getElementById('streakDays');
const timerDisplayEl = document.getElementById('timerDisplay');
const timerStartBtn = document.getElementById('timerStart');
const timerResetBtn = document.getElementById('timerReset');
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

// SW
async function registerSW(){ if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('sw.js'); } catch {} } }
async function ensureNotificationPermission(){ if (!('Notification' in window)) return false; if (Notification.permission==='granted') return true; if (Notification.permission==='denied') return false; return (await Notification.requestPermission())==='granted'; }
async function refreshReminders(){ try{ const reg=await navigator.serviceWorker.getRegistration(); if(!reg) return; const upcoming=tasks.filter(t=>!t.completed && t.due-nowMs()<=THREE_DAYS_MS && t.due>nowMs()); reg.active?.postMessage({ type:'SET_REMINDERS', tasks: upcoming.map(t=>({id:t.id,title:t.title,due:t.due})) }); }catch{} }

function render(){
  const filtered = tasks.filter(t=>{
    if (searchQuery && !(t.title.toLowerCase().includes(searchQuery) || (t.notes||'').toLowerCase().includes(searchQuery))) return false;
    if (filterMode==='active' && t.completed) return false;
    if (filterMode==='completed' && !t.completed) return false;
    if (filterMode==='dueSoon' && (t.completed || (t.due - nowMs() > THREE_DAYS_MS))) return false;
    return true;
  });
  const sorted=[...filtered].sort((a,b)=> a.completed-b.completed || a.due-b.due || b.importance-a.importance);
  taskListEl.innerHTML='';
  let completedCount=0; const dueSoon=[];
  for (const t of sorted){
    if (t.completed) completedCount++; if (!t.completed && t.due-nowMs()<=THREE_DAYS_MS) dueSoon.push(t);
    const li=document.createElement('li'); li.className='task-item animate-in';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!t.completed; cb.addEventListener('change', async ()=>{ t.completed=cb.checked; await saveTask(t); render(); });
    const content=document.createElement('div');
    const titleRow=document.createElement('div'); titleRow.className='title-row';
    const dot=document.createElement('span'); dot.className='dot';
    const hue = Math.round(120 - ((t.importance-1)/9)*120);
    dot.style.backgroundColor = `hsl(${hue} 85% 50%)`;
    const title=document.createElement('div'); title.className='title'; title.textContent=t.title;
    titleRow.appendChild(dot); titleRow.appendChild(title);
    const meta=document.createElement('div'); meta.className='meta'; meta.textContent=`Due ${new Date(t.due).toLocaleString()} • Importance ${t.importance}`;
    content.appendChild(titleRow); content.appendChild(meta);
    if (Array.isArray(t.tags) && t.tags.length){
      const chips=document.createElement('div'); chips.className='chips';
      t.tags.forEach(tag=>{ const c=document.createElement('span'); c.className='chip'; c.textContent=tag; chips.appendChild(c); });
      content.appendChild(chips);
    }
    if (t.notes){ const n=document.createElement('div'); n.className='hint'; n.textContent=t.notes; content.appendChild(n); }
    const right=document.createElement('div'); right.className='badges';
    const soon=t.due-nowMs()<=THREE_DAYS_MS && !t.completed; const badge=document.createElement('span'); badge.className='badge ' + (soon?'alert':'ok'); badge.textContent= soon ? 'Due ≤ 3 days' : 'Scheduled'; right.appendChild(badge);
    const del=document.createElement('button'); del.className='icon-btn icon-danger'; del.title='Delete task'; del.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
    del.addEventListener('click', ()=> softDeleteTask(t)); right.appendChild(del);
    li.appendChild(cb); li.appendChild(content); li.appendChild(right); taskListEl.appendChild(li);
  }
  const pct = tasks.length===0 ? 0 : Math.round((completedCount/tasks.length)*100);
  progressFillEl.style.transform = `scaleX(${pct/100})`; progressPctEl.textContent = pct + '%';
  upcomingListEl.innerHTML=''; if (dueSoon.length>0){ upcomingSectionEl.hidden=false; for (const t of dueSoon.slice(0,10)){ const li=document.createElement('li'); li.className='task-item'; const lab=document.createElement('div'); lab.className='title'; lab.textContent=`${t.title} — ${new Date(t.due).toLocaleString()}`; li.appendChild(document.createElement('span')); li.appendChild(lab); li.appendChild(document.createElement('div')); upcomingListEl.appendChild(li);} } else { upcomingSectionEl.hidden=true; }

  // Insights
  try{
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);
    const todayCount = tasks.filter(t=> !t.completed && t.due >= startOfDay.getTime() && t.due <= endOfDay.getTime()).length;
    const overdueCount = tasks.filter(t=> !t.completed && t.due < startOfDay.getTime()).length;
    if (todayCountEl) todayCountEl.textContent = String(todayCount);
    if (overdueCountEl) overdueCountEl.textContent = String(overdueCount);
    updateStreakUI();
  } catch{}
}

async function loadTasks(){ tasks = await dbTxn(['tasks'],'readonly',(s)=> new Promise((resolve,reject)=>{ const out=[]; const cur=s.openCursor(); cur.onsuccess=()=>{ const c=cur.result; if(c){ out.push(c.value); c.continue(); } else resolve(out); }; cur.onerror=()=>reject(cur.error);})); }
async function saveTask(task){ await dbTxn(['tasks'],'readwrite',(s)=> s.put(task)); await refreshReminders(); }
async function deleteTasks(ids){ await dbTxn(['tasks'],'readwrite',(s)=> ids.forEach(id=> s.delete(id))); await loadTasks(); await refreshReminders(); render(); }

function openDialog(defaults=null){ form.reset(); document.getElementById('dialogTitle').textContent = defaults?'Edit Task':'New Task'; const d=defaults ?? { title:'', due: nowMs()+ONE_DAY_MS, importance:5, notes:'', recurrence:'none', tags:[] }; titleInput.value=d.title; dueInput.value=toInputDateTime(d.due); importanceInput.value=d.importance; if (importanceValueEl) importanceValueEl.textContent=String(d.importance); recurrenceInput.value=d.recurrence; notesInput.value=d.notes||''; if (tagsInput) tagsInput.value=(d.tags||[]).join(', '); dialog.showModal(); }

addTaskButton.addEventListener('click', ()=> openDialog());
form.addEventListener('submit', async (e)=>{ if (!e.submitter || e.submitter.id!=='saveTaskButton'){ e.preventDefault(); return; } e.preventDefault(); const title=titleInput.value.trim(); const due=new Date(dueInput.value).getTime(); const importance=Number(importanceInput.value); const recurrence=recurrenceInput.value; const notes=notesInput.value.trim(); const tags=(tagsInput?.value||'').split(',').map(s=>s.trim()).filter(Boolean); if(!title||!Number.isFinite(due)) return; const task={ id:uid(), title, due, importance, notes, recurrence, tags, completed:false, createdAt: nowMs() }; await saveTask(task); tasks.push(task); tasks.sort((a,b)=>a.due-b.due); render(); dialog.close(); });
cancelTaskButton?.addEventListener('click', (e)=>{ e.preventDefault(); form.reset(); dialog.close('cancel'); });
dialog?.addEventListener('cancel', (e)=>{ e.preventDefault(); form.reset(); dialog.close('cancel'); });

// Keep importance label in sync as user moves the slider
const syncImportanceLabel = () => { if (importanceValueEl) importanceValueEl.textContent = String(importanceInput.value); };
importanceInput?.addEventListener('input', syncImportanceLabel);
importanceInput?.addEventListener('change', syncImportanceLabel);

importButton?.addEventListener('click', ()=> importFile?.click());
importFile?.addEventListener('change', async ()=>{ const file=importFile.files?.[0]; if(!file) return; const text=await file.text(); try{ const imported=JSON.parse(text); let list=Array.isArray(imported)?imported:imported?.tasks; if(!list && imported?.type==='focus-tasks-backup') list=imported.tasks; if(!Array.isArray(list)) throw new Error('Invalid file'); const normalized=list.map(t=>({ id: typeof t.id==='string'&&t.id?t.id:uid(), title:String(t.title||'Untitled task'), due: Number.isFinite(+t.due)? +t.due : new Date(t.due).getTime() || (nowMs()+ONE_DAY_MS), importance: Math.min(10, Math.max(1, Number(t.importance??5))), notes:String(t.notes||''), tags: Array.isArray(t.tags)? t.tags.map(String) : [], completed:Boolean(t.completed), createdAt: Number.isFinite(+t.createdAt)? +t.createdAt : nowMs(), recurrence: t.recurrence||'none' })); await dbTxn(['tasks'],'readwrite',(s)=>{ normalized.forEach(t=> s.put(t)); }); await loadTasks(); render(); await refreshReminders(); } catch(e){ alert('Import failed: '+ e.message); } finally { importFile.value=''; } });

// Streak settings
async function getSetting(key){ return dbTxn(['tasks'],'readonly',()=>{}).then(()=> dbTxn(['settings'],'readonly',(s)=> new Promise((resolve)=>{ const r=s.get(key); r.onsuccess=()=> resolve(r.result?.value); r.onerror=()=> resolve(undefined); }))).catch(()=>undefined); }
async function setSetting(key, value){ try{ await dbTxn(['settings'],'readwrite',(s)=> s.put({ key, value })); } catch{} }
async function updateStreakUI(){ try{ const days = await getSetting('streakDays'); if (streakDaysEl) streakDaysEl.textContent = String(days||0); } catch{} }

// Focus timer (simple Pomodoro: 25 min)
let timerMs = 25*60*1000; let timerId=null; let running=false;
function renderTimer(){ if (timerDisplayEl){ const m=Math.floor(timerMs/60000); const s=Math.floor((timerMs%60000)/1000); timerDisplayEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; } }
timerStartBtn?.addEventListener('click', ()=>{ if (running) return; running=true; timerId=setInterval(()=>{ timerMs-=1000; if (timerMs<=0){ timerMs=0; clearInterval(timerId); running=false; } renderTimer(); }, 1000); });
timerResetBtn?.addEventListener('click', ()=>{ if (timerId) clearInterval(timerId); running=false; timerMs=25*60*1000; renderTimer(); });

exportButton?.addEventListener('click', async ()=>{ exportList.innerHTML=''; const sorted=[...tasks].sort((a,b)=> a.completed-b.completed || a.due-b.due || b.importance-a.importance); for(const t of sorted){ const li=document.createElement('li'); li.className='task-item'; const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=true; cb.dataset.taskId=t.id; const lab=document.createElement('div'); lab.className='title'; lab.textContent=`${t.title} — ${new Date(t.due).toLocaleString()} (imp ${t.importance})`; li.appendChild(cb); li.appendChild(lab); li.appendChild(document.createElement('div')); exportList.appendChild(li);} exportDialog.showModal(); });
exportSelectAll?.addEventListener('click', (e)=>{ e.preventDefault(); exportList.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked=true); });
exportSelectNone?.addEventListener('click', (e)=>{ e.preventDefault(); exportList.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked=false); });
exportCancel?.addEventListener('click', ()=> exportDialog.close());
exportConfirm?.addEventListener('click', (e)=>{ e.preventDefault(); const ids=Array.from(exportList.querySelectorAll('input[type="checkbox"]')).filter(cb=>cb.checked).map(cb=>cb.dataset.taskId); const selected=tasks.filter(t=> ids.includes(t.id)); const payload={ type:'focus-tasks-backup', version:1, exportedAt: Date.now(), tasks:selected }; const blob=new Blob([JSON.stringify(payload,null,2)],{ type:'application/json' }); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`focus-tasks-${new Date().toISOString().slice(0,10)}.task`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); exportDialog.close(); });

async function softDeleteTask(task){ const snapshot={...task}; await dbTxn(['tasks'],'readwrite',(s)=> s.delete(task.id)); tasks = tasks.filter(x=> x.id!==task.id); render(); showToast(`Deleted "${task.title}"`, async ()=>{ await saveTask(snapshot); await loadTasks(); render(); }); }

function showToast(message, onUndo){ toastMessageEl.textContent=message; toastEl.hidden=false; toastEl.classList.add('show'); let finished=false; const tid=setTimeout(()=>{ if(!finished) hide(); }, 5200); toastUndoEl.onclick=()=>{ finished=true; hide(); onUndo?.(); }; function hide(){ toastEl.classList.remove('show'); clearTimeout(tid); toastUndoEl.onclick=null; setTimeout(()=>{ toastEl.hidden=true; },200); } }

(async function init(){ const min=new Date(nowMs()+30*60*1000); if (dueInput) dueInput.min=toInputDateTime(min.getTime()); await registerSW(); await ensureNotificationPermission(); await loadTasks(); render(); await refreshReminders(); })();

