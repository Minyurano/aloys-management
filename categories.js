/* =====================================================================
   ALOYS MANAGEMENT — Catégories de dépenses et classement automatique
   Classifieur bayésien naïf multinomial (lissage de Laplace) :
   - amorcé par un lexique de mots-clés adapté au Maroc (enseignes, services),
   - puis enrichi par l'historique du foyer (chaque dépense catégorisée
     devient un exemple d'apprentissage : le modèle apprend vos habitudes).
   Fonctionne entièrement dans le navigateur.
   ===================================================================== */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'courses',    label: 'Courses & alimentation', icon: '🛒' },
    { id: 'loyer',      label: 'Loyer & charges',        icon: '🏠' },
    { id: 'energie',    label: 'Eau, électricité & gaz', icon: '⚡' },
    { id: 'internet',   label: 'Internet & téléphone',   icon: '📶' },
    { id: 'transport',  label: 'Transport',              icon: '🚕' },
    { id: 'sante',      label: 'Santé',                  icon: '💊' },
    { id: 'etudes',     label: 'Études & fournitures',   icon: '📚' },
    { id: 'menage',     label: 'Hygiène & ménage',       icon: '🧴' },
    { id: 'loisirs',    label: 'Loisirs & sorties',      icon: '🎉' },
    { id: 'equipement', label: 'Équipement & réparations', icon: '🛋️' },
    { id: 'autre',      label: 'Autre',                  icon: '📦' }
  ];

  const LEXIQUE = {
    courses: 'marjane carrefour bim acima labelvie aswak assalam hanout epicerie epicier supermarche marche souk pain boulangerie lait oeuf huile riz farine sucre the legume fruit viande poulet poisson fromage yaourt pate tomate oignon pomme banane minerale sidi ali saiss coca jus semoule couscous lentille haricot beurre confiture courses alimentation nourriture provision kefta sardine harira msemen datte olive epice sel',
    loyer: 'loyer location proprietaire bail caution syndic charge appartement chambre logement immobilier mensualite',
    energie: 'amendis lydec redal radeef onee electricite eau compteur gaz butane bouteille courant chauffe facture_eau facture_electricite',
    internet: 'telecom iam inwi orange wifi internet fibre adsl recharge telephone forfait mobile sim 4g 5g box abonnement',
    transport: 'taxi tram tramway bus alsa ctm oncf train boraq careem indrive uber heetch essence carburant gasoil parking autoroute billet trajet',
    sante: 'pharmacie medicament medecin docteur clinique hopital analyse dentiste ordonnance vaccin lunette consultation radio',
    etudes: 'livre cahier stylo photocopie impression imprimerie inscription universite faculte fst cours formation usb papeterie memoire reliure manuel',
    menage: 'savon detergent javel tide ariel omo papier toilette mouchoir shampoing dentifrice brosse eponge balai serpillere poubelle lessive vaisselle nettoyage menage',
    loisirs: 'restaurant cafe snack pizza tacos burger cinema sortie anniversaire cadeau match football sport gym netflix spotify jeu voyage plage fete glace',
    equipement: 'reparation plombier electricien ampoule meuble matelas chaise table ventilateur frigo refrigerateur machine casserole poele assiette rideau serrure outil ustensile cle',
    autre: ''
  };

  const STOP = new Set('de des du la le les un une et en au aux pour par avec sur dans chez a d l mad dh dhs dirham dirhams achat paiement payer paye frais total'.split(' '));

  function normaliser(txt) {
    return String(txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function tokens(txt) {
    return normaliser(txt).split(/[^a-z0-9_]+/)
      .filter(t => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))
      .map(t => (t.length > 4 ? t.replace(/(s|x)$/, '') : t));
  }

  class NaiveBayes {
    constructor() { this.docs = {}; this.words = {}; this.totals = {}; this.vocab = new Set(); }
    learn(text, cat, poids = 1) {
      const toks = tokens(text);
      if (!toks.length) return;
      this.docs[cat] = (this.docs[cat] || 0) + poids;
      this.words[cat] = this.words[cat] || {};
      toks.forEach(t => {
        this.words[cat][t] = (this.words[cat][t] || 0) + poids;
        this.totals[cat] = (this.totals[cat] || 0) + poids;
        this.vocab.add(t);
      });
    }
    predict(text) {
      const toks = tokens(text).filter(t => this.vocab.has(t));
      if (!toks.length) return { categorie: null, confiance: 0, scores: [] };
      const cats = Object.keys(this.docs);
      const nDocs = cats.reduce((s, c) => s + this.docs[c], 0);
      const V = this.vocab.size;
      const logs = cats.map(c => {
        let s = Math.log(this.docs[c] / nDocs);
        toks.forEach(t => { s += Math.log(((this.words[c][t] || 0) + 1) / (this.totals[c] + V)); });
        return { c, s };
      });
      const mx = Math.max(...logs.map(l => l.s));
      const ex = logs.map(l => ({ c: l.c, p: Math.exp(l.s - mx) }));
      const z = ex.reduce((s, e) => s + e.p, 0);
      const scores = ex.map(e => ({ categorie: e.c, p: e.p / z })).sort((a, b) => b.p - a.p);
      return { categorie: scores[0].categorie, confiance: scores[0].p, scores };
    }
  }

  // Construit le modèle : lexique (amorce) + historique du foyer (apprentissage)
  function entrainer(historique) {
    const nb = new NaiveBayes();
    Object.entries(LEXIQUE).forEach(([cat, mots]) => {
      if (mots) nb.learn(mots.replace(/_/g, ' '), cat, 1); // un document par catégorie : a priori uniforme
    });
    (historique || []).forEach(h => {
      if (h && h.description && h.categorie && h.categorie !== 'autre') nb.learn(h.description, h.categorie, 3);
    });
    return nb;
  }

  let modele = null, signature = '';
  function historiqueCourant() {
    try {
      // eslint-disable-next-line no-undef
      const tx = (typeof DATA !== 'undefined' && DATA && DATA.transactions) || [];
      return tx.filter(t => t.type === 'consumption' && t.description && t.categorie)
        .map(t => ({ description: t.description, categorie: t.categorie }));
    } catch (e) { return []; }
  }
  function suggerer(description, historique) {
    const h = historique || historiqueCourant();
    const sig = h.length + ':' + (h.length ? h[h.length - 1].description : '');
    if (!modele || sig !== signature) { modele = entrainer(h); signature = sig; }
    return modele.predict(description);
  }

  const parId = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  const libelle = id => { const c = parId(id || 'autre'); return `${c.icon} ${c.label}`; };
  const categorieDe = t => (t && t.categorie && CATEGORIES.some(c => c.id === t.categorie) ? t.categorie : 'autre');

  root.AloysCategories = { CATEGORIES, LEXIQUE, tokens, normaliser, NaiveBayes, entrainer, suggerer, parId, libelle, categorieDe };
})(typeof window !== 'undefined' ? window : globalThis);
