# Tiny Tide

A mobile-first 3D eat-and-grow adventure at `/tiny-tide.html`. Start as a tiny shrimp grazing
on a rolling seabed, become a fish, an orca, a flying tentacled fortress, and
finally a cosmic creature that eats all 12 planets.

## Play

Run `npm run dev` and open `http://localhost:5199/tiny-tide.html`.

- **Move:** drag the left joystick, or use WASD / arrow keys.
- **Look:** swipe or drag the world. Swimming/flying forward follows the camera,
  including its pitch, so the habitat can be explored in three dimensions.
- **Eat:** hold Chomp / Space near food.
- **Change depth:** hold Rise / E or Dive / Q. Releasing the controls hovers.
- **Orca breach:** tap Breach / E and hold Chomp to catch seabirds above the water.
- **Pause:** the pause button, Escape, or P. Backgrounding the game pauses it.

The five diets are:

| Form | Foods |
| --- | --- |
| Little shrimp | Sea sprouts, tender kelp, sea grapes, sea lettuce |
| Happy fish | Shrimp, peach crabs, moon jellies, sea snails |
| Pocket orca | Silver tuna, berry squid, rays, seagulls |
| Cuddlethulhu | Palm trees, sailboats, seaplanes, balloons, lighthouses |
| Cosmic cutie | All 12 distinct planets |

Evolution happens in place over 3.4 seconds, with a creature
transformation, particles and a continuous change of scale. There are no form
selection dialogs or level loading screens. Larger food and landmarks exist
before they are edible: look up from the reef to see the busier ocean above.

The universe is constructed once per page. Every food tier shares physical
coordinates. During evolution, the world scales smoothly around the character's
physical location; small reef details are culled as they become insignificant.
The camera remains near the player, and the visible world changes from seafloor
to open water, surface, sky and space.

All 50 creature, food, scenery and planet models are original Blender assets,
authored and exported through Blender MCP. Five heroes have Idle, Swim and
Chomp clips. Painted color gradients and shared PBR materials keep the complete
GLB kit near 6 MB without external textures. The models preload once before
play; changing forms makes no network requests. Static scenery is merged by
material, repeated food uses instancing, and small details disappear with scale.
Water, caustics, light shafts, particles and sound remain runtime effects.

The editable source is `art/tiny-tide/tiny-tide-art.blend`. See
[the authoring notes](TINY-TIDE-ART.md) for rebuilding, asset inventory and checks.

Progress and sound preferences save locally when browser storage is available.
A fresh adventure replaces that save. There is no combat, countdown or loss
condition. The ending occurs only after every planet has been consumed.

## Verification

```sh
npm run build
npm test -- --run tests/tiny-tide.test.ts
python3 scripts/tiny-tide/blender/check_assets.py
node e2e/tiny-tide.mjs
node e2e/tiny-tide-mobile.mjs
node e2e/tiny-tide-replay.mjs
```

The full browser test steers using real controls and checks all five forms,
every food type, uninterrupted transformations at the same physical position,
breaching, the ending, replay, saves, pause and mobile layout. The mobile control
test uses a fish-stage save fixture and actual Chromium touch events to check
simultaneous movement and ascent, camera swiping, hovering, descent, touch
cancellation and small portrait/landscape viewports. Read-only diagnostics are
available in development or with `?qa`.

The other games remain at `/mineral-wage.html`, `/royal-yeet.html`, and
`/wildtag.html`. Production builds use the existing `/wildtag/` deployment base.
