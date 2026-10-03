// The emitter-level difference between two designs (spec §7): which weapons vanish, which move, which pins clear.
import type { ActiveSlot, CombatLoadout, EmitterSource, MoveKind } from './combat-types';
import type { Genome, PlacedPart } from './genome';
import { PARTS, type PartSpec } from './parts';
import { grantedKinds, movesOf } from './moves';

export type PartEmitterSource = Extract<EmitterSource, { kind: 'part' }>;
/** `clearedPins`: pins whose kind the new design no longer grants (spec §7.2); `lostKinds`: every kind the old design granted and the new one does not. */
export interface DesignDelta { removedEmitters: PartEmitterSource[]; changedEmitters: PartEmitterSource[]; clearedPins: { slot: ActiveSlot; kind: MoveKind }[]; lostKinds: MoveKind[] }

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
  const before = grantedKinds(movesOf(oldG, catalog)), after = grantedKinds(movesOf(newG, catalog));
  const clearedPins: DesignDelta['clearedPins'] = [];
  loadout.slots.forEach((kind, i) => { if (kind && !after.includes(kind)) clearedPins.push({ slot: i as ActiveSlot, kind }); });
  return { removedEmitters, changedEmitters, clearedPins, lostKinds: before.filter(k => !after.includes(k)) };
}
