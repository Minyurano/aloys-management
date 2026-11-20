import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, F, tx } from './helpers.mjs';

const now = new Date(2026, 10, 20, 12);
const d = days => new Date(2026, 10, 20 - days, 10);
const members = ['MINYURANO Aloys', 'NIBITANGA Billy', 'IRAKOZE Alain'];
const data = [
  tx('1', d(30), 'deposit', 'MINYURANO Aloys', 600), tx('2', d(30), 'deposit', 'NIBITANGA Billy', 300),
  tx('3', d(25), 'deposit', 'IRAKOZE Alain', 150), tx('4', d(10), 'consumption', 'NIBITANGA Billy', 220, { categorie: 'courses', description: 'Marjane' }),
  tx('5', d(5), 'consumption', 'IRAKOZE Alain', 90, { categorie: 'transport' }), tx('6', d(2), 'deposit', 'NIBITANGA Billy', 100),
  tx('7', d(40), 'deposit', 'MINYURANO Aloys', 200)
];

test('Équilibre : les soldes s\'annulent et le règlement remet tout le monde à zéro', () => {
  for (const mode of ['egal', 'prorata']) {
    const pos = F.positions(data, members, mode);
    assert.ok(Math.abs(pos.rows.reduce((s, r) => s + r.solde, 0)) < 1e-9);
    const t = F.regler(pos.rows);
    assert.ok(t.length <= members.length - 1, 'au plus n-1 virements');
    const after = Object.fromEntries(pos.rows.map(r => [r.p, r.solde]));
    t.forEach(x => { after[x.de] += x.montant; after[x.a] -= x.montant; });
    Object.values(after).forEach(v => assert.ok(Math.abs(v) < 0.02));
  }
});

test('Équilibre à parts égales : valeurs attendues', () => {
  const t = F.regler(F.positions(data, members, 'egal').rows);
  assert.deepEqual(t, [
    { de: 'IRAKOZE Alain', a: 'MINYURANO Aloys', montant: 300 },
    { de: 'NIBITANGA Billy', a: 'MINYURANO Aloys', montant: 50 }
  ]);
});

test('Classifieur : catégories des exemples courants', () => {
  const cas = {
    'Marjane huile riz': 'courses', 'facture Amendis novembre': 'energie', 'recharge inwi 50': 'internet',
    'taxi gare': 'transport', 'pharmacie doliprane': 'sante', 'photocopie cours FST': 'etudes',
    'pizza anniversaire': 'loisirs', 'loyer décembre': 'loyer', 'Javel et savon': 'menage', 'ampoule cuisine': 'equipement'
  };
  for (const [txt, cat] of Object.entries(cas)) assert.equal(C.suggerer(txt, []).categorie, cat, txt);
  assert.equal(C.suggerer('truc bizarre', []).categorie, null);
});

test('Classifieur : apprend les habitudes du foyer', () => {
  const h = [{ description: 'Hanout Si Mohamed', categorie: 'courses' }, { description: 'Chez Karim pressing', categorie: 'menage' }];
  assert.equal(C.suggerer('Si Mohamed', h).categorie, 'courses');
  assert.equal(C.suggerer('pressing Karim', h).categorie, 'menage');
});

test('Budgets : statut et projection de fin de mois', () => {
  const e = F.etatBudgets(data, { courses: 100, transport: 1000 }, now);
  const courses = e.find(r => r.id === 'courses'), transport = e.find(r => r.id === 'transport');
  assert.equal(courses.statut, 'depasse');
  assert.equal(transport.statut, 'ok');
  assert.ok(Math.abs(courses.proj - 220 / 20 * 30) < 1e-9);
});

test('Assistant : périodes', () => {
  assert.equal(F.periode('en octobre', now).label, 'en octobre 2026');
  assert.equal(F.periode('le mois dernier', now).label, 'en octobre');
  assert.equal(F.periode('les 7 derniers jours', now).label, 'sur les 7 derniers jours');
  assert.equal(F.periode('quelque chose', now).all, true);
});

test('Assistant : réponses aux questions courantes', () => {
  const ctx = { tx: data, members, me: 'MINYURANO Aloys', now };
  const r = q => F.repondre(q, ctx).text.replace(/<[^>]+>/g, '').replace(/[\u202f\u00a0]/g, ' ');
  assert.match(r('Quel est le solde de la caisse ?'), /1 040,00/);
  assert.match(r('Combien Billy a déposé ce mois-ci ?'), /NIBITANGA Billy a déposé 100,00/);
  assert.match(r("Combien j'ai déposé en octobre ?"), /MINYURANO Aloys a déposé 800,00/);
  assert.match(r('Qui a le plus dépensé ?'), /NIBITANGA Billy/);
  assert.match(r('Combien de dépôts ?'), /5 dépôts/);
  assert.match(r('dépenses en courses'), /220,00/);
  assert.match(r('Qui doit combien ?'), /équilibrer/);
  assert.match(r('blabla'), /pas compris/);
});
