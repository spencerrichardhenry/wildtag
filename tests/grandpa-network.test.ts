import { describe, expect, it } from 'vitest';
import { displayCode, inviteLink, normalizeCode, readGrandpaInput, validCode } from '../src/grandpa/network.ts';
describe('Grandpa invitation and input boundaries', () => {
  it('accepts readable codes while rejecting partial or ambiguous ones', () => {
    expect(normalizeCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(validCode('abcd-efgh')).toBe(true);
    for (const bad of ['', 'ABCD', 'ABCD-EFG0', 'ABCD-EFGI', '<script>']) expect(validCode(bad)).toBe(false);
    expect(displayCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
  it('shares the dedicated guest page under the deployed repository path', () => {
    expect(inviteLink('ABCDEFGH', 'https://example.org/wildtag/wildtag.html?dev=1')).toBe('https://example.org/wildtag/grandpa.html#join=ABCDEFGH');
    expect(inviteLink('ABCDEFGH', 'http://localhost:5199/')).toBe('http://localhost:5199/grandpa.html#join=ABCDEFGH');
  });
  it('only accepts bounded movement intents, never guest-supplied positions or rewards', () => {
    const good = { forward: 1, strafe: 0, yaw: Math.PI, jumpId: 1, sprintId: 0, vault: true, sneeze: false };
    expect(readGrandpaInput({ ...good, pos: { x: 200, y: 200, z: 200 }, reward: true })).toEqual(good);
    for (const bad of [null, {}, { ...good, forward: 2 }, { ...good, yaw: Infinity }, { ...good, vault: 'true' }, { ...good, jumpId: -1 }, { ...good, sprintId: .5 }]) expect(readGrandpaInput(bad)).toBeNull();
  });
});
