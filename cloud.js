/* =========================================================
   SYNCHRONISATION EN LIGNE (Supabase)
   - comptes utilisateurs, rôles, registre partagé en temps réel
   - les règles de sécurité sont appliquées par le serveur (RLS)
   ========================================================= */
const SUPABASE_URL = "https://bvbxztrifoahygejowhb.supabase.co";
const SUPABASE_KEY = "sb_publishable_vYy564LypO4gasy3poAuYg_Fgjz2oAl";
const CACHE_KEY = "aloys_mgmt_cache_v2";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let CURRENT = null;          // profil connecté {id,email,display_name,role,foyer_id}
let FOYER = null;            // foyer du compte connecté {id,nom,devise,code_invitation}
let PROFILES = [];           // tous les profils visibles
let SYNCED = { tx: new Set(), fac: new Set(), settings: {} };
const SETTING_KEYS = ["target", "budgets", "seuil"];
let OFFLINE_MODE = false;
let syncChain = Promise.resolve();
let realtimeChannel = null;
let reloadTimer = null;

const ROLE_LABELS = { admin: "Administrateur", membre: "Membre", lecture: "Lecture seule", attente: "En attente" };

function rowToTx(r){ return Object.assign({}, r.payload, { id: r.id, type: r.type, person: r.person, amount: Number(r.amount) }); }
function rowToFac(r){ return Object.assign({}, r.payload, { id: r.id, nom: r.nom, montant: Number(r.montant) }); }

function settingValue(k){
  const v = DATA[k];
  if(k === "budgets") return v && Object.keys(v).length ? v : null;
  return v ?? null;
}
function markSynced(){
  SYNCED = {
    tx: new Set(DATA.transactions.map(t => String(t.id))),
    fac: new Set(DATA.factures.map(f => String(f.id))),
    settings: Object.fromEntries(SETTING_KEYS.map(k => [k, JSON.stringify(settingValue(k))]))
  };
}
function writeCache(){
  try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ DATA, PROFILES, FOYER, at: new Date().toISOString() })); }catch(e){}
}

async function fetchAll(){
  const [tx, fac, st, pr, fo] = await Promise.all([
    sb.from("transactions").select("*").order("created_at"),
    sb.from("factures").select("*").order("created_at"),
    sb.from("settings").select("key,value"),
    sb.from("profiles").select("id,email,display_name,role,created_at,foyer_id").order("created_at"),
    sb.from("foyers").select("id,nom,devise,code_invitation").maybeSingle()
  ]);
  const err = tx.error || fac.error || st.error || pr.error || fo.error;
  if(err) throw err;
  const S = Object.fromEntries((st.data || []).map(r => [r.key, r.value]));
  DATA = {
    transactions: tx.data.map(rowToTx),
    factures: fac.data.map(rowToFac),
    target: S.target ?? null,
    budgets: S.budgets || {},
    seuil: S.seuil ?? null
  };
  FOYER = fo.data || null;
  PROFILES = pr.data;
  MEMBERS = PROFILES.filter(p => p.role !== "attente").map(p => p.display_name);
  markSynced();
  writeCache();
}

function canWrite(){ return CURRENT && (CURRENT.role === "admin" || CURRENT.role === "membre") && !OFFLINE_MODE; }
function isAdmin(){ return !!CURRENT && CURRENT.role === "admin"; }

/* Remplace l'ancien enregistrement local : envoie au serveur la différence
   entre l'état affiché (DATA) et le dernier état synchronisé. */
function saveData(){
  syncChain = syncChain.then(pushChanges).catch(() => {});
  return syncChain;
}

async function pushChanges(){
  const txNow = new Map(DATA.transactions.map(t => [String(t.id), t]));
  const facNow = new Map(DATA.factures.map(f => [String(f.id), f]));
  const addTx = [...txNow.keys()].filter(id => !SYNCED.tx.has(id)).map(id => txNow.get(id));
  const delTx = [...SYNCED.tx].filter(id => !txNow.has(id));
  const addFac = [...facNow.keys()].filter(id => !SYNCED.fac.has(id)).map(id => facNow.get(id));
  const delFac = [...SYNCED.fac].filter(id => !facNow.has(id));
  const changedKeys = SETTING_KEYS.filter(k => JSON.stringify(settingValue(k)) !== SYNCED.settings[k]);
  if(!addTx.length && !delTx.length && !addFac.length && !delFac.length && !changedKeys.length) return;

  try{
    if(OFFLINE_MODE || !navigator.onLine) throw new Error("offline");
    if(!canWrite()) throw new Error("readonly");
    if(addFac.length){
      const { error } = await sb.from("factures").insert(addFac.map(f => ({ id: String(f.id), nom: f.nom, montant: f.montant, payload: f })));
      if(error) throw error;
    }
    if(addTx.length){
      const { error } = await sb.from("transactions").insert(addTx.map(t => ({ id: String(t.id), type: t.type, person: t.person, amount: t.amount, payload: t })));
      if(error) throw error;
    }
    if(delTx.length){
      const { data, error } = await sb.from("transactions").delete().in("id", delTx).select("id");
      if(error) throw error;
      if((data || []).length < delTx.length) throw new Error("denied");
    }
    if(delFac.length){
      const { data, error } = await sb.from("factures").delete().in("id", delFac).select("id");
      if(error) throw error;
      if((data || []).length < delFac.length) throw new Error("denied");
    }
    for(const k of changedKeys){
      const v = settingValue(k);
      const res = v === null
        ? await sb.from("settings").delete().eq("key", k)
        : await sb.from("settings").upsert({ foyer_id: FOYER && FOYER.id, key: k, value: v }, { onConflict: "foyer_id,key" });
      if(res.error) throw res.error;
    }
    markSynced();
    writeCache();
  }catch(e){
    const reason =
      e.message === "offline"  ? "Hors connexion : la modification n'a pas été enregistrée." :
      e.message === "readonly" ? "Votre compte est en lecture seule : modification impossible." :
      (e.message === "denied" || /row-level security|permission/i.test(e.message || ""))
                               ? "Action réservée : le serveur a refusé cette modification." :
                                 "Erreur d'enregistrement : " + (e.message || e);
    showToast(reason, "err");
    await reloadFromServer();
  }
}

async function reloadFromServer(){
  try{
    await fetchAll();
    OFFLINE_MODE = false;
    setOfflineBanner(false);
  }catch(e){
    loadCache();
  }
  CURRENT = PROFILES.find(p => CURRENT && p.id === CURRENT.id) || CURRENT;
  ADMIN_UNLOCKED = isAdmin();
  populateMembers();
  refreshChrome();
  const live = ["status", "database", "cash", "stats", "charts", "forecast", "consumed", "audit", "members", "equilibre", "budgets", "facture"];
  if(currentPanel && live.includes(currentPanel)) renderPanel(currentPanel, true);
  if(window.AloysNotify) AloysNotify.apresRechargement();
}
function scheduleReload(){
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { syncChain = syncChain.then(reloadFromServer); }, 400);
}
function loadCache(){
  try{
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if(c && c.DATA){
      DATA = Object.assign({ budgets: {}, seuil: null }, c.DATA); PROFILES = c.PROFILES || []; FOYER = c.FOYER || null;
      MEMBERS = PROFILES.filter(p => p.role !== "attente").map(p => p.display_name);
      markSynced();
    }
  }catch(e){}
  OFFLINE_MODE = true;
  setOfflineBanner(true);
}

/* ---------- interface : connexion ---------- */
function showToast(text, kind = "ok"){
  const t = document.getElementById("toast");
  t.textContent = text;
  t.className = "toast show " + kind;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = "toast"; }, 5000);
}
function setOfflineBanner(on){
  document.getElementById("offlineBanner").style.display = on ? "block" : "none";
}
function showLogin(mode = "login"){
  document.getElementById("authOverlay").style.display = "flex";
  document.getElementById("pendingBox").style.display = "none";
  document.getElementById("authBox").style.display = "";
  setAuthMode(mode);
}
function hideLogin(){ document.getElementById("authOverlay").style.display = "none"; }
function setAuthMode(mode){
  const box = document.getElementById("authBox");
  box.dataset.mode = mode;
  document.getElementById("authNameField").style.display = mode === "signup" ? "" : "none";
  document.getElementById("authFoyerField").style.display = mode === "signup" ? "" : "none";
  document.getElementById("authSubmit").textContent = mode === "signup" ? "Créer mon compte" : "Se connecter";
  document.getElementById("authSwitch").textContent = mode === "signup" ? "J'ai déjà un compte" : "Créer un compte";
  document.getElementById("authTitle").textContent = mode === "signup" ? "Créer un compte" : "Connexion";
  authMsg("", "");
}
function authMsg(text, kind){
  const m = document.getElementById("authMsg");
  m.textContent = text;
  m.className = text ? "msg show " + kind : "msg";
}
function appUrl(){ return location.origin + location.pathname; }

async function submitAuth(){
  const mode = document.getElementById("authBox").dataset.mode;
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const name = document.getElementById("authName").value.trim();
  if(!email || !password){ authMsg("Saisissez votre e-mail et votre mot de passe.", "err"); return; }
  if(mode === "signup"){
    if(name.length < 3){ authMsg("Saisissez votre nom complet (ex. MINYURANO Aloys).", "err"); return; }
    if(password.length < 8){ authMsg("Mot de passe : 8 caractères minimum.", "err"); return; }
    const meta = { display_name: name };
    const foyerMode = (document.querySelector('input[name="foyerMode"]:checked') || {}).value || "join";
    if(foyerMode === "create"){
      const fn = document.getElementById("authFoyerNom").value.trim();
      if(fn.length < 2){ authMsg("Donnez un nom à votre foyer (ex. Coloc Tanger centre).", "err"); return; }
      meta.foyer_nom = fn;
      meta.devise = document.getElementById("authDevise").value;
    }else{
      const code = document.getElementById("authCode").value.trim().toUpperCase();
      if(!/^[0-9A-F]{8}$/.test(code)){ authMsg("Le code d'invitation comporte 8 caractères (chiffres et lettres A à F).", "err"); return; }
      const { data: nomFoyer, error: e1 } = await sb.rpc("foyer_par_code", { code });
      if(e1){ authMsg(traduireErreur(e1.message), "err"); return; }
      if(!nomFoyer){ authMsg("Code d'invitation inconnu : vérifiez-le auprès de l'administrateur.", "err"); return; }
      meta.foyer_code = code;
    }
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: meta, emailRedirectTo: appUrl() }
    });
    if(error){ authMsg(traduireErreur(error.message), "err"); return; }
    if(!data.session){
      authMsg("Compte créé. Ouvrez l'e-mail de confirmation que vous venez de recevoir, puis connectez-vous.", "ok");
      setTimeout(() => setAuthMode("login"), 6000);
    }
  }else{
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ authMsg(traduireErreur(error.message), "err"); return; }
  }
}
async function forgotPassword(){
  const email = document.getElementById("authEmail").value.trim();
  if(!email){ authMsg("Saisissez d'abord votre e-mail, puis cliquez sur « Mot de passe oublié ».", "err"); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  authMsg(error ? traduireErreur(error.message) : "Un lien de réinitialisation vient d'être envoyé à " + email + ".", error ? "err" : "ok");
}
function traduireErreur(m){
  if(/Invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
  if(/Email not confirmed/i.test(m)) return "Confirmez d'abord votre e-mail (lien reçu par e-mail).";
  if(/already registered/i.test(m)) return "Un compte existe déjà avec cet e-mail : connectez-vous.";
  if(/rate limit/i.test(m)) return "Trop de tentatives : réessayez dans quelques minutes.";
  if(/Password should/i.test(m)) return "Mot de passe trop faible (8 caractères minimum).";
  return m;
}

/* ---------- après connexion ---------- */
async function onSignedIn(user){
  try{
    await fetchAll();
    OFFLINE_MODE = false; setOfflineBanner(false);
  }catch(e){
    loadCache();
  }
  CURRENT = PROFILES.find(p => p.id === user.id) || null;
  if(!CURRENT){
    const { data } = await sb.from("profiles").select("id,email,display_name,role").eq("id", user.id).maybeSingle();
    CURRENT = data;
  }
  if(!CURRENT || CURRENT.role === "attente"){
    document.getElementById("authOverlay").style.display = "flex";
    document.getElementById("authBox").style.display = "none";
    document.getElementById("pendingBox").style.display = "";
    document.getElementById("pendingName").textContent = CURRENT ? CURRENT.display_name : user.email;
    document.getElementById("pendingFoyer").textContent = FOYER ? ` du foyer « ${FOYER.nom} »` : "";
    return;
  }
  hideLogin();
  ADMIN_UNLOCKED = isAdmin();
  populateMembers();
  renderUserBadge();
  refreshChrome();
  subscribeRealtime();
  offerLocalImport();
}
function renderUserBadge(){
  const el = document.getElementById("userBadge");
  el.innerHTML = `${avatarHTML(CURRENT.display_name, "sm")} <b>${esc(CURRENT.display_name)}</b> · ${ROLE_LABELS[CURRENT.role] || CURRENT.role}${FOYER ? ` · <span title="Foyer">🏠 ${esc(FOYER.nom)}</span>` : ""}`;
  document.getElementById("headerMembers").textContent = MEMBERS.join(", ");
}
function populateMembers(){
  const sel = document.getElementById("activeMember");
  const current = isAdmin() ? (sel.value || (CURRENT && CURRENT.display_name)) : (CURRENT && CURRENT.display_name);
  sel.innerHTML = MEMBERS.map(m => `<option>${m}</option>`).join("");
  if(current && MEMBERS.includes(current)) sel.value = current;
  sel.disabled = !isAdmin();
  sel.title = isAdmin() ? "L'administrateur peut saisir au nom d'un membre" : "Vous saisissez en votre nom";
  const hm = document.getElementById("headerMembers");
  if(hm) hm.textContent = MEMBERS.join(", ");
}
function subscribeRealtime(){
  if(realtimeChannel) return;
  realtimeChannel = sb.channel("registre")
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, ch => { if(window.AloysNotify) AloysNotify.surChangement(ch); scheduleReload(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "foyers" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "factures" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleReload)
    .subscribe();
}
async function signOut(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  await sb.auth.signOut();
  CURRENT = null; FOYER = null; DATA = { transactions: [], factures: [], target: null, budgets: {}, seuil: null }; markSynced();
  ADMIN_UNLOCKED = false;
  panelHost.innerHTML = "";
  refreshChrome();
  showLogin();
}

/* Import des données enregistrées sur cet appareil avec l'ancienne version */
function offerLocalImport(){
  const banner = document.getElementById("importBanner");
  banner.style.display = "none";
  if(!isAdmin()) return;
  let old = null;
  try{ old = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }catch(e){}
  if(!old || !Array.isArray(old.transactions) || !old.transactions.length) return;
  const known = new Set(DATA.transactions.map(t => String(t.id)));
  const fresh = old.transactions.filter(t => !known.has(String(t.id)));
  if(!fresh.length) return;
  banner.style.display = "flex";
  banner.querySelector("span").textContent =
    `${fresh.length} transaction(s) de l'ancienne version sont enregistrées sur cet appareil.`;
  banner.querySelector("button").onclick = async () => {
    const knownF = new Set(DATA.factures.map(f => String(f.id)));
    DATA.transactions = DATA.transactions.concat(fresh);
    DATA.factures = DATA.factures.concat((old.factures || []).filter(f => !knownF.has(String(f.id))));
    if(DATA.target === null && old.target) DATA.target = old.target;
    await saveData();
    localStorage.setItem(STORE_KEY + "_importe", localStorage.getItem(STORE_KEY));
    localStorage.removeItem(STORE_KEY);
    banner.style.display = "none";
    refreshChrome();
    showToast("Données de cet appareil importées dans le registre en ligne.");
  };
}

/* ---------- reçus (Supabase Storage, dossier privé du foyer) ---------- */
async function compresserImage(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.82));
  return blob && blob.size < file.size ? new File([blob], "recu.jpg", { type: "image/jpeg" }) : file;
}
async function uploadRecu(file, factureId){
  if(!FOYER) throw new Error("foyer inconnu");
  if(OFFLINE_MODE || !navigator.onLine) throw new Error("hors connexion");
  const f = await compresserImage(file);
  if(f.size > 5 * 1024 * 1024) throw new Error("fichier trop lourd (5 Mo maximum)");
  const ext = f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
  const path = `${FOYER.id}/${String(factureId).replace(/[^0-9]/g, "")}.${ext}`;
  const { error } = await sb.storage.from("recus").upload(path, f, { contentType: f.type, upsert: false });
  if(error) throw error;
  return path;
}
async function openRecu(path){
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("recus").createSignedUrl(path, 120);
  if(error || !data){ if(w) w.close(); showToast("Reçu inaccessible : " + (error ? error.message : "introuvable"), "err"); return; }
  if(w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

/* ---------- panneaux administrateur ---------- */
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }

function panelMembers(root){
  if(!isAdmin()){ root.innerHTML = `<h2>👥 Membres</h2><p class="role">Réservé à l'administrateur.</p>`; return; }
  const rows = PROFILES.map(p => `
    <tr data-id="${p.id}">
      <td>${avatarHTML(p.display_name, "sm")}</td>
      <td><input class="m-name" value="${esc(p.display_name)}" ${p.id === CURRENT.id ? "" : ""}></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;">${esc(p.email)}</td>
      <td>
        <select class="m-role" ${p.id === CURRENT.id ? "disabled title=\"Vous ne pouvez pas retirer votre propre rôle d'administrateur\"" : ""}>
          ${["attente", "membre", "lecture", "admin"].map(r => `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}
        </select>
      </td>
      <td><button class="btn m-save" style="padding:5px 12px;font-size:12px;">Enregistrer</button></td>
    </tr>`).join("");
  const pending = PROFILES.filter(p => p.role === "attente").length;
  const devOpts = Object.keys(DEVISE_NOMS).map(d => `<option value="${d}" ${FOYER && FOYER.devise === d ? "selected" : ""}>${d} — ${DEVISE_NOMS[d]}</option>`).join("");
  root.innerHTML = `
    <h2>👥 Foyer, membres et rôles</h2>
    ${FOYER ? `<div class="foyer-card">
      <div class="row">
        <div class="field"><label>Nom du foyer</label><input id="fNom" value="${esc(FOYER.nom)}" maxlength="80"></div>
        <div class="field"><label>Devise</label><select id="fDev">${devOpts}</select></div>
        <button class="btn" id="fSave">Enregistrer</button>
      </div>
      <div class="foyer-code">Code d'invitation : <b id="fCode">${esc(FOYER.code_invitation)}</b>
        <button class="btn secondary" id="fCopy" style="padding:5px 12px;font-size:12px;">Copier l'invitation</button>
        <button class="btn secondary" id="fRegen" style="padding:5px 12px;font-size:12px;">Nouveau code</button></div>
      <small class="hint">Vos colocataires choisissent « Rejoindre un foyer » à l'inscription et saisissent ce code. Changez-le si quelqu'un d'extérieur l'a obtenu.</small>
      <div class="msg" id="foyerMsg"></div>
    </div>` : ""}
    <p class="role">Chaque personne crée son compte depuis l'écran de connexion. Elle apparaît ici <b>en attente</b> : choisissez son rôle pour lui donner accès.
    ${pending ? `<br><b style="color:var(--gold-light)">${pending} compte(s) en attente de validation.</b>` : ""}</p>
    <div class="tablewrap"><table class="dbtable">
      <thead><tr><th></th><th>Nom affiché</th><th>E-mail</th><th>Rôle</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="explain" style="margin-top:12px;">
      <b>Administrateur</b> : tout faire · <b>Membre</b> : saisir en son nom, tout consulter ·
      <b>Lecture seule</b> : consulter · <b>En attente</b> : aucun accès.
    </div>
    <div class="msg" id="membersMsg"></div>`;
  const fm = root.querySelector("#foyerMsg");
  const fSave = root.querySelector("#fSave");
  if(fSave) fSave.onclick = async () => {
    const nom = root.querySelector("#fNom").value.trim(), devise = root.querySelector("#fDev").value;
    if(nom.length < 2){ fm.className = "msg err show"; fm.textContent = "Nom trop court."; return; }
    const { data, error } = await sb.from("foyers").update({ nom, devise }).eq("id", FOYER.id).select("id");
    if(error || !data || !data.length){ fm.className = "msg err show"; fm.textContent = "Modification refusée : " + (error ? error.message : "droits insuffisants"); return; }
    fm.className = "msg ok show"; fm.textContent = "Foyer mis à jour.";
    await reloadFromServer(); renderUserBadge();
  };
  const fCopy = root.querySelector("#fCopy");
  if(fCopy) fCopy.onclick = () => {
    const txt = `Rejoins notre foyer « ${FOYER.nom} » sur ALOYS MANAGEMENT : ${appUrl()}\nCrée ton compte, choisis « Rejoindre un foyer » et saisis le code ${FOYER.code_invitation}.`;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
      () => showToast("Invitation copiée : collez-la dans WhatsApp."), () => showToast("Copie impossible sur cet appareil.", "err"));
  };
  const fRegen = root.querySelector("#fRegen");
  if(fRegen) fRegen.onclick = async () => {
    if(!confirm("Créer un nouveau code ? L'ancien ne fonctionnera plus.")) return;
    const { data, error } = await sb.rpc("regenerer_code_invitation");
    if(error){ fm.className = "msg err show"; fm.textContent = error.message; return; }
    FOYER.code_invitation = data; root.querySelector("#fCode").textContent = data;
    fm.className = "msg ok show"; fm.textContent = "Nouveau code créé.";
  };
  root.querySelectorAll(".m-save").forEach(btn => {
    btn.onclick = async () => {
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const display_name = tr.querySelector(".m-name").value.trim();
      const roleSel = tr.querySelector(".m-role");
      const update = { display_name };
      if(!roleSel.disabled) update.role = roleSel.value;
      const msg = root.querySelector("#membersMsg");
      if(display_name.length < 3){ msg.className = "msg err show"; msg.textContent = "Nom trop court."; return; }
      const { data, error } = await sb.from("profiles").update(update).eq("id", id).select("id");
      if(error || !data || !data.length){
        msg.className = "msg err show"; msg.textContent = "Modification refusée : " + (error ? error.message : "droits insuffisants");
        return;
      }
      msg.className = "msg ok show"; msg.textContent = "Membre mis à jour.";
      await reloadFromServer();
      if(CURRENT) renderUserBadge();
    };
  });
}

async function panelAudit(root){
  if(!isAdmin()){ root.innerHTML = `<h2>📜 Journal d'audit</h2><p class="role">Réservé à l'administrateur.</p>`; return; }
  root.innerHTML = `<h2>📜 Journal d'audit</h2><p class="role">Toutes les opérations enregistrées par le serveur : qui, quoi, quand. Ce journal ne peut pas être modifié.</p><div id="auditBody">Chargement…</div>`;
  const { data, error } = await sb.from("audit_log").select("*").order("id", { ascending: false }).limit(300);
  const body = root.querySelector("#auditBody");
  if(!body) return;
  if(error){ body.innerHTML = `<div class="msg err show">${esc(error.message)}</div>`; return; }
  if(!data.length){ body.innerHTML = `<div class="explain">Aucune opération enregistrée pour le moment.</div>`; return; }
  const ACT = { INSERT: "Ajout", DELETE: "Suppression", UPDATE: "Modification" };
  const TBL = { transactions: "Transaction", factures: "Facture", settings: "Paramètre", profiles: "Membre" };
  const detail = r => {
    const d = r.details || {};
    const x = d.apres || d;
    if(r.table_name === "transactions") return `${x.type === "deposit" ? "Dépôt" : "Dépense"} · ${esc(x.person)} · ${fmt(Number(x.amount))} ${DEV()}`;
    if(r.table_name === "factures") return `${esc(x.nom)} · ${fmt(Number(x.montant))} ${DEV()}`;
    if(r.table_name === "settings"){
      if(x.key === "budgets") return "Budgets mensuels mis à jour";
      if(x.key === "seuil") return x.value ? `Seuil d'alerte : ${fmt(Number(x.value.montant))} ${DEV()}` : "Seuil d'alerte supprimé";
      return x.value && x.value.amount ? `Objectif : ${fmt(Number(x.value.amount))} ${DEV()}` : "Objectif supprimé";
    }
    if(r.table_name === "profiles") return `${esc(x.display_name)} → ${ROLE_LABELS[x.role] || esc(x.role)}`;
    return "";
  };
  body.innerHTML = `<div class="tablewrap"><table class="dbtable">
    <thead><tr><th>Date</th><th>Par</th><th>Action</th><th>Élément</th><th>Détail</th></tr></thead>
    <tbody>${data.map(r => `<tr>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;">${new Date(r.at).toLocaleString("fr-FR")}</td>
      <td>${esc(r.user_name || "—")}</td>
      <td>${ACT[r.action] || r.action}</td>
      <td>${TBL[r.table_name] || r.table_name}</td>
      <td>${detail(r)}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------- démarrage ---------- */
async function bootCloud(){
  document.getElementById("authSubmit").onclick = submitAuth;
  document.getElementById("authPassword").addEventListener("keydown", e => { if(e.key === "Enter") submitAuth(); });
  document.getElementById("authSwitch").onclick = () => setAuthMode(document.getElementById("authBox").dataset.mode === "signup" ? "login" : "signup");
  document.getElementById("authForgot").onclick = forgotPassword;
  document.querySelectorAll('input[name="foyerMode"]').forEach(r => r.onchange = () => {
    const create = document.querySelector('input[name="foyerMode"]:checked').value === "create";
    document.getElementById("foyerCreate").style.display = create ? "" : "none";
    document.getElementById("foyerJoin").style.display = create ? "none" : "";
    authMsg("", "");
  });
  document.getElementById("authCode").addEventListener("input", async e => {
    const code = e.target.value.trim().toUpperCase(), hint = document.getElementById("authCodeHint");
    if(!/^[0-9A-F]{8}$/.test(code)){ hint.textContent = "Demandez le code à l'administrateur de votre foyer."; return; }
    const { data } = await sb.rpc("foyer_par_code", { code });
    hint.textContent = data ? `✅ Foyer trouvé : « ${data} »` : "❌ Code inconnu.";
  });
  document.getElementById("logoutBtn").onclick = signOut;
  document.getElementById("pendingLogout").onclick = signOut;
  window.addEventListener("online", () => { if(CURRENT) scheduleReload(); });
  window.addEventListener("offline", () => { OFFLINE_MODE = true; setOfflineBanner(true); });

  sb.auth.onAuthStateChange((event, session) => {
    if(event === "PASSWORD_RECOVERY"){
      setTimeout(async () => {
        const pw = prompt("Choisissez votre nouveau mot de passe (8 caractères minimum) :");
        if(pw && pw.length >= 8){
          const { error } = await sb.auth.updateUser({ password: pw });
          showToast(error ? traduireErreur(error.message) : "Mot de passe modifié.", error ? "err" : "ok");
        }
      }, 0);
    }
    if(event === "SIGNED_IN" && session && (!CURRENT || CURRENT.id !== session.user.id)){
      setTimeout(() => onSignedIn(session.user), 0);
    }
  });
  const { data: { session } } = await sb.auth.getSession();
  if(session) await onSignedIn(session.user);
  else showLogin();
}

if("serviceWorker" in navigator && location.protocol === "https:"){
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

bootCloud();
