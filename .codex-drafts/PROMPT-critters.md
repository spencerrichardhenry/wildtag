# Task: whimsical critter model redesign ("round 3 — Neopets vibes")

The attached images are the style inspiration: classic Neopets art + plushies.
The owner's directive: critters should look **more whimsical and varied — Neopets
vibes**. Translate that character language into this game's low-poly THREE.js
procedural style.

## What to change

Rework the per-species model builders in `src/critters/models.ts` (round 3).
Study the whole file first — round 2's conventions carry over:

- Smooth plush volumes (spheres/capsules/lathe), flat faceting ONLY as material
  identity (prismhorse crystal, craghorn horns, gloomgobbler shadow-ball,
  shardwing crystal wings, gargoyle stone).
- `mat()` shared material cache contract (NEVER mutate or dispose a cached
  material; the key includes the flat flag).
- Models face +Z, stand on y=0.
- `CritterParts` animation contract per species MUST keep its current shape:
  same number of `legs`, presence/absence of `wings`/`tail`/`antennae`, pivots
  at the joint (animation.ts, ai.ts, mount-system.ts depend on it — prismhorse
  keeps ALL its legs and its ride-ability, gargoyle keeps its perch-friendly
  form).
- Per-individual rng jitter hooks stay (CRITTER_VARIATION).
- Tri budgets: ≤1200 typical, ≤1800 prismhorse. BoxGeometry banned for
  body/head (small accents ok).

## The Neopets language to inject (see images)

1. **Eyes are the soul**: BIG sclera+iris+highlight eyes — round 2 has them,
   but push size + placement: eyes ~30-45% of face height, set close, forward
   on a defined face-front, with the white specular highlight blob offset
   up-outward. Species with attitude can tilt an eye or add a brow wedge.
2. **Silhouette variety** — every species gets ONE unmistakable feature, big
   and readable at 30m (like Aisha antennae-paddles / Acara fins / Zafara
   ears / Shoyru wings):
   - puffle: giant teardrop rabbit-ears (plush Kacheek/Blumaroo energy), tiny
     rounded arms, pear body, sandy-cream w/ pink inner-ear + cheek blush
   - skitterling: Aisha-style antennae ending in paddle pads + big beetle eyes
   - bellowbuck: broad mossy palmate antlers + heavy gentle head, plush elk
   - mirefin: axolotl frill (3 fins each side of the head) + big tail fin,
     saturated teal-blue with pink frills, happy dolphin face
   - craghorn: fat spiral ram horns (keep faceted ridge identity) + stoic eyes
   - zephyrfinch: round chick w/ head plume feathers (3 swept quills) + chest
     tuft, sky-blue over cream
   - shardwing: KEEP crystal wings (bigger, 2 pairs, translucent) + plump
     furry two-tone body, curled antennae
   - nectarwisp: chubby striped bumble, heart-nose, stubby bee wings
   - emberpup: fox pup w/ huge ears, cream muzzle + chest, twin-tuft flame
     tail (emissive tips), mischievous eyes
   - lumenstag: elegant slim stag, glowing antlers (keep emissive identity) +
     glowing hoof accents, serene almond eyes
   - prismhorse: keep the crystal material identity + ALL current legs, but
     give it a defined HEAD with big gentle eyes + crystal mane spikes
   - bumblewhale: sky-whale w/ tiny useless wings, huge happy eye, two-tone
     belly bands, blowhole puff blob
   - snickerdoodle: cookie-dough puppy, floppy ears, chocolate-chip speckle
     blobs, tongue-out smile
   - gloomgobbler: keep softly-faceted shadow-ball but add HUGE luminous
     yellow eyes + tiny nub feet + a cowlick tuft (cute-spooky, not scary)
   - gargoyle: cute-spooky stone imp — big bat ears, stubby wings, underbite
     fangs, keep stone grey + perch pose
   - timberchomp: beaver w/ oversized incisors, flat paddle tail (keep tail
     part), acorn-brown w/ cream belly
   - pebbleshrew: round shrew w/ pebble-mosaic back (small faceted rock studs),
     pink nose, whisker quills
3. **Two-tone plush colors**: main saturated hue + cream belly/muzzle/inner-ear
   secondary. Cheek blush pads on the cuties. Colors read like the plushie
   photo: candy-saturated but soft.
4. **Plump proportions**: head 40-50% visual mass on small species, bottom-
   heavy bellies, stubby limbs, NO spikes except identity features.

## Verification loop (do all of this yourself, iterate until green)

1. `npx tsc --noEmit`
2. `npx vitest run tests/models.test.ts tests/model-thumbnails.test.ts tests/manager.test.ts tests/animation.test.ts tests/mount.test.ts` (run whichever of these exist; also `npx vitest run` once at the end — the FULL suite must stay green)
3. A dev server is already running on http://localhost:5199 — the critter
   turntable page is `http://localhost:5199/?preview=critters&quality=medium`.
   You can screenshot it headlessly with:
   `node /private/tmp/claude-501/-Users-spencerhenry-projects/9104a3b6-a3e9-4b3a-a183-24c07f89d0ca/scratchpad/snap.mjs 'http://localhost:5199/?preview=critters&quality=medium' /Users/spencerhenry/projects/wildtag/.codex-drafts/critters-preview.png 6000`
   (playwright is preinstalled in that scratchpad dir). View the screenshot and
   iterate on the models until they match the inspiration language.

## Hard rules

- Modify ONLY `src/critters/models.ts`. If a color/tuning constant must change,
  it may also touch the `CRITTER_VARIATION` block in `src/core/constants.ts`,
  nothing else. Do NOT commit anything to git.
- Keep every existing export + the `CritterParts` interface unchanged.
- The full `npx vitest run` suite must pass when you finish.
- Leave a short summary of per-species changes at
  `.codex-drafts/critters-summary.md`.
