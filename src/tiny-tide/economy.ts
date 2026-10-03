// DNA with provenance. Rewards stay "at risk" until the next evolution banks
// them. Basis is what an installed part is worth; credit is what a refund can
// return. After a forfeit, a part keeps its basis and loses its credit.
import { partCost, type Genome } from './genome';

export interface DnaCredit { banked: number; atRisk: number }
export interface PartLedger { basis: number; credit: DnaCredit }
export interface Economy { wallet: DnaCredit; parts: Record<string, PartLedger> }
export interface Quote { spend: number; release: number; net: number; affordable: boolean; shortfall: number }
const total = (c: DnaCredit) => c.banked + c.atRisk;
export const walletTotal = (e: Economy) => total(e.wallet);
const clone = (e: Economy): Economy => ({ wallet: { ...e.wallet }, parts: Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [k, { basis: v.basis, credit: { ...v.credit } }])) });
export const earn = (e: Economy, amount: number): Economy => { const n = clone(e); n.wallet.atRisk += Math.max(0, Math.floor(amount)); if (!Number.isSafeInteger(total(n.wallet))) throw new RangeError('DNA total overflow'); return n; };
export const legacyEconomy = (dna: number, g: Genome): Economy => ({ wallet: { banked: Math.max(0, Math.floor(dna)), atRisk: 0 }, parts: Object.fromEntries(g.parts.map(p => [p.uid, { basis: partCost(p), credit: { banked: partCost(p), atRisk: 0 } }])) });
/** Takes up to `amount` from `from`, at-risk first. */
function take(from: DnaCredit, amount: number): DnaCredit {
  const atRisk = Math.min(from.atRisk, amount), banked = Math.min(from.banked, amount - atRisk);
  from.atRisk -= atRisk; from.banked -= banked; return { banked, atRisk };
}
const add = (a: DnaCredit, b: DnaCredit) => { a.banked += b.banked; a.atRisk += b.atRisk; };
interface Plan { releases: { uid: string; amount: number }[]; purchases: { uid: string; amount: number }[]; removed: string[]; basis: Record<string, number> }
function planDesign(e: Economy, from: Genome, to: Genome): Plan {
  const before = new Map(from.parts.map(p => [p.uid, p])), plan: Plan = { releases: [], purchases: [], removed: [], basis: {} };
  for (const p of from.parts) if (!to.parts.some(q => q.uid === p.uid)) { plan.removed.push(p.uid); plan.releases.push({ uid: p.uid, amount: total(e.parts[p.uid]?.credit ?? { banked: 0, atRisk: 0 }) }); }
  for (const p of [...to.parts].sort((a, b) => a.uid.localeCompare(b.uid))) {
    const cost = partCost(p); plan.basis[p.uid] = cost;
    if (!before.has(p.uid)) { plan.purchases.push({ uid: p.uid, amount: cost }); continue; }
    const old = e.parts[p.uid]?.basis ?? partCost(before.get(p.uid)!), credit = total(e.parts[p.uid]?.credit ?? { banked: 0, atRisk: 0 });
    if (cost > old) plan.purchases.push({ uid: p.uid, amount: cost - old });
    // Integer arithmetic: never subtract a rounded ratio from 1 (20 × (1 − 18/20) is 1.999… in floating point).
    else if (cost < old && old > 0) plan.releases.push({ uid: p.uid, amount: Math.floor((credit * (old - cost)) / old) });
  }
  return plan;
}
export function quoteDesign(e: Economy, from: Genome, to: Genome): Quote {
  const p = planDesign(e, from, to), spend = p.purchases.reduce((n, x) => n + x.amount, 0), release = p.releases.reduce((n, x) => n + x.amount, 0);
  const shortfall = Math.max(0, spend - release - walletTotal(e));
  return { spend, release, net: spend - release, affordable: shortfall === 0, shortfall };
}
export function commitDesign(e: Economy, from: Genome, to: Genome): { ok: true; economy: Economy } | { ok: false; shortfall: number; invalid?: string[] } {
  const invalid = validateLedger(e, from); if (invalid.length) return { ok: false, shortfall: 0, invalid };   // never refund forged or corrupt credit
  const q = quoteDesign(e, from, to); if (!q.affordable) return { ok: false, shortfall: q.shortfall };
  const n = clone(e), p = planDesign(e, from, to);
  for (const r of p.releases) add(n.wallet, take(n.parts[r.uid]!.credit, r.amount));   // releases first: they fund purchases
  for (const uid of p.removed) delete n.parts[uid];
  for (const b of p.purchases) { const paid = take(n.wallet, b.amount); n.parts[b.uid] ??= { basis: 0, credit: { banked: 0, atRisk: 0 } }; add(n.parts[b.uid]!.credit, paid); }
  for (const [uid, basis] of Object.entries(p.basis)) n.parts[uid]!.basis = basis;
  // Postcondition: the ledger we return must be one the loader accepts.
  const issues = validateLedger(n, to); if (issues.length) throw new Error(`ledger invariant: ${issues.join(', ')}`);
  return { ok: true, economy: n };
}
export function bankAll(e: Economy): Economy { const n = clone(e), bank = (c: DnaCredit) => { c.banked += c.atRisk; c.atRisk = 0; }; bank(n.wallet); Object.values(n.parts).forEach(p => bank(p.credit)); return n; }
/** The faint economy (spec §10.3, R7, D20): every at-risk credit is lost. Basis, design and banked credit stay. */
export function faintCombat(e: Economy): Economy { const n = clone(e); n.wallet.atRisk = 0; for (const p of Object.values(n.parts)) p.credit.atRisk = 0; return n; }
/** What `faintCombat` takes: the at-risk wallet, and the at-risk credit of the parts. */
export function faintLoss(e: Economy): { wallet: number; parts: number } {
  return { wallet: e.wallet.atRisk, parts: Object.values(e.parts).reduce((n, p) => n + p.credit.atRisk, 0) };
}
const dna = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nonNeg = (c: DnaCredit) => !!c && dna(c.banked) && dna(c.atRisk) && Number.isSafeInteger(c.banked + c.atRisk);
export function validateLedger(e: Economy, g: Genome): string[] {
  const out: string[] = [];
  if (!e?.wallet || !nonNeg(e.wallet)) out.push('ledger wallet');
  const uids = new Set(g.parts.map(p => p.uid));
  for (const p of g.parts) {
    const l = e?.parts?.[p.uid];
    if (!l) { out.push(`ledger missing ${p.uid}`); continue; }
    if (!dna(l.basis) || l.basis !== partCost(p)) out.push(`ledger basis ${p.uid}`);
    if (!nonNeg(l.credit) || total(l.credit) > l.basis) out.push(`ledger credit ${p.uid}`);
  }
  for (const uid of Object.keys(e?.parts ?? {})) if (!uids.has(uid)) out.push(`ledger extra ${uid}`);
  return out;
}
