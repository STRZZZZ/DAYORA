(() => {
  "use strict";

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const state = {
    page: "dashboard",
    authMode: "login",
    user: null,
    supabase: null,
    localMode: true,
    data: { tasks: [], notes: [], goals: [], events: [], focus_sessions: [] },
    timer: { seconds: 25*60, remaining: 25*60, running: false, interval: null, preset: 25 }
  };
  const labels = {dashboard:"Dashboard",tasks:"My Tasks",calendar:"Calendar",notes:"My Notes",goals:"Goals",focus:"Focus Room",analytics:"Analytics",settings:"Settings"};
  const todayISO = () => new Date().toISOString().slice(0,10);
  const dateText = value => value ? new Date(value+"T00:00:00").toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "Tanpa tanggal";
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()));
  let toastTimer;

  function toast(message) {
    const el=$("#toast"); el.textContent=message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600);
  }
  function configured() {
    const c=window.DAYORA_CONFIG || {};
    return Boolean(c.SUPABASE_URL && c.SUPABASE_ANON_KEY && window.supabase);
  }
  function localKey(){ return "dayora_data_"+(state.user?.id || "guest"); }
  function loadLocal() {
    try {
      const saved=JSON.parse(localStorage.getItem(localKey()) || "{}");
      state.data={tasks:[],notes:[],goals:[],events:[],focus_sessions:[],...saved};
    } catch { state.data={tasks:[],notes:[],goals:[],events:[],focus_sessions:[]}; }
  }
  function saveLocal(){ localStorage.setItem(localKey(),JSON.stringify(state.data)); }
  async function initBackend() {
    if(!configured()) return;
    const c=window.DAYORA_CONFIG;
    state.supabase=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY);
    state.localMode=false;
    const {data:{session}}=await state.supabase.auth.getSession();
    if(session?.user) await setUser(session.user);
    state.supabase.auth.onAuthStateChange((_event,session)=>{
      if(session?.user){ setUser(session.user); }
      else if(state.user){ state.user=null; showLanding(); }
    });
  }
  async function setUser(user) {
    state.user=user;
    if(state.localMode) loadLocal();
    else await loadRemoteData();
    showApp();
  }
  async function loadRemoteData() {
    const tables=["tasks","notes","goals","events","focus_sessions"];
    for(const table of tables) {
      const {data,error}=await state.supabase.from(table).select("*").order("created_at",{ascending:false});
      if(error){ console.error(error); toast("Gagal memuat "+table+". Periksa tabel dan RLS."); }
      else state.data[table]=data || [];
    }
  }
  async function persist(table, record, id) {
    if(state.localMode) {
      const arr=state.data[table];
      if(id){ const index=arr.findIndex(x=>x.id===id); if(index>=0) arr[index]={...arr[index],...record}; }
      else arr.unshift({id:uid(),created_at:new Date().toISOString(),...record});
      saveLocal(); return true;
    }
    const query=id ? state.supabase.from(table).update(record).eq("id",id) : state.supabase.from(table).insert({...record,user_id:state.user.id});
    const {error}=await query;
    if(error){toast(error.message);return false;}
    await loadRemoteData(); return true;
  }
  async function removeRecord(table,id) {
    if(state.localMode){state.data[table]=state.data[table].filter(x=>x.id!==id);saveLocal();return true;}
    const {error}=await state.supabase.from(table).delete().eq("id",id);
    if(error){toast(error.message);return false;}
    await loadRemoteData();return true;
  }
  function showLanding(){ $("#landingView").classList.remove("hidden");$("#authView").classList.add("hidden");$("#appView").classList.add("hidden"); }
  function showAuth(mode){
    state.authMode=mode;$("#landingView").classList.add("hidden");$("#appView").classList.add("hidden");$("#authView").classList.remove("hidden");
    const register=mode==="register";
    $("#authTitle").textContent=register?"Buat akun DAYORA":"Selamat datang kembali";
    $("#authSubtitle").textContent=register?"Mulai atur aktivitasmu secara lebih terstruktur.":"Masuk untuk membuka workspace-mu.";
    $("#nameField").classList.toggle("hidden",!register);
    $("#authName").required=register;
    $("#authPassword").autocomplete=register?"new-password":"current-password";
    $("#authSubmit").textContent=register?"Buat akun gratis":"Masuk";
    $("#authSwitch").innerHTML=register?'Sudah punya akun? <button type="button" data-open-auth="login">Masuk</button>':'Belum punya akun? <button type="button" data-open-auth="register">Daftar gratis</button>';
    $("#authModeNote").textContent=state.localMode?"Mode demo lokal: data tersimpan di browser ini.":"Akun online: data tersimpan di Supabase.";
  }
  async function handleAuth(e){
    e.preventDefault();
    const email=$("#authEmail").value.trim(),password=$("#authPassword").value;
    const name=$("#authName").value.trim();
    if(state.localMode){
      const users=JSON.parse(localStorage.getItem("dayora_local_users")||"{}");
      if(state.authMode==="register"){
        if(users[email]) return toast("Email ini sudah terdaftar di browser ini.");
        users[email]={password,name};localStorage.setItem("dayora_local_users",JSON.stringify(users));
        state.user={id:"local_"+email,email,user_metadata:{full_name:name}};
      } else {
        if(!users[email] || users[email].password!==password) return toast("Email atau password demo tidak cocok.");
        state.user={id:"local_"+email,email,user_metadata:{full_name:users[email].name}};
      }
      loadLocal();showApp();toast("Berhasil masuk ke DAYORA.");return;
    }
    $("#authSubmit").disabled=true;
    try {
      if(state.authMode==="register"){
        const {data,error}=await state.supabase.auth.signUp({email,password,options:{data:{full_name:name}}});
        if(error) throw error;
        if(data.session){await setUser(data.user);toast("Akun berhasil dibuat.");}
        else toast("Akun dibuat. Periksa email untuk konfirmasi, lalu masuk.");
      } else {
        const {data,error}=await state.supabase.auth.signInWithPassword({email,password});
        if(error) throw error;
        await setUser(data.user);toast("Berhasil masuk.");
      }
    } catch(err){toast(err.message || "Autentikasi gagal.");}
    finally{$("#authSubmit").disabled=false;}
  }
  async function logout(){
    if(!state.localMode) await state.supabase.auth.signOut();
    state.user=null;state.data={tasks:[],notes:[],goals:[],events:[],focus_sessions:[]};showLanding();toast("Kamu sudah keluar.");
  }
  function showApp(){
    $("#landingView").classList.add("hidden");$("#authView").classList.add("hidden");$("#appView").classList.remove("hidden");
    const name=state.user?.user_metadata?.full_name || state.user?.email?.split("@")[0] || "Pengguna";
    $("#sideName").textContent=name;$("#sideEmail").textContent=state.user?.email || "Mode demo";
    $("#sideAvatar").textContent=name[0].toUpperCase();$("#topAvatar").textContent=name[0].toUpperCase();
    $("#todayLabel").textContent=new Date().toLocaleDateString("id-ID",{weekday:"short",day:"numeric",month:"short"});
    renderPage(state.page);
  }
  function setPage(page){
    if(!labels[page]) return;
    state.page=page;$("#sidebar").classList.remove("open");
    $$(".nav-item,[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    renderPage(page);
  }
  function heading(title,desc,button=""){
    return `<div class="page-heading"><div><h1>${title}</h1><p>${desc}</p></div>${button?`<div class="heading-actions">${button}</div>`:""}</div>`;
  }
  function addButton(type,label="Tambah baru"){return `<button class="btn btn-primary" data-add="${type}">＋ ${label}</button>`;}
  function empty(text){return `<div class="empty-state"><span>◌</span>${text}</div>`;}
  function taskRows(tasks){
    if(!tasks.length)return empty("Belum ada tugas. Tambahkan tugas pertamamu.");
    return `<div class="task-list">${tasks.map(t=>`<div class="task-row ${t.status==="completed"?"done":""}">
      <button class="check-btn ${t.status==="completed"?"checked":""}" data-toggle-task="${t.id}" aria-label="Ubah status">${t.status==="completed"?"✓":""}</button>
      <div class="task-main"><b>${escapeHTML(t.title)}</b><small>${t.due_date?dateText(t.due_date):"Tanpa tenggat"} · <span class="pill ${t.priority||"medium"}">${t.priority||"medium"}</span></small></div>
      <button class="small-action" data-edit="tasks" data-id="${t.id}">Edit</button>
    </div>`).join("")}</div>`;
  }
  function renderDashboard(){
    const tasks=state.data.tasks,done=tasks.filter(t=>t.status==="completed").length,pct=tasks.length?Math.round(done/tasks.length*100):0;
    const upcoming=[...tasks].filter(t=>t.status!=="completed").sort((a,b)=>(a.due_date||"9999").localeCompare(b.due_date||"9999")).slice(0,5);
    const notes=state.data.notes.slice(0,3);
    return `${heading("Dashboard","Ringkasan aktivitas dan fokusmu hari ini.",addButton("tasks","Tambah tugas"))}
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-icon">✓</span><span class="stat-label">Total tugas</span><strong>${tasks.length}</strong></div>
        <div class="stat-card"><span class="stat-icon">◉</span><span class="stat-label">Selesai</span><strong>${done}</strong></div>
        <div class="stat-card"><span class="stat-icon">◎</span><span class="stat-label">Target</span><strong>${state.data.goals.length}</strong></div>
        <div class="stat-card"><span class="stat-icon">✎</span><span class="stat-label">Catatan</span><strong>${state.data.notes.length}</strong></div>
      </div>
      <div class="dashboard-grid">
        <section class="card"><div class="card-title">Tugas mendatang</div>${taskRows(upcoming)}</section>
        <section class="card"><div class="card-title">Progres penyelesaian</div><h2 style="font-size:32px;margin:5px 0">${pct}%</h2><p class="muted tiny">${done} dari ${tasks.length} tugas selesai</p><div class="progress-track" style="margin:14px 0 22px"><i style="width:${pct}%"></i></div><div class="card-title">Catatan terbaru</div>${notes.length?notes.map(n=>`<p class="tiny muted" style="padding:7px 0;border-bottom:1px solid var(--border)">✎ ${escapeHTML(n.title)}</p>`).join(""):empty("Belum ada catatan.")}</section>
      </div>`;
  }
  function renderTasks(){
    const tasks=state.data.tasks;
    return `${heading("My Tasks","Atur prioritas dan pantau semua pekerjaanmu.",addButton("tasks","Tambah tugas"))}
      <div class="toolbar"><input id="taskSearch" type="search" placeholder="Cari tugas..."><select id="taskFilter"><option value="all">Semua status</option><option value="pending">Belum dimulai</option><option value="in_progress">Dikerjakan</option><option value="completed">Selesai</option></select></div>
      <div id="taskResults">${taskRows(tasks)}</div>`;
  }
  function renderNotes(){
    return `${heading("My Notes","Simpan ide dan informasi pentingmu.",addButton("notes","Buat catatan"))}
      <div class="toolbar"><input id="noteSearch" type="search" placeholder="Cari catatan..."></div>
      <div class="item-grid" id="noteResults">${state.data.notes.length?state.data.notes.map(n=>noteCard(n)).join(""):empty("Belum ada catatan. Buat catatan pertamamu.")}</div>`;
  }
  function noteCard(n){return `<article class="data-card note-card"><div class="data-card-top"><h3>${escapeHTML(n.title)}</h3><div class="data-card-actions"><button class="small-action" data-edit="notes" data-id="${n.id}">Edit</button><button class="small-action" data-delete="notes" data-id="${n.id}">Hapus</button></div></div><p>${escapeHTML(n.content||"Catatan kosong")}</p></article>`;}
  function renderGoals(){
    return `${heading("Goals","Ubah tujuan menjadi langkah yang terukur.",addButton("goals","Tambah target"))}
      <div class="item-grid">${state.data.goals.length?state.data.goals.map(g=>`<article class="data-card"><div class="data-card-top"><h3>${escapeHTML(g.title)}</h3><div class="data-card-actions"><button class="small-action" data-edit="goals" data-id="${g.id}">Edit</button><button class="small-action" data-delete="goals" data-id="${g.id}">Hapus</button></div></div><p>Target: ${dateText(g.target_date)}</p><div class="goal-progress"><div class="progress-head"><span class="muted tiny">Progres</span><b class="tiny">${g.progress||0}%</b></div><div class="progress-track"><i style="width:${g.progress||0}%"></i></div></div></article>`).join(""):empty("Belum ada target. Tambahkan tujuan pertamamu.")}</div>`;
  }
  function renderCalendar(){
    const events=[...state.data.events].sort((a,b)=>(a.start_time||"").localeCompare(b.start_time||""));
    return `${heading("Calendar","Lihat dan atur agenda yang akan datang.",addButton("events","Tambah agenda"))}
      <div class="card"><div class="card-title">Agenda tersimpan</div>${events.length?`<div class="calendar-list">${events.map(e=>`<div class="calendar-event"><div class="data-card-top"><b>${escapeHTML(e.title)}</b><button class="small-action" data-delete="events" data-id="${e.id}">Hapus</button></div><small>${new Date(e.start_time).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}</small>${e.description?`<p class="tiny muted">${escapeHTML(e.description)}</p>`:""}</div>`).join("")}</div>`:empty("Belum ada agenda. Tambahkan jadwal pertamamu.")}</div>`;
  }
  function renderFocus(){
    const t=state.timer,mins=String(Math.floor(t.remaining/60)).padStart(2,"0"),secs=String(t.remaining%60).padStart(2,"0");
    return `${heading("Focus Room","Ambil waktu untuk fokus pada satu hal penting.","")}
      <div class="card focus-wrap"><span class="eyebrow">FOCUS SESSION</span><div class="timer-circle"><div><div class="timer-time" id="timerDisplay">${mins}:${secs}</div><div class="timer-caption" id="timerCaption">${t.running?"SEDANG BERJALAN":"SIAP UNTUK FOKUS"}</div></div></div>
      <div class="focus-presets">${[15,25,45,60].map(n=>`<button class="${t.preset===n?"selected":""}" data-preset="${n}">${n} menit</button>`).join("")}</div>
      <div class="focus-controls"><button class="btn btn-primary" id="timerStart">${t.running?"Jeda":"Mulai fokus"}</button><button class="btn btn-outline" id="timerReset">Reset</button></div>
      <p class="muted tiny" style="margin-top:20px">Sesi yang selesai akan masuk ke riwayat fokus.</p></div>
      <div class="card"><div class="card-title">Sesi terbaru</div>${state.data.focus_sessions.length?state.data.focus_sessions.slice(0,5).map(s=>`<p class="tiny muted" style="padding:7px 0">${Math.round(s.duration/60)} menit · ${new Date(s.completed_at).toLocaleString("id-ID")}</p>`).join(""):empty("Belum ada sesi fokus.")}</div>`;
  }
  function renderAnalytics(){
    const tasks=state.data.tasks,done=tasks.filter(t=>t.status==="completed").length;
    const last7=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const key=d.toISOString().slice(0,10);return {label:d.toLocaleDateString("id-ID",{weekday:"short"}),count:tasks.filter(t=>t.status==="completed"&&(t.updated_at||t.created_at||"").slice(0,10)===key).length};});
    const max=Math.max(1,...last7.map(x=>x.count));
    return `${heading("Analytics","Ringkasan sederhana dari aktivitasmu.","")}
      <div class="stat-grid"><div class="stat-card"><span class="stat-label">Total tugas</span><strong>${tasks.length}</strong></div><div class="stat-card"><span class="stat-label">Tugas selesai</span><strong>${done}</strong></div><div class="stat-card"><span class="stat-label">Target</span><strong>${state.data.goals.length}</strong></div><div class="stat-card"><span class="stat-label">Sesi fokus</span><strong>${state.data.focus_sessions.length}</strong></div></div>
      <div class="card"><div class="card-title">Tugas selesai · 7 hari terakhir</div><div class="bar-chart">${last7.map(x=>`<div class="bar-col"><div class="bar" style="height:${Math.max(3,x.count/max*100)}%"></div><small>${x.label}</small></div>`).join("")}</div><p class="muted tiny" style="margin-top:14px">Grafik dihitung dari tanggal pembaruan tugas yang tersedia.</p></div>`;
  }
  function renderSettings(){
    const name=state.user?.user_metadata?.full_name||state.user?.email?.split("@")[0]||"Pengguna";
    return `${heading("Settings","Kelola preferensi workspace dan akunmu.","")}
      <div class="card settings-list">
        <div class="setting-row"><div><b>Profil pengguna</b><small>${escapeHTML(state.user?.email||"Mode lokal")}</small></div><span class="pill">Aktif</span></div>
        <div class="setting-row"><div><b>Tampilan</b><small>Ubah tema gelap atau terang</small></div><button class="btn btn-outline" id="settingsTheme">Ganti tema</button></div>
        <div class="setting-row"><div><b>Mode penyimpanan</b><small>${state.localMode?"Lokal di browser ini":"Database Supabase online"}</small></div><span class="pill">${state.localMode?"Demo":"Online"}</span></div>
        <div class="setting-row"><div><b>Ekspor data</b><small>Unduh salinan data DAYORA dalam format JSON</small></div><button class="btn btn-outline" id="exportData">Ekspor</button></div>
        <div class="setting-row"><div><b>Keluar akun</b><small>Akhiri sesi pada perangkat ini</small></div><button class="btn btn-outline danger-text" id="settingsLogout">Logout</button></div>
      </div>
      <p class="muted tiny" style="margin-top:14px">Halo, ${escapeHTML(name)}. DAYORA menyimpan data demo di browser atau di database online jika Supabase sudah dikonfigurasi.</p>`;
  }
  function renderPage(page){
    $("#pageCrumb").textContent=labels[page];
    const renderers={dashboard:renderDashboard,tasks:renderTasks,calendar:renderCalendar,notes:renderNotes,goals:renderGoals,focus:renderFocus,analytics:renderAnalytics,settings:renderSettings};
    $("#pageContent").innerHTML=renderers[page]();
  }
  function openItem(type,id=null){
    const existing=id?state.data[type].find(x=>x.id===id):null;
    $("#itemForm").reset();$("#itemId").value=id||"";$("#itemType").value=type;
    const titleMap={tasks:"Tugas",notes:"Catatan",goals:"Target",events:"Agenda"};
    $("#dialogTitle").textContent=(existing?"Edit ":"Tambah ")+titleMap[type];
    $("#itemTitle").value=existing?.title||"";
    $("#itemDescription").value=existing?.description||existing?.content||"";
    $("#descriptionWrap").classList.toggle("hidden",type==="goals");
    $("#priorityWrap").classList.toggle("hidden",type!=="tasks");
    $("#dateWrap").classList.toggle("hidden",type==="notes");
    $("#goalProgressWrap").classList.toggle("hidden",type!=="goals");
    $("#itemPriority").value=existing?.priority||"medium";
    $("#itemDate").value=existing?.due_date||existing?.target_date||(existing?.start_time?existing.start_time.slice(0,10):"");
    $("#goalProgress").value=existing?.progress||0;
    $("#itemDialog").showModal();
  }
  async function submitItem(e){
    e.preventDefault();
    const type=$("#itemType").value,id=$("#itemId").value,title=$("#itemTitle").value.trim();
    const desc=$("#itemDescription").value.trim(),date=$("#itemDate").value;
    let record={title};
    if(type==="tasks")record={...record,description:desc,priority:$("#itemPriority").value,due_date:date||null,status:"pending"};
    if(type==="notes")record={...record,content:desc,updated_at:new Date().toISOString()};
    if(type==="goals")record={...record,target_date:date||null,progress:Math.min(100,Math.max(0,Number($("#goalProgress").value)||0))};
    if(type==="events")record={...record,description:desc,start_time:date?new Date(date+"T09:00:00").toISOString():new Date().toISOString()};
    const ok=await persist(type,record,id||null);
    if(ok){$("#itemDialog").close();renderPage(state.page);toast("Berhasil disimpan.");}
  }
  async function handleClick(e){
    const auth=e.target.closest("[data-open-auth]");if(auth){showAuth(auth.dataset.openAuth);return;}
    const scroll=e.target.closest("[data-scroll]");if(scroll){document.querySelector(scroll.dataset.scroll)?.scrollIntoView({behavior:"smooth"});return;}
    const page=e.target.closest("[data-page]");if(page){setPage(page.dataset.page);return;}
    const add=e.target.closest("[data-add]");if(add){openItem(add.dataset.add);return;}
    const edit=e.target.closest("[data-edit]");if(edit){openItem(edit.dataset.edit,edit.dataset.id);return;}
    const del=e.target.closest("[data-delete]");if(del){if(confirm("Hapus item ini?")){await removeRecord(del.dataset.delete,del.dataset.id);renderPage(state.page);toast("Item dihapus.");}return;}
    const toggle=e.target.closest("[data-toggle-task]");if(toggle){const task=state.data.tasks.find(t=>t.id===toggle.dataset.toggleTask);if(task){const next=task.status==="completed"?"pending":"completed";await persist("tasks",{status:next,updated_at:new Date().toISOString()},task.id);renderPage(state.page);}return;}
    const preset=e.target.closest("[data-preset]");if(preset){stopTimer();state.timer.preset=Number(preset.dataset.preset);state.timer.seconds=state.timer.preset*60;state.timer.remaining=state.timer.seconds;renderPage("focus");return;}
  }
  function stopTimer(){if(state.timer.interval)clearInterval(state.timer.interval);state.timer.interval=null;state.timer.running=false;}
  function updateTimer(){const el=$("#timerDisplay");if(el){el.textContent=String(Math.floor(state.timer.remaining/60)).padStart(2,"0")+":"+String(state.timer.remaining%60).padStart(2,"0");$("#timerCaption").textContent=state.timer.running?"SEDANG BERJALAN":"SIAP UNTUK FOKUS";}}
  async function finishTimer(){stopTimer();const duration=state.timer.seconds;state.timer.remaining=state.timer.seconds;await persist("focus_sessions",{duration,completed_at:new Date().toISOString()});toast("Sesi fokus selesai. Bagus!");renderPage("focus");}
  function bindPageActions(e){
    if(e.target.id==="timerStart"){
      if(state.timer.running){stopTimer();updateTimer();e.target.textContent="Lanjutkan";}
      else{state.timer.running=true;e.target.textContent="Jeda";state.timer.interval=setInterval(()=>{state.timer.remaining--;updateTimer();if(state.timer.remaining<=0)finishTimer();},1000);updateTimer();}
    }
    if(e.target.id==="timerReset"){stopTimer();state.timer.remaining=state.timer.seconds;renderPage("focus");}
    if(e.target.id==="settingsTheme")toggleTheme();
    if(e.target.id==="settingsLogout")logout();
    if(e.target.id==="exportData")exportData();
  }
  function toggleTheme(){document.body.classList.toggle("light");localStorage.setItem("dayora_theme",document.body.classList.contains("light")?"light":"dark");}
  function exportData(){const blob=new Blob([JSON.stringify(state.data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="dayora-data.json";a.click();URL.revokeObjectURL(url);toast("Data berhasil diekspor.");}
  function filterTasks(){
    const q=($("#taskSearch")?.value||"").toLowerCase(),f=$("#taskFilter")?.value||"all";
    const rows=state.data.tasks.filter(t=>t.title.toLowerCase().includes(q)&&(f==="all"||t.status===f));
    $("#taskResults").innerHTML=taskRows(rows);
  }
  function filterNotes(){
    const q=($("#noteSearch")?.value||"").toLowerCase();
    const rows=state.data.notes.filter(n=>(n.title+" "+(n.content||"")).toLowerCase().includes(q));
    $("#noteResults").innerHTML=rows.length?rows.map(noteCard).join(""):empty("Catatan tidak ditemukan.");
  }
  document.addEventListener("click",e=>{handleClick(e);bindPageActions(e);});
  document.addEventListener("submit",e=>{if(e.target.id==="authForm")handleAuth(e);if(e.target.id==="itemForm")submitItem(e);});
  document.addEventListener("input",e=>{if(e.target.id==="taskSearch"||e.target.id==="taskFilter")filterTasks();if(e.target.id==="noteSearch")filterNotes();});
  $("#backLanding").addEventListener("click",showLanding);
  $("#logoutBtn").addEventListener("click",logout);
  $("#themeToggle").addEventListener("click",toggleTheme);
  $("#mobileMenu").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
  const savedTheme=localStorage.getItem("dayora_theme");if(savedTheme==="light")document.body.classList.add("light");
  initBackend().then(()=>{if(!state.user)showLanding();}).catch(err=>{console.error(err);showLanding();});
})();
