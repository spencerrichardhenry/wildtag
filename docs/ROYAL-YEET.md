# Royal Yeet

A mobile-friendly 3D slingshot demolition game. A seeded castle village contains a keep, four towers, walls, a barn, glass gardens, a treasury, a windmill, an ironworks, a powder magazine, market stalls, and sometimes a cottage. There are no people.

Run `npm run dev` and open `/royal-yeet.html` on the local address printed by Vite. The game has its own entry point alongside the other games in this workspace. Production builds include `dist/royal-yeet.html`.

## Play

- Set **Power** with the slider. This controls speed independently of the aiming gesture.
- Touch the projectile in the middle of the slingshot. Drag left to shoot right, or right to shoot left. Drag down for a higher arc or up for a lower shot, then release.
- The dotted guide previews the launch arc. An aiming label identifies the first building/material in its path and any unclaimed bonus.
- A tap, cancelled touch, or returning the pouch to its starting position spends no ammunition.
- The next projectile loads automatically after the shot. Only the current and next projectile are displayed. The demo cycles through cow, rocket, bomb, catapult, and bowling ball, with unlimited shots.
- Tap the special button in flight to boost a rocket, detonate a bomb, or launch the catapult's watermelon early. Rockets and catapults activate automatically if left alone.
- The catapult weighs 75% as much as the cow. Its watermelon explodes on impact, with 50% more blast power and about 20% more range than the classic bomb.
- Wreck **75%** of the village to win. You can keep playing after winning.
- The camera approaches the shot's target, then returns to the slingshot for the next turn.

Keyboard alternative: focus the slingshot pouch, hold Space, adjust direction with the arrow keys, then release Space. Escape cancels. The power slider supports its normal arrow-key controls.

## Materials and bonuses

| Material | Behavior |
| --- | --- |
| Timber | Low mass, easily splintered by impacts and especially explosions. |
| Stone | Heavy masonry, stronger than timber. Undermining supports causes collapses. |
| Iron | Highest mass and blast resistance. A heavy direct bowling-ball hit works better than a distant explosion. |
| Glass | Light, fragile panes that shatter readily. |
| Powder | Explosive barrels that can ignite nearby barrels and structures. Each barrel detonates once. |

Weights affect rigid-body collisions. Each material has separate health, impact resistance, explosion resistance, friction, blast response, and point values. A block scores only when first dislodged or shattered.

Cows, bowling balls, and catapults damage what they physically strike. Their mass and the target's mass determine the collision, and a wall transfers momentum before a broken block is removed. Heavy masonry slows a cow; iron can stop or deflect it. Cows and wooden catapults shed energy after impact, while the heavier bowling ball keeps more of its roll. Bombs, rockets, watermelons, and powder barrels apply blast damage. Their blasts have short ranges, steep falloff, and limited knockback; intact walls shield pieces behind them. Powder chains remain confined to nearby barrels and structures.

Gold markers highlight selected bonus targets. Demolishing 55% of a bonus building awards its bonus once. Smashing/dislodging the treasury chest can also award the treasury bonus. The keep awards 800 points; treasury 600; ironworks 450; powder magazine 400; windmill 350; glass gardens 250; barn 180; cottage 120; market stalls 100.

## Seeded and limited rounds

- `?seed=42` reproduces a village. Building types move between spaced plots, and dimensions, heights, materials, roofs, and small placement offsets vary deterministically.
- `?seed=42&shots=5` starts an optional five-shot round. The default demo is unlimited.
- Limited rounds prevent extra launches after the final shot, then offer a retry using the same village and reset queue. New fortress generates a fresh village.

## Implementation and validation

Source lives in `src/siege/`. Three.js renders perspective scenery and models; Rapier handles unrestricted 3D rigid bodies. Layouts settle before play. Spent projectiles are retired, geometry is shared, static scenery is batched, and stationary shadows are reused.

- `npm run build`: type check and production build for all game pages.
- `npm test`: repository tests, including generation, structural stability, independent power/direction, materials, chain reactions, bonus scoring, queued shots, finite budgets, victory, and cleanup.
- `node e2e/siege.mjs`: browser checks against the running development server at `http://127.0.0.1:5202/royal-yeet.html`. Override with `VERIFY_URL` (without a query string). Uses installed Chrome and real touch events, slider input, and keyboard controls.
- `node e2e/siege-balance.mjs`: real touch shots at village buildings, checking that the cow and explosions cause useful local damage while most of the village stays intact.

The read-only `window.__siege` diagnostic snapshot exposes score, queue, material/building progress, and the current aim target. Browser tests launch through the visible controls.
