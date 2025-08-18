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
let sortMode = 'due';

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
const timerMinutesInput = document.getElementById('timerMinutes');
const timerStartBtn = document.getElementById('timerStart');
const timerResetBtn = document.getElementById('timerReset');
const cancelTaskButton = document.getElementById('cancelTaskButton');
const filterSelect = document.getElementById('filterSelect');
const sortSelect = document.getElementById('sortSelect');
const searchInput = document.getElementById('searchInput');
const quickAddButton = document.getElementById('quickAddButton');
console.log('Quick add button found:', !!quickAddButton);
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
// Settings elements
const settingsButton = document.getElementById('settingsButton');
const shortcutsButton = document.getElementById('shortcutsButton');
const shortcutsDialog = document.getElementById('shortcutsDialog');
const shortcutsClose = document.getElementById('shortcutsClose');
const settingsDialog = document.getElementById('settingsDialog');
const settingsForm = document.getElementById('settingsForm');
const themeSelect = document.getElementById('themeSelect');
const accentSelect = document.getElementById('accentSelect');
const settingsCancel = document.getElementById('settingsCancel');
// Widget cards and toggles
const cardToday = document.getElementById('cardToday');
const cardStreak = document.getElementById('cardStreak');
const cardTimer = document.getElementById('cardTimer');
const cardWeather = document.getElementById('cardWeather');
const cardQuote = document.getElementById('cardQuote');
const cardStats = document.getElementById('cardStats');
const toggleToday = document.getElementById('toggleToday');
const toggleStreak = document.getElementById('toggleStreak');
const toggleTimer = document.getElementById('toggleTimer');
const toggleWeather = document.getElementById('toggleWeather');
const toggleQuote = document.getElementById('toggleQuote');
const toggleStats = document.getElementById('toggleStats');

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
  
  let sorted = [...filtered];
  if (sortMode === 'due') {
    sorted.sort((a,b)=> a.completed-b.completed || a.due-b.due || b.importance-a.importance);
  } else if (sortMode === 'importance') {
    sorted.sort((a,b)=> a.completed-b.completed || b.importance-a.importance || a.due-b.due);
  } else if (sortMode === 'created') {
    sorted.sort((a,b)=> a.completed-b.completed || b.createdAt-a.createdAt || b.importance-a.importance);
  }
  taskListEl.innerHTML='';
  let completedCount=0; const dueSoon=[];
  for (const t of sorted){
    if (t.completed) completedCount++; if (!t.completed && t.due-nowMs()<=THREE_DAYS_MS) dueSoon.push(t);
    const li=document.createElement('li'); li.className='task-item animate-in';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!t.completed; cb.addEventListener('change', async ()=>{ 
      t.completed=cb.checked; 
      await saveTask(t); 
      if (t.completed) {
        li.classList.add('completed');
        setTimeout(() => li.classList.remove('completed'), 600);
      }
      render(); 
    });
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

// Quick add functionality
function quickAddTask() {
  const title = prompt('Quick add task:');
  if (title && title.trim()) {
    const task = {
      id: uid(),
      title: title.trim(),
      due: nowMs() + ONE_DAY_MS,
      importance: 5,
      notes: '',
      recurrence: 'none',
      tags: [],
      completed: false,
      createdAt: nowMs()
    };
    saveTask(task).then(() => {
      tasks.push(task);
      tasks.sort((a,b) => a.due-b.due);
      render();
      showToast(`Added "${task.title}"`);
    });
  }
}

if (quickAddButton) {
  quickAddButton.addEventListener('click', quickAddTask);
} else {
  console.error('Quick add button not found!');
}

// Keyboard shortcuts dialog
shortcutsButton?.addEventListener('click', () => shortcutsDialog?.showModal());
shortcutsClose?.addEventListener('click', () => shortcutsDialog?.close());

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'n') {
      e.preventDefault();
      quickAddTask();
    } else if (e.key === 's') {
      e.preventDefault();
      settingsButton?.click();
    } else if (e.key === 'f') {
      e.preventDefault();
      searchInput?.focus();
    }
  } else if (e.key === '?') {
    e.preventDefault();
    shortcutsButton?.click();
  }
});

// Filter and sort event listeners
filterSelect?.addEventListener('change', (e) => { filterMode = e.target.value; render(); });
sortSelect?.addEventListener('change', (e) => { sortMode = e.target.value; render(); });
searchInput?.addEventListener('input', (e) => { searchQuery = e.target.value.toLowerCase(); render(); });
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
let timerMs = 25*60*1000; let timerId=null; let running=false; let paused=false;
function renderTimer(){ if (timerDisplayEl){ const m=Math.floor(timerMs/60000); const s=Math.floor((timerMs%60000)/1000); timerDisplayEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; } }
function updateTimerButtons(){
  const timerPauseBtn = document.getElementById('timerPause');
  if (timerStartBtn) timerStartBtn.style.display = running ? 'none' : 'inline-block';
  if (timerPauseBtn) timerPauseBtn.style.display = running ? 'inline-block' : 'none';
}
timerStartBtn?.addEventListener('click', ()=>{ 
  if (running) return; 
  const mins = Math.min(120, Math.max(1, Number(timerMinutesInput?.value||25))); 
  if (!paused) timerMs = mins*60*1000; 
  renderTimer(); 
  running=true; 
  paused=false;
  updateTimerButtons();
  timerId=setInterval(()=>{ 
    timerMs-=1000; 
    if (timerMs<=0){ 
      timerMs=0; 
      clearInterval(timerId); 
      running=false; 
      paused=false;
      updateTimerButtons();
    } 
    renderTimer(); 
  }, 1000); 
});
document.getElementById('timerPause')?.addEventListener('click', ()=>{ 
  if (timerId) clearInterval(timerId); 
  running=false; 
  paused=true;
  updateTimerButtons();
});
timerResetBtn?.addEventListener('click', ()=>{ 
  if (timerId) clearInterval(timerId); 
  running=false; 
  paused=false;
  updateTimerButtons();
  const mins = Math.min(120, Math.max(1, Number(timerMinutesInput?.value||25))); 
  timerMs=mins*60*1000; 
  renderTimer(); 
});

exportButton?.addEventListener('click', async ()=>{ exportList.innerHTML=''; const sorted=[...tasks].sort((a,b)=> a.completed-b.completed || a.due-b.due || b.importance-a.importance); for(const t of sorted){ const li=document.createElement('li'); li.className='task-item'; const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=true; cb.dataset.taskId=t.id; const lab=document.createElement('div'); lab.className='title'; lab.textContent=`${t.title} — ${new Date(t.due).toLocaleString()} (imp ${t.importance})`; li.appendChild(cb); li.appendChild(lab); li.appendChild(document.createElement('div')); exportList.appendChild(li);} exportDialog.showModal(); });
exportSelectAll?.addEventListener('click', (e)=>{ e.preventDefault(); exportList.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked=true); });
exportSelectNone?.addEventListener('click', (e)=>{ e.preventDefault(); exportList.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked=false); });
exportCancel?.addEventListener('click', ()=> exportDialog.close());
exportConfirm?.addEventListener('click', (e)=>{ e.preventDefault(); const ids=Array.from(exportList.querySelectorAll('input[type="checkbox"]')).filter(cb=>cb.checked).map(cb=>cb.dataset.taskId); const selected=tasks.filter(t=> ids.includes(t.id)); const payload={ type:'focus-tasks-backup', version:1, exportedAt: Date.now(), tasks:selected }; const blob=new Blob([JSON.stringify(payload,null,2)],{ type:'application/json' }); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`focus-tasks-${new Date().toISOString().slice(0,10)}.task`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); exportDialog.close(); });

async function softDeleteTask(task){ const snapshot={...task}; await dbTxn(['tasks'],'readwrite',(s)=> s.delete(task.id)); tasks = tasks.filter(x=> x.id!==task.id); render(); showToast(`Deleted "${task.title}"`, async ()=>{ await saveTask(snapshot); await loadTasks(); render(); }); }

function showToast(message, onUndo){ toastMessageEl.textContent=message; toastEl.hidden=false; toastEl.classList.add('show'); let finished=false; const tid=setTimeout(()=>{ if(!finished) hide(); }, 5200); toastUndoEl.onclick=()=>{ finished=true; hide(); onUndo?.(); }; function hide(){ toastEl.classList.remove('show'); clearTimeout(tid); toastUndoEl.onclick=null; setTimeout(()=>{ toastEl.hidden=true; },200); } }

(async function init(){ const min=new Date(nowMs()+30*60*1000); if (dueInput) dueInput.min=toInputDateTime(min.getTime()); await registerSW(); await ensureNotificationPermission(); await loadTasks(); render(); await refreshReminders(); })();

// Settings
function applyTheme(theme){
  document.body.classList.remove('light');
  // Light mode removed; coerce to dark only
}
function applyAccent(hex){
  document.documentElement.style.setProperty('--primary', hex);
}
function loadSettings(){
  try{
    let theme = localStorage.getItem('theme') || 'dark';
    if (theme === 'light') theme = 'dark';
    const accent = localStorage.getItem('accent') || '#3b82f6';
    if (themeSelect) themeSelect.value = theme;
    if (accentSelect) accentSelect.value = accent;
    applyTheme(theme);
    applyAccent(accent);
    // Widgets
    const showToday = localStorage.getItem('showToday');
    const showStreak = localStorage.getItem('showStreak');
    const showTimer = localStorage.getItem('showTimer');
    const showWeather = localStorage.getItem('showWeather');
    const showQuote = localStorage.getItem('showQuote');
    const showStats = localStorage.getItem('showStats');
    const todayOn = showToday === null ? true : showToday !== 'false';
    const streakOn = showStreak === null ? true : showStreak !== 'false';
    const timerOn = showTimer === null ? true : showTimer !== 'false';
    const weatherOn = showWeather === null ? false : showWeather !== 'false';
    const quoteOn = showQuote === null ? false : showQuote !== 'false';
    const statsOn = showStats === null ? false : showStats !== 'false';
    if (toggleToday) toggleToday.checked = todayOn;
    if (toggleStreak) toggleStreak.checked = streakOn;
    if (toggleTimer) toggleTimer.checked = timerOn;
    if (toggleWeather) toggleWeather.checked = weatherOn;
    if (toggleQuote) toggleQuote.checked = quoteOn;
    if (toggleStats) toggleStats.checked = statsOn;
    applyWidgetVisibility(todayOn, streakOn, timerOn, weatherOn, quoteOn, statsOn);
    initializeWidgets();
  }catch{}
}
function applyWidgetVisibility(todayOn, streakOn, timerOn, weatherOn, quoteOn, statsOn){
  if (cardToday) cardToday.style.display = todayOn ? 'block' : 'none';
  if (cardStreak) cardStreak.style.display = streakOn ? 'block' : 'none';
  if (cardTimer) cardTimer.style.display = timerOn ? 'block' : 'none';
  if (cardWeather) cardWeather.style.display = weatherOn ? 'block' : 'none';
  if (cardQuote) cardQuote.style.display = quoteOn ? 'block' : 'none';
  if (cardStats) cardStats.style.display = statsOn ? 'block' : 'none';
}
settingsButton?.addEventListener('click', ()=> settingsDialog?.showModal());
settingsCancel?.addEventListener('click', ()=> settingsDialog?.close('cancel'));
settingsForm?.addEventListener('submit', (e)=>{
  e.preventDefault();
  let theme = themeSelect?.value || 'dark';
  if (theme === 'light') theme = 'dark';
  const accent = accentSelect?.value || '#3b82f6';
  localStorage.setItem('theme', theme);
  localStorage.setItem('accent', accent);
  applyTheme(theme);
  applyAccent(accent);
  // Persist widget visibility
  const todayOn = toggleToday ? !!toggleToday.checked : true;
  const streakOn = toggleStreak ? !!toggleStreak.checked : true;
  const timerOn = toggleTimer ? !!toggleTimer.checked : true;
  const weatherOn = toggleWeather ? !!toggleWeather.checked : false;
  const quoteOn = toggleQuote ? !!toggleQuote.checked : false;
  const statsOn = toggleStats ? !!toggleStats.checked : false;
  localStorage.setItem('showToday', String(todayOn));
  localStorage.setItem('showStreak', String(streakOn));
  localStorage.setItem('showTimer', String(timerOn));
  localStorage.setItem('showWeather', String(weatherOn));
  localStorage.setItem('showQuote', String(quoteOn));
  localStorage.setItem('showStats', String(statsOn));
  applyWidgetVisibility(todayOn, streakOn, timerOn, weatherOn, quoteOn, statsOn);
  initializeWidgets();
  settingsDialog?.close('ok');
});
loadSettings();

// Widget functionality
const weatherRefresh = document.getElementById('weatherRefresh');
const quoteRefresh = document.getElementById('quoteRefresh');

// Weather widget
async function loadWeather() {
  const weatherTemp = document.getElementById('weatherTemp');
  const weatherDesc = document.getElementById('weatherDesc');
  const weatherIcon = document.getElementById('weatherIcon');
  const weatherLocation = document.getElementById('weatherLocation');
  
  try {
    // Get location from localStorage or use default
    const location = localStorage.getItem('weatherLocation') || 'London';
    weatherLocation.textContent = location;
    
    // Simulate weather data (in real app, you'd use a weather API)
    const weatherData = {
      temp: Math.floor(Math.random() * 25) + 5,
      desc: ['Sunny', 'Cloudy', 'Rainy', 'Partly Cloudy'][Math.floor(Math.random() * 4)],
      icon: ['☀️', '☁️', '🌧️', '⛅'][Math.floor(Math.random() * 4)]
    };
    
    weatherTemp.textContent = `${weatherData.temp}°C`;
    weatherDesc.textContent = weatherData.desc;
    weatherIcon.textContent = weatherData.icon;
  } catch (error) {
    weatherTemp.textContent = '--°C';
    weatherDesc.textContent = 'Unable to load';
    weatherIcon.textContent = '❓';
  }
}

// Quote widget
const quotes = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "The only limit to our realization of tomorrow is our doubts of today.", author: "Franklin D. Roosevelt" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" }
];

function loadQuote() {
  const quoteContent = document.getElementById('quoteContent');
  const quoteAuthor = document.getElementById('quoteAuthor');
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  quoteContent.textContent = `"${randomQuote.text}"`;
  quoteAuthor.textContent = `— ${randomQuote.author}`;
}

// Stats widget
function updateStats() {
  const avgCompletion = document.getElementById('avgCompletion');
  const bestDay = document.getElementById('bestDay');
  const totalTasks = document.getElementById('totalTasks');
  const completionRate = document.getElementById('completionRate');
  
  const completedTasks = tasks.filter(t => t.completed).length;
  const totalTaskCount = tasks.length;
  const completionRateValue = totalTaskCount > 0 ? Math.round((completedTasks / totalTaskCount) * 100) : 0;
  
  // Calculate average tasks per day (last 7 days)
  const lastWeek = tasks.filter(t => t.createdAt > nowMs() - (7 * ONE_DAY_MS));
  const avgPerDay = lastWeek.length > 0 ? Math.round(lastWeek.length / 7) : 0;
  
  // Find best day (most tasks completed in a day)
  const completedByDay = {};
  tasks.filter(t => t.completed).forEach(task => {
    const day = new Date(task.due).toDateString();
    completedByDay[day] = (completedByDay[day] || 0) + 1;
  });
  const bestDayValue = Object.keys(completedByDay).length > 0 
    ? Math.max(...Object.values(completedByDay))
    : 0;
  
  avgCompletion.textContent = avgPerDay;
  bestDay.textContent = bestDayValue;
  totalTasks.textContent = totalTaskCount;
  completionRate.textContent = `${completionRateValue}%`;
}

// Event listeners for widgets
weatherRefresh?.addEventListener('click', loadWeather);
quoteRefresh?.addEventListener('click', loadQuote);

// Initialize widgets when they become visible
function initializeWidgets() {
  if (cardWeather?.style.display !== 'none') loadWeather();
  if (cardQuote?.style.display !== 'none') loadQuote();
  if (cardStats?.style.display !== 'none') updateStats();
}

// Update stats when tasks change
const originalRender = render;
render = function() {
  originalRender();
  updateStats();
};

