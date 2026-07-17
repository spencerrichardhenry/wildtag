import { describe, expect, it } from 'vitest';
import {
  canFulfill,
  fulfill,
  generateRequest,
  nextReward,
  reroll,
  trackingFillRate,
  UNIQUE_REWARD_COUNT,
  type NpcRequestState,
  type Request,
} from '../src/village/barter.ts';
import { stepTracking } from '../src/tracking/progress.ts';
import { createInventory } from '../src/craft/inventory.ts';
import type { Roster, RosterEntry } from '../src/critters/roster.ts';
import { decodeSave, encodeSave, type SaveV2 } from '../src/core/save.ts';
import type { SpeciesDef } from '../src/core/types.ts';
import { speciesById } from '../src/critters/species.ts';

// ---------------------------------------------------------------------------
// Barter core (pure): request generation, fulfilment, reward track, golden
// dart multiplier, and the save round-trip of the V4 fields.
// ---------------------------------------------------------------------------

function idle(id: number, speciesId: string): RosterEntry {
  return { id, speciesId, nickname: `n${id}`, status: { kind: 'idle' } };
}

describe('generateRequest — determinism', () => {
  it('same (npcId, seq, linked) always yields the same request', () => {
    const linked = new Set(['puffle', 'craghorn']);
    const a = generateRequest('juno', 3, linked);
    const b = generateRequest('juno', 3, new Set(['craghorn', 'puffle'])); // order differs
    expect(a).toEqual(b);
  });

  it('different NPCs / seqs generally diverge', () => {
    const linked = new Set(['puffle', 'craghorn', 'skitterling']);
    const junoReqs = Array.from({ length: 8 }, (_, s) => JSON.stringify(generateRequest('juno', s, linked)));
    const bramReqs = Array.from({ length: 8 }, (_, s) => JSON.stringify(generateRequest('bram', s, linked)));
    // Not a hard guarantee per-index, but the two full sequences must not be identical.
    expect(junoReqs.join('|')).not.toBe(bramReqs.join('|'));
  });
});

describe('reroll', () => {
  const linked = new Set(['puffle', 'craghorn']);
  const state: NpcRequestState = {
    npcId: 'juno',
    seq: 2,
    request: generateRequest('juno', 2, linked),
    fulfilled: 1,
  };

  it('advances seq by one and regenerates the request', () => {
    const next = reroll(state, linked);
    expect(next.seq).toBe(3);
    expect(next.request).toEqual(generateRequest('juno', 3, linked));
  });

  it('grants no reward and consumes nothing (fulfilled unchanged, pure)', () => {
    const next = reroll(state, linked);
    expect(next.fulfilled).toBe(state.fulfilled); // not a fulfilment
    expect(next.npcId).toBe('juno');
    expect(state.seq).toBe(2); // input untouched
  });

  it('is deterministic — same (state, linked) → same next request', () => {
    expect(reroll(state, linked)).toEqual(reroll(state, linked));
  });
});

describe('generateRequest — only-linked-species + fallback', () => {
  it('never requests a species the player has not Linked', () => {
    const linked = new Set(['puffle', 'craghorn']);
    for (let seq = 0; seq < 200; seq++) {
      const req = generateRequest('juno', seq, linked);
      if (req.kind === 'critters') expect(linked.has(req.speciesId)).toBe(true);
    }
  });

  it('always asks for resources when no species are Linked', () => {
    for (let seq = 0; seq < 100; seq++) {
      const req = generateRequest('odd', seq, new Set());
      expect(req.kind).toBe('resources');
    }
  });
});

describe('generateRequest — n ranges', () => {
  it('critter counts respect the rarity-weighted band; resources sit in their bands', () => {
    const linked = new Set(['puffle', 'gloomgobbler']); // puffle common, gloomgobbler rarity 0.3
    let sawCritter = false;
    let sawResource = false;
    for (let seq = 0; seq < 400; seq++) {
      const req = generateRequest('juno', seq, linked);
      if (req.kind === 'critters') {
        sawCritter = true;
        expect(req.n).toBeGreaterThanOrEqual(1);
        const rarity = speciesById(req.speciesId)!.rarity;
        const cap = rarity < 0.4 ? 3 : 5;
        expect(req.n).toBeLessThanOrEqual(cap);
      } else {
        sawResource = true;
        if (req.resource === 'spark') {
          expect(req.n).toBeGreaterThanOrEqual(5);
          expect(req.n).toBeLessThanOrEqual(15);
        } else {
          expect(['fiber', 'resin', 'shard']).toContain(req.resource);
          expect(req.n).toBeGreaterThanOrEqual(20);
          expect(req.n).toBeLessThanOrEqual(60);
        }
      }
    }
    expect(sawCritter).toBe(true);
    expect(sawResource).toBe(true);
  });
});

describe('canFulfill / fulfill — critter consumption', () => {
  const req: Request = { kind: 'critters', speciesId: 'puffle', n: 2 };

  it('consumes the N OLDEST idle entries, leaving assigned entries untouched', () => {
    const roster: Roster = [
      { id: 10, speciesId: 'puffle', nickname: 'A', status: { kind: 'farm', plotId: 0 } }, // protected
      idle(11, 'puffle'), // oldest idle
      idle(12, 'puffle'),
      idle(13, 'puffle'),
      { id: 14, speciesId: 'puffle', nickname: 'M', status: { kind: 'mount' } }, // protected
    ];
    const inv = createInventory();
    expect(canFulfill(req, roster, inv)).toBe(true);

    const res = fulfill(req, roster, inv)!;
    expect(res.delivered.map((e) => e.id)).toEqual([11, 12]); // two oldest idle
    // Remaining keeps the protected farm/mount entries + the untouched idle 13.
    expect(res.roster.map((e) => e.id)).toEqual([10, 13, 14]);
    // Pure: input roster unchanged.
    expect(roster).toHaveLength(5);
  });

  it('canFulfill is false when too few IDLE members exist (assigned do not count)', () => {
    const roster: Roster = [
      idle(1, 'puffle'),
      { id: 2, speciesId: 'puffle', nickname: 'F', status: { kind: 'farm', plotId: 1 } },
    ];
    expect(canFulfill(req, roster, createInventory())).toBe(false);
    expect(fulfill(req, roster, createInventory())).toBeNull();
  });
});

describe('canFulfill / fulfill — resources', () => {
  const req: Request = { kind: 'resources', resource: 'fiber', n: 40 };

  it('spends the resource and returns a new inventory (pure)', () => {
    const inv = createInventory();
    inv.fiber = 55;
    expect(canFulfill(req, [], inv)).toBe(true);
    const res = fulfill(req, [], inv)!;
    expect(res.inventory.fiber).toBe(15);
    expect(res.delivered).toEqual([]);
    expect(inv.fiber).toBe(55); // input untouched
  });

  it('fails when short of the resource', () => {
    const inv = createInventory();
    inv.fiber = 39;
    expect(canFulfill(req, [], inv)).toBe(false);
    expect(fulfill(req, [], inv)).toBeNull();
  });
});

describe('reward track', () => {
  it('follows the fixed unique order with Plot Deed twice, then bundles', () => {
    expect(nextReward(0).id).toBe('saddle');
    expect(nextReward(1).id).toBe('plotDeed');
    expect(nextReward(2).id).toBe('plotDeed');
    expect(nextReward(3).id).toBe('goldenDart');
    expect(nextReward(4).id).toBe('whistle');
    expect(nextReward(5).id).toBe('lanternCharm');
    expect(UNIQUE_REWARD_COUNT).toBe(6);
  });

  it('hands out rotating resource bundles once the uniques run out', () => {
    const b0 = nextReward(6);
    expect(b0.kind).toBe('bundle');
    expect(b0.resource).toBe('fiber');
    expect(b0.amount).toBe(30);
    expect(nextReward(7).resource).toBe('resin');
    expect(nextReward(8).resource).toBe('shard');
    expect(nextReward(9).resource).toBe('spark');
    expect(nextReward(10).resource).toBe('fiber'); // rotation wraps
  });
});

describe('golden dart multiplier (pure)', () => {
  it('trackingFillRate is 1.5 only with the reward owned', () => {
    expect(trackingFillRate(new Set())).toBe(1);
    expect(trackingFillRate(new Set(['saddle']))).toBe(1);
    expect(trackingFillRate(new Set(['goldenDart']))).toBe(1.5);
  });

  it('stepTracking accrues 1.5× faster inside the ring with the multiplier', () => {
    const sp = { trackRadius: 10, trackTime: 100 } as SpeciesDef;
    const base = stepTracking(0, 5, 1, sp); // inside, fillRate 1
    const boosted = stepTracking(0, 5, 1, sp, 1.5); // inside, fillRate 1.5
    expect(base).toBeCloseTo(1);
    expect(boosted).toBeCloseTo(1.5);
    // Outside the ring decay is unaffected by the fill multiplier.
    expect(stepTracking(10, 50, 1, sp, 1.5)).toBeCloseTo(9.5);
  });
});

describe('save round-trip — V4 fields', () => {
  function baseSave(over: Partial<SaveV2>): SaveV2 {
    return {
      v: 2,
      inventory: createInventory(),
      unlocks: [],
      critterPersist: {},
      structures: { ziplines: [], drones: [] },
      player: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
      hints: [],
      roster: [],
      ...over,
    };
  }

  it('round-trips barter / pens / rewards', () => {
    const state = baseSave({
      barter: [{ npcId: 'juno', seq: 2, fulfilled: 2 }],
      pens: [{ npcId: 'juno', speciesId: 'puffle', nickname: 'Beans' }],
      rewards: ['saddle', 'plotDeed', 'plotDeed'],
    });
    const decoded = decodeSave(encodeSave(state));
    expect(decoded?.barter).toEqual(state.barter);
    expect(decoded?.pens).toEqual(state.pens);
    expect(decoded?.rewards).toEqual(state.rewards);
  });

  it('drops malformed barter/pen elements but keeps valid siblings', () => {
    const raw = JSON.stringify(
      baseSave({
        barter: [{ npcId: 'juno', seq: 1, fulfilled: 1 }, { bad: true }],
        pens: [{ npcId: 'bram', speciesId: 'craghorn', nickname: 'Quill' }, { npcId: 5 }],
      } as unknown as Partial<SaveV2>),
    );
    const decoded = decodeSave(raw);
    expect(decoded?.barter).toHaveLength(1);
    expect(decoded?.pens).toHaveLength(1);
  });

  it('a save with no V4 fields decodes without them (backward-compat)', () => {
    const decoded = decodeSave(encodeSave(baseSave({})));
    expect(decoded).not.toBeNull();
    expect('barter' in decoded!).toBe(false);
    expect('rewards' in decoded!).toBe(false);
  });
});
