import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S } from './helpers.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('Kruskal-Wallis : identique à scipy.stats.kruskal', () => {
  const r = S.kruskalWallis([[100, 200, 150, 300, 250], [50, 60, 80, 70], [400, 380, 500, 450, 410, 390]]);
  close(r.H, 12.375);                 // scipy : statistic=12.375
  close(r.p, 0.00205495773120946, 1e-12); // scipy : pvalue=0.00205495773120946
  assert.equal(r.df, 2);
});

test('Kruskal-Wallis : correction des ex aequo', () => {
  const r = S.kruskalWallis([[1, 2, 2, 3], [2, 3, 3, 4], [4, 4, 5, 5]]);
  close(r.H, 8.018315018315018, 1e-9);   // scipy.stats.kruskal([1,2,2,3],[2,3,3,4],[4,4,5,5])
  close(r.p, 0.01814867889349773, 1e-12);
});

test('Loi du khi-deux : fonction de survie', () => {
  close(S.chi2Sf(3.841, 1), 0.050013683763956804, 1e-12);
  close(S.chi2Sf(10, 4), 0.04042768199451279, 1e-12);
});

test('Indice de Gini', () => {
  assert.equal(S.gini([100, 100, 100, 100]), 0);
  close(S.gini([0, 0, 0, 400]), 0.75);
  close(S.gini([50, 100, 150, 700]), 0.5);
});

test('Statistiques robustes : quantiles (type 7) et MAD', () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  close(S.quantile(a, 0.25), 3.25);
  close(S.median(a), 5.5);
  close(S.mad([1, 1, 2, 2, 4, 6, 9]), 1);
});

test('Histogramme : classes de Freedman-Diaconis et classe des valeurs extrêmes', () => {
  const b = S.fdBins([100, 150, 175, 200, 220, 250, 300, 2400]);
  assert.deepEqual(b.edges, [100, 200, 300, 400, 500, 600]);
  assert.equal(b.overflow, 600);
});

test('Comparaison de modèles : une série linéaire est mieux prévue par une tendance que par le modèle naïf', () => {
  const y = Array.from({ length: 30 }, (_, i) => 100 + 25 * i);
  const cmp = S.compareModels(y);
  assert.notEqual(cmp.best, 'naif');
  const naif = cmp.rows.find(r => r.key === 'naif');
  assert.ok(cmp.rows[0].mae < naif.mae);
});

test('Comparaison de modèles : Holt-Winters gagne sur une série à cycle hebdomadaire', () => {
  const y = Array.from({ length: 63 }, (_, i) => i * 20 + (i % 7 >= 5 ? 300 : 0));
  assert.equal(S.compareModels(y).best, 'holtwinters');
});

test('Comparaison de modèles : moins de 6 points, pas de comparaison', () => {
  assert.equal(S.compareModels([1, 2, 3, 4, 5]), null);
});
