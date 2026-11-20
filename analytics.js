/* =====================================================================
   ALOYS MANAGEMENT — Tableau de bord analytique (carte 08)
   Graphiques : camemberts, histogrammes, séries temporelles, nuage par membre
   Modèles    : naïf, dérive, régression linéaire (MCO), lissage de Holt
                comparés par validation temporelle (MAE / RMSE)
   Tests      : Kruskal-Wallis entre membres, indice de Gini,
                détection d'anomalies par z-score robuste (MAD)
   Dépend de  : Chart.js 4 (CDN), et des globales DATA, MEMBERS, fmt,
                getAvatarData, avatarHTML, remainingTarget (index.html)
   ===================================================================== */
(function () {
  'use strict';

  // Palette catégorielle validée (contraste ≥ 3:1 sur #16243A, séparation daltonisme ΔE ≥ 8)
  const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const C_IN = '#199e70';     // dépôts
  const C_OUT = '#d95926';    // dépenses
  const C_BAL = '#E4C55E';    // solde
  const C_MODEL = '#3987e5';  // prévision
  const C_TREND = '#8CA0BC';  // tendance
  const C_GRID = 'rgba(140,160,188,0.14)';
  const C_MUTED = '#8CA0BC';
  const C_TEXT = '#E8ECF1';
  const C_SURF = '#1E3050';
  const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const DAY = 86400000;

  const DEV = () => (typeof window.DEV === 'function' ? window.DEV() : 'MAD');
  let charts = [];
  let period = 'all';

  function destroyCharts() {
    charts.forEach(c => { try { c.destroy(); } catch (e) { /* déjà détruit */ } });
    charts = [];
  }
  window.destroyAnalyticsCharts = destroyCharts;

  /* ------------------------------------------------------------------
     Statistiques de base
     ------------------------------------------------------------------ */
  const sum = a => a.reduce((s, v) => s + v, 0);
  const mean = a => a.length ? sum(a) / a.length : NaN;
  function quantile(a, q) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q, b = Math.floor(pos), r = pos - b;
    return s[b + 1] !== undefined ? s[b] + r * (s[b + 1] - s[b]) : s[b];
  }
  const median = a => quantile(a, 0.5);
  function sd(a) { // écart-type corrigé (n-1)
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map(v => (v - m) ** 2)) / (a.length - 1));
  }
  function mad(a) { const m = median(a); return median(a.map(v => Math.abs(v - m))); }
  function skewness(a) {
    const n = a.length; if (n < 3) return NaN;
    const m = mean(a), s = sd(a); if (!s) return 0;
    return (n / ((n - 1) * (n - 2))) * sum(a.map(v => ((v - m) / s) ** 3));
  }
  function gini(values) {
    const x = values.filter(v => v >= 0).sort((a, b) => a - b);
    const n = x.length, t = sum(x);
    if (n < 2 || t === 0) return 0;
    let acc = 0; x.forEach((v, i) => { acc += (i + 1) * v; });
    return (2 * acc) / (n * t) - (n + 1) / n;
  }

  // Loi du khi-deux : fonction gamma incomplète régularisée
  function lnGamma(z) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1; let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function gammaP(a, x) {
    if (x <= 0) return 0;
    if (x < a + 1) {
      let ap = a, s = 1 / a, d = s;
      for (let i = 0; i < 500; i++) { ap += 1; d *= x / ap; s += d; if (Math.abs(d) < Math.abs(s) * 1e-12) break; }
      return s * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }
  const chi2Sf = (x, df) => 1 - gammaP(df / 2, x / 2);

  // Test de Kruskal-Wallis (comparaison non paramétrique de k groupes)
  function kruskalWallis(groups) {
    const g = groups.filter(a => a.length > 0);
    const k = g.length, all = [];
    g.forEach((a, gi) => a.forEach(v => all.push({ v, gi })));
    const N = all.length;
    if (k < 2 || N <= k) return null;
    all.sort((a, b) => a.v - b.v);
    const ranks = new Array(N); let tieSum = 0;
    for (let i = 0; i < N;) {
      let j = i; while (j + 1 < N && all[j + 1].v === all[i].v) j++;
      const r = (i + j + 2) / 2, t = j - i + 1;
      for (let m = i; m <= j; m++) ranks[m] = r;
      tieSum += t ** 3 - t; i = j + 1;
    }
    const R = new Array(k).fill(0), n = new Array(k).fill(0);
    all.forEach((o, i) => { R[o.gi] += ranks[i]; n[o.gi]++; });
    let H = 12 / (N * (N + 1)) * sum(R.map((r, i) => r * r / n[i])) - 3 * (N + 1);
    const corr = 1 - tieSum / (N ** 3 - N);
    if (corr > 0) H /= corr;
    const df = k - 1;
    return { H, df, p: chi2Sf(H, df), eta2: Math.max(0, (H - k + 1) / (N - k)), N, k, minN: Math.min(...n) };
  }

  // Quantile de Student bilatéral à 95 %
  function t975(df) {
    const tab = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145,
      2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
    if (df < 1) return NaN;
    return df <= 30 ? tab[df - 1] : 1.96 + 2.4 / df;
  }

  /* ------------------------------------------------------------------
     Préparation des données
     ------------------------------------------------------------------ */
  const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const monthKey = d => dayKey(d).slice(0, 7);
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

  function allTx() {
    return (typeof DATA !== 'undefined' && DATA && Array.isArray(DATA.transactions) ? DATA.transactions : [])
      .filter(t => t && t.iso && isFinite(Number(t.amount)))
      .map(t => ({ ...t, amount: Number(t.amount), ts: new Date(t.iso).getTime() }))
      .filter(t => isFinite(t.ts))
      .sort((a, b) => a.ts - b.ts);
  }
  function filterPeriod(tx) {
    if (period === 'all') return tx;
    const days = { '30': 30, '90': 90, '365': 365 }[period];
    const from = startOfDay(Date.now()) - (days - 1) * DAY;
    return tx.filter(t => t.ts >= from);
  }
  function personsOf(tx) {
    const set = new Set(tx.map(t => t.person));
    const ordered = (typeof MEMBERS !== 'undefined' && Array.isArray(MEMBERS) ? MEMBERS : []).filter(m => set.has(m));
    [...set].forEach(p => { if (!ordered.includes(p)) ordered.push(p); });
    return ordered;
  }
  const colorOf = p => (typeof getAvatarData === 'function' ? getAvatarData(p).color : PALETTE[0]);

  // Série quotidienne régulière du solde cumulé (jours sans mouvement inclus)
  function dailyBalance(tx) {
    if (!tx.length) return [];
    const flows = {};
    tx.forEach(t => { const k = dayKey(t.ts); flows[k] = (flows[k] || 0) + (t.type === 'deposit' ? t.amount : -t.amount); });
    const start = startOfDay(tx[0].ts), end = Math.max(startOfDay(tx[tx.length - 1].ts), startOfDay(Date.now()));
    const out = []; let run = 0;
    for (let d = start; d <= end; d += DAY) {
      const k = dayKey(d); run += flows[k] || 0;
      out.push({ t: out.length, date: k, ts: d, y: run, flow: flows[k] || 0 });
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Modèles de prévision du solde
     ------------------------------------------------------------------ */
  const MODELS = {
    naif: {
      label: 'Naïf (marche aléatoire)',
      fit(y) {
        const res = y.slice(1).map((v, i) => v - y[i]);
        return { last: y[y.length - 1], sigma: sd(res) || 0, residuals: res };
      },
      forecast(m, h) { return { mean: m.last, se: m.sigma * Math.sqrt(h) }; }
    },
    derive: {
      label: 'Dérive (tendance moyenne)',
      fit(y) {
        const n = y.length, slope = n > 1 ? (y[n - 1] - y[0]) / (n - 1) : 0;
        const res = y.slice(1).map((v, i) => v - y[i] - slope);
        return { last: y[n - 1], slope, sigma: sd(res) || 0, residuals: res };
      },
      forecast(m, h) { return { mean: m.last + m.slope * h, se: m.sigma * Math.sqrt(h) }; }
    },
    mco: {
      label: 'Régression linéaire (MCO)',
      fit(y) {
        const n = y.length, x = y.map((_, i) => i), mx = mean(x), my = mean(y);
        const sxx = sum(x.map(v => (v - mx) ** 2)) || 1;
        const slope = sum(x.map((v, i) => (v - mx) * (y[i] - my))) / sxx;
        const icpt = my - slope * mx;
        const res = y.map((v, i) => v - (icpt + slope * i));
        const sse = sum(res.map(r => r * r)), sst = sum(y.map(v => (v - my) ** 2));
        return { n, slope, icpt, mx, sxx, sigma: n > 2 ? Math.sqrt(sse / (n - 2)) : 0, r2: sst ? 1 - sse / sst : 1, residuals: res };
      },
      forecast(m, h) {
        const x0 = m.n - 1 + h;
        return { mean: m.icpt + m.slope * x0, se: m.sigma * Math.sqrt(1 + 1 / m.n + (x0 - m.mx) ** 2 / m.sxx), tcrit: t975(m.n - 2) };
      }
    },
    holt: {
      label: 'Lissage exponentiel de Holt',
      fit(y) {
        let best = null;
        for (let a = 0.1; a <= 0.91; a += 0.1) for (let b = 0.05; b <= 0.91; b += 0.1) {
          let l = y[0], tr = y.length > 1 ? y[1] - y[0] : 0, sse = 0; const res = [];
          for (let i = 1; i < y.length; i++) {
            const pred = l + tr, e = y[i] - pred; res.push(e); sse += e * e;
            const nl = a * y[i] + (1 - a) * (l + tr);
            tr = b * (nl - l) + (1 - b) * tr; l = nl;
          }
          if (!best || sse < best.sse) best = { a, b, l, tr, sse, res };
        }
        return { alpha: best.a, beta: best.b, level: best.l, trend: best.tr, sigma: sd(best.res) || 0, residuals: best.res };
      },
      forecast(m, h) {
        // Variance de prévision de Holt (approximation de Hyndman et al.)
        let v = 1; for (let j = 1; j < h; j++) v += (m.alpha * (1 + j * m.beta)) ** 2;
        return { mean: m.level + m.trend * h, se: m.sigma * Math.sqrt(v) };
      }
    }
  };

  // Holt-Winters additif à saisonnalité hebdomadaire (m = 7)
  MODELS.holtwinters = {
    label: 'Holt-Winters saisonnier (hebdo.)',
    minN: 21,
    fit(y) {
      const m = 7, n = y.length;
      if (n < 2 * m) return null;
      const mean0 = mean(y.slice(0, m)), mean1 = mean(y.slice(m, 2 * m));
      let best = null;
      for (const a of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const b of [0.05, 0.1, 0.3]) for (const g of [0.05, 0.1, 0.3, 0.5]) {
        let l = mean0, tr = (mean1 - mean0) / m, sse = 0;
        const s = y.slice(0, m).map(v => v - mean0), res = [];
        for (let t = m; t < n; t++) {
          const st = s[t - m], pred = l + tr + st, e = y[t] - pred;
          res.push(e); sse += e * e;
          const nl = a * (y[t] - st) + (1 - a) * (l + tr);
          tr = b * (nl - l) + (1 - b) * tr;
          s[t] = g * (y[t] - nl) + (1 - g) * st;
          l = nl;
        }
        if (!best || sse < best.sse) best = { a, b, g, l, tr, season: s.slice(n - m), sse, res };
      }
      return { alpha: best.a, beta: best.b, gamma: best.g, level: best.l, trend: best.tr, season: best.season, sigma: sd(best.res) || 0, residuals: best.res };
    },
    forecast(f, h) { return { mean: f.level + f.trend * h + f.season[(h - 1) % 7], se: f.sigma * Math.sqrt(h) }; }
  };

  // Validation temporelle : on cache les derniers jours, on prévoit, on mesure l'erreur
  function compareModels(y) {
    const n = y.length;
    if (n < 6) return null;
    const hTest = Math.max(1, Math.min(14, Math.round(n * 0.2)));
    const train = y.slice(0, n - hTest), test = y.slice(n - hTest);
    const rows = Object.entries(MODELS).filter(([, M]) => train.length >= (M.minN || 3)).map(([key, M]) => {
      const fitted = M.fit(train);
      if (!fitted) return null;
      const errs = test.map((v, i) => v - M.forecast(fitted, i + 1).mean);
      return {
        key, label: M.label,
        mae: mean(errs.map(Math.abs)),
        rmse: Math.sqrt(mean(errs.map(e => e * e)))
      };
    }).filter(Boolean);
    rows.sort((a, b) => a.mae - b.mae || a.rmse - b.rmse);
    return { rows, best: rows[0].key, hTest, nTrain: train.length };
  }

  /* ------------------------------------------------------------------
     Aides d'affichage
     ------------------------------------------------------------------ */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (isFinite(v) ? (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '—');
  const num = (v, d = 2) => (isFinite(v) ? Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const pFmt = p => (!isFinite(p) ? '= —' : p < 0.001 ? '< 0,001' : '= ' + num(p, 3));
  const dateFr = ts => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const monthFr = k => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }); };

  function baseOptions(extra) {
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      plugins: {
        legend: { labels: { color: C_TEXT, boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: {
          backgroundColor: '#0F1B2D', borderColor: 'rgba(201,162,39,0.4)', borderWidth: 1,
          titleColor: C_TEXT, bodyColor: C_TEXT, padding: 10,
          callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ' : ' : ''}${fmt(ctx.parsed.y ?? ctx.parsed)} ${DEV()}` }
        }
      },
      scales: {
        x: { ticks: { color: C_MUTED }, grid: { color: C_GRID, drawTicks: false }, border: { color: C_GRID } },
        y: { ticks: { color: C_MUTED, callback: v => Number(v).toLocaleString('fr-FR') }, grid: { color: C_GRID, drawTicks: false }, border: { display: false }, beginAtZero: true }
      }
    }, extra || {});
  }
  function makeChart(canvas, cfg) {
    if (!window.Chart || !canvas) return null;
    const c = new Chart(canvas.getContext('2d'), cfg);
    charts.push(c); return c;
  }
  function card(id, title, sub, extraHtml) {
    return `<section class="an-card" id="${id}">
      <h3>${title}</h3>${sub ? `<p class="an-sub">${sub}</p>` : ''}
      <div class="an-canvas"><canvas></canvas></div>
      <div class="an-read"></div>${extraHtml || ''}
    </section>`;
  }
  const read = (root, id, html) => { const el = root.querySelector(`#${id} .an-read`); if (el) el.innerHTML = html; };
  const canvasOf = (root, id) => root.querySelector(`#${id} canvas`);
  function empty(root, id, msg) {
    const box = root.querySelector(`#${id} .an-canvas`);
    if (box) box.outerHTML = `<div class="an-empty">${msg}</div>`;
  }

  /* ------------------------------------------------------------------
     Panneau principal
     ------------------------------------------------------------------ */
  function panelAnalytics(root) {
    destroyCharts();
    const txAll = allTx();
    const tx = filterPeriod(txAll);
    const dep = tx.filter(t => t.type === 'deposit');
    const out = tx.filter(t => t.type === 'consumption');
    const persons = personsOf(tx);
    const totIn = sum(dep.map(t => t.amount)), totOut = sum(out.map(t => t.amount));
    const contribByPerson = persons.map(p => sum(dep.filter(t => t.person === p).map(t => t.amount)));
    const giniVal = gini(contribByPerson);

    root.innerHTML = `
      <h2>📊 Analyse &amp; modèles</h2>
      <p class="role">Tableau de bord analytique du registre : répartition par membre, distribution des montants,
      évolution du solde, <b>comparaison de cinq modèles de prévision</b> par validation temporelle,
      test statistique entre membres et détection d'opérations inhabituelles. Survolez un graphique pour voir les valeurs.</p>

      <div class="an-filters" role="group" aria-label="Période analysée">
        ${[['all', 'Tout l\'historique'], ['30', '30 jours'], ['90', '90 jours'], ['365', '12 mois']]
          .map(([k, l]) => `<button type="button" class="an-chip${period === k ? ' on' : ''}" data-period="${k}" aria-pressed="${period === k}">${l}</button>`).join('')}
        <span class="an-count">${tx.length} opération${tx.length > 1 ? 's' : ''} analysée${tx.length > 1 ? 's' : ''}</span>
      </div>

      <div class="an-kpis">
        <div class="statbox"><div class="k">Total déposé</div><div class="v">${fmt(totIn)}</div></div>
        <div class="statbox"><div class="k">Total dépensé</div><div class="v">${fmt(totOut)}</div></div>
        <div class="statbox"><div class="k">Flux net</div><div class="v">${fmt(totIn - totOut)}</div></div>
        <div class="statbox"><div class="k">Taux d'épargne</div><div class="v">${totIn ? pct((totIn - totOut) / totIn) : '—'}</div></div>
        <div class="statbox"><div class="k">Contributeurs</div><div class="v">${contribByPerson.filter(v => v > 0).length}</div></div>
        <div class="statbox"><div class="k">Indice de Gini</div><div class="v">${persons.length > 1 ? num(giniVal) : '—'}</div></div>
      </div>

      ${tx.length === 0 ? `<div class="explain">Aucune opération sur cette période. Choisissez « Tout l'historique » ou enregistrez un dépôt.</div>` : `
      <h3 class="an-h">1. Répartition par membre</h3>
      <div class="an-grid">
        ${card('anPieIn', 'Part des dépôts par membre', 'Qui alimente la caisse commune ?')}
        ${card('anPieOut', 'Part des dépenses par membre', 'Qui retire de l\'argent ?')}
        ${card('anPieCat', 'Dépenses par catégorie', 'À quoi sert l\'argent de la caisse ?')}
      </div>

      <h3 class="an-h">2. Distribution des montants</h3>
      <div class="an-grid">
        ${card('anHist', 'Histogramme des montants', 'Classes calculées par la règle de Freedman-Diaconis (robuste aux valeurs extrêmes)')}
        ${card('anStrip', 'Montants déposés par membre', 'Chaque point est un dépôt ; le trait marque la médiane du membre')}
      </div>

      <h3 class="an-h">3. Évolution dans le temps</h3>
      <div class="an-grid">
        ${card('anMonthly', 'Dépôts et dépenses par mois', '')}
        ${card('anWeekday', 'Activité selon le jour de la semaine', 'Somme des montants par jour')}
      </div>
      `}

      <h3 class="an-h">4. Modélisation et prévision du solde (30 jours)</h3>
      <div class="an-grid an-wide">
        ${card('anForecast', 'Solde observé et prévision du meilleur modèle', 'Bande : intervalle de prévision à 95 %')}
      </div>
      <div id="anModels"></div>

      <h3 class="an-h">5. Comparaison statistique des membres</h3>
      <div id="anCompare"></div>

      <h3 class="an-h">6. Détection d'opérations inhabituelles</h3>
      <div id="anAnomalies"></div>

      <p class="an-method">Méthodes : statistiques robustes (médiane, MAD, IQR), règle de Freedman-Diaconis,
      validation temporelle « hold-out » (les derniers jours sont cachés au modèle puis comparés à la réalité),
      test de Kruskal-Wallis (non paramétrique, adapté aux petits échantillons non gaussiens),
      z-score robuste d'Iglewicz-Hoaglin (|z| &gt; 3,5). Calculs effectués dans votre navigateur.</p>
    `;

    root.querySelectorAll('.an-chip').forEach(b => b.onclick = () => { period = b.dataset.period; panelAnalytics(root); });

    if (!window.Chart) {
      root.querySelectorAll('.an-canvas').forEach(el => { el.outerHTML = '<div class="an-empty">Bibliothèque graphique non chargée (connexion requise). Rechargez la page.</div>'; });
    }
    if (window.Chart) {
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.color = C_MUTED;
    }

    if (tx.length) {
      drawPies(root, persons, dep, out);
      drawCategories(root, out);
      drawHistogram(root, dep, out);
      drawStrip(root, persons, dep);
      drawMonthly(root, tx);
      drawWeekday(root, tx);
    }
    drawForecast(root, txAll);
    renderCompare(root, persons, dep, out, giniVal);
    renderAnomalies(root, tx);
  }

  /* ---- 1. Camemberts ---- */
  function drawPies(root, persons, dep, out) {
    [['anPieIn', dep, 'déposé'], ['anPieOut', out, 'dépensé']].forEach(([id, list, verb]) => {
      const vals = persons.map(p => sum(list.filter(t => t.person === p).map(t => t.amount)));
      const total = sum(vals);
      if (!total) { empty(root, id, `Aucun montant ${verb} sur la période.`); return; }
      const idx = persons.map((_, i) => i).filter(i => vals[i] > 0);
      makeChart(canvasOf(root, id), {
        type: 'doughnut',
        data: {
          labels: idx.map(i => persons[i]),
          datasets: [{ data: idx.map(i => vals[i]), backgroundColor: idx.map(i => colorOf(persons[i])), borderColor: C_SURF, borderWidth: 2, hoverOffset: 6 }]
        },
        options: Object.assign(baseOptions(), {
          cutout: '58%', scales: {},
          plugins: {
            legend: { position: 'bottom', labels: { color: C_TEXT, boxWidth: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
            tooltip: { callbacks: { label: c => `${c.label} : ${fmt(c.parsed)} ${DEV()} (${pct(c.parsed / total)})` } }
          }
        })
      });
      const top = idx.reduce((a, i) => vals[i] > vals[a] ? i : a, idx[0]);
      const share = vals[top] / total;
      read(root, id, `<b>${esc(persons[top])}</b> représente <b>${pct(share)}</b> du total ${verb} (${fmt(total)} ${DEV()}).
        ${idx.length > 1 ? (share > 0.5 ? 'La contribution est concentrée sur une seule personne.' : 'La répartition est partagée entre plusieurs membres.') : 'Un seul membre apparaît sur la période.'}`);
    });
  }

  /* ---- 1b. Catégories ---- */
  function drawCategories(root, out) {
    const CAT = window.AloysCategories;
    if (!CAT) { empty(root, 'anPieCat', 'Module des catégories non chargé.'); return; }
    const total = sum(out.map(t => t.amount));
    if (!total) { empty(root, 'anPieCat', 'Aucune dépense sur la période.'); return; }
    const agg = {};
    out.forEach(t => { const c = CAT.categorieDe(t); agg[c] = (agg[c] || 0) + t.amount; });
    const ids = CAT.CATEGORIES.map(c => c.id).filter(id => agg[id] > 0).sort((a, b) => agg[b] - agg[a]);
    // 7 catégories maximum à l'écran (palette validée), le reste est regroupé dans « Autres »
    let shown = ids.slice(0, 7), rest = ids.slice(7);
    const labels = shown.map(id => CAT.libelle(id)), data = shown.map(id => agg[id]);
    if (rest.length) { labels.push('📦 Autres catégories'); data.push(sum(rest.map(id => agg[id]))); }
    makeChart(canvasOf(root, 'anPieCat'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: C_SURF, borderWidth: 2, hoverOffset: 6 }] },
      options: Object.assign(baseOptions(), {
        cutout: '58%', scales: {},
        plugins: {
          legend: { position: 'bottom', labels: { color: C_TEXT, boxWidth: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: { callbacks: { label: c => `${c.label} : ${fmt(c.parsed)} ${DEV()} (${pct(c.parsed / total)})` } }
        }
      })
    });
    const unc = agg.autre || 0;
    read(root, 'anPieCat', `Premier poste : <b>${CAT.libelle(ids[0])}</b> avec <b>${pct(agg[ids[0]] / total)}</b> des dépenses.
      ${unc / total > 0.3 ? ` ${pct(unc / total)} des dépenses ne sont pas classées : indiquez une catégorie dans la facture pour affiner l'analyse.` : ''}`);
  }

  /* ---- 2a. Histogramme ---- */
  function fdBins(values) {
    const n = values.length, min = Math.min(...values), max = Math.max(...values);
    if (max === min) return { edges: [min - 0.5, max + 0.5], overflow: null };
    const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75), iqr = q3 - q1;
    // Les valeurs extrêmes (> Q3 + 3·IQR) vont dans une classe finale « plus de X » pour ne pas écraser le graphique
    const top = iqr > 0 && q3 + 3 * iqr < max ? q3 + 3 * iqr : max;
    let k = iqr > 0 ? Math.ceil((top - min) / (2 * iqr * Math.pow(n, -1 / 3))) : Math.ceil(Math.log2(n) + 1);
    k = Math.max(3, Math.min(12, k));
    const raw = (top - min) / k || 1, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const width = [1, 2, 2.5, 5, 10].map(f => f * mag).find(w => w >= raw) || raw;
    const start = Math.floor(min / width) * width;
    const edges = []; for (let e = start; e <= top + 1e-9; e += width) edges.push(e);
    edges.push(edges[edges.length - 1] + width);
    const last = edges[edges.length - 1];
    return { edges, overflow: max >= last ? last : null };
  }
  function drawHistogram(root, dep, out) {
    const values = [...dep, ...out].map(t => t.amount);
    if (values.length < 2) { empty(root, 'anHist', 'Au moins deux opérations sont nécessaires pour un histogramme.'); return; }
    const { edges, overflow } = fdBins(values);
    const nb = edges.length - 1;
    const binOf = v => { if (overflow !== null && v >= overflow) return nb; let i = edges.findIndex((e, j) => j < nb && v >= e && v < edges[j + 1]); return i < 0 ? nb - 1 : i; };
    const count = list => { const c = new Array(nb + (overflow !== null ? 1 : 0)).fill(0); list.forEach(t => c[binOf(t.amount)]++); return c; };
    const labels = edges.slice(0, -1).map((lo, i) => `${num(lo, 0)}–${num(edges[i + 1], 0)}`);
    if (overflow !== null) labels.push(`≥ ${num(overflow, 0)}`);
    makeChart(canvasOf(root, 'anHist'), {
      type: 'bar',
      data: {
        labels, datasets: [
          { label: 'Dépôts', data: count(dep), backgroundColor: C_IN, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34 },
          { label: 'Dépenses', data: count(out), backgroundColor: C_OUT, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34 }
        ]
      },
      options: baseOptions({
        datasets: { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } },
        plugins: {
          legend: { labels: { color: C_TEXT, boxWidth: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: { callbacks: { title: c => `${c[0].label} ${DEV()}`, label: c => `${c.dataset.label} : ${c.parsed.y} opération${c.parsed.y > 1 ? 's' : ''}` } }
        },
        scales: {
          x: { ticks: { color: C_MUTED, maxRotation: 0, autoSkip: true }, grid: { display: false }, title: { display: true, text: 'Montant (' + DEV() + ')', color: C_MUTED } },
          y: { ticks: { color: C_MUTED, precision: 0 }, grid: { color: C_GRID }, border: { display: false }, beginAtZero: true, title: { display: true, text: 'Nombre', color: C_MUTED } }
        }
      })
    });
    const sk = skewness(values), q1 = quantile(values, 0.25), q3 = quantile(values, 0.75);
    read(root, 'anHist', `Médiane <b>${fmt(median(values))} ${DEV()}</b>, 50 % des montants entre <b>${fmt(q1)}</b> et <b>${fmt(q3)} ${DEV()}</b>.
      ${overflow !== null ? `Les montants exceptionnels (≥ ${fmt(overflow)} ${DEV()}) sont regroupés dans la dernière classe.` : ''}
      ${isFinite(sk) ? `Asymétrie = <b>${num(sk)}</b> : ${Math.abs(sk) < 0.5 ? 'distribution à peu près symétrique.' : sk > 0 ? 'quelques gros montants tirent la moyenne vers le haut ; la médiane est plus représentative.' : 'quelques petits montants tirent la moyenne vers le bas.'}` : ''}`);
  }

  /* ---- 2b. Nuage de points par membre ---- */
  function drawStrip(root, persons, dep) {
    const ps = persons.filter(p => dep.some(t => t.person === p));
    if (!dep.length) { empty(root, 'anStrip', 'Aucun dépôt sur la période.'); return; }
    const datasets = ps.map((p, i) => {
      const vals = dep.filter(t => t.person === p);
      return {
        type: 'scatter', label: p,
        data: vals.map((t, j) => ({ x: i + ((j * 0.6180339) % 1 - 0.5) * 0.36, y: t.amount, d: t.ts })),
        backgroundColor: colorOf(p), borderColor: C_SURF, borderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7
      };
    });
    datasets.push({
      type: 'scatter', label: 'Médiane', data: ps.map((p, i) => ({ x: i, y: median(dep.filter(t => t.person === p).map(t => t.amount)) })),
      pointStyle: 'line', pointRadius: 16, pointHoverRadius: 18, borderWidth: 3, borderColor: C_TEXT, backgroundColor: C_TEXT
    });
    makeChart(canvasOf(root, 'anStrip'), {
      type: 'scatter', data: { datasets },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => c.dataset.label === 'Médiane' ? `Médiane ${ps[c.raw.x]} : ${fmt(c.parsed.y)} ${DEV()}` : `${c.dataset.label} : ${fmt(c.parsed.y)} ${DEV()} (${dateFr(c.raw.d)})` } }
        },
        scales: {
          x: { type: 'linear', min: -0.6, max: ps.length - 0.4, ticks: { stepSize: 1, color: C_TEXT, callback: v => Number.isInteger(v) && ps[v] ? ps[v].split(/\s+/)[0] : '' }, grid: { display: false }, border: { color: C_GRID } },
          y: { ticks: { color: C_MUTED, callback: v => Number(v).toLocaleString('fr-FR') }, grid: { color: C_GRID }, border: { display: false }, beginAtZero: true, title: { display: true, text: DEV(), color: C_MUTED } }
        }
      })
    });
    const meds = ps.map(p => ({ p, m: median(dep.filter(t => t.person === p).map(t => t.amount)) })).sort((a, b) => b.m - a.m);
    read(root, 'anStrip', meds.length > 1
      ? `Dépôt médian le plus élevé : <b>${esc(meds[0].p)}</b> (${fmt(meds[0].m)} ${DEV()}) ; le plus faible : <b>${esc(meds[meds.length - 1].p)}</b> (${fmt(meds[meds.length - 1].m)} ${DEV()}). Le test statistique (section 5) indique si cet écart est significatif.`
      : `Dépôt médian de <b>${esc(meds[0].p)}</b> : ${fmt(meds[0].m)} ${DEV()}.`);
  }

  /* ---- 3a. Mensuel ---- */
  function drawMonthly(root, tx) {
    const months = [...new Set(tx.map(t => monthKey(t.ts)))].sort();
    const agg = type => months.map(m => sum(tx.filter(t => t.type === type && monthKey(t.ts) === m).map(t => t.amount)));
    const ins = agg('deposit'), outs = agg('consumption');
    makeChart(canvasOf(root, 'anMonthly'), {
      type: 'bar',
      data: {
        labels: months.map(monthFr), datasets: [
          { label: 'Dépôts', data: ins, backgroundColor: C_IN, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 },
          { label: 'Dépenses', data: outs, backgroundColor: C_OUT, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 }
        ]
      },
      options: baseOptions({ interaction: { mode: 'index', intersect: false }, scales: baseOptions().scales })
    });
    const nets = ins.map((v, i) => v - outs[i]);
    const neg = nets.filter(v => v < 0).length;
    read(root, 'anMonthly', `${months.length} mois couvert${months.length > 1 ? 's' : ''}. ${neg ? `<b>${neg}</b> mois avec plus de dépenses que de dépôts.` : 'Aucun mois déficitaire : les dépôts couvrent toujours les dépenses.'}
      <details class="an-table"><summary>Voir les données</summary><table><thead><tr><th>Mois</th><th>Dépôts</th><th>Dépenses</th><th>Net</th></tr></thead><tbody>
      ${months.map((m, i) => `<tr><td>${monthFr(m)}</td><td>${fmt(ins[i])}</td><td>${fmt(outs[i])}</td><td>${fmt(nets[i])}</td></tr>`).join('')}
      </tbody></table></details>`);
  }

  /* ---- 3b. Jour de la semaine ---- */
  function drawWeekday(root, tx) {
    const wd = t => (new Date(t.ts).getDay() + 6) % 7;
    const agg = type => JOURS.map((_, i) => sum(tx.filter(t => t.type === type && wd(t) === i).map(t => t.amount)));
    const ins = agg('deposit'), outs = agg('consumption');
    makeChart(canvasOf(root, 'anWeekday'), {
      type: 'bar',
      data: {
        labels: JOURS, datasets: [
          { label: 'Dépôts', data: ins, backgroundColor: C_IN, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
          { label: 'Dépenses', data: outs, backgroundColor: C_OUT, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 }
        ]
      },
      options: baseOptions({ interaction: { mode: 'index', intersect: false } })
    });
    const peakOut = outs.indexOf(Math.max(...outs)), peakIn = ins.indexOf(Math.max(...ins));
    read(root, 'anWeekday', `${Math.max(...ins) > 0 ? `Les dépôts se font surtout le <b>${JOURS[peakIn].toLowerCase()}</b>.` : ''}
      ${Math.max(...outs) > 0 ? ` Les dépenses culminent le <b>${JOURS[peakOut].toLowerCase()}</b>.` : ' Aucune dépense sur la période.'}`);
  }

  /* ---- 4. Prévision ---- */
  function drawForecast(root, txAll) {
    const series = dailyBalance(txAll);
    const host = root.querySelector('#anModels');
    if (series.length < 6) {
      empty(root, 'anForecast', `La modélisation demande au moins <b>6 jours</b> d'historique (actuellement : ${series.length} jour${series.length > 1 ? 's' : ''}).
        Continuez à enregistrer les dépôts et dépenses : les modèles s'activeront automatiquement.`);
      host.innerHTML = '';
      return;
    }
    const y = series.map(p => p.y);
    const cmp = compareModels(y);
    const bestKey = cmp.best, M = MODELS[bestKey], fitted = M.fit(y);
    const H = 30, lastTs = series[series.length - 1].ts;
    const fc = []; for (let h = 1; h <= H; h++) {
      const f = M.forecast(fitted, h), z = f.tcrit || 1.96;
      fc.push({ ts: lastTs + h * DAY, mean: f.mean, lo: f.mean - z * f.se, hi: f.mean + z * f.se });
    }
    const mco = MODELS.mco.fit(y);
    const labels = [...series.map(p => p.ts), ...fc.map(p => p.ts)].map(ts => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    const pad = arr => [...new Array(series.length - 1).fill(null), y[y.length - 1], ...arr];
    makeChart(canvasOf(root, 'anForecast'), {
      type: 'line',
      data: {
        labels, datasets: [
          { label: 'Borne haute 95 %', data: pad(fc.map(p => p.hi)), borderColor: 'transparent', pointRadius: 0, fill: false },
          { label: 'Borne basse 95 %', data: pad(fc.map(p => p.lo)), borderColor: 'transparent', backgroundColor: 'rgba(57,135,229,0.18)', pointRadius: 0, fill: '-1' },
          { label: 'Solde observé', data: [...y, ...new Array(H).fill(null)], borderColor: C_BAL, backgroundColor: C_BAL, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 },
          { label: 'Tendance linéaire', data: [...y.map((_, i) => mco.icpt + mco.slope * i), ...new Array(H).fill(null)], borderColor: C_TREND, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
          { label: `Prévision — ${M.label}`, data: pad(fc.map(p => p.mean)), borderColor: C_MODEL, backgroundColor: C_MODEL, borderWidth: 2, borderDash: [6, 3], pointRadius: 0, pointHoverRadius: 4 }
        ]
      },
      options: baseOptions({
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: C_TEXT, boxWidth: 14, filter: it => !it.text.startsWith('Borne') } },
          tooltip: {
            filter: it => it.parsed.y !== null && !it.dataset.label.startsWith('Borne'),
            callbacks: { label: c => `${c.dataset.label} : ${fmt(c.parsed.y)} ${DEV()}` }
          }
        },
        scales: {
          x: { ticks: { color: C_MUTED, maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false }, border: { color: C_GRID } },
          y: { ticks: { color: C_MUTED, callback: v => Number(v).toLocaleString('fr-FR') }, grid: { color: C_GRID }, border: { display: false } }
        }
      })
    });

    const end = fc[fc.length - 1];
    const slopePerDay = (end.mean - y[y.length - 1]) / H;
    let targetTxt = '';
    if (typeof DATA !== 'undefined' && DATA && DATA.target && typeof remainingTarget === 'function') {
      const rem = remainingTarget();
      const recent = series.slice(-30), inflow = sum(txAll.filter(t => t.type === 'deposit' && t.ts >= recent[0].ts).map(t => t.amount)) / recent.length;
      if (rem <= 0) targetTxt = ' L\'objectif d\'épargne est déjà atteint.';
      else if (inflow > 0) targetTxt = ` Au rythme de dépôt des 30 derniers jours (${fmt(inflow)} ${DEV()}/jour), l'objectif serait atteint vers le <b>${dateFr(Date.now() + Math.ceil(rem / inflow) * DAY)}</b>.`;
      else targetTxt = ' Aucun dépôt récent : l\'objectif ne peut pas être projeté.';
    }
    read(root, 'anForecast', `Modèle retenu : <b>${M.label}</b>. Solde prévu dans 30 jours : <b>${fmt(end.mean)} ${DEV()}</b>
      (intervalle à 95 % : ${fmt(end.lo)} à ${fmt(end.hi)} ${DEV()}), soit ${slopePerDay >= 0 ? '+' : ''}${fmt(slopePerDay)} ${DEV()} par jour.
      ${end.lo < 0 && end.mean > 0 ? 'Le bas de l\'intervalle passe sous zéro : risque réel de caisse vide.' : end.mean < 0 ? '<b>Alerte :</b> la caisse serait vide avant 30 jours sans nouveaux dépôts.' : ''}${targetTxt}`);

    const r2 = mco.r2;
    host.innerHTML = `
      <div class="tablewrap"><table class="an-models">
        <thead><tr><th>Modèle</th><th>MAE (${DEV()})</th><th>RMSE (${DEV()})</th><th>Verdict</th></tr></thead>
        <tbody>${cmp.rows.map((r, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${r.label}</td><td>${fmt(r.mae)}</td><td>${fmt(r.rmse)}</td>
          <td>${i === 0 ? '✅ Retenu' : `+${pct(cmp.rows[0].mae ? (r.mae - cmp.rows[0].mae) / cmp.rows[0].mae : 0)} d'erreur`}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="explain">
        <b>Protocole :</b> les ${cmp.hTest} derniers jours ont été cachés ; chaque modèle a été entraîné sur les ${cmp.nTrain} jours précédents,
        puis sa prévision a été comparée au solde réel. <b>MAE</b> = erreur moyenne absolue, <b>RMSE</b> = erreur quadratique (pénalise les grosses erreurs).
        Le modèle le plus précis est ensuite ré-entraîné sur tout l'historique.
        ${bestKey === 'holt' ? `Paramètres de Holt optimisés : α = ${num(fitted.alpha)} (niveau), β = ${num(fitted.beta)} (tendance).` : ''}
        ${bestKey === 'holtwinters' ? `Paramètres optimisés : α = ${num(fitted.alpha)} (niveau), β = ${num(fitted.beta)} (tendance), γ = ${num(fitted.gamma)} (cycle hebdomadaire).` : ''}
        ${cmp.rows.length < 5 ? `<br><i>Le modèle saisonnier de Holt-Winters entre en compétition à partir de 4 semaines d'historique (cycle hebdomadaire).</i>` : ''}
        La régression linéaire explique <b>${pct(r2)}</b> de la variance du solde (R²)${r2 < 0.5 ? ' : le solde suit mal une droite, d\'où l\'intérêt de comparer plusieurs modèles' : ''}.
        ${cmp.rows[0].key === 'naif' ? 'Le modèle naïf gagne : les mouvements récents sont peu prévisibles, aucune tendance fiable ne se dégage encore.' : ''}
      </div>`;
  }

  /* ---- 5. Comparaison des membres ---- */
  function renderCompare(root, persons, dep, out, giniVal) {
    const host = root.querySelector('#anCompare');
    if (!persons.length) { host.innerHTML = `<div class="explain">Aucune donnée sur la période.</div>`; return; }
    const totalIn = sum(dep.map(t => t.amount)) || 1;
    const rows = persons.map(p => {
      const d = dep.filter(t => t.person === p).map(t => t.amount), o = out.filter(t => t.person === p).map(t => t.amount);
      return { p, n: d.length, tot: sum(d), share: sum(d) / totalIn, mean: mean(d), med: median(d), sd: sd(d), out: sum(o) };
    });
    const fair = 1 / persons.length;
    const kw = kruskalWallis(persons.map(p => dep.filter(t => t.person === p).map(t => t.amount)));
    let kwTxt;
    if (!kw || kw.minN < 2) {
      kwTxt = `<b>Test de Kruskal-Wallis :</b> non applicable pour l'instant — il faut au moins 2 membres ayant chacun au moins 2 dépôts.`;
    } else {
      const sig = kw.p < 0.05;
      kwTxt = `<b>Test de Kruskal-Wallis</b> (les montants déposés diffèrent-ils selon le membre ?) : H = ${num(kw.H)}, ddl = ${kw.df}, <b>p ${pFmt(kw.p)}</b>, taille d'effet η² = ${num(kw.eta2)}.
        ${sig ? 'Au seuil de 5 %, <b>les membres ne déposent pas des montants comparables</b> : la différence n\'est pas due au hasard.' : 'Au seuil de 5 %, <b>aucune différence significative</b> : les écarts observés peuvent s\'expliquer par le hasard.'}
        ${kw.minN < 5 ? '<br><i>Prudence : moins de 5 dépôts pour au moins un membre, la puissance du test est faible.</i>' : ''}`;
    }
    host.innerHTML = `
      <div class="tablewrap"><table>
        <thead><tr><th>Membre</th><th>Dépôts</th><th>Total déposé</th><th>Part</th><th>Écart à la part égale</th><th>Moyenne</th><th>Médiane</th><th>Écart-type</th><th>Dépensé</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><span class="avatar-wrap">${typeof avatarHTML === 'function' ? avatarHTML(r.p, 'sm') : ''} ${esc(r.p)}</span></td>
          <td>${r.n}</td><td>${fmt(r.tot)}</td><td>${pct(r.share)}</td>
          <td style="color:${r.share - fair >= 0 ? C_IN : C_OUT}">${r.share - fair >= 0 ? '+' : '−'}${pct(Math.abs(r.share - fair))}</td>
          <td>${r.n ? fmt(r.mean) : '—'}</td><td>${r.n ? fmt(r.med) : '—'}</td><td>${r.n > 1 ? fmt(r.sd) : '—'}</td><td>${fmt(r.out)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="explain">
        ${persons.length > 1 ? `<b>Indice de Gini des contributions = ${num(giniVal)}</b> (0 = tout le monde verse la même somme, 1 = une seule personne verse tout) :
        ${giniVal < 0.2 ? 'contributions <b>équilibrées</b>.' : giniVal < 0.4 ? 'déséquilibre <b>modéré</b>.' : 'contributions <b>très inégales</b> — à discuter entre colocataires.'}` : `<b>Indice de Gini :</b> calculable dès que deux membres ont déposé.`}
        Part égale attendue : ${pct(fair)} par membre.<br>${kwTxt}
      </div>`;
  }

  /* ---- 6. Anomalies ---- */
  function renderAnomalies(root, tx) {
    const host = root.querySelector('#anAnomalies');
    const parts = [['deposit', 'dépôts', 'dépôt', 'inhabituel'], ['consumption', 'dépenses', 'dépense', 'inhabituelle']].map(([type, name, one, adj]) => {
      const list = tx.filter(t => t.type === type);
      if (list.length < 5) return { name, note: `${list.length} ${name} : au moins 5 sont nécessaires.` };
      const vals = list.map(t => t.amount), med = median(vals), m = mad(vals);
      if (!m) return { name, note: `Plus de la moitié des ${name} ont le même montant (${fmt(med)} ${DEV()}) : pas de dispersion à analyser.` };
      const flagged = list.map(t => ({ t, z: 0.6745 * (t.amount - med) / m })).filter(o => Math.abs(o.z) > 3.5);
      return { name, one, adj, med, flagged };
    });
    const flagged = parts.flatMap(p => (p.flagged || []).map(o => ({ ...o, name: p.name })));
    host.innerHTML = `
      ${flagged.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Date</th><th>Membre</th><th>Type</th><th>Montant</th><th>z robuste</th></tr></thead>
        <tbody>${flagged.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).map(o => `<tr><td>${dateFr(o.t.ts)}</td><td>${esc(o.t.person)}</td>
          <td>${o.t.type === 'deposit' ? 'Dépôt' : 'Dépense'}</td><td>${fmt(o.t.amount)} ${DEV()}</td><td>${num(o.z)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}
      <div class="explain">
        ${parts.map(p => p.note ? p.note : (p.flagged.length ? `<b>${p.flagged.length}</b> ${p.flagged.length > 1 ? p.name : p.one} ${p.adj}${p.flagged.length > 1 ? 's' : ''}` : `Aucun${p.adj.endsWith('e') ? 'e' : ''} ${p.one} ${p.adj}`) + ` sur la période (montant médian ${fmt(p.med)} ${DEV()}).`).join('<br>')}
        <br>Une opération est signalée quand son montant s'écarte fortement de l'habitude (|z| &gt; 3,5, calculé avec la médiane et la MAD, insensibles aux valeurs extrêmes).
        Ce n'est pas forcément une erreur : vérifiez simplement qu'elle est correcte.
      </div>`;
  }

  window.panelAnalytics = panelAnalytics;
  window.AloysStats = { quantile, median, mad, sd, gini, kruskalWallis, chi2Sf, compareModels, MODELS, dailyBalance, fdBins };
})();
