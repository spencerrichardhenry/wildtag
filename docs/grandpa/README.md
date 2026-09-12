# Grandpa visits

## Agreed experience

One child plays their existing Wildtag save with their own unlocked equipment.
Grandpa joins that world as a mischievous fantasy running bird: a top-heavy,
long-legged silhouette with tiny wings, a feathery counterweight tail,
expressive eyebrows, and a feather beard. The revised bird direction was
requested after the initial dragon-emu concept.

Landing a tracker dart starts the round immediately. Staying within tracking
range fills the capture meter; escaping pauses progress. Capture ends in a
theatrical surrender. The child's first capture unlocks one placeable statue;
later captures award nothing. There are no Grandpa objectives, scores, time
limits, challenges, or additional reward tiers.

Grandpa waddles more slowly than the child can run. His own body provides his
movement kit; he has no player grapple or glider:

| Input | Ability | Pursuit |
| --- | --- | --- |
| Space | Normal jump: no energy cost; land on ground or sky trampolines to bounce | Follow with existing movement |
| Hold/release E | Accordion Vault: 28–42 m/s forward launch (twice the original); tap E just before landing for one smaller rebound | Read the windup and intercept the landing |
| Shift | Chicken Zoom: press once for 4× movement speed (20.8 m/s) for 6 seconds, including normal jumps; 30-second cooldown from activation | Anticipate the route and intercept |
| Q | Sneeze Launch: telegraphed backward/upward recoil | Ride the temporary updraft, which works without a glider |
| WASD / mouse | Waddle / steer | Normal movement |
| Hold RMB | Look behind | Keep the pursuer in view |

The sneeze is the only ability that leaves a movement aid for the child. Energy
recovers on the ground, and recovery windows make extravagant escapes catchable.
Normal hops and small terrain dips do not cause a landing stumble. Space and
Shift presses are numbered so fast taps survive network timing; holding either
key does not repeat its action. The zoom has no energy cost and stops after six
seconds. Jumping does not extend its duration, and holding Shift cannot rearm it.
Current radius, timings, movement speeds, and costs are playtest tuning in
`GRANDPA` in `src/core/constants.ts`.

## Joining

The child opens **Invite Grandpa**, or **Esc → Grandpa visit**, and creates an
invite. They can copy the eight-character code or the complete link. Grandpa
opens `grandpa.html`, enters the code, and clicks **Join their world**. Invite
links prefill the code. The child keeps their game open throughout the visit.

The dedicated page initializes as a guest before loading any world or save. A
guest receives the host's world and uses a third-person camera. Guest sessions
never write to the local Wildtag save, including automatic and manual save
paths. **Rejoin** reloads into a clean guest session using the same invite.

The statue is placed or moved from **Grandpa visit** after the first capture.
Aim at nearby ground, click to place, press R to rotate, or Esc to cancel.

## Implementation

- `src/grandpa/core.ts`: deterministic movement, capture state, reward guard,
  updraft volume; shared by host simulation and guest movement prediction.
- `src/grandpa/controls.ts`: normal jump and zoom press counters, E vault hold,
  keyboard state scoped to the visit.
- `src/grandpa/scenery.ts`: deterministic obstacle queries beyond the child's
  rendered scenery, so both players collide with the same trees and rocks.
- `src/grandpa/network.ts`: PeerJS room codes, version handshake, one guest,
  snapshots, input timeout, backpressure, reconnect entry, shared world updates.
- `src/grandpa/ice.ts`: explicit STUN configuration and optional TURN credentials.
- `src/grandpa/system.ts`: scene/controller integration, pursuit, camera,
  temporary updraft visuals, first-catch reward, statue placement.
- `src/grandpa/ui.ts` and `style.css`: invitation, joining, controls, tracking.
- `src/grandpa/model.ts`: the original Blender-authored Featherfoot character,
  with separate body, head, tail, wings, hips, knees and feet for procedural
  waddle, crouch, airborne tuck, speed burst and surrender poses. Walking phase
  advances with distance, and two-joint leg posing plants toes on slopes.
- `scripts/wildtag/grandpa/build_model.py`: reproducible Blender MCP authoring,
  local GLB export, named animation pivots, and studio render.
- `art/wildtag/grandpa-featherfoot.blend`: editable source scene.
- `src/main.ts`: host and guest boot paths, shared world and wildlife, save isolation.
- `src/core/save.ts`: optional `grandpa` data and preservation of placed trampolines.
- `src/structures/trampolines.ts`: swept descending contact used by Grandpa;
  the same pad height, gravity-adjusted impulse and bounded apex as the child.

Mobademo's reference is `/Users/spencerhenry/projects/mobademo/js/net.js`.
The child runs the simulation; Grandpa sends movement intents, receives state,
and predicts movement locally with visual correction. Host snapshots run at
20 Hz; input is sent at 30 Hz. Buildings, deployables, farm/pen state, rewards,
and relevant world progression synchronize on change, with a one-second check.
Wildlife uses host positions in the guest view rather than a second AI loop.

## Connection services

The free PeerJS public service still provides signaling. The bundled library's
old free TURN endpoints have been explicitly removed from our configuration:
[PeerJS discontinued those relays](https://github.com/orgs/peers/discussions/1172).
Direct connections work; networks that require relaying need a replacement
TURN service.

Set `VITE_GRANDPA_ICE_ENDPOINT` at build time to an endpoint returning either
an array of `RTCIceServer` entries or `{ "iceServers": [...] }`. The endpoint
should issue temporary TURN usernames/credentials; provider master keys stay
on its server. Both pages fetch these credentials when creating a connection.
The endpoint must permit requests from the game's origin if hosted separately.
If it fails, the connection still attempts the normal STUN/direct route.

```json
{
  "iceServers": [
    {
      "urls": ["turn:your-relay.example:3478", "turns:your-relay.example:5349"],
      "username": "temporary-user",
      "credential": "temporary-credential"
    }
  ]
}
```

No relay provider is provisioned by this implementation. A forced-relay test
against PeerJS's retired default service timed out, consistent with its
maintainers' announcement. Cross-household reliability is not yet certified.

## Verification

```sh
npm run build
npm test
node e2e/grandpa-network.mjs
node e2e/grandpa.mjs
node e2e/grandpa-terrain.mjs
# After configuring working TURN credentials:
VERIFY_RELAY=1 node e2e/grandpa-network.mjs
```

Both browser scripts use real Chrome and WebRTC through the public handshake
service. Start the Vite server first; `VERIFY_URL` can override the default
`http://localhost:5199`. Screenshots are saved in `docs/grandpa/verify/`.

The network test covers actual hosting, joining, world transfer, inputs,
snapshots, stale input stopping, second-guest rejection, and rejoining. The
gameplay test uses real controls, a real thrown dart, cumulative tracking,
statue placement, and guest save isolation. Fixture teleports only position
the players; they do not grant captures or rewards.

Real public-service networking and the two-browser gameplay sequence passed.
Movement regression tests cover continuous steep and undulating slopes,
charging on slopes, uphill launch clearance, and falling from real ledges.
The terrain browser scenario walks down the actual western mountain terrain,
jumps onto a ground trampoline and falls onto a sky trampoline, verifying that
both players receive the launches. The exported Blender feet are also checked
against flat and sloping ground through the actual animation code.

The downhill bug came from treating every small drop in the height field as
airtime, then applying the landing stumble. Grounded walking now follows drops
up to 0.65 m per step; launched or already airborne movement cannot snap down.
Ascending jumps are kept outside rising ground without losing their impulse.
Ordinary jumps now keep normal air speed and land without a stumble. Fast
movement uses short collision steps; trampoline contact sweeps across the pad
instead of missing it during a fast fall. A second correction keeps scenery
collision independent of camera streaming, which previously let the two peers
disagree when Grandpa ran far ahead of the child.

The new local GLB is 375,220 bytes, 10,956 triangles and 12 meshes. Named pivots
survive export. Host, guest and bronze reward statue all use this same model.
`verify/featherfoot-blender.png` is the Blender render; gameplay screenshots
show the actual exported asset in Three.js.

## Visual reference

`concept.png` records the initial dragon-emu concept generated with the built-in
imagegen tool. The user then explicitly requested a new, more Chocobo-like bird
through the MCP server. That direction supersedes the initial concept and
procedural-only workflow in `.claude/skills/critter-modeling/SKILL.md`.
Featherfoot is original geometry authored in the local Blender MCP session;
no external character mesh or texture is imported.

Generation prompt:

> Use case: stylized-concept. Asset type: concept and turnaround reference sheet for an original code-built low-poly 3D creature in Wildtag. Create ONE landscape sheet with a large three-quarter front view on the left and smaller side and rear views of the SAME character on the right. Character: Grandpa Longlegs, a mischievous showoff fantasy dragon-emu. Strong top-heavy bipedal chicken-walker silhouette, broad angular organic dragon head almost merging into a hunched compact torso, two very long jointed springy emu legs with large three-toed talons, comically tiny feather wings, long tapered tail as counterweight. Face: knowing cheeky grin, heavy expressive white feather eyebrows, short white dangling feather beard, dark glossy inset eyes flush with skull facets, amber highlight. Jade/teal dragon scales with ochre breast feathers and rust/coral crest, ivory talons. Creature entirely organic, not a robot; no weapons, armor, saddle, rider, clothing or text. Feet planted on a tiny natural rock base in primary view. Low-poly faceted game figurine, flat triangular faces and chamfered masses, hard edges, charming readable proportions with legs constituting over half the height. Strong silhouette for first-person chasing and third-person play. Bright neutral warm gray background, soft studio shadows. Both legs and full tail visible; no cutoffs. Include consistent side and rear turnarounds, no pose variations.
