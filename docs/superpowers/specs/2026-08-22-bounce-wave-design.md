# Bounce Wave — spec (Spencer, 2026-08-22, verbatim requirements)

1. CROCODILE (new species — does NOT exist yet; wetland): farm-produces new
   resource "croc hide" (like timberchomp→wood).
2. TRAMPOLINE (craftable structure): croc hide + cragdrake horns (cragdrake
   farm produce switches or adds horns? — currently sparks; needs decision:
   ADD 'horn' produce to cragdrake). Player bounces on it: launch height ≈
   1.5× drone height. Ballistic bounce only — free-flight invariant holds.
3. DRONE TRAMPOLINE: trampoline + 4 drones = trampoline floating at drone
   height. NO separate asset (Spencer): compose in-game from 4 existing drone
   models holding the corners of the NORMAL trampoline asset (concept
   approved: 'very good'). Bounce from it reaches ~2.5× drone height total altitude.
4. SKY WYVERN (new species): LONG AND LANKY like a Chinese dragon (Spencer)
   — serpentine ribbon body, not the stubby winged glider of concept v1;
   regenerate concept. Stays very high, slowly glides DOWN at ≈ player
   glide sink rate or slightly faster; easy to catch once reached, but
   requires a drone trampoline to get high enough. fleeStyle: new 'skyglide'.
5. SHARKS (new species, water biome): swim in packs of 3-4; tagging ANY pack
   member aggros ALL (pack-linked aggro — new mechanic); per-hit damage low
   (bee/nectarwisp-tier 'sting'-like contact).
6. GRAPPLE WORKS UNDERWATER (movement change — review vs free-flight/swim).
7. GIANT KELP TREES: tall underwater flora props in the water biome for
   vertical visual density (scatter kind, no collision? decide; grappleable
   would be fun but review).
8. fal.ai concept art FIRST for every new asset (crocodile, trampoline, drone
   trampoline, sky wyvern, shark, giant kelp) per .claude/skills/
   critter-modeling — Spencer approves concepts before builds.

DECIDED: cragdrake ADDS horn produce (sparks stay); kelp = decoration only,
swim-through, no collision/grapple; preview page gains a non-species
character registry (clams/turtles/goblins/elves) + coverage test.
