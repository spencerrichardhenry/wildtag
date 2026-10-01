// The emitter-level difference between two designs (spec §7): which weapons vanish, which move, which bindings break.
import type { ActiveSlot, AbilityBinding, CombatLoadout, EmitterSource } from './combat-types';
import type { Genome, PlacedPart } from './genome';
import { PARTS, type PartSpec } from './parts';

export type PartEmitterSource = Extract<EmitterSource, { kind: 'part' }>;
export interface DesignDelta { removedEmitters: PartEmitterSource[]; changedEmitters: PartEmitterSource[]; clearedBindings: { slot: ActiveSlot; binding: AbilityBinding; reason: 'part removed' | 'grant missing' }[] }

/** Per part, copy 0 then copy 1 if mirrored, sockets in catalog order. */
export function emittersOf(g: Genome, catalog: readonly PartSpec[] = PARTS): PartEmitterSource[] {
  const out: PartEmitterSource[] = [];
  for (const placed of g.parts) {
    const spec = catalog.find(s => s.id === placed.id); if (!spec) continue;
    for (const copy of placed.mirror ? [0, 1] as const : [0] as const) for (const s of spec.sockets) out.push({ kind: 'part', partUid: placed.uid, copy, socketId: s.id });
  }
  return out;
}
const keyOf = (e: PartEmitterSource) => `${e.partUid}:${e.copy}:${e.socketId}`;
const moved = (a: PlacedPart, b: PlacedPart) => a.id !== b.id || a.t !== b.t || a.angle !== b.angle || a.roll !== b.roll || a.scale !== b.scale || a.mirror !== b.mirror;
const sameSpine = (a: Genome['spine'], b: Genome['spine']) => a.length === b.length && a.every((s, i) => { const o = b[i]!; return (Object.keys(s) as (keyof typeof s)[]).every(k => s[k] === o[k]) && Object.keys(o).length === Object.keys(s).length; });

export function designDelta(oldG: Genome, newG: Genome, loadout: CombatLoadout, catalog: readonly PartSpec[] = PARTS): DesignDelta {
  const now = new Set(emittersOf(newG, catalog).map(keyOf)), reshaped = !sameSpine(oldG.spine, newG.spine);
  const removedEmitters: PartEmitterSource[] = [], changedEmitters: PartEmitterSource[] = [];
  for (const e of emittersOf(oldG, catalog)) {
    if (!now.has(keyOf(e))) { removedEmitters.push(e); continue; }
    const before = oldG.parts.find(p => p.uid === e.partUid)!, after = newG.parts.find(p => p.uid === e.partUid)!;
    if (reshaped || moved(before, after)) changedEmitters.push(e);
  }
  const clearedBindings: DesignDelta['clearedBindings'] = [];
  loadout.active.forEach((binding, i) => {
    if (!binding) return;
    const placed = newG.parts.find(p => p.uid === binding.partUid);
    if (!placed) { clearedBindings.push({ slot: i as ActiveSlot, binding, reason: 'part removed' }); return; }
    if (!catalog.find(s => s.id === placed.id)?.activeGrants.some(g => g.id === binding.grantId)) clearedBindings.push({ slot: i as ActiveSlot, binding, reason: 'grant missing' });
  });
  return { removedEmitters, changedEmitters, clearedBindings };
}
