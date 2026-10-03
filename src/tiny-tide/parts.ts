// Creature parts for the editor. Each part is a Blender GLB named `part_<id>`.
// See docs/TINY-TIDE-EVOLUTION.md for the attach conventions.
import type { CombatSocket, CombatTrait, MoveKind, PartCombatFields, PivotRef } from './combat-types';
export type PartKind = 'mouth' | 'eye' | 'fin' | 'tail' | 'leg' | 'wing' | 'jet' | 'arm' | 'armor' | 'sense' | 'cosmic';
export type Diet = 'herbivore' | 'carnivore' | 'omnivore';
export type TintSlot = 'base' | 'belly' | 'accent';
export interface Stats { speed: number; bite: number; reach: number; armor: number; health: number; sense: number; stealth: number }
export interface PartSpec extends PartCombatFields {
  id: string; name: string; kind: PartKind; stage: number; cost: number; stats: Partial<Stats>;
  tint: TintSlot; mirror: boolean; diet?: Diet; blurb: string;
  /** Where the editor puts a new part: t along the body, angle around it. */
  t: number; angle: number;
  /** An alpha reward: in the editor only when unlocked (spec §7.6). */
  rare?: true;
  /** The part whose GLB, rig and sockets this part uses (default `id`). */
  model?: string;
  /** A rare part's colour on its tint meshes (instead of the paint slot), so it reads as a new part on a reused model (spec §7.6, D24). */
  modelTint?: string;
}
/** The move kind each move-giving part grants (spec §7.1). Mouths give the basic Bite instead. */
export const PART_MOVES: Readonly<Record<string, MoveKind>> = {
  claw_pincer: 'grab', claw_mother: 'grab', spike: 'counter', shell_plate: 'brace',
  fin_side: 'dash', fin_dorsal: 'dash', fin_frill: 'dash', tail_paddle: 'dash', leg_little: 'dash', leg_crab: 'dash',
  tail_fan: 'sweep', tail_fluke: 'sweep',
};
const W: CombatTrait[] = ['weapon'], WL: CombatTrait[] = ['weapon', 'locomotion'], PR: CombatTrait[] = ['protection'], L: CombatTrait[] = ['locomotion'];
const TRAITS: Record<string, readonly CombatTrait[]> = {
  claw_pincer: W, horn: W, tentacle: W, tentacle_long: W, tail_paddle: WL, tail_fan: WL, tail_fluke: WL,
  spike: PR, shell_plate: PR, tower: PR, leg_crab: ['locomotion', 'protection'],
  fin_side: L, fin_dorsal: L, leg_little: L, wing_feather: L, jet_vent: L, nebula_fin: L, fin_frill: ['locomotion', 'concealment'], cloak_fronds: ['concealment'], eye_big: ['concealment'],
};
const UP = { x: 0, y: 1, z: 0 };
const socket = (id: string, y: number, z: number, pivot?: PivotRef, x = 0, forward = UP): CombatSocket => ({ id, ...(pivot ? { pivot } : {}), origin: { x, y, z }, forward });
const mouth = (y: number) => [socket('bite', y, 0, { kind: 'jaw', index: 0 })];
const SOCKETS: Record<string, readonly CombatSocket[]> = {
  mouth_nibbler: mouth(.3), mouth_snapper: mouth(.5), mouth_beak: mouth(.6), mouth_filter: mouth(.3), mouth_fangs: mouth(.3), mouth_maw: mouth(.35),
  claw_pincer: [socket('pinch', .6, .7, { kind: 'swing', index: 0 }, 0, { x: 0, y: 0, z: 1 })],
  horn: [socket('gore', .75, .2)], spike: [socket('spike', .5, 0)],
  tentacle: [socket('lash', .9, .3, { kind: 'seg', index: 3 })], tentacle_long: [socket('lash', 1.5, .5, { kind: 'seg', index: 4 })],
  tail_paddle: [socket('slap', 1.1, 0, { kind: 'seg', index: 3 })], tail_fan: [socket('slap', 1.1, 0, { kind: 'seg', index: 2 })], tail_fluke: [socket('slap', 1, 0, { kind: 'seg', index: 3 })],
  jet_vent: [socket('thrust', .7, 0)],
};
/** The basic grant of each mouth (spec §7.1). Filter grin, Fangs and Maw reuse the Nibbler, Snapper and Beak rows until 3b (plan decision). */
export const MOUTH_BITES: Readonly<Record<string, string>> = { mouth_nibbler: 'bite-nibbler', mouth_snapper: 'bite-snapper', mouth_beak: 'bite-beak', mouth_filter: 'bite-nibbler', mouth_fangs: 'bite-snapper', mouth_maw: 'bite-beak', mouth_tyrant: 'bite-tyrant' };
/** The ability of each move-giving part (spec §7.1, §7.6). */
export const PART_ABILITIES: Readonly<Record<string, string>> = {
  claw_pincer: 'grab-pincer', claw_mother: 'grab-clawmother', spike: 'counter-spike', shell_plate: 'brace-shell',
  fin_side: 'dash-side-fin', fin_dorsal: 'dash-dorsal-fin', fin_frill: 'dash-frill-fin', tail_paddle: 'dash-paddle-tail', leg_little: 'scuttle-little-leg', leg_crab: 'scuttle-crab-leg',
  tail_fan: 'sweep-fan-tail', tail_fluke: 'sweep-fluke',
};
/** The socket each kind emits from (Brace and Dash have none). */
export const KIND_SOCKETS: Readonly<Record<MoveKind, readonly string[]>> = { grab: ['pinch'], counter: ['spike'], sweep: ['slap'], brace: [], dash: [] };
/** The basic grant of a mouth and the active grant of a move-giving part (grant ids: 'bite' and the move kind). */
const grantsOf = (id: string): Pick<PartSpec, 'basicAttacks' | 'activeGrants'> => {
  const bite = MOUTH_BITES[id], ability = PART_ABILITIES[id], kind = PART_MOVES[id];
  return { basicAttacks: bite ? [{ id: 'bite', attackId: bite, socketIds: ['bite'] }] : [],
    activeGrants: ability && kind ? [{ id: kind, abilityId: ability, socketIds: KIND_SOCKETS[kind], mirrorPolicy: 'shared-cast' }] : [] };
};
const p = (id: string, name: string, kind: PartKind, stage: number, cost: number, stats: Partial<Stats>, tint: TintSlot, mirror: boolean, t: number, angle: number, blurb: string, diet?: Diet): PartSpec =>
  ({ id, name, kind, stage, cost, stats, tint, mirror, t, angle, blurb, diet, traits: TRAITS[id] ?? (kind === 'mouth' ? ['weapon'] : []), sockets: SOCKETS[id] ?? [], ...grantsOf(id) });
const HALF = Math.PI / 2;
/** A rare part (spec §7.6, D24): the model part's GLB, rig, sockets, traits and placement, with its own grant, stats, cost and tint. */
const rare = (id: string, name: string, model: string, kind: PartKind, stage: number, cost: number, stats: Partial<Stats>, mirror: boolean, modelTint: string, blurb: string, diet?: Diet): PartSpec => {
  const m = PARTS_BASE.find(x => x.id === model)!;
  return { ...m, id, name, kind, stage, cost, stats, mirror, blurb, diet, rare: true, model, modelTint, ...grantsOf(id) };
};
const PARTS_BASE: readonly PartSpec[] = [
  p('mouth_nibbler', 'Nibbler', 'mouth', 0, 0, { reach: .2 }, 'belly', false, 0, 0, 'Soft lips for plants.', 'herbivore'),
  p('mouth_snapper', 'Snapper', 'mouth', 0, 0, { bite: 1 }, 'belly', false, 0, 0, 'A toothy snap for meat.', 'carnivore'),
  p('mouth_beak', 'Beak', 'mouth', 1, 20, { bite: 1 }, 'accent', false, 0, 0, 'Cracks anything. Eats everything.', 'omnivore'),
  p('mouth_filter', 'Filter grin', 'mouth', 2, 30, { reach: .6 }, 'belly', false, 0, 0, 'A wide grin that sieves greens.', 'herbivore'),
  p('mouth_fangs', 'Fangs', 'mouth', 2, 35, { bite: 3 }, 'belly', false, 0, 0, 'Big smile. Bigger fangs.', 'carnivore'),
  p('mouth_maw', 'Maw', 'mouth', 3, 50, { bite: 3, reach: .4 }, 'belly', false, 0, 0, 'Eats the world, one bite at a time.', 'omnivore'),
  p('eye_bead', 'Bead eye', 'eye', 0, 5, { sense: 1 }, 'base', true, .16, .55, 'A bright little eye.'),
  p('eye_stalk', 'Stalk eye', 'eye', 0, 10, { sense: 2 }, 'base', true, .18, .45, 'See over the sand.'),
  p('eye_big', 'Big eye', 'eye', 1, 15, { sense: 2, stealth: 1 }, 'base', true, .17, .6, 'Spot danger early.'),
  p('eye_compound', 'Compound eye', 'eye', 2, 20, { sense: 3 }, 'accent', true, .17, .6, 'A thousand tiny views.'),
  p('eye_cosmic', 'Cosmic eye', 'eye', 4, 30, { sense: 4 }, 'accent', true, .17, .6, 'Sees across galaxies.'),
  p('fin_side', 'Side fin', 'fin', 0, 10, { speed: .4 }, 'accent', true, .45, HALF + .2, 'A quick little paddle.'),
  p('fin_dorsal', 'Dorsal fin', 'fin', 1, 12, { speed: .2, health: 1 }, 'accent', false, .45, 0, 'Steady and strong.'),
  p('fin_frill', 'Frill fin', 'fin', 1, 18, { speed: .4, stealth: 1 }, 'accent', true, .55, HALF, 'Ruffles that blend in.'),
  p('tail_paddle', 'Paddle tail', 'tail', 0, 10, { speed: .6 }, 'accent', false, 1, 0, 'Push, push, push.'),
  p('tail_fan', 'Fan tail', 'tail', 1, 18, { speed: .9 }, 'accent', false, 1, 0, 'A showy, speedy fan.'),
  p('tail_fluke', 'Fluke', 'tail', 2, 25, { speed: 1.2 }, 'accent', false, 1, 0, 'Whale power.'),
  p('leg_little', 'Little leg', 'leg', 0, 8, { speed: .4 }, 'base', true, .45, HALF + .9, 'Scuttle scuttle.'),
  p('leg_crab', 'Crab leg', 'leg', 1, 14, { speed: .3, armor: 1 }, 'base', true, .5, HALF + .8, 'Pointy, armored and fast.'),
  p('wing_feather', 'Feather wing', 'wing', 3, 30, { speed: 1 }, 'accent', true, .4, HALF - .4, 'Fly, little calamity.'),
  p('jet_vent', 'Jet vent', 'jet', 3, 35, { speed: 1.5 }, 'base', true, .85, HALF + .5, 'Whoosh.'),
  p('claw_pincer', 'Pincer', 'arm', 0, 12, { bite: 1 }, 'accent', true, .2, HALF + .5, 'Pinch first, ask later.'),
  p('tentacle', 'Tentacle', 'arm', 1, 15, { reach: .5 }, 'base', true, .3, HALF + .8, 'Grab the snacks.'),
  p('tentacle_long', 'Long tentacle', 'arm', 3, 30, { reach: 1 }, 'base', true, .35, HALF + .9, 'Reach across the bay.'),
  p('spike', 'Spike', 'armor', 0, 6, { armor: 1 }, 'accent', false, .5, 0, 'Pointy. Nobody bites this.'),
  p('shell_plate', 'Shell plate', 'armor', 1, 14, { armor: 2, speed: -.2 }, 'belly', false, .55, 0, 'A cozy suit of armor.'),
  p('horn', 'Horn', 'armor', 2, 18, { bite: 2 }, 'belly', false, .12, .2, 'A head start in any fight.'),
  p('tower', 'Tower', 'armor', 3, 30, { armor: 3, health: 2 }, 'belly', false, .5, 0, 'A tiny castle. A big defense.'),
  p('antenna', 'Antenna', 'sense', 0, 6, { sense: 1 }, 'accent', true, .1, .35, 'Feel the water move.'),
  p('glow_bulb', 'Glow lure', 'sense', 2, 15, { sense: 1, reach: .3 }, 'accent', false, .08, 0, 'Snacks come to the light.'),
  p('cloak_fronds', 'Cloak fronds', 'sense', 1, 16, { stealth: 2 }, 'accent', false, .5, 0, 'Look like kelp. Be safe.'),
  p('halo', 'Halo', 'cosmic', 4, 40, { health: 3 }, 'accent', false, .2, 0, 'Cosmically wholesome.'),
  p('star_crown', 'Star crown', 'cosmic', 4, 35, { sense: 2, bite: 2 }, 'accent', false, .15, 0, 'Ruler of the snack universe.'),
  p('nebula_fin', 'Nebula fin', 'cosmic', 4, 40, { speed: 2 }, 'accent', true, .5, HALF - .3, 'Swim through the stars.'),
];
export const PARTS: readonly PartSpec[] = [
  ...PARTS_BASE,
  rare('claw_mother', 'Clawmother pincer', 'claw_pincer', 'arm', 0, 18, { bite: 2 }, true, '#b5523b', 'The old queen’s pincer. Holds bigger prey.'),
  rare('mouth_tyrant', 'Tyrant jaw', 'mouth_fangs', 'mouth', 1, 30, { bite: 2 }, false, '#6b3f7a', 'The reef’s worst bite. Now yours.', 'carnivore'),
];
export type PartId = typeof PARTS[number]['id'];
const byId = new Map(PARTS.map(part => [part.id, part]));
export const part = (id: string): PartSpec | undefined => byId.get(id);
/** The part whose GLB and rig a part uses (a rare part reuses its model's). */
export const modelOf = (id: string): string => part(id)?.model ?? id;
/** The part GLBs to load, once each. */
export const PART_ASSETS = [...new Set(PARTS.map(p => `part_${p.model ?? p.id}`))];
/** Defeating a species that fights unlocks one part before its stage. */
export const DROPS: Partial<Record<string, string>> = { crab: 'leg_crab', jellyfish: 'glow_bulb', squid: 'tentacle_long', plane: 'jet_vent' };
export const KIND_LABELS: Record<PartKind, string> = { mouth: 'Mouths', eye: 'Eyes', fin: 'Fins', tail: 'Tails', leg: 'Legs', wing: 'Wings', jet: 'Jets', arm: 'Arms', armor: 'Armor', sense: 'Senses', cosmic: 'Cosmic' };
