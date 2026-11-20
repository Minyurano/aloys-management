// Charge les modules du navigateur dans Node (ils s'attachent à globalThis)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../categories.js');
require('../analytics.js');
require('../features.js');
export const S = globalThis.AloysStats;
export const C = globalThis.AloysCategories;
export const F = globalThis.AloysFeatures;

export function tx(id, date, type, person, amount, extra = {}) {
  const iso = date.toISOString();
  return { id, iso, ts: date.getTime(), type, person, amount, ...extra };
}
