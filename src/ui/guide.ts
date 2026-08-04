import type { ScreenDef, ScreenManager } from './screens.ts';
import type { CritterManager } from '../critters/manager.ts';
import { SPECIES } from '../critters/species.ts';
import type { Biome, SpeciesDef } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Field Guide (Task 10, Tab). A silhouette-style grid of all 8 species: each
// still-unknown critter shows a dark "???" card with only a biome hint, while
// a Linked critter reveals its coloured name, tracking stats, biome, flee
// style, a flavour line and a "Linked ✓" badge. Data comes from the static
// SPECIES table plus `manager.linkedSpecies()` (which slots the player has
// Linked). Plain DOM; reuses the screen manager's panel/grid classes and adds
// a small guide-specific style block once.
// ---------------------------------------------------------------------------

/** One-line flavour text per species (guide reveal). */
const FLAVOR: Record<string, string> = {
  puffle: 'A meadow marshmallow that bounces when startled — mostly bounces.',
  skitterling: 'Six legs, no patience; it is gone before the grass stops waving.',
  bellowbuck: 'Too proud to run. It simply strides off, bellowing its disdain.',
  mirefin: 'Half fish, half rumour, all mud. Surfaces only to judge you.',
  craghorn: 'Ledge-hopping cliff dweller that treats gravity as a suggestion.',
  zephyrfinch: 'A gust with feathers — blink and it is a dot on the horizon.',
  emberpup: 'Warm to the touch and impossible to corner; zigzags on principle.',
  lumenstag: 'The living lantern of the deep wood. Few ever see it. Fewer link it.',
  gargoyle: 'Stone by day, wings by night — it only stirs once you dare tag it.',
  timberchomp: 'Never met a tree it did not want to gnaw down and haul home.',
  pebbleshrew: 'Digs first, looks later — a small plated nose forever in the rubble.',
};

/** Human-readable flee-style labels. */
const FLEE_LABEL: Record<SpeciesDef['fleeStyle'], string> = {
  none: 'stands its ground',
  sprint: 'sprints',
  zigzag: 'zigzags',
  fly: 'takes flight',
  swim: 'dives & swims',
  ledge: 'scales ledges',
  perch: 'perches',
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function biomeHint(biomes: Biome[]): string {
  // The gargoyle's biomes: [] (fixed castle-perch slots, no procedural cell
  // spawn) would otherwise render as a blank line here.
  if (biomes.length === 0) return 'Castle towers';
  return biomes.map(capitalize).join(' / ');
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wt-guide-card { min-height: 132px; }
    .wt-guide-card.wt-unknown {
      background: rgba(0, 0, 0, 0.35);
      border-style: dashed;
      opacity: 0.75;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .wt-guide-unknown-mark {
      font-size: 30px;
      font-weight: bold;
      color: #6b7a82;
      letter-spacing: 0.08em;
    }
    .wt-guide-hint { font-size: 12px; color: #8a9aa2; }
    .wt-guide-name { font-size: 15px; font-weight: bold; color: #a8e6bc; }
    .wt-guide-stats { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #cfe0d6; }
    .wt-guide-flavor { font-size: 11px; color: #9fb0b8; font-style: italic; }
    .wt-guide-linked { margin-top: auto; font-size: 12px; color: #9fd8b8; font-weight: bold; }
  `;
  document.head.appendChild(style);
}

function renderCard(sp: SpeciesDef, linked: boolean): HTMLDivElement {
  const card = document.createElement('div');
  if (!linked) {
    card.className = 'wt-card wt-guide-card wt-unknown';
    const mark = document.createElement('div');
    mark.className = 'wt-guide-unknown-mark';
    mark.textContent = '???';
    const hint = document.createElement('div');
    hint.className = 'wt-guide-hint';
    hint.textContent = biomeHint(sp.biomes);
    card.append(mark, hint);
    return card;
  }

  card.className = 'wt-card wt-guide-card';
  const name = document.createElement('div');
  name.className = 'wt-guide-name';
  name.textContent = sp.name;

  const stats = document.createElement('div');
  stats.className = 'wt-guide-stats';
  const r = document.createElement('span');
  r.textContent = `Track R ${sp.trackRadius}m / T ${sp.trackTime}s`;
  const b = document.createElement('span');
  b.textContent = `Biome: ${biomeHint(sp.biomes)}`;
  const f = document.createElement('span');
  f.textContent = `Flees: ${FLEE_LABEL[sp.fleeStyle]}`;
  stats.append(r, b, f);

  const flavor = document.createElement('div');
  flavor.className = 'wt-guide-flavor';
  flavor.textContent = FLAVOR[sp.id] ?? '';

  const linkedTag = document.createElement('div');
  linkedTag.className = 'wt-guide-linked';
  linkedTag.textContent = 'Linked ✓';

  card.append(name, stats, flavor, linkedTag);
  return card;
}

/** Build the ScreenDef for the Field Guide (Tab). */
export function createGuideScreen(
  manager: CritterManager,
  screens: ScreenManager,
): ScreenDef {
  return {
    id: 'guide',
    render(root: HTMLElement) {
      injectStyles();
      const linkedIds = manager.linkedSpecies();

      const panel = document.createElement('div');
      panel.className = 'wt-panel';
      panel.addEventListener('click', (e) => e.stopPropagation());

      const closeBtn = document.createElement('button');
      closeBtn.className = 'wt-close';
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close (Tab)';
      closeBtn.addEventListener('click', () => screens.close());
      panel.appendChild(closeBtn);

      const h1 = document.createElement('h1');
      h1.textContent = `Field Guide — ${linkedIds.size}/${SPECIES.length} Linked`;
      panel.appendChild(h1);

      const subhead = document.createElement('p');
      subhead.className = 'wt-subhead';
      subhead.textContent = 'Tag a critter with a dart, then keep close to Link it.';
      panel.appendChild(subhead);

      const grid = document.createElement('div');
      grid.className = 'wt-grid';
      for (const sp of SPECIES) grid.appendChild(renderCard(sp, linkedIds.has(sp.id)));
      panel.appendChild(grid);

      root.appendChild(panel);
    },
  };
}
