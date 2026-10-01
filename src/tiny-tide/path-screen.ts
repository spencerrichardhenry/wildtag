// Choose the next body plan (spec §6). Each card shows the playstyle, the cost
// of the form, the lasting sacrifice and where it leads. "Details" adds every
// gain and loss, a larger preview, the changes to the creature and the DNA.
import './path-screen.css';
import { compareCapabilities, type BodyPlan } from './plans';
import { renderPreview } from './preview';
import type { Adaptation, Genome } from './genome';
import type { Quote } from './economy';

export interface PathChoice {
  plan: BodyPlan; adaptation: Adaptation; quote: Quote | null; leadsTo: string[];
  /** `cardSummary(current, plan, run.plans)`. */
  summary: { playstyle: string; cost: string; sacrifice: string };
}
export interface PathScreenOptions { current: BodyPlan; choices: PathChoice[]; /** The current design, previewed when the proposal fails. */ genome: Genome }

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const list = (cls: string, items: string[], empty: string) => `<ul class="path-list ${cls}">${(items.length ? items : [empty]).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

function banner({ adaptation: a, quote }: PathChoice): string {
  if (!a.ok) return `<p class="path-banner">Needs changes you choose: ${esc(a.reasons[0] ?? 'the automatic changes did not work')}</p>`;
  if (quote && !quote.affordable) return `<p class="path-banner">Needs changes you choose: short by ${quote.shortfall} DNA</p>`;
  return '';
}
function dnaLine(quote: Quote | null): string {
  if (!quote) return 'DNA: set when you choose your changes';
  return quote.net > 0 ? `Costs ${quote.net} DNA` : quote.net < 0 ? `Refunds ${-quote.net} DNA` : 'No DNA change';
}

function card(o: PathScreenOptions, choice: PathChoice): string {
  const { plan: p, adaptation: a, summary } = choice, genome = a.ok ? a.genome : o.genome;
  const changes = compareCapabilities(o.current, p), gains = changes.filter(c => c.good).map(c => c.text), losses = changes.filter(c => !c.good).map(c => c.text);
  const edits = a.ok ? a.changes : a.reasons;
  return `<article class="path-card" data-plan="${esc(p.id)}" aria-labelledby="path-name-${esc(p.id)}">
    <h3 class="path-name" id="path-name-${esc(p.id)}">${esc(p.name)}</h3>
    <img class="path-silhouette" width="64" height="64" alt="" src="${renderPreview(genome, 64)}">
    <dl class="path-summary">
      <div><dt>Playstyle:</dt><dd>${esc(summary.playstyle || 'Nothing new')}</dd></div>
      <div><dt>This form's cost:</dt><dd>${esc(summary.cost)}</dd></div>
      <div><dt>Lasting sacrifice:</dt><dd>${esc(summary.sacrifice)}</dd></div>
      <div><dt>Leads to:</dt><dd class="path-next">${choice.leadsTo.length ? choice.leadsTo.map(esc).join(' · ') : 'The end of this path for now'}</dd></div>
    </dl>
    ${banner(choice)}
    <details class="path-details">
      <summary>Details</summary>
      <img class="path-preview" width="160" height="160" alt="${esc(p.name)} preview" src="${renderPreview(genome, 160)}">
      <h4>You gain</h4>${list('gains', gains, 'Nothing new')}
      <h4>You give up</h4>${list('losses', losses, 'Nothing')}
      <h4>Your creature</h4>${list('changes', edits, 'No changes needed')}
      <p class="path-dna">${dnaLine(choice.quote)}</p>
    </details>
    <button class="path-choose primary">Choose ${esc(p.name)}</button>
  </article>`;
}

/** Resolves the chosen plan id, or null for "Not yet". Only eligible plans are passed, so no card is disabled. */
export function openPathScreen(o: PathScreenOptions): Promise<string | null> {
  return new Promise(resolve => {
    const root = document.createElement('section'); root.id = 'path-screen';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'path-title');
    const title = o.choices.length === 1 ? 'Next form' : 'Choose your path';
    root.innerHTML = `<div class="path-inner"><h2 id="path-title">${title}</h2>
      <p class="path-lede">Choose your diet now: you can change your mouth while you evolve.</p>
      <div class="path-cards">${o.choices.map(c => card(o, c)).join('')}</div>
      <button class="path-later text-button">Not yet</button></div>`;
    document.querySelector('#app')!.append(root);
    const close = (id: string | null) => { removeEventListener('keydown', onKey); root.remove(); resolve(id); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    addEventListener('keydown', onKey);
    root.querySelectorAll<HTMLElement>('.path-card').forEach(c => c.addEventListener('click', () => close(c.dataset.plan!)));
    // Opening or reading the details never selects the card.
    root.querySelectorAll<HTMLElement>('.path-details').forEach(d => d.addEventListener('click', e => e.stopPropagation()));
    root.querySelector<HTMLButtonElement>('.path-later')!.onclick = () => close(null);
    root.querySelector<HTMLButtonElement>('.path-choose')?.focus();
  });
}
