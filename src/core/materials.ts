import * as THREE from 'three';
import { qualityFlags } from './quality.ts';

// ---------------------------------------------------------------------------
// Quality-gated surface material factory (Fidelity-2 P3, deliverable 4).
//
// On medium+ (`standardMaterials` flag) prop/critter/village surfaces are built
// from MeshStandardMaterial with a per-kind roughness, so the golden-hour sun
// picks out material contrast (rough rock vs. slick crystal) and the PBR
// response reads richer than flat Lambert. On low the SAME call returns a
// MeshLambertMaterial — identical vertex colours / flat shading / emissive — so
// the floor preset is byte-for-byte the pre-P3 look. The choice is made at mesh
// CONSTRUCTION time (see the `standardMaterials` flag doc: reload-required).
//
// flatShading is preserved on both paths: the deliberate faceted look of props
// and critters (in contrast to the smooth terrain) is a stylistic constant, not
// a quality dial. Emissive colour/intensity, translucency and side pass through
// unchanged so crystals/lamps/antlers still glow (and bloom on high).
// ---------------------------------------------------------------------------

/** Per-kind roughness for the Standard path (P3 spec: rock/mesa .95, trees .85,
 *  crystals .4, critters .8, village .9). Lambert ignores it. */
export const ROUGHNESS = {
  rock: 0.95,
  tree: 0.85,
  crystal: 0.4,
  critter: 0.8,
  village: 0.9,
  /** Generic ground-cover / foliage default. */
  foliage: 0.9,
} as const;

export interface SurfaceOpts {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  flatShading?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  /** Sets transparent + opacity when provided (crystal translucency). */
  opacity?: number;
  side?: THREE.Side;
  /** Standard-path roughness (default 0.85); ignored on the Lambert floor. */
  roughness?: number;
  /** Standard-path metalness (default 0). */
  metalness?: number;
}

/**
 * Build a surface material honouring the active quality preset: a
 * MeshStandardMaterial on medium+ (roughness/metalness applied), a
 * MeshLambertMaterial on low. Shared shape so props/critters/village all read
 * identical on the floor and gain PBR on medium+.
 */
export function makeSurfaceMaterial(opts: SurfaceOpts = {}): THREE.Material {
  const standard = qualityFlags().standardMaterials;
  const common: THREE.MeshStandardMaterialParameters & THREE.MeshLambertMaterialParameters = {
    flatShading: opts.flatShading ?? true,
  };
  if (opts.color !== undefined) common.color = opts.color;
  if (opts.vertexColors) common.vertexColors = true;
  if (opts.side !== undefined) common.side = opts.side;
  if (opts.opacity !== undefined) {
    common.transparent = true;
    common.opacity = opts.opacity;
  }

  const mat = standard
    ? new THREE.MeshStandardMaterial({
        ...common,
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0,
      })
    : new THREE.MeshLambertMaterial(common);

  if (opts.emissive !== undefined) {
    mat.emissive = new THREE.Color(opts.emissive);
    mat.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return mat;
}
