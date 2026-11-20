/* =========================================================
   ALOYS MANAGEMENT — interface : panneaux, saisie, statistiques de base
   Stockage : base de données en ligne Supabase (voir supabase_setup.sql)
   ========================================================= */

const STORE_KEY = "aloys_mgmt_v1";
let MEMBERS = []; // chargé depuis la base de données (profils validés)

// Couleurs des avatars par membre (index)
// Palette validée (contraste et daltonisme) : un membre garde la même couleur partout, avatars et graphiques
const AVATAR_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const AVATAR_INITIALS = ["MA", "NB", "IA", "IW"]; // Initiales

function getAvatarData(memberName) {
  const idx = MEMBERS.indexOf(memberName);
  if (idx === -1) return { color: "#888", initial: String(memberName||"?").slice(0,2).toUpperCase() };
  const initials = String(memberName).split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
  return { color: AVATAR_COLORS[idx % AVATAR_COLORS.length], initial: initials || "?" };
}

function avatarHTML(name, size="sm") {
  const data = getAvatarData(name);
  const cls = size === "sm" ? "avatar avatar-sm" : "avatar";
  return `<span class="${cls}" style="background:${data.color};">${data.initial}</span>`;
}

let DATA = { transactions: [], factures: [], target: null, budgets: {}, seuil: null };

// Devise du foyer (définie dans Administration → Membres et rôles)
const DEVISE_NOMS = { MAD: "dirhams", EUR: "euros", USD: "dollars", BIF: "francs burundais", MRU: "ouguiyas", XOF: "francs CFA", CAD: "dollars canadiens" };
function DEV(){ try{ return (FOYER && FOYER.devise) || "MAD"; }catch(e){ return "MAD"; } }
function DEVNOM(){ return DEVISE_NOMS[DEV()] || DEV(); }
let ADMIN_UNLOCKED = false;

function fmt(n){
  const v = Number(n)||0;
  return v.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function nowParts(){
  const d = new Date();
  return {
    iso: d.toISOString(),
    hour: d.toLocaleTimeString('fr-FR'),
    day: d.toLocaleDateString('fr-FR',{weekday:'long'}),
    date: d.getDate(),
    month: d.toLocaleDateString('fr-FR',{month:'long'}),
    year: d.getFullYear()
  };
}
function balance(){
  return DATA.transactions.reduce((s,t)=> s + (t.type==='deposit'? t.amount : -t.amount), 0);
}
function totalDeposits(){ return DATA.transactions.filter(t=>t.type==='deposit').reduce((s,t)=>s+t.amount,0); }
function totalConsumed(){ return DATA.transactions.filter(t=>t.type==='consumption').reduce((s,t)=>s+t.amount,0); }

/* Synthèse vocale automatique */
function voiceEnabled(){ return localStorage.getItem('aloys_mgmt_voice') !== 'off'; }
function setVoiceEnabled(on){ localStorage.setItem('aloys_mgmt_voice', on? 'on':'off'); }

function speakText(text){
  if(!voiceEnabled()) return;
  if(!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  u.rate = 0.95;
  const voices = window.speechSynthesis.getVoices();
  const frVoice = voices.find(v =>
    v.lang && (v.lang.toLowerCase().startsWith('fr') || /français/i.test(v.name))
  );
  if(frVoice) u.voice = frVoice;
  window.speechSynthesis.speak(u);
}
if('speechSynthesis' in window){
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = function(){ window.speechSynthesis.getVoices(); };
}

function remainingTarget(){
  if(!DATA.target) return null;
  const depositedSinceSet = totalDeposits() - DATA.target.baselineDeposits;
  const remaining = DATA.target.amount - depositedSinceSet;
  return Math.max(0, remaining);
}

function refreshChrome(){
  document.getElementById('entryCount').textContent = DATA.transactions.length + " entrées enregistrées";
}

function tickClock(){
  const p = nowParts();
  document.getElementById('clock').textContent = `${p.day}, ${p.month} ${p.date}, ${p.year} · ${p.hour}`;
}
setInterval(tickClock,1000); tickClock();

/* ---------- catégories & cartes ---------- */
const categoryGrid = document.getElementById('categoryGrid');
const cardGrid = document.getElementById('cardGrid');
const backToCategories = document.getElementById('backToCategories');
const panelHost = document.getElementById('panelHost');
let currentPanel = null;

function showCategory(cat){
  document.querySelectorAll('#cardGrid .card').forEach(c=>{
    c.style.display = (c.dataset.category === cat) ? '' : 'none';
  });
  categoryGrid.style.display = 'none';
  cardGrid.style.display = '';
  backToCategories.style.display = '';
  panelHost.innerHTML = '';
  cardGrid.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function showCategories(){
  categoryGrid.style.display = '';
  cardGrid.style.display = 'none';
  backToCategories.style.display = 'none';
  panelHost.innerHTML = '';
  currentPanel = null;
  document.querySelectorAll('.card').forEach(c=>c.classList.remove('active'));
}

categoryGrid.addEventListener('click', e=>{
  const cat = e.target.closest('.catcard');
  if(!cat) return;
  showCategory(cat.dataset.category);
});

backToCategories.addEventListener('click', showCategories);

cardGrid.addEventListener('click', e=>{
  const card = e.target.closest('.card');
  if(!card) return;
  document.querySelectorAll('.card').forEach(c=>c.classList.remove('active'));
  card.classList.add('active');
  currentPanel = card.dataset.panel;
  renderPanel(currentPanel);
  panelHost.scrollIntoView({behavior:'smooth', block:'nearest'});
});

function activeMember(){
  return document.getElementById('activeMember').value;
}

function renderPanel(name, silent){
  const renderers = {
    deposit: panelDeposit,
    database: panelDatabase,
    cash: panelCash,
    consumed: panelConsumed,
    status: panelStatus,
    forecast: panelForecast,
    stats: panelStats,
    charts: (r)=> window.panelAnalytics ? panelAnalytics(r) : panelCharts(r),
    download: panelDownload,
    target: panelTarget,
    facture: panelFacture,
    members: panelMembers,
    audit: panelAudit,
    equilibre: (r)=> panelEquilibre(r),
    budgets: (r)=> panelBudgets(r),
    assistant: (r)=> panelAssistant(r),
    rapport: (r)=> panelRapport(r)
  };
  if(window.destroyAnalyticsCharts) destroyAnalyticsCharts();
  panelHost.innerHTML = '';
  const div = document.createElement('div');
  div.className='panel';
  panelHost.appendChild(div);
  renderers[name](div);
  if(!silent) setTimeout(()=> speakPanel(name), 150);
}

function speakPanel(name){
  const bal = balance();
  let msg = '';
  switch(name){
    case 'deposit':
      msg = `Panneau Dépôt ouvert. Chaque membre peut enregistrer un versement ici. À ce jour, ${DATA.transactions.length} entrées sont enregistrées.`;
      break;
    case 'database':
      msg = `Panneau Base de données ouvert. ${DATA.transactions.length} enregistrements sont affichés.`;
      break;
    case 'cash':
      msg = ADMIN_UNLOCKED
        ? `Panneau Argent en caisse ouvert. Le solde actuel est de ${fmt(bal)} ${DEVNOM()}.`
        : `Panneau Argent en caisse ouvert. Réservé à l'administrateur.`;
      break;
    case 'consumed': {
      const count = DATA.transactions.filter(t=>t.type==='consumption').length;
      msg = `Panneau Dépenses ouvert. Le total des dépenses enregistrées est de ${fmt(totalConsumed())} ${DEVNOM()}, réparti sur ${count} entrées. Ce panneau est en lecture seule ; les dépenses sont créées via la fonction Facture.`;
      break;
    }
    case 'status':
      msg = bal > 0
        ? `Panneau État de la consommation ouvert. Votre patrimoine est en cours d'utilisation. Il reste de l'argent dans la caisse.`
        : `Panneau État de la consommation ouvert. Votre patrimoine est épuisé. Plus d'argent dans la caisse.`;
      break;
    case 'forecast': {
      const series = dailySeries();
      if(series.length < 3){
        msg = `Panneau Prévisions ouvert. Pas assez de jours d'historique (${series.length}).`;
      }else{
        const {slope} = linearRegression(series);
        msg = `Panneau Prévisions ouvert. La caisse évolue de ${fmt(slope)} ${DEVNOM()} par jour. ` + (slope < 0 ? 'À ce rythme, le fonds diminue.' : slope > 0 ? 'Le fonds augmente.' : 'Le fonds est stable.');
      }
      break;
    }
    case 'stats': {
      const all = DATA.transactions.map(t=>t.amount);
      const s = computeStats(all);
      msg = s ? `Panneau Statistiques ouvert. Sur ${s.n} entrées, moyenne ${fmt(s.mean)}, médiane ${fmt(s.median)}, écart‑type ${fmt(s.std)}.` : `Panneau Statistiques ouvert. Aucune donnée.`;
      break;
    }
    case 'charts': {
      msg = `Panneau Analyse et modèles ouvert. ${DATA.transactions.length} opérations analysées : répartition par membre, distribution des montants, prévision du solde et comparaison des membres.`;
      break;
    }
    case 'target':
      msg = ADMIN_UNLOCKED
        ? (DATA.target ? `Panneau Objectif ouvert. Il reste ${fmt(remainingTarget())} ${DEVNOM()}.` : `Panneau Objectif ouvert. Aucun objectif.`)
        : `Panneau Objectif ouvert. Réservé à l'administrateur.`;
      break;
    case 'download':
      msg = `Panneau Export ouvert. Téléchargez les données en CSV ou JSON.`;
      break;
    case 'facture':
      msg = `Panneau Facture ouvert. Enregistrez un retrait, la dépense sera automatiquement ajoutée au journal.`;
      break;
  }
  if(msg) speakText(msg);
}

/* ---------- 01 Dépôt ---------- */
function panelDeposit(root){
  root.innerHTML = `
    <h2>💰 Enregistrer un dépôt</h2>
    <p class="role">Chaque membre enregistre manuellement la somme qu'il verse dans la caisse commune. Chaque entrée est immédiatement sauvegardée avec un horodatage complet.</p>
    <div class="row">
      <div class="field">
        <label>Membre</label>
        <input type="text" value="${activeMember()}" disabled style="opacity:0.7;">
      </div>
      <div class="field">
        <label>Montant (${DEV()})</label>
        <input type="number" id="depAmount" min="0" step="0.01" placeholder="ex. 100">
      </div>
      <button class="btn" id="depSubmit">Enregistrer le dépôt</button>
    </div>
    <div class="msg" id="depMsg"></div>
  `;
  root.querySelector('#depSubmit').onclick = ()=>{
    const amt = parseFloat(root.querySelector('#depAmount').value);
    const msg = root.querySelector('#depMsg');
    if(!amt || amt<=0){
      msg.className='msg err show'; msg.textContent='Veuillez saisir un montant valide supérieur à zéro.'; return;
    }
    const p = nowParts();
    DATA.transactions.push({id:Date.now()+Math.random(), person:activeMember(), type:'deposit', amount:amt, ...p});
    saveData(DATA);
    refreshChrome();
    msg.className='msg ok show';
    msg.textContent = `Enregistré : ${activeMember()} a déposé ${fmt(amt)} ${DEV()} le ${p.day} ${p.date} ${p.month} ${p.year} à ${p.hour}.`;
    root.querySelector('#depAmount').value='';
  };
}

/* ---------- 02 Base de données (avec suppression admin) ---------- */
function panelDatabase(root){
  const rows = [...DATA.transactions].sort((a,b)=> new Date(b.iso)-new Date(a.iso));

  // Construction du HTML avec gestion admin
  let html = `
    <h2>🗄️ Base de données</h2>
    <p class="role">Enregistrement permanent de chaque entrée — dépôts et dépenses — horodatées.</p>
    <div style="margin-bottom:12px;">
      ${ADMIN_UNLOCKED
        ? `<span style="color:var(--green);font-family:'IBM Plex Mono',monospace;">ADMIN — SUPPRESSION AUTORISÉE</span>`
        : `<button class="btn secondary" id="unlockDbDelete" style="padding:5px 12px;font-size:11px;">Déverrouiller la suppression</button>`}
    </div>
    <div id="dbDeleteGate"></div>
    <div class="tablewrap" id="dbTableWrap">
      <table>
        <thead><tr><th>Année</th><th>Mois</th><th>Date</th><th>Jour</th><th>Heure</th><th>Membre</th><th>Type</th><th>Montant (${DEV()})</th>${ADMIN_UNLOCKED?'<th></th>':''}</tr></thead>
        <tbody>
          ${rows.length? rows.map(t=>`
            <tr>
              <td>${t.year}</td><td>${t.month}</td><td>${t.date}</td><td>${t.day}</td><td>${t.hour}</td>
              <td><span class="avatar-wrap">${avatarHTML(t.person, "sm")} ${t.person}</span></td>
              <td>${t.type==='deposit'?'Dépôt':'Dépense'}</td>
              <td>${t.type==='deposit'?'+':'-'}${fmt(t.amount)}</td>
              ${ADMIN_UNLOCKED? `<td><button class="btn danger db-del-btn" data-del="${t.id}" style="padding:4px 10px;font-size:11px;">Supprimer</button></td>` : ''}
            </tr>`).join('') : `<tr><td colspan="${ADMIN_UNLOCKED?9:8}" style="text-align:center;color:var(--muted);padding:20px;">Aucune entrée.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  root.innerHTML = html;

  // Gestion du déverrouillage
  const unlockBtn = root.querySelector('#unlockDbDelete');
  if(unlockBtn){
    unlockBtn.onclick = ()=>{
      root.querySelector('#dbDeleteGate').innerHTML = `
        <div class="row" style="margin-bottom:10px;">
          <div class="field">
            <label>Code administrateur</label>
            <input type="password" id="dbAdminCode" placeholder="Entrez le code">
          </div>
          <button class="btn" id="dbAdminSubmit">Déverrouiller</button>
        </div>
        <div class="msg" id="dbAdminMsg"></div>
      `;
      root.querySelector('#dbAdminSubmit').onclick = ()=>{
        const val = root.querySelector('#dbAdminCode').value;
        const msg = root.querySelector('#dbAdminMsg');
        if(isAdmin()){
          ADMIN_UNLOCKED = true;
          panelDatabase(root);
        }else{
          msg.className='msg err show'; msg.textContent="Accès réservé à l'administrateur.";
        }
      };
    };
  }

  // Gestion des suppressions (délégation d'événements)
  const tableWrap = root.querySelector('#dbTableWrap');
  if(tableWrap){
    tableWrap.addEventListener('click', function(e){
      const btn = e.target.closest('.db-del-btn');
      if(!btn) return;
      const id = btn.dataset.del;
      if(confirm('Supprimer cette transaction ?')) {
        DATA.transactions = DATA.transactions.filter(t=> String(t.id) !== String(id));
        saveData(DATA);
        refreshChrome();
        panelDatabase(root);
      }
    });
  }
}

/* ---------- 03 Argent en caisse ---------- */
function panelCash(root){
  if(!ADMIN_UNLOCKED){
    root.innerHTML = `
      <h2>🔐 Argent en caisse</h2>
      <p class="role">Réservé à l'administrateur. Indique le solde actuel.</p>
      <div class="row">
        <div class="field">
          <label>Code administrateur</label>
          <input type="password" id="adminCode" placeholder="Entrez le code">
        </div>
        <button class="btn" id="adminSubmit">Déverrouiller</button>
      </div>
      <div class="msg" id="adminMsg"></div>
    `;
    root.querySelector('#adminSubmit').onclick = ()=>{
      const val = root.querySelector('#adminCode').value;
      const msg = root.querySelector('#adminMsg');
      if(isAdmin()){
        ADMIN_UNLOCKED = true;
        panelCash(root);
        speakText(`Déverrouillé. Solde : ${fmt(balance())} ${DEVNOM()}.`);
      }else{
        msg.className='msg err show'; msg.textContent="Accès réservé à l'administrateur.";
      }
    };
    return;
  }
  const bal = balance();
  root.innerHTML = `
    <h2>🔐 Argent en caisse <span style="font-size:11px;color:var(--green);font-family:'IBM Plex Mono',monospace;">ADMIN DÉVERROUILLÉ</span></h2>
    <p class="role">Total des fonds actuellement dans la caisse commune.</p>
    <div class="statgrid">
      <div class="statbox"><div class="k">Argent en caisse</div><div class="v">${fmt(bal)} ${DEV()}</div></div>
      <div class="statbox"><div class="k">Total des dépôts</div><div class="v">${fmt(totalDeposits())} ${DEV()}</div></div>
      <div class="statbox"><div class="k">Total des dépenses</div><div class="v">${fmt(totalConsumed())} ${DEV()}</div></div>
    </div>
    <div class="row" style="margin-top:16px;">
      <button class="btn secondary" id="lockAgain">Verrouiller</button>
    </div>
  `;
  root.querySelector('#lockAgain').onclick = ()=>{ ADMIN_UNLOCKED = false; panelCash(root); };
}

/* ---------- 04 SORTIE (lecture seule avec suppression admin) ---------- */
function panelConsumed(root){
  // On affiche uniquement le journal et le total, sans formulaire d'ajout
  root.innerHTML = `
    <h2>📉 Argent dépensé</h2>
    <p class="role"><b>Ce panneau est en lecture seule.</b> Les dépenses sont désormais enregistrées automatiquement via la fonction <b>FACTURE</b> (carte n°11). Vous trouverez ci‑dessous l'historique complet des dépenses.</p>
    <div class="statgrid" style="margin-top:0;">
      <div class="statbox"><div class="k">Total dépensé à ce jour</div><div class="v">-${fmt(totalConsumed())} ${DEV()}</div></div>
    </div>

    <h3 style="font-family:'Fraunces',serif;font-size:15px;margin:22px 0 8px;display:flex;align-items:center;gap:10px;">
      Journal des dépenses
      ${ADMIN_UNLOCKED
        ? `<span style="font-size:11px;color:var(--green);font-family:'IBM Plex Mono',monospace;">ADMIN — SUPPRESSION AUTORISÉE</span>`
        : `<button class="btn secondary" id="unlockDelete" style="padding:5px 12px;font-size:11px;">Déverrouiller la suppression</button>`}
    </h3>
    <div id="adminDeleteGate"></div>
    <div id="consumedLog"></div>
  `;

  // Gestion du déverrouillage admin pour suppression
  const unlockBtn = root.querySelector('#unlockDelete');
  if(unlockBtn){
    unlockBtn.onclick = ()=>{
      root.querySelector('#adminDeleteGate').innerHTML = `
        <div class="row" style="margin-bottom:10px;">
          <div class="field">
            <label>Code administrateur</label>
            <input type="password" id="consAdminCode" placeholder="Entrez le code">
          </div>
          <button class="btn" id="consAdminSubmit">Déverrouiller</button>
        </div>
        <div class="msg" id="consAdminMsg"></div>
      `;
      root.querySelector('#consAdminSubmit').onclick = ()=>{
        const val = root.querySelector('#consAdminCode').value;
        const msg = root.querySelector('#consAdminMsg');
        if(isAdmin()){
          ADMIN_UNLOCKED = true;
          panelConsumed(root);
        }else{
          msg.className='msg err show'; msg.textContent="Accès réservé à l'administrateur.";
        }
      };
    };
  }

  renderConsumptionLog(root);
}

function renderConsumptionLog(root){
  const log = root.querySelector('#consumedLog');
  const entries = DATA.transactions.filter(t=>t.type==='consumption').sort((a,b)=> new Date(b.iso)-new Date(a.iso));
  if(entries.length === 0){
    log.innerHTML = `<div class="explain">Aucune dépense enregistrée pour l'instant.</div>`;
    return;
  }
  log.innerHTML = `
    <div class="tablewrap">
      <table>
        <thead><tr><th>Année</th><th>Mois</th><th>Date</th><th>Jour</th><th>Heure</th><th>Membre</th><th>Montant</th>${ADMIN_UNLOCKED? '<th></th>':''}</tr></thead>
        <tbody>
          ${entries.map(t=>`
            <tr>
              <td>${t.year}</td><td>${t.month}</td><td>${t.date}</td><td>${t.day}</td><td>${t.hour}</td>
              <td><span class="avatar-wrap">${avatarHTML(t.person, "sm")} ${t.person}</span></td>
              <td style="color:var(--rust);">-${fmt(t.amount)}</td>
              ${ADMIN_UNLOCKED? `<td><button class="btn danger cons-del-btn" data-del="${t.id}" style="padding:4px 10px;font-size:11px;">Supprimer</button></td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  if(ADMIN_UNLOCKED){
    log.addEventListener('click', function(e){
      const btn = e.target.closest('.cons-del-btn');
      if(!btn) return;
      const id = btn.dataset.del;
      if(confirm('Supprimer cette dépense ?')) {
        DATA.transactions = DATA.transactions.filter(t=> String(t.id) !== String(id));
        saveData(DATA);
        refreshChrome();
        renderConsumptionLog(root);
      }
    });
  }
}

/* ---------- 05 État ---------- */
function panelStatus(root){
  const bal = balance();
  const active = bal > 0;
  root.innerHTML = `
    <h2>🚦 État de la consommation</h2>
    <p class="role">Diagnostic en langage clair de l'état général du fonds.</p>
    <div class="statuscard ${active?'active':'done'}">
      <div class="big">${active? '🟢' : '🔴'}</div>
      <div class="title">${active? 'Patrimoine en cours d\'utilisation' : 'Patrimoine épuisé'}</div>
      <div class="desc">${active
        ? 'Il reste de l\'argent dans la caisse commune.'
        : 'Il n\'y a plus d\'argent dans la caisse. Un nouveau dépôt est nécessaire.'}</div>
    </div>
  `;
}

/* ---------- 06 Prévision ---------- */
function dailySeries(){
  const byDay = {};
  DATA.transactions.forEach(t=>{
    const key = t.iso.slice(0,10);
    byDay[key] = (byDay[key]||0) + (t.type==='deposit'? t.amount : -t.amount);
  });
  const days = Object.keys(byDay).sort();
  let running = 0;
  const series = days.map((d,i)=>{ running += byDay[d]; return {day:i, date:d, cum:running}; });
  return series;
}
function linearRegression(series){
  const n = series.length;
  const sx = series.reduce((s,p)=>s+p.day,0);
  const sy = series.reduce((s,p)=>s+p.cum,0);
  const sxy = series.reduce((s,p)=>s+p.day*p.cum,0);
  const sxx = series.reduce((s,p)=>s+p.day*p.day,0);
  const denom = (n*sxx - sx*sx);
  const slope = denom!==0 ? (n*sxy - sx*sy)/denom : 0;
  const intercept = (sy - slope*sx)/n;
  return {slope, intercept, n};
}
function panelForecast(root){
  const series = dailySeries();
  root.innerHTML = `
    <h2>🔮 Moteur de prévision</h2>
    <p class="role">Projection du solde par tendance linéaire sur l'historique quotidien.</p>
    <div id="forecastBody"></div>
  `;
  const body = root.querySelector('#forecastBody');
  if(series.length < 3){
    body.innerHTML = `<div class="explain">Pas assez de jours distincts d'historique (<b>${series.length}</b> jour${series.length===1?'':'s'}). Enregistrez sur plusieurs jours.</div>`;
    return;
  }
  const {slope, intercept, n} = linearRegression(series);
  const lastDay = series[series.length-1].day;
  const horizons = [
    {label:'1 semaine', days:7},
    {label:'1 mois', days:30},
    {label:'3 mois', days:90},
    {label:'6 mois', days:180},
    {label:'12 mois', days:365},
  ];
  const cards = horizons.map(h=>{
    const projDay = lastDay + h.days;
    const proj = slope*projDay + intercept;
    return `<div class="fbox"><div class="h">${h.label}</div><div class="n">${fmt(proj)} ${DEV()}</div></div>`;
  }).join('');
  body.innerHTML = `
    <div class="forecastgrid">${cards}</div>
    <div class="explain">
      Tendance : le solde évolue d'environ <b>${fmt(slope)} ${DEV()} par jour</b> sur <b>${n}</b> jour(s).
      ${slope < 0 ? 'Le fonds diminue — pensez à de nouveaux dépôts.' : slope > 0 ? 'Le fonds augmente.' : 'Le fonds est stable.'}
    </div>
  `;
}

/* ---------- 07 Statistiques ---------- */
function computeStats(values){
  const n = values.length;
  if(n===0) return null;
  const sum = values.reduce((a,b)=>a+b,0);
  const mean = sum/n;
  const sorted = [...values].sort((a,b)=>a-b);
  const median = n%2? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2;
  const variance = values.reduce((a,b)=>a+Math.pow(b-mean,2),0)/n;
  const std = Math.sqrt(variance);
  return {n, sum, mean, median, std, min:sorted[0], max:sorted[n-1], sorted};
}
function panelStats(root){
  const all = DATA.transactions.map(t=>t.amount);
  const deposits = DATA.transactions.filter(t=>t.type==='deposit').map(t=>t.amount);
  const consumption = DATA.transactions.filter(t=>t.type==='consumption').map(t=>t.amount);
  const s = computeStats(all);
  root.innerHTML = `
    <h2>📐 Statistiques descriptives</h2>
    <p class="role">Résumé statistique complet de toutes les entrées.</p>
    <div id="statsBody"></div>
  `;
  const body = root.querySelector('#statsBody');
  if(!s){
    body.innerHTML = `<div class="explain">Aucune donnée.</div>`;
    return;
  }
  body.innerHTML = `
    <div class="statgrid">
      <div class="statbox"><div class="k">Entrées (n)</div><div class="v">${s.n}</div></div>
      <div class="statbox"><div class="k">Somme totale</div><div class="v">${fmt(s.sum)}</div></div>
      <div class="statbox"><div class="k">Moyenne</div><div class="v">${fmt(s.mean)}</div></div>
      <div class="statbox"><div class="k">Médiane</div><div class="v">${fmt(s.median)}</div></div>
      <div class="statbox"><div class="k">Écart‑type</div><div class="v">${fmt(s.std)}</div></div>
      <div class="statbox"><div class="k">Minimum</div><div class="v">${fmt(s.min)}</div></div>
      <div class="statbox"><div class="k">Maximum</div><div class="v">${fmt(s.max)}</div></div>
      <div class="statbox"><div class="k">1er quartile (Q1)</div><div class="v">${fmt(quantile(s.sorted,0.25))}</div></div>
      <div class="statbox"><div class="k">3e quartile (Q3)</div><div class="v">${fmt(quantile(s.sorted,0.75))}</div></div>
      <div class="statbox"><div class="k">Coef. de variation</div><div class="v">${s.mean ? (s.std/s.mean*100).toLocaleString('fr-FR',{maximumFractionDigits:1})+' %' : '—'}</div></div>
    </div>
    <h3 style="font-family:'Fraunces',serif;font-size:15px;margin:20px 0 8px;">Totaux par membre</h3>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Membre</th><th>Déposé</th><th>Dépensé</th><th>Net</th></tr></thead>
        <tbody>
          ${MEMBERS.map(m=>{
            const dep = DATA.transactions.filter(t=>t.person===m && t.type==='deposit').reduce((a,t)=>a+t.amount,0);
            const con = DATA.transactions.filter(t=>t.person===m && t.type==='consumption').reduce((a,t)=>a+t.amount,0);
            return `<tr><td><span class="avatar-wrap">${avatarHTML(m, "sm")} ${m}</span></td><td>+${fmt(dep)}</td><td>-${fmt(con)}</td><td>${fmt(dep-con)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="explain">
      Sur <b>${s.n}</b> entrées, dépôts : <b>${deposits.length}</b>, dépenses : <b>${consumption.length}</b>.
      La taille moyenne est de <b>${fmt(s.mean)} ${DEV()}</b> avec un écart‑type de <b>${fmt(s.std)}</b>.
      Le coefficient de variation (écart‑type / moyenne) mesure la dispersion relative : sous 30 %, les montants sont homogènes.
      Pour les graphiques et les modèles de prévision, ouvrez la carte <b>08 · Analyse &amp; modèles</b>.
    </div>
  `;
}

/* ---------- 08 Graphiques ---------- */
function panelCharts(root){
  const consumption = DATA.transactions.filter(t=>t.type==='consumption').map(t=>t.amount);
  root.innerHTML = `
    <h2>📊 Graphiques de consommation</h2>
    <p class="role">Histogramme et boîte à moustaches des montants dépensés.</p>
    <div id="chartsBody"></div>
  `;
  const body = root.querySelector('#chartsBody');
  if(consumption.length < 2){
    body.innerHTML = `<div class="explain">Au moins deux dépenses nécessaires (actuellement : <b>${consumption.length}</b>).</div>`;
    return;
  }
  const s = computeStats(consumption);
  body.innerHTML = `
    <h3 style="font-family:'Fraunces',serif;font-size:14px;margin:14px 0 6px;">Histogramme</h3>
    <canvas id="histCanvas" width="600" height="220"></canvas>
    <div id="histExplainHost"></div>
    <h3 style="font-family:'Fraunces',serif;font-size:14px;margin:20px 0 6px;">Boîte à moustaches</h3>
    <canvas id="boxCanvas" width="600" height="160"></canvas>
    <div id="boxExplainHost"></div>
  `;
  drawHistogram(document.getElementById('histCanvas'), consumption, s);
  drawBoxplot(document.getElementById('boxCanvas'), consumption, s);

  const binInfo = histogramBins(consumption, 6);
  const peak = binInfo.reduce((a,b)=> b.count>a.count? b:a, binInfo[0]);
  document.getElementById('histExplainHost').innerHTML = `<div class="explain">
    Distribution sur <b>${consumption.length}</b> dépenses en ${binInfo.length} tranches.
    Tranche la plus fréquente : <b>${fmt(peak.lo)}–${fmt(peak.hi)} ${DEV()}</b> (${peak.count} entrée${peak.count===1?'':'s'}).
  </div>`;

  const q1 = quantile(s.sorted,0.25), q3 = quantile(s.sorted,0.75), iqr = q3-q1;
  const outliers = consumption.filter(v=> v < q1-1.5*iqr || v > q3+1.5*iqr);
  document.getElementById('boxExplainHost').innerHTML = `<div class="explain">
    Médiane : <b>${fmt(s.median)} ${DEV()}</b>, 50 % centraux entre <b>${fmt(q1)}</b> et <b>${fmt(q3)} ${DEV()}</b> (IQR = ${fmt(iqr)}).
    ${outliers.length? `<b>${outliers.length}</b> valeur${outliers.length===1?'':'s'} aberrante${outliers.length===1?'':'s'}.` : 'Aucune valeur aberrante.'}
  </div>`;
}
function quantile(sorted, q){
  const pos = (sorted.length-1)*q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if(sorted[base+1]!==undefined) return sorted[base] + rest*(sorted[base+1]-sorted[base]);
  return sorted[base];
}
function histogramBins(values, count){
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max-min)||1;
  const width = span/count;
  const bins = Array.from({length:count},(_,i)=>({lo:min+i*width, hi:min+(i+1)*width, count:0}));
  values.forEach(v=>{
    let idx = Math.floor((v-min)/width);
    if(idx>=count) idx = count-1;
    if(idx<0) idx=0;
    bins[idx].count++;
  });
  return bins;
}
function drawHistogram(canvas, values, s){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad=36;
  ctx.clearRect(0,0,W,H);
  const bins = histogramBins(values,6);
  const maxCount = Math.max(...bins.map(b=>b.count),1);
  const chartW = W-pad*2, chartH = H-pad*2;
  const bw = chartW/bins.length;
  ctx.strokeStyle = '#1b2436'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(pad,H-pad); ctx.lineTo(W-pad,H-pad); ctx.stroke();
  bins.forEach((b,i)=>{
    const h = (b.count/maxCount)*chartH;
    const x = pad + i*bw + 4;
    const y = H-pad-h;
    ctx.fillStyle = '#C9A227';
    ctx.fillRect(x,y,bw-8,h);
    ctx.fillStyle = '#1b2436';
    ctx.font='10px IBM Plex Mono, monospace';
    ctx.textAlign='center';
    ctx.fillText(b.count, x+(bw-8)/2, y-6<12?12:y-6);
    ctx.fillText(Math.round(b.lo), x+(bw-8)/2, H-pad+14);
  });
}
function drawBoxplot(canvas, values, s){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad=50;
  ctx.clearRect(0,0,W,H);
  const sorted = s.sorted;
  const q1 = quantile(sorted,0.25), q3 = quantile(sorted,0.75), med = s.median;
  const min = s.min, max = s.max;
  const range = (max-min)||1;
  const scaleX = v => pad + ((v-min)/range)*(W-pad*2);
  const midY = H/2;
  ctx.strokeStyle = '#1b2436'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(scaleX(min),midY); ctx.lineTo(scaleX(q1),midY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(scaleX(q3),midY); ctx.lineTo(scaleX(max),midY); ctx.stroke();
  [min,max].forEach(v=>{ ctx.beginPath(); ctx.moveTo(scaleX(v),midY-15); ctx.lineTo(scaleX(v),midY+15); ctx.stroke(); });
  ctx.fillStyle='rgba(201,162,39,0.35)';
  ctx.fillRect(scaleX(q1), midY-25, scaleX(q3)-scaleX(q1), 50);
  ctx.strokeRect(scaleX(q1), midY-25, scaleX(q3)-scaleX(q1), 50);
  ctx.strokeStyle='#C1543C'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(scaleX(med),midY-25); ctx.lineTo(scaleX(med),midY+25); ctx.stroke();
  ctx.fillStyle = '#1b2436'; ctx.font='10px IBM Plex Mono, monospace'; ctx.textAlign='center';
  [['min',min],['Q1',q1],['med',med],['Q3',q3],['max',max]].forEach(([label,v])=>{
    ctx.fillText(label, scaleX(v), midY+45);
    ctx.fillText(Math.round(v), scaleX(v), midY+58);
  });
}

/* ---------- 09 Téléchargement ---------- */
function panelDownload(root){
  root.innerHTML = `
    <h2>⬇️ Télécharger le rapport complet</h2>
    <p class="role">Sauvegarde toutes les entrées et le résumé statistique.</p>
    <div class="row">
      <button class="btn" id="dlCsv">Télécharger CSV</button>
      <button class="btn secondary" id="dlJson">Télécharger JSON</button>
    </div>
    <h2 style="margin-top:26px">💾 Sauvegarde et restauration</h2>
    <p class="role">Les données sont enregistrées dans ce navigateur uniquement. Faites une sauvegarde régulière, et utilisez-la pour transférer les données vers un autre appareil.</p>
    <div class="row">
      <button class="btn" id="dlBackup">Sauvegarde complète</button>
      <label class="btn secondary" for="restoreFile" style="cursor:pointer">Restaurer une sauvegarde</label>
      <input type="file" id="restoreFile" accept="application/json,.json" style="display:none">
    </div>
    <div class="msg" id="dlMsg"></div>
  `;
  root.querySelector('#dlBackup').onclick = ()=>{
    const stamp = new Date().toISOString().slice(0,10);
    downloadBlob(JSON.stringify({format:'aloys_mgmt_backup', version:1, generated:new Date().toISOString(), data:DATA}, null, 2),
                 `aloys_management_sauvegarde_${stamp}.json`, 'application/json');
    flashMsg(root,'Sauvegarde complète téléchargée.');
  };
  root.querySelector('#restoreFile').onchange = (ev)=>{
    if(!isAdmin()){ flashMsg(root,"La restauration est réservée à l'administrateur."); ev.target.value=''; return; }
    const file = ev.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const obj = JSON.parse(reader.result);
        const d = obj.format === 'aloys_mgmt_backup' ? obj.data : obj;
        if(!d || !Array.isArray(d.transactions)) throw new Error('format');
        const restored = {
          transactions: d.transactions,
          factures: Array.isArray(d.factures) ? d.factures : [],
          target: d.target === undefined ? null : d.target
        };
        if(!confirm(`Remplacer les données actuelles par cette sauvegarde (${restored.transactions.length} transactions) ?`)) return;
        DATA = restored;
        saveData(DATA);
        refreshChrome();
        flashMsg(root,'Sauvegarde restaurée.');
      }catch(e){
        flashMsg(root,'Fichier invalide : choisissez une sauvegarde JSON de l\'application.');
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  };
  root.querySelector('#dlCsv').onclick = ()=>{
    const header = ['Année','Mois','Date','Jour','Heure','Membre','Type','Montant(' + DEV() + ')','Catégorie','Description'];
    const lines = [header.join(',')];
    DATA.transactions.forEach(t=>{
      const q = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
      const cat = t.type === 'consumption' && window.AloysCategories ? AloysCategories.parId(AloysCategories.categorieDe(t)).label : '';
      lines.push([t.year,t.month,t.date,t.day,t.hour,q(t.person),t.type,t.amount,q(cat),q(t.description)].join(','));
    });
    downloadBlob('\ufeff' + lines.join('\n'), 'aloys_management_transactions.csv', 'text/csv;charset=utf-8');
    flashMsg(root,'CSV téléchargé.');
  };
  root.querySelector('#dlJson').onclick = ()=>{
    const all = DATA.transactions.map(t=>t.amount);
    const snapshot = {
      generated: new Date().toISOString(),
      totalDeposits: totalDeposits(),
      totalConsumed: totalConsumed(),
      transactionCount: DATA.transactions.length,
      statistics: computeStats(all),
      transactions: DATA.transactions
    };
    downloadBlob(JSON.stringify(snapshot,null,2), 'aloys_management_snapshot.json', 'application/json');
    flashMsg(root,'JSON téléchargé.');
  };
}
function flashMsg(root, text){
  const msg = root.querySelector('#dlMsg');
  msg.className='msg ok show'; msg.textContent=text;
}
function downloadBlob(content, filename, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- 10 Objectif de caisse ---------- */
function panelTarget(root){
  if(!ADMIN_UNLOCKED){
    root.innerHTML = `
      <h2>🎯 Objectif de caisse</h2>
      <p class="role">Réservé à l'administrateur.</p>
      <div class="row">
        <div class="field">
          <label>Code administrateur</label>
          <input type="password" id="targetAdminCode" placeholder="Entrez le code">
        </div>
        <button class="btn" id="targetAdminSubmit">Déverrouiller</button>
      </div>
      <div class="msg" id="targetAdminMsg"></div>
    `;
    root.querySelector('#targetAdminSubmit').onclick = ()=>{
      const val = root.querySelector('#targetAdminCode').value;
      const msg = root.querySelector('#targetAdminMsg');
      if(isAdmin()){
        ADMIN_UNLOCKED = true;
        panelTarget(root);
        speakText(DATA.target ? `Déverrouillé. Il reste ${fmt(remainingTarget())} ${DEVNOM()}.` : `Déverrouillé. Aucun objectif.`);
      }else{
        msg.className='msg err show'; msg.textContent="Accès réservé à l'administrateur.";
      }
    };
    return;
  }

  const remaining = remainingTarget();
  const hasTarget = DATA.target !== null;
  const percentDone = hasTarget ? Math.min(100, Math.round(((DATA.target.amount - remaining) / DATA.target.amount) * 100)) : 0;

  root.innerHTML = `
    <h2>🎯 Objectif de caisse <span style="font-size:11px;color:var(--green);font-family:'IBM Plex Mono',monospace;">ADMIN DÉVERROUILLÉ</span></h2>
    <p class="role">Définissez le montant à collecter. Il diminue automatiquement à chaque dépôt.</p>

    ${hasTarget ? `
      <div class="statgrid">
        <div class="statbox"><div class="k">Objectif fixé</div><div class="v">${fmt(DATA.target.amount)} ${DEV()}</div></div>
        <div class="statbox"><div class="k">Reste à collecter</div><div class="v">${remaining<=0 ? '0.00 ✅' : fmt(remaining)}</div></div>
        <div class="statbox"><div class="k">Progression</div><div class="v">${percentDone}%</div></div>
      </div>
      <div class="explain" style="margin-top:14px;">
        ${remaining<=0 ? 'Objectif atteint.' : `Encore <b>${fmt(remaining)} ${DEV()}</b> à collecter.`}
      </div>
    ` : `<div class="explain">Aucun objectif défini.</div>`}

    <div class="row" style="margin-top:18px;">
      <div class="field">
        <label>${hasTarget? 'Nouveau montant (remplace)' : 'Montant à collecter (' + DEV() + ')'}</label>
        <input type="number" id="targetAmount" min="0" step="0.01" placeholder="ex. 500">
      </div>
      <button class="btn" id="targetSubmit">${hasTarget? 'Mettre à jour' : 'Définir'}</button>
      ${hasTarget ? `<button class="btn secondary" id="targetClear">Effacer</button>` : ''}
    </div>
    <div class="msg" id="targetMsg"></div>
  `;

  root.querySelector('#targetSubmit').onclick = ()=>{
    const amt = parseFloat(root.querySelector('#targetAmount').value);
    const msg = root.querySelector('#targetMsg');
    if(!amt || amt<=0){
      msg.className='msg err show'; msg.textContent='Montant valide requis.'; return;
    }
    DATA.target = { amount: amt, setAt: new Date().toISOString(), baselineDeposits: totalDeposits() };
    saveData(DATA);
    msg.className='msg ok show';
    msg.textContent = `Objectif fixé à ${fmt(amt)} ${DEV()}.`;
    panelTarget(root);
  };
  if(hasTarget){
    root.querySelector('#targetClear').onclick = ()=>{
      DATA.target = null;
      saveData(DATA);
      panelTarget(root);
    };
  }
}

/* ---------- 11 FACTURE (avec création automatique de la dépense, suppression admin et avatar) ---------- */
function panelFacture(root) {
  const factures = DATA.factures || [];

  // Afficher l'avatar du membre actif dans le formulaire
  const currentMember = activeMember();
  const avatarCurrent = avatarHTML(currentMember, "sm");

  root.innerHTML = `
    <h2>🧾 Facture de retrait</h2>
    <p class="role">Enregistrez un retrait d'argent. Les champs <b>Pays</b> (Maroc) et <b>Fonction</b> (Étudiant) sont fixes.  
    <br><b>Important :</b> l'enregistrement de la facture ajoute <u>automatiquement</u> une dépense dans le journal (option SORTIE).</p>
    <div class="row">
      <div class="field">
        <label>Nom du retraitant</label>
        <div style="display:flex;align-items:center;gap:8px;">
          ${avatarCurrent}
          <input type="text" id="factureNom" placeholder="ex. MINYURANO Aloys" value="${currentMember}" style="flex:1;">
        </div>
      </div>
      <div class="field">
        <label>Heure de retrait</label>
        <input type="text" id="factureTime" placeholder="HH:MM" value="${nowParts().hour}">
      </div>
      <div class="field">
        <label>Montant (${DEV()})</label>
        <input type="number" id="factureMontant" min="0" step="0.01" placeholder="ex. 150">
      </div>
    </div>
    <div class="row">
      <div class="field" style="flex:2;min-width:220px;">
        <label>Description (ce qui a été acheté)</label>
        <input type="text" id="factureDesc" placeholder="ex. Marjane : huile, riz, lait" maxlength="140">
      </div>
      <div class="field">
        <label>Catégorie</label>
        <select id="factureCat">${(window.AloysCategories ? AloysCategories.CATEGORIES : []).map(c => `<option value="${c.id}" ${c.id==='autre'?'selected':''}>${c.icon} ${c.label}</option>`).join('')}</select>
        <small class="ia-hint" id="factureHint" aria-live="polite"></small>
      </div>
      <div class="field">
        <label>Reçu (photo, facultatif)</label>
        <input type="file" id="factureRecu" accept="image/*,application/pdf">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label>Pays</label>
        <input type="text" id="facturePays" value="Maroc" disabled style="opacity:0.7;">
      </div>
      <div class="field">
        <label>Fonction</label>
        <input type="text" id="factureFonction" value="Étudiant" disabled style="opacity:0.7;">
      </div>
      <button class="btn" id="factureSubmit">Enregistrer la facture</button>
    </div>
    <div class="msg" id="factureMsg"></div>

    <h3 style="font-family:'Fraunces',serif;font-size:15px;margin:22px 0 8px;display:flex;align-items:center;gap:10px;">
      Factures enregistrées
      ${ADMIN_UNLOCKED
        ? `<span style="font-size:11px;color:var(--green);font-family:'IBM Plex Mono',monospace;">ADMIN — SUPPRESSION AUTORISÉE</span>`
        : `<button class="btn secondary" id="unlockFactureDelete" style="padding:5px 12px;font-size:11px;">Déverrouiller la suppression</button>`}
    </h3>
    <div id="factureDeleteGate"></div>
    <div id="factureList"></div>
  `;

  const listDiv = root.querySelector('#factureList');
  renderFactureList(listDiv);

  // Suggestion automatique de la catégorie (classifieur bayésien naïf)
  const descIn = root.querySelector('#factureDesc'), catSel = root.querySelector('#factureCat'), hint = root.querySelector('#factureHint');
  let catManuelle = false;
  catSel.onchange = ()=>{ catManuelle = true; hint.textContent = ''; };
  descIn.oninput = ()=>{
    if(!window.AloysCategories) return;
    const r = AloysCategories.suggerer(descIn.value);
    if(r.categorie && !catManuelle){
      catSel.value = r.categorie;
      hint.textContent = `🤖 Suggestion IA : ${AloysCategories.parId(r.categorie).label}`;
    }else if(!r.categorie && !catManuelle){ hint.textContent = ''; }
  };

  // Gestion du déverrouillage pour suppression des factures
  const unlockBtn = root.querySelector('#unlockFactureDelete');
  if(unlockBtn){
    unlockBtn.onclick = ()=>{
      root.querySelector('#factureDeleteGate').innerHTML = `
        <div class="row" style="margin-bottom:10px;">
          <div class="field">
            <label>Code administrateur</label>
            <input type="password" id="factureAdminCode" placeholder="Entrez le code">
          </div>
          <button class="btn" id="factureAdminSubmit">Déverrouiller</button>
        </div>
        <div class="msg" id="factureAdminMsg"></div>
      `;
      root.querySelector('#factureAdminSubmit').onclick = ()=>{
        const val = root.querySelector('#factureAdminCode').value;
        const msg = root.querySelector('#factureAdminMsg');
        if(isAdmin()){
          ADMIN_UNLOCKED = true;
          panelFacture(root);
        }else{
          msg.className='msg err show'; msg.textContent="Accès réservé à l'administrateur.";
        }
      };
    };
  }

  root.querySelector('#factureSubmit').onclick = async ()=>{
    const nom = root.querySelector('#factureNom').value.trim();
    const time = root.querySelector('#factureTime').value.trim();
    const montant = parseFloat(root.querySelector('#factureMontant').value);
    const msg = root.querySelector('#factureMsg');

    if(!nom){ msg.className='msg err show'; msg.textContent='Veuillez saisir un nom.'; return; }
    if(!time){ msg.className='msg err show'; msg.textContent='Veuillez saisir une heure.'; return; }
    if(!montant || montant<=0){ msg.className='msg err show'; msg.textContent='Montant invalide.'; return; }

    const description = root.querySelector('#factureDesc').value.trim();
    const categorie = root.querySelector('#factureCat').value || 'autre';
    const fichier = root.querySelector('#factureRecu').files[0];
    const btn = root.querySelector('#factureSubmit');
    const factureId = Date.now() + Math.random();
    let recu = null;
    if(fichier){
      btn.disabled = true; btn.textContent = 'Envoi du reçu…';
      try{ recu = await uploadRecu(fichier, factureId); }
      catch(e){ msg.className='msg err show'; msg.textContent = 'Reçu non envoyé : ' + (e.message || e) + '. La facture n\'a pas été enregistrée.'; btn.disabled = false; btn.textContent = 'Enregistrer la facture'; return; }
      btn.disabled = false; btn.textContent = 'Enregistrer la facture';
    }

    // 1. Enregistrer la facture
    const facture = {
      id: factureId,
      nom,
      time,
      montant,
      description,
      categorie,
      recu,
      pays: 'Maroc',
      fonction: 'Étudiant',
      dateCreation: new Date().toISOString()
    };
    DATA.factures.push(facture);

    // 2. Ajouter automatiquement une transaction de type 'consumption'
    const p = nowParts();
    DATA.transactions.push({
      id: Date.now() + Math.random() + 1,
      person: nom,
      type: 'consumption',
      amount: montant,
      categorie,
      description,
      recu,
      iso: p.iso,
      hour: time,
      day: p.day,
      date: p.date,
      month: p.month,
      year: p.year
    });

    saveData(DATA);
    refreshChrome();
    msg.className='msg ok show';
    msg.textContent = `Facture enregistrée pour ${nom} de ${fmt(montant)} ${DEV()}. Dépense automatiquement ajoutée.`;

    root.querySelector('#factureNom').value = activeMember();
    // Mettre à jour l'avatar dans le champ nom
    const avatarSpan = root.querySelector('#factureNom').previousElementSibling;
    if(avatarSpan && avatarSpan.classList.contains('avatar')) {
      const newAvatar = avatarHTML(activeMember(), "sm");
      avatarSpan.outerHTML = newAvatar;
    }
    root.querySelector('#factureTime').value = nowParts().hour;
    root.querySelector('#factureMontant').value = '';
    root.querySelector('#factureDesc').value = '';
    root.querySelector('#factureRecu').value = '';
    root.querySelector('#factureCat').value = 'autre';
    root.querySelector('#factureHint').textContent = '';
    catManuelle = false;
    renderFactureList(listDiv);
  };
}

function renderFactureList(container) {
  const factures = DATA.factures || [];
  if(factures.length === 0) {
    container.innerHTML = `<div class="explain">Aucune facture enregistrée pour l'instant.</div>`;
    return;
  }

  const sorted = [...factures].sort((a,b)=> new Date(b.dateCreation) - new Date(a.dateCreation));

  let html = `<div class="tablewrap"><table>
    <thead><tr><th>Avatar</th><th>Nom</th><th>Heure</th><th>Montant (${DEV()})</th><th>Catégorie</th><th>Description</th><th>Date création</th><th>Reçu</th><th>Action</th>${ADMIN_UNLOCKED?'<th></th>':''}</tr></thead><tbody>`;
  sorted.forEach(f => {
    const date = new Date(f.dateCreation);
    const dateStr = date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
    html += `<tr>
      <td>${avatarHTML(f.nom, "sm")}</td>
      <td>${f.nom}</td>
      <td>${f.time}</td>
      <td>${fmt(f.montant)}</td>
      <td>${window.AloysCategories ? AloysCategories.libelle(f.categorie) : (f.categorie || '')}</td>
      <td>${esc(f.description || '—')}</td>
      <td>${dateStr}</td>
      <td>${f.recu ? `<button class="btn secondary facture-recu-btn" data-recu="${esc(f.recu)}" style="padding:4px 10px;font-size:11px;">📎 Voir</button>` : '—'}</td>
      <td><button class="btn secondary facture-dl-btn" data-id="${f.id}" style="padding:4px 10px;font-size:11px;">Télécharger</button></td>
      ${ADMIN_UNLOCKED? `<td><button class="btn danger facture-del-btn" data-del="${f.id}" style="padding:4px 10px;font-size:11px;">Supprimer</button></td>` : ''}
    </tr>`;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Téléchargement, reçu et suppression (délégation, un seul gestionnaire)
  container.onclick = function(e){
    const recuBtn = e.target.closest('.facture-recu-btn');
    if(recuBtn){ openRecu(recuBtn.dataset.recu); return; }
    const dlBtn = e.target.closest('.facture-dl-btn');
    if(dlBtn){
      const id = dlBtn.dataset.id;
      const facture = DATA.factures.find(f => String(f.id) === String(id));
      if(facture) downloadFacture(facture);
      return;
    }
    const delBtn = e.target.closest('.facture-del-btn');
    if(delBtn){
      const id = delBtn.dataset.del;
      if(confirm('Supprimer cette facture ?')) {
        DATA.factures = DATA.factures.filter(f => String(f.id) !== String(id));
        saveData(DATA);
        renderFactureList(container);
      }
    }
  };
}

function downloadFacture(facture) {
  const date = new Date(facture.dateCreation);
  const dateStr = date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});

  // Récupérer l'avatar (initiales) pour l'inclure dans le texte
  const avatarData = getAvatarData(facture.nom);
  const avatarText = `[${avatarData.initial}]`;

  const lines = [
    '============================================',
    '            FACTURE DE RETRAIT               ',
    '============================================',
    '',
    `  Avatar             : ${avatarText}`,
    `  Nom du retraitant   : ${facture.nom}`,
    `  Heure de retrait    : ${facture.time}`,
    `  Montant             : ${fmt(facture.montant)} ${DEV()}`,
    `  Catégorie           : ${window.AloysCategories ? AloysCategories.parId(facture.categorie).label : (facture.categorie || '—')}`,
    `  Description         : ${facture.description || '—'}`,
    `  Pays                : ${facture.pays}`,
    `  Fonction            : ${facture.fonction}`,
    `  Date d'émission     : ${dateStr}`,
    '',
    '============================================',
    '  Signature : _______________________________',
    '============================================'
  ];

  const content = lines.join('\n');
  const filename = `facture_${facture.nom.replace(/\s/g,'_')}_${facture.time.replace(':','h')}.txt`;
  downloadBlob(content, filename, 'text/plain');
}

/* ---------- sortie ---------- */
const exitOverlay = document.getElementById('exitOverlay');
document.getElementById('exitBtn').onclick = ()=>{ exitOverlay.style.display='flex'; };
document.getElementById('backBtn').onclick = ()=>{ exitOverlay.style.display='none'; };

/* Commande vocale */
function renderVoiceStatus(){
  const el = document.getElementById('voiceBtn');
  el.textContent = voiceEnabled() ? '🔊 Voix : Activée' : '🔇 Voix : Désactivée';
}
document.getElementById('voiceBtn').onclick = ()=>{
  setVoiceEnabled(!voiceEnabled());
  renderVoiceStatus();
  if(!voiceEnabled() && 'speechSynthesis' in window) window.speechSynthesis.cancel();
};

document.getElementById('notifBtn').onclick = ()=> window.AloysNotify && AloysNotify.basculer();

/* initialisation */
refreshChrome();
renderVoiceStatus();
if(window.AloysNotify) AloysNotify.bouton();
