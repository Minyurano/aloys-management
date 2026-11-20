/* =====================================================================
   ALOYS MANAGEMENT — Fonctionnalités avancées
   12 · Équilibre : qui doit combien à qui (règlement en un minimum de virements)
   13 · Budgets et alertes : budget mensuel par catégorie, projection de fin de mois
   14 · Assistant : questions en français sur le registre (analyse locale)
   15 · Rapport mensuel PDF
   Notifications : nouvelles opérations des autres membres, seuil de caisse, budgets
   ===================================================================== */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const C_IN = '#199e70', C_OUT = '#d95926', C_TEXT = '#E8ECF1', C_MUTED = '#8CA0BC', C_GRID = 'rgba(140,160,188,0.14)';

  /* ---------- accès aux données de l'application (protégé pour les tests) ---------- */
  const G = {
    data()    { try { return DATA; } catch (e) { return { transactions: [], factures: [] }; } },
    members() { try { return MEMBERS; } catch (e) { return []; } },
    me()      { try { return CURRENT; } catch (e) { return null; } },
    foyer()   { try { return FOYER; } catch (e) { return null; } },
    admin()   { try { return isAdmin(); } catch (e) { return false; } }
  };
  const DEV = () => (typeof root.DEV === 'function' ? root.DEV() : 'MAD');
  const fmtM = v => (typeof root.fmt === 'function' ? root.fmt(v)
    : (Number(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const money = v => `${fmtM(v)} ${DEV()}`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
  const sum = a => a.reduce((s, v) => s + v, 0);
  const pct = v => (isFinite(v) ? (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '—');
  const CAT = () => root.AloysCategories;
  const catOf = t => (CAT() ? CAT().categorieDe(t) : (t.categorie || 'autre'));

  function txList(src) {
    return ((src || G.data()).transactions || [])
      .filter(t => t && t.iso && isFinite(Number(t.amount)))
      .map(t => ({ ...t, amount: Number(t.amount), ts: new Date(t.iso).getTime() }))
      .sort((a, b) => a.ts - b.ts);
  }
  function personsOf(tx, members) {
    const set = new Set(tx.map(t => t.person));
    const out = (members || []).slice();
    set.forEach(p => { if (!out.includes(p)) out.push(p); });
    return out;
  }

  /* =====================================================================
     12 · Équilibre des contributions
     ===================================================================== */
  function positions(tx, members, mode) {
    const persons = personsOf(tx, members);
    const dep = p => sum(tx.filter(t => t.type === 'deposit' && t.person === p).map(t => t.amount));
    const out = p => sum(tx.filter(t => t.type === 'consumption' && t.person === p).map(t => t.amount));
    const totalDep = sum(persons.map(dep)), totalOut = sum(persons.map(out));
    const useProrata = mode === 'prorata' && totalOut > 0;
    return {
      mode: useProrata ? 'prorata' : 'egal', totalDep, totalOut,
      rows: persons.map(p => {
        const target = useProrata ? totalDep * out(p) / totalOut : (persons.length ? totalDep / persons.length : 0);
        return { p, dep: dep(p), out: out(p), target, solde: dep(p) - target };
      })
    };
  }
  // Règlement glouton : au plus n-1 virements, chaque débiteur paie les plus gros créanciers
  function regler(rows) {
    const cred = rows.filter(r => r.solde > 0.005).map(r => ({ p: r.p, v: r.solde })).sort((a, b) => b.v - a.v);
    const debt = rows.filter(r => r.solde < -0.005).map(r => ({ p: r.p, v: -r.solde })).sort((a, b) => b.v - a.v);
    const out = []; let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const m = Math.min(debt[i].v, cred[j].v);
      if (m > 0.005) out.push({ de: debt[i].p, a: cred[j].p, montant: Math.round(m * 100) / 100 });
      debt[i].v -= m; cred[j].v -= m;
      if (debt[i].v < 0.005) i++;
      if (cred[j].v < 0.005) j++;
    }
    return out;
  }

  let modeEquilibre = 'egal';
  let chartEq = null;
  function panelEquilibre(rootEl) {
    if (chartEq) { try { chartEq.destroy(); } catch (e) { /* */ } chartEq = null; }
    const tx = txList();
    const pos = positions(tx, G.members(), modeEquilibre);
    const transfers = regler(pos.rows);
    const maxDep = Math.max(0, ...pos.rows.map(r => r.dep));
    rootEl.innerHTML = `
      <h2>⚖️ Équilibre des contributions</h2>
      <p class="role">Qui a versé plus ou moins que sa part, et <b>qui doit combien à qui</b> pour que tout le monde soit à égalité.
      Les virements proposés sont calculés pour être <b>les moins nombreux possible</b>.</p>
      <div class="an-filters" role="group" aria-label="Règle de partage">
        <button type="button" class="an-chip${pos.mode === 'egal' ? ' on' : ''}" data-mode="egal">Parts égales</button>
        <button type="button" class="an-chip${pos.mode === 'prorata' ? ' on' : ''}" data-mode="prorata">Selon ce que chacun dépense</button>
      </div>
      ${modeEquilibre === 'prorata' && pos.mode !== 'prorata' ? `<div class="explain" style="margin:0 0 12px">Aucune dépense enregistrée : le partage se fait à parts égales.</div>` : ''}
      ${!pos.rows.length ? `<div class="explain">Aucun membre ni opération pour le moment.</div>` : `
      <div class="tablewrap"><table>
        <thead><tr><th>Membre</th><th>A déposé</th><th>A dépensé</th><th>Part attendue</th><th>Solde</th></tr></thead>
        <tbody>${pos.rows.map(r => `<tr>
          <td><span class="avatar-wrap">${typeof root.avatarHTML === 'function' ? root.avatarHTML(r.p, 'sm') : ''} ${esc(r.p)}</span></td>
          <td>${fmtM(r.dep)}</td><td>${fmtM(r.out)}</td><td>${fmtM(r.target)}</td>
          <td style="color:${r.solde >= 0 ? C_IN : C_OUT};font-weight:600">${r.solde >= 0 ? '+' : '−'}${fmtM(Math.abs(r.solde))}</td></tr>`).join('')}</tbody>
      </table></div>
      <section class="an-card" style="margin-top:14px"><h3>Solde de chaque membre</h3>
        <p class="an-sub">À droite : a versé plus que sa part. À gauche : doit encore contribuer.</p>
        <div class="an-canvas" style="height:${Math.max(160, pos.rows.length * 46)}px"><canvas id="eqChart"></canvas></div></section>
      <h3 class="an-h">Règlement proposé</h3>
      ${transfers.length ? `<div class="eq-list">${transfers.map(t => `<div class="eq-item">
          <span>${esc(t.de)}</span><span class="eq-arrow">verse</span><b>${money(t.montant)}</b><span class="eq-arrow">à</span><span>${esc(t.a)}</span></div>`).join('')}</div>
        <div class="explain"><b>Autre option :</b> au lieu de se rembourser entre vous, chacun peut déposer dans la caisse
        ce qui lui manque pour rattraper le plus gros contributeur :
        ${pos.rows.filter(r => maxDep - r.dep > 0.005).map(r => `${esc(r.p)} <b>${money(maxDep - r.dep)}</b>`).join(' · ') || '—'}.</div>
        <button class="btn secondary" id="eqCopy" style="margin-top:10px">Copier le récapitulatif (WhatsApp)</button>`
        : `<div class="explain">✅ Tout le monde est à égalité : aucun virement nécessaire.</div>`}`}
    `;
    rootEl.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { modeEquilibre = b.dataset.mode; panelEquilibre(rootEl); });
    const copy = rootEl.querySelector('#eqCopy');
    if (copy) copy.onclick = () => {
      const f = G.foyer();
      const txt = [`Équilibre de la caisse${f ? ' — ' + f.nom : ''} (${pos.mode === 'egal' ? 'parts égales' : 'selon les dépenses'})`]
        .concat(transfers.map(t => `• ${t.de} → ${t.a} : ${money(t.montant)}`)).join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
        () => toast('Récapitulatif copié : collez-le dans WhatsApp.'),
        () => toast('Copie impossible sur cet appareil.', 'err'));
    };
    const cv = rootEl.querySelector('#eqChart');
    if (cv && root.Chart) {
      chartEq = new Chart(cv.getContext('2d'), {
        type: 'bar',
        data: { labels: pos.rows.map(r => r.p), datasets: [{ label: 'Solde', data: pos.rows.map(r => Math.round(r.solde * 100) / 100),
          backgroundColor: pos.rows.map(r => (r.solde >= 0 ? C_IN : C_OUT)), borderRadius: 4, maxBarThickness: 26 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.x >= 0 ? 'Avance' : 'Manque'} : ${money(Math.abs(c.parsed.x))}` } } },
          scales: {
            x: { ticks: { color: C_MUTED, callback: v => Number(v).toLocaleString('fr-FR') }, grid: { color: c => (c.tick && c.tick.value === 0 ? C_MUTED : C_GRID) } },
            y: { ticks: { color: C_TEXT }, grid: { display: false } }
          }
        }
      });
    }
  }

  /* =====================================================================
     13 · Budgets mensuels et alertes
     ===================================================================== */
  function etatBudgets(tx, budgets, now) {
    now = now || new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const start = new Date(y, m, 1).getTime(), daysIn = new Date(y, m + 1, 0).getDate();
    const elapsed = Math.max(1, Math.floor((now.getTime() - start) / DAY) + 1);
    const month = tx.filter(t => t.type === 'consumption' && t.ts >= start && t.ts <= now.getTime());
    const cats = CAT() ? CAT().CATEGORIES.map(c => c.id) : Object.keys(budgets || {});
    return cats.map(id => {
      const spent = sum(month.filter(t => catOf(t) === id).map(t => t.amount));
      const budget = Number((budgets || {})[id]) || 0;
      const rate = spent / elapsed, proj = rate * daysIn;
      let statut = 'libre', jour = null;
      if (budget > 0) {
        if (spent > budget) statut = 'depasse';
        else if (proj > budget) { statut = 'risque'; jour = Math.min(daysIn, Math.ceil(budget / (rate || 1e-9))); }
        else if (proj > 0.9 * budget) statut = 'surveiller';
        else statut = 'ok';
      }
      return { id, spent, budget, proj, statut, jour, fragile: elapsed < 5 };
    }).filter(r => r.budget > 0 || r.spent > 0);
  }

  function panelBudgets(rootEl) {
    const d = G.data();
    const budgets = d.budgets || {};
    const seuil = d.seuil && isFinite(d.seuil.montant) ? Number(d.seuil.montant) : null;
    const now = new Date();
    const etat = etatBudgets(txList(), budgets, now);
    const admin = G.admin();
    const C = CAT();
    const lab = id => (C ? C.libelle(id) : id);
    const bal = typeof root.balance === 'function' ? root.balance() : 0;
    const alerts = [];
    if (seuil !== null && bal < seuil) alerts.push(`💰 La caisse (${money(bal)}) est <b>sous le seuil d'alerte</b> de ${money(seuil)}.`);
    etat.forEach(r => {
      if (r.statut === 'depasse') alerts.push(`${lab(r.id)} : budget <b>dépassé</b> (${money(r.spent)} pour ${money(r.budget)}).`);
      if (r.statut === 'risque') alerts.push(`${lab(r.id)} : à ce rythme, le budget sera <b>dépassé vers le ${r.jour} ${MOIS_FR[now.getMonth()]}</b> (projection ${money(r.proj)}).`);
    });
    const BADGE = { ok: ['✅', 'Dans le budget'], surveiller: ['🟡', 'À surveiller'], risque: ['🟠', 'Dépassement prévu'], depasse: ['🔴', 'Dépassé'], libre: ['➖', 'Sans budget'] };
    rootEl.innerHTML = `
      <h2>🎯 Budgets et alertes</h2>
      <p class="role">Budget mensuel par catégorie, dépenses du mois de <b>${MOIS_FR[now.getMonth()]} ${now.getFullYear()}</b> et
      <b>projection de fin de mois</b> au rythme actuel. ${admin ? 'Vous pouvez modifier les budgets en bas de page.' : 'Seul l\'administrateur modifie les budgets.'}</p>
      ${alerts.length ? `<div class="bud-alerts">${alerts.map(a => `<div>${a}</div>`).join('')}</div>` : `<div class="explain" style="margin-top:0">✅ Aucune alerte en cours.</div>`}
      ${etat.length ? `<div class="bud-list">${etat.map(r => {
        const ref = r.budget || Math.max(r.proj, r.spent) || 1;
        const w = Math.min(100, r.spent / ref * 100), wp = Math.min(100, r.proj / ref * 100);
        return `<div class="bud-row">
          <div class="bud-head"><span>${lab(r.id)}</span><span class="bud-badge s-${r.statut}">${BADGE[r.statut][0]} ${BADGE[r.statut][1]}</span></div>
          <div class="bud-bar" role="img" aria-label="${esc(lab(r.id))} : ${money(r.spent)} dépensés${r.budget ? ' sur ' + money(r.budget) : ''}">
            <div class="bud-proj" style="width:${wp}%"></div><div class="bud-fill s-${r.statut}" style="width:${w}%"></div></div>
          <div class="bud-meta">${money(r.spent)} dépensés${r.budget ? ` sur ${money(r.budget)}` : ''} · projection fin de mois ${money(r.proj)}${r.fragile ? ' (début de mois : estimation fragile)' : ''}</div>
        </div>`;
      }).join('')}</div>` : `<div class="explain">Aucune dépense ce mois-ci et aucun budget défini.</div>`}
      ${admin ? `
      <h3 class="an-h">Définir les budgets mensuels (${DEV()})</h3>
      <div class="bud-form">${(C ? C.CATEGORIES : []).map(c => `<label class="field"><span>${c.icon} ${c.label}</span>
        <input type="number" min="0" step="10" data-bud="${c.id}" value="${budgets[c.id] || ''}" placeholder="aucun"></label>`).join('')}
        <label class="field"><span>💰 Seuil d'alerte de la caisse</span><input type="number" min="0" step="10" id="budSeuil" value="${seuil ?? ''}" placeholder="aucun"></label>
      </div>
      <button class="btn" id="budSave" style="margin-top:12px">Enregistrer les budgets</button><div class="msg" id="budMsg"></div>` : ''}
      <p class="an-method">Méthode : projection linéaire (dépenses du mois ÷ jours écoulés × jours du mois).
      Le trait clair sur chaque barre montre la projection, la partie colorée ce qui est déjà dépensé.</p>`;
    const save = rootEl.querySelector('#budSave');
    if (save) save.onclick = async () => {
      const nb = {};
      rootEl.querySelectorAll('[data-bud]').forEach(i => { const v = parseFloat(i.value); if (v > 0) nb[i.dataset.bud] = Math.round(v * 100) / 100; });
      const s = parseFloat(rootEl.querySelector('#budSeuil').value);
      d.budgets = nb;
      d.seuil = s > 0 ? { montant: Math.round(s * 100) / 100 } : null;
      if (typeof root.saveData === 'function') await root.saveData(d);
      const msg = rootEl.querySelector('#budMsg');
      if (msg) { msg.className = 'msg ok show'; msg.textContent = 'Budgets enregistrés pour tout le foyer.'; }
      setTimeout(() => panelBudgets(rootEl), 600);
    };
  }

  /* =====================================================================
     14 · Assistant : questions en langage naturel
     ===================================================================== */
  function periode(q, now) {
    now = now || new Date();
    const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate();
    const day0 = new Date(Y, M, D).getTime();
    const end = now.getTime();
    let m;
    if (/aujourd'?hui/.test(q)) return { from: day0, to: end, label: "aujourd'hui" };
    if (/\bhier\b/.test(q)) return { from: day0 - DAY, to: day0 - 1, label: 'hier' };
    if (/semaine (derniere|passee)/.test(q)) { const dow = (now.getDay() + 6) % 7, mon = day0 - dow * DAY; return { from: mon - 7 * DAY, to: mon - 1, label: 'la semaine dernière' }; }
    if (/cette semaine/.test(q)) { const dow = (now.getDay() + 6) % 7; return { from: day0 - dow * DAY, to: end, label: 'cette semaine' }; }
    if (/mois (dernier|passe|precedent)/.test(q)) return { from: new Date(Y, M - 1, 1).getTime(), to: new Date(Y, M, 1).getTime() - 1, label: `en ${MOIS_FR[(M + 11) % 12]}` };
    if (/ce mois|du mois|mois-ci|mois en cours/.test(q)) return { from: new Date(Y, M, 1).getTime(), to: end, label: 'ce mois-ci' };
    if (/annee (derniere|passee)/.test(q)) return { from: new Date(Y - 1, 0, 1).getTime(), to: new Date(Y, 0, 1).getTime() - 1, label: `en ${Y - 1}` };
    if (/cette annee/.test(q)) return { from: new Date(Y, 0, 1).getTime(), to: end, label: `en ${Y}` };
    if ((m = q.match(/(\d+)\s+derniers?\s+jours/))) return { from: day0 - (Number(m[1]) - 1) * DAY, to: end, label: `sur les ${m[1]} derniers jours` };
    for (let i = 0; i < 12; i++) {
      const re = new RegExp(`\\b${MOIS[i]}\\b(?:\\s+(\\d{4}))?`);
      if ((m = q.match(re))) {
        let y = m[1] ? Number(m[1]) : Y;
        if (!m[1] && i > M) y -= 1;
        return { from: new Date(y, i, 1).getTime(), to: new Date(y, i + 1, 1).getTime() - 1, label: `en ${MOIS_FR[i]} ${y}` };
      }
    }
    return { from: -Infinity, to: Infinity, label: 'depuis le début', all: true };
  }
  function personne(q, persons, me) {
    const found = persons.filter(p => norm(p).split(/[^a-z]+/).some(tok => tok.length >= 3 && new RegExp(`\\b${tok}\\b`).test(q)));
    if (found.length) return found;
    if (me && /\b(je|j'|moi|mon|ma|mes|j')\b|\bj'/.test(q)) return [me];
    return [];
  }
  function categorieQ(q) {
    const C = CAT(); if (!C) return null;
    const direct = { courses: /courses|aliment|nourriture/, loyer: /loyer/, energie: /electricite|eau|gaz|energie|amendis/, internet: /internet|telephone|wifi|recharge/,
      transport: /transport|taxi|tram|bus/, sante: /sante|pharmacie|medic/, etudes: /etudes|fourniture|photocopie|livre/, menage: /menage|hygiene|nettoyage/,
      loisirs: /loisir|sortie|restaurant/, equipement: /equipement|reparation|meuble/ };
    for (const [id, re] of Object.entries(direct)) if (re.test(q)) return id;
    return null;
  }

  function repondre(question, ctx) {
    ctx = ctx || {};
    const q = norm(question).trim();
    const now = ctx.now || new Date();
    const tx = ctx.tx || txList();
    const persons = personsOf(tx, ctx.members || G.members());
    const me = ctx.me !== undefined ? ctx.me : (G.me() && G.me().display_name);
    if (!q) return { text: 'Posez une question, par exemple : « Combien Billy a-t-il déposé ce mois-ci ? »' };
    if (/^(aide|help|\?)|que (peux|sais)-tu|exemple/.test(q)) return { text: AIDE };

    const per = periode(q, now);
    const who = personne(q, persons, me);
    const cat = categorieQ(q);
    let type = null;
    if (/depos|depot|verse|versement|contribu|cotis|apport/.test(q)) type = 'deposit';
    if (/depens|retir|achat|achete|paye|coute|facture|sortie|consomm/.test(q) || cat) type = type === 'deposit' && !cat ? 'deposit' : 'consumption';

    const inPer = tx.filter(t => t.ts >= per.from && t.ts <= per.to);
    const sel = inPer.filter(t => (!type || t.type === type) && (!who.length || who.includes(t.person)) && (!cat || catOf(t) === cat));
    const verbe = type === 'deposit' ? 'déposé' : 'dépensé';
    const sujet = who.length ? who.join(' et ') : (type === 'deposit' ? 'Le foyer' : 'Le foyer');
    const catTxt = cat && CAT() ? ` en ${CAT().parId(cat).label.toLowerCase()}` : '';

    // Règlement
    if (/\bdoi[st]\b|dette|rembours|equilibr|a qui/.test(q)) {
      const t = regler(positions(tx, ctx.members || G.members(), /prorata|depense/.test(q) ? 'prorata' : 'egal').rows)
        .filter(x => !who.length || who.includes(x.de) || who.includes(x.a));
      return t.length ? { text: `Pour équilibrer les contributions (parts égales) :`, table: { head: ['De', 'À', 'Montant'], rows: t.map(x => [x.de, x.a, money(x.montant)]) } }
        : { text: '✅ Tout le monde est à égalité : personne ne doit rien.' };
    }
    // Prévision
    if (/prevision|prevoi|prevu|fin du mois|dans \d+ jours|va rester|restera|futur/.test(q)) {
      const S = root.AloysStats;
      if (!S) return { text: 'Le module de prévision n\'est pas chargé.' };
      const series = S.dailyBalance(tx);
      if (series.length < 6) return { text: `Il faut au moins 6 jours d'historique pour prévoir le solde (actuellement : ${series.length}).` };
      const y = series.map(p => p.y), cmp = S.compareModels(y), M = S.MODELS[cmp.best], fit = M.fit(y);
      let h = 30, quand = 'dans 30 jours';
      const mm = q.match(/dans (\d+) jours/);
      if (mm) { h = Number(mm[1]); quand = `dans ${h} jours`; }
      else if (/fin du mois/.test(q)) { h = Math.max(1, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate()); quand = 'à la fin du mois'; }
      const f = M.forecast(fit, h), z = f.tcrit || 1.96;
      return { text: `Solde prévu ${quand} : <b>${money(f.mean)}</b> (intervalle à 95 % : ${money(f.mean - z * f.se)} à ${money(f.mean + z * f.se)}), selon le meilleur modèle : ${M.label}.` };
    }
    // Budgets
    if (/budget/.test(q)) {
      const e = etatBudgets(tx, (ctx.budgets || G.data().budgets || {}), now).filter(r => r.budget > 0 && (!cat || r.id === cat));
      if (!e.length) return { text: 'Aucun budget n\'est défini. L\'administrateur peut en créer dans la carte « Budgets et alertes ».' };
      return { text: 'Budgets du mois :', table: { head: ['Catégorie', 'Dépensé', 'Budget', 'Projection'], rows: e.map(r => [CAT().libelle(r.id), money(r.spent), money(r.budget), money(r.proj)]) } };
    }
    // Solde
    if (/solde|caisse|reste|disponible|combien (il )?(y a|reste)/.test(q) && !type) {
      const upto = tx.filter(t => t.ts <= per.to);
      const bal = sum(upto.map(t => (t.type === 'deposit' ? t.amount : -t.amount)));
      return { text: `Solde de la caisse${per.all ? '' : ' ' + per.label} : <b>${money(bal)}</b> (${upto.length} opération${upto.length > 1 ? 's' : ''}).` };
    }
    // Classement
    if (/qui (a |est |)(le plus|le moins)|qui .*(le plus|le moins)|classement|\btop\b/.test(q)) {
      const t = type || 'deposit';
      const rank = personsOf(inPer, ctx.members || G.members()).map(p => ({ p, v: sum(inPer.filter(x => x.type === t && x.person === p && (!cat || catOf(x) === cat)).map(x => x.amount)) }))
        .sort((a, b) => (/le moins/.test(q) ? a.v - b.v : b.v - a.v));
      if (!rank.length) return { text: 'Aucune donnée sur cette période.' };
      return { text: `${/le moins/.test(q) ? 'Le moins' : 'Le plus'} ${t === 'deposit' ? 'déposé' : 'dépensé'}${catTxt} ${per.label} : <b>${esc(rank[0].p)}</b> (${money(rank[0].v)}).`,
        table: { head: ['Membre', t === 'deposit' ? 'Déposé' : 'Dépensé'], rows: rank.map(r => [r.p, money(r.v)]) } };
    }
    if (!sel.length) return { text: `Aucune opération trouvée${who.length ? ' pour ' + esc(who.join(', ')) : ''}${catTxt} ${per.label}.` };
    // Plus grosse opération
    if (/plus gros|plus grand|plus cher|plus elev|maximum|record/.test(q)) {
      const t = sel.reduce((a, b) => (b.amount > a.amount ? b : a));
      return { text: `Plus grosse opération ${per.label} : <b>${money(t.amount)}</b> — ${t.type === 'deposit' ? 'dépôt' : 'dépense'} de ${esc(t.person)} le ${new Date(t.ts).toLocaleDateString('fr-FR')}${t.description ? ` (${esc(t.description)})` : ''}.` };
    }
    // Nombre
    if (/combien de (fois|depots|depenses|operations|versements)|nombre/.test(q)) {
      return { text: `${sujet} : <b>${sel.length}</b> ${type === 'consumption' ? 'dépense' : type === 'deposit' ? 'dépôt' : 'opération'}${sel.length > 1 ? 's' : ''}${catTxt} ${per.label}.` };
    }
    // Moyenne
    if (/moyen/.test(q)) {
      return { text: `Montant moyen${catTxt} ${per.label} : <b>${money(sum(sel.map(t => t.amount)) / sel.length)}</b> sur ${sel.length} opération${sel.length > 1 ? 's' : ''}.` };
    }
    // Somme (par défaut)
    if (type) {
      return { text: `${esc(sujet)} a ${verbe} <b>${money(sum(sel.map(t => t.amount)))}</b>${catTxt} ${per.label} (${sel.length} opération${sel.length > 1 ? 's' : ''}).` };
    }
    if (per.all && !who.length && !/combien|total|bilan|resume|recap|tout/.test(q)) return { text: `Je n'ai pas compris la question. ${AIDE}` };
    const d = sum(sel.filter(t => t.type === 'deposit').map(t => t.amount)), c = sum(sel.filter(t => t.type === 'consumption').map(t => t.amount));
    return { text: `${who.length ? esc(who.join(' et ')) : 'Le foyer'} ${per.label} : <b>${money(d)}</b> déposés, <b>${money(c)}</b> dépensés, solde des mouvements ${money(d - c)}.` };
  }

  const AIDE = `Je réponds aux questions sur le registre, par exemple :<br>
    • « Combien Billy a déposé ce mois-ci ? » · « Combien j'ai dépensé en octobre ? »<br>
    • « Qui a le plus dépensé en courses ? » · « Quelle est la plus grosse dépense ? »<br>
    • « Quel est le solde de la caisse ? » · « Quel solde à la fin du mois ? »<br>
    • « Qui doit combien ? » · « Où en sont les budgets ? » · « Combien de dépôts la semaine dernière ? »`;

  const EXEMPLES = ['Quel est le solde de la caisse ?', 'Combien j\'ai déposé ce mois-ci ?', 'Qui a le plus dépensé ?', 'Qui doit combien ?', 'Quel solde à la fin du mois ?', 'Où en sont les budgets ?'];
  let journal = [];
  function panelAssistant(rootEl) {
    rootEl.innerHTML = `
      <h2>🤖 Assistant du registre</h2>
      <p class="role">Posez vos questions en français. L'assistant comprend les <b>membres</b>, les <b>périodes</b> (ce mois-ci, en octobre, la semaine dernière…),
      les <b>catégories</b> et les calculs (total, moyenne, classement, solde, prévision, qui doit combien).
      <br>Analyse <b>locale</b> : vos questions et vos données ne quittent pas le navigateur.</p>
      <div class="as-chips">${EXEMPLES.map(e => `<button type="button" class="an-chip" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <div class="as-log" id="asLog" aria-live="polite">${journal.map(rendreMsg).join('') || '<div class="as-empty">Aucune question pour le moment.</div>'}</div>
      <form class="as-form" id="asForm"><input id="asInput" type="text" autocomplete="off" placeholder="Ex. Combien Billy a déposé en novembre ?" aria-label="Votre question">
        <button class="btn" type="submit">Demander</button></form>`;
    const ask = q => {
      if (!q.trim()) return;
      const r = repondre(q);
      journal.push({ q, r }); if (journal.length > 30) journal = journal.slice(-30);
      const log = rootEl.querySelector('#asLog');
      log.innerHTML = journal.map(rendreMsg).join('');
      log.scrollTop = log.scrollHeight;
    };
    rootEl.querySelector('#asForm').onsubmit = e => { e.preventDefault(); const i = rootEl.querySelector('#asInput'); ask(i.value); i.value = ''; i.focus(); };
    rootEl.querySelectorAll('[data-q]').forEach(b => b.onclick = () => ask(b.dataset.q));
  }
  function rendreMsg(m) {
    const t = m.r.table;
    return `<div class="as-q">${esc(m.q)}</div><div class="as-a">${m.r.text}${t ? `<table><thead><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}</div>`;
  }

  /* =====================================================================
     15 · Rapport mensuel PDF
     ===================================================================== */
  const moisCle = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const moisLabel = k => { const [y, m] = k.split('-').map(Number); return `${MOIS_FR[m - 1]} ${y}`; };

  function donneesRapport(cle, tx, members) {
    const [y, m] = cle.split('-').map(Number);
    const from = new Date(y, m - 1, 1).getTime(), to = new Date(y, m, 1).getTime() - 1;
    const mois = tx.filter(t => t.ts >= from && t.ts <= to);
    const avant = sum(tx.filter(t => t.ts < from).map(t => (t.type === 'deposit' ? t.amount : -t.amount)));
    const dep = sum(mois.filter(t => t.type === 'deposit').map(t => t.amount));
    const out = sum(mois.filter(t => t.type === 'consumption').map(t => t.amount));
    const persons = personsOf(mois, members);
    const parMembre = persons.map(p => ({ p, dep: sum(mois.filter(t => t.type === 'deposit' && t.person === p).map(t => t.amount)), out: sum(mois.filter(t => t.type === 'consumption' && t.person === p).map(t => t.amount)) }));
    const cats = {};
    mois.filter(t => t.type === 'consumption').forEach(t => { const c = catOf(t); cats[c] = (cats[c] || 0) + t.amount; });
    const daily = []; let run = avant;
    for (let d = from; d <= Math.min(to, Date.now()); d += DAY) {
      run += sum(mois.filter(t => t.ts >= d && t.ts < d + DAY).map(t => (t.type === 'deposit' ? t.amount : -t.amount)));
      daily.push({ d, y: run });
    }
    return { cle, from, to, mois, avant, dep, out, fin: avant + dep - out, parMembre, cats, daily,
      top: mois.filter(t => t.type === 'consumption').sort((a, b) => b.amount - a.amount).slice(0, 5),
      transfers: regler(positions(mois, members, 'egal').rows) };
  }

  function imageGraphique(cfg, w, h) {
    if (!root.Chart) return '';
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(cv);
    cfg.options = Object.assign({ responsive: false, animation: false, devicePixelRatio: 2 }, cfg.options || {});
    const c = new Chart(cv.getContext('2d'), cfg);
    const url = cv.toDataURL('image/png');
    c.destroy(); cv.remove();
    return url;
  }

  function genererRapport(cle) {
    const r = donneesRapport(cle, txList(), G.members());
    const f = G.foyer();
    const C = CAT();
    const ink = '#1d2433', mut = '#5b6578';
    const catIds = Object.keys(r.cats).sort((a, b) => r.cats[b] - r.cats[a]);
    const PAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
    const imgCat = catIds.length ? imageGraphique({
      type: 'doughnut',
      data: { labels: catIds.map(id => (C ? C.parId(id).label : id)), datasets: [{ data: catIds.map(id => r.cats[id]), backgroundColor: catIds.map((_, i) => PAL[i % PAL.length]), borderColor: '#fff', borderWidth: 2 }] },
      options: { plugins: { legend: { position: 'right', labels: { color: ink, font: { size: 11 } } } }, cutout: '55%' }
    }, 520, 260) : '';
    const imgSolde = r.daily.length > 1 ? imageGraphique({
      type: 'line',
      data: { labels: r.daily.map(p => new Date(p.d).getDate()), datasets: [{ data: r.daily.map(p => p.y), borderColor: '#2a78d6', borderWidth: 2, pointRadius: 0, fill: false }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: mut }, grid: { display: false } }, y: { ticks: { color: mut }, grid: { color: '#e6e8ee' } } } }
    }, 520, 220) : '';
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport ${moisLabel(cle)}${f ? ' — ' + esc(f.nom) : ''}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: ${ink}; font-size: 11.5px; line-height: 1.5; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid ${ink}; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 22px; margin: 0; }
  h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 14px; margin: 18px 0 6px; }
  .mut { color: ${mut}; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpi { border: 1px solid #d5d9e2; border-radius: 6px; padding: 8px 10px; }
  .kpi .k { font-size: 10px; color: ${mut}; } .kpi .v { font-size: 15px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e3e6ec; } th { font-size: 10px; color: ${mut}; text-transform: none; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  img { width: 100%; height: auto; }
  footer { margin-top: 20px; border-top: 1px solid #d5d9e2; padding-top: 6px; font-size: 9.5px; color: ${mut}; }
  .noprint { margin: 14px 0; } @media print { .noprint { display: none; } }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid ${ink}; background: ${ink}; color: #fff; cursor: pointer; }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Enregistrer en PDF / Imprimer</button> <span class="mut">Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF ».</span></div>
<header><div><h1>Rapport mensuel — ${moisLabel(cle)}</h1><div class="mut">${f ? esc(f.nom) + ' · ' : ''}Registre partagé ALOYS MANAGEMENT</div></div>
<div class="mut">Édité le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}<br>Montants en ${DEV()}</div></header>
<div class="kpis">
  <div class="kpi"><div class="k">Solde au début du mois</div><div class="v">${fmtM(r.avant)}</div></div>
  <div class="kpi"><div class="k">Dépôts du mois</div><div class="v">${fmtM(r.dep)}</div></div>
  <div class="kpi"><div class="k">Dépenses du mois</div><div class="v">${fmtM(r.out)}</div></div>
  <div class="kpi"><div class="k">Solde en fin de période</div><div class="v">${fmtM(r.fin)}</div></div>
</div>
<div class="cols">
  <div><h2>Contributions par membre</h2><table><thead><tr><th>Membre</th><th class="n">Déposé</th><th class="n">Dépensé</th><th class="n">Part des dépôts</th></tr></thead><tbody>
  ${r.parMembre.map(x => `<tr><td>${esc(x.p)}</td><td class="n">${fmtM(x.dep)}</td><td class="n">${fmtM(x.out)}</td><td class="n">${r.dep ? pct(x.dep / r.dep) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Aucune opération.</td></tr>'}
  </tbody></table></div>
  <div><h2>Dépenses par catégorie</h2><table><thead><tr><th>Catégorie</th><th class="n">Montant</th><th class="n">Part</th></tr></thead><tbody>
  ${catIds.map(id => `<tr><td>${C ? esc(C.parId(id).label) : id}</td><td class="n">${fmtM(r.cats[id])}</td><td class="n">${pct(r.cats[id] / (r.out || 1))}</td></tr>`).join('') || '<tr><td colspan="3" class="mut">Aucune dépense.</td></tr>'}
  </tbody></table></div>
</div>
<div class="cols">
  ${imgCat ? `<div><h2>Répartition des dépenses</h2><img src="${imgCat}" alt="Répartition des dépenses par catégorie"></div>` : ''}
  ${imgSolde ? `<div><h2>Évolution du solde</h2><img src="${imgSolde}" alt="Évolution du solde au cours du mois"></div>` : ''}
</div>
<h2>Plus grosses dépenses</h2><table><thead><tr><th>Date</th><th>Membre</th><th>Catégorie</th><th>Description</th><th class="n">Montant</th></tr></thead><tbody>
${r.top.map(t => `<tr><td>${new Date(t.ts).toLocaleDateString('fr-FR')}</td><td>${esc(t.person)}</td><td>${C ? esc(C.parId(catOf(t)).label) : ''}</td><td>${esc(t.description || '—')}</td><td class="n">${fmtM(t.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="mut">Aucune dépense.</td></tr>'}
</tbody></table>
<h2>Équilibre des dépôts du mois (parts égales)</h2>
${r.transfers.length ? `<table><thead><tr><th>De</th><th>À</th><th class="n">Montant</th></tr></thead><tbody>${r.transfers.map(t => `<tr><td>${esc(t.de)}</td><td>${esc(t.a)}</td><td class="n">${fmtM(t.montant)}</td></tr>`).join('')}</tbody></table>` : '<p class="mut">Tous les membres ont déposé la même somme ce mois-ci.</p>'}
<footer>${r.mois.length} opération(s) sur la période · Rapport généré automatiquement par ALOYS MANAGEMENT · Les données proviennent du registre partagé du foyer.</footer>
<script>setTimeout(function(){ window.print(); }, 400);<\/script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Autorisez les fenêtres pop-up pour ce site afin de générer le rapport.', 'err'); return null; }
    w.document.open(); w.document.write(html); w.document.close();
    return html;
  }

  function panelRapport(rootEl) {
    const tx = txList();
    const keys = [...new Set(tx.map(t => moisCle(t.ts)).concat([moisCle(Date.now())]))].sort().reverse();
    rootEl.innerHTML = `
      <h2>🖨️ Rapport mensuel PDF</h2>
      <p class="role">Un rapport d'une page, prêt à partager : soldes, contributions de chacun, dépenses par catégorie, graphiques,
      plus grosses dépenses et règlement proposé. Choisissez le mois, puis <b>« Enregistrer au format PDF »</b> dans la fenêtre d'impression.</p>
      <div class="row"><div class="field"><label>Mois</label><select id="rapMois">${keys.map(k => `<option value="${k}">${moisLabel(k)}</option>`).join('')}</select></div>
      <button class="btn" id="rapGo">Générer le rapport</button></div>
      <div class="explain">Astuce : sur téléphone, le rapport s'ouvre dans un nouvel onglet ; utilisez « Partager → Imprimer → Enregistrer en PDF ».</div>`;
    rootEl.querySelector('#rapGo').onclick = () => genererRapport(rootEl.querySelector('#rapMois').value);
  }

  /* =====================================================================
     Notifications
     ===================================================================== */
  const NKEY = 'aloys_mgmt_notif';
  function toast(t, k) { if (typeof root.showToast === 'function') root.showToast(t, k || 'ok'); }
  const Notify = {
    actif() { try { return localStorage.getItem(NKEY) === 'on'; } catch (e) { return false; } },
    async basculer() {
      const on = !this.actif();
      if (on && 'Notification' in root && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { /* */ } }
      try { localStorage.setItem(NKEY, on ? 'on' : 'off'); } catch (e) { /* */ }
      this.bouton();
      toast(on ? ('Notification' in root && Notification.permission === 'denied'
        ? 'Notifications activées dans l\'application (le navigateur bloque les notifications système).'
        : 'Notifications activées.') : 'Notifications désactivées.');
    },
    bouton() {
      const b = document.getElementById('notifBtn');
      if (b) { b.textContent = this.actif() ? '🔔 Notifications : activées' : '🔕 Notifications : désactivées'; b.setAttribute('aria-pressed', String(this.actif())); }
    },
    signaler(titre, corps) {
      if (!this.actif()) return;
      toast(`${titre} — ${corps}`);
      try {
        if ('Notification' in root && Notification.permission === 'granted' && document.hidden) {
          if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(reg => reg.showNotification(titre, { body: corps, icon: 'icons/icon-192.png', tag: 'aloys' }));
          } else new Notification(titre, { body: corps, icon: 'icons/icon-192.png' });
        }
      } catch (e) { /* */ }
    },
    // Appelé par l'abonnement temps réel
    surChangement(change) {
      try {
        const me = G.me();
        if (!change || change.eventType !== 'INSERT' || change.table !== 'transactions' || !change.new) return;
        if (me && change.new.created_by === me.id) return;
        const n = change.new, p = n.payload || {};
        const cat = p.categorie && CAT() ? ` (${CAT().parId(p.categorie).label})` : '';
        this.signaler(n.type === 'deposit' ? 'Nouveau dépôt' : 'Nouvelle dépense', `${n.person} : ${money(Number(n.amount))}${cat}`);
      } catch (e) { /* */ }
    },
    // Appelé après chaque rechargement des données : seuil de caisse et budgets
    _etat: null,
    apresRechargement() {
      try {
        const d = G.data();
        const bal = typeof root.balance === 'function' ? root.balance() : 0;
        const seuil = d.seuil && isFinite(d.seuil.montant) ? Number(d.seuil.montant) : null;
        const risques = etatBudgets(txList(), d.budgets || {}).filter(r => r.statut === 'depasse' || r.statut === 'risque').map(r => r.id + ':' + r.statut).sort().join(',');
        const prev = this._etat;
        this._etat = { bal, risques };
        if (!prev) return;
        if (seuil !== null && prev.bal >= seuil && bal < seuil) this.signaler('Caisse sous le seuil', `Solde : ${money(bal)} (seuil ${money(seuil)})`);
        if (risques && risques !== prev.risques) this.signaler('Budget', 'Un budget du mois est dépassé ou risque de l\'être. Ouvrez « Budgets et alertes ».');
      } catch (e) { /* */ }
    }
  };

  root.panelEquilibre = panelEquilibre;
  root.panelBudgets = panelBudgets;
  root.panelAssistant = panelAssistant;
  root.panelRapport = panelRapport;
  root.AloysNotify = Notify;
  root.AloysFeatures = { positions, regler, etatBudgets, periode, repondre, donneesRapport, genererRapport };
})(typeof window !== 'undefined' ? window : globalThis);
