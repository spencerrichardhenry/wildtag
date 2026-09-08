export type MaterialId = 'timber' | 'stone' | 'iron' | 'glass' | 'powder';
export interface BuildingMaterial {
  name: string; density: number; integrity: number; impactResistance: number;
  blastResistance: number; blastImpulse: number; friction: number; points: number; color: string; description: string;
}
export const MATERIALS: Record<MaterialId, BuildingMaterial> = {
  timber: { name: 'Timber', density: .28, integrity: 24, impactResistance: .65, blastResistance: .45, blastImpulse: 1.35, friction: .7, points: 5, color: '#b5804d', description: 'Light. Splinters easily, especially in explosions.' },
  stone: { name: 'Stone', density: .8, integrity: 85, impactResistance: 1.3, blastResistance: 1.5, blastImpulse: .85, friction: .8, points: 10, color: '#ddcba3', description: 'Heavy masonry. Take out the supports.' },
  iron: { name: 'Iron', density: 2.8, integrity: 180, impactResistance: 1.8, blastResistance: 4.5, blastImpulse: .3, friction: .85, points: 20, color: '#697879', description: 'Very heavy. Resists blasts; use a heavy direct hit.' },
  glass: { name: 'Glass', density: .16, integrity: 10, impactResistance: .25, blastResistance: .2, blastImpulse: 1.6, friction: .45, points: 8, color: '#a0d7ca', description: 'Fragile panes. Shatter with almost anything.' },
  powder: { name: 'Powder', density: .42, integrity: 18, impactResistance: .5, blastResistance: .25, blastImpulse: 1, friction: .7, points: 25, color: '#b9513b', description: 'Explosive barrels. Set off a chain reaction.' },
};
export const damageToMaterial = (id: MaterialId, energy: number, source: 'impact' | 'blast') => Math.max(0, energy) / (source === 'blast' ? MATERIALS[id].blastResistance : MATERIALS[id].impactResistance);
