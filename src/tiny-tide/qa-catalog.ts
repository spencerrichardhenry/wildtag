// QA only. No shipped part has an active ability grant yet, so the lost-abilities preview cannot be seen in play.
// `?qaGrantCatalog=1` (read once at load, development or `?qa` only) and the fixture page use this catalog:
// the shipped parts, with one synthetic active grant on the Pincer.
import type { ActiveGrant } from './combat-types';
import { PARTS, type PartSpec } from './parts';

export const QA_GRANT: ActiveGrant = { id: 'qa-pinch', abilityId: 'qa-pinch', socketIds: ['pinch'], mirrorPolicy: 'shared-cast' };
export const QA_GRANT_PART = 'claw_pincer';
export const QA_GRANT_CATALOG: readonly PartSpec[] = PARTS.map(spec => spec.id === QA_GRANT_PART ? { ...spec, activeGrants: [QA_GRANT] } : spec);
