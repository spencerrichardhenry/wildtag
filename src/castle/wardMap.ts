// ---------------------------------------------------------------------------
// Castle Ward — hand-authored 36×36 ASCII maze map (Castle Ward Task 1).
// 5 m per cell, spanning the ±90 m interior of the (Task-2-resized) curtain
// wall, centered on CASTLE.center. Committed, human-editable content — this
// is the actual level design, not generated at runtime. Edit freely; the
// BFS/articulation-point tests in tests/ward.test.ts are the lint that keeps
// edits honest (gate reaches the keep/every plaza/every hall, at least 2
// distinct gate→keep routes, each hall has exactly 2 doorways).
//
// Legend:
//   #  maze wall (WARD.wallH tall, WARD.wallT thick, centered on the cell)
//   .  corridor / open ground (1 cell wide between wall faces)
//   P  plaza cell (open; 3 contiguous regions — NW, SE, S-center)
//   H  roofed hall interior (2 contiguous regions — N-center, W-center;
//      each has exactly 2 one-cell doorway gaps in its `#` perimeter)
//   K  keep footprint (4×4 block at cells [16..19]×[16..19], centered on
//      CASTLE.center — the existing keep builder stamps here)
//   G  gate opening in the curtain wall (east edge, col 35, rows 17–18 —
//      the curtain wall gate faces back toward the origin/east)
//   T  corner tower anchor (existing corner towers / gargoyle perches)
//
// The outer ring (row/col 0 and 35) IS the curtain wall line for
// connectivity/collision purposes — `#` everywhere except the 4 `T` corners
// and the 2 `G` gate cells. The actual curtain-wall mesh is built by the
// existing builder (Task 4), not from these ring cells' geometry.
//
// Column ruler (tens digit / ones digit), for editing by eye:
//         0         1         2         3
//         0123456789012345678901234567890123456
// ---------------------------------------------------------------------------
export const WARD_MAP: readonly string[] = [
  'T##################################T', //  0
  '#...#...#....#....#......#......#.##', //  1
  '#.#.#.#.#.###.###.###.#.#.#.#.#.#.##', //  2
  '#......#......###.###...#.....#...##', //  3
  '###.PPPPP.#.#.#HHHHH#.###########.##', //  4
  '#..#PPPPP.#...#HHHHH#.#...#...#.#.##', //  5
  '#.#.PPPPP.###.#HHHHH###.###.#.#.####', //  6
  '#...PPPPP#....###.###.#.....#.....##', //  7
  '#.#.PPPPP.#.#####.###.###.#######.##', //  8
  '#...#...#.....#....#....#....#....##', //  9
  '#.###.###.#.#.###.###.#.#.#.#.######', // 10
  '##..#...#...#......#......#...#...##', // 11
  '#.#.###.#.#####.#.#.###.#.###.######', // 12
  '#....#....#....#....#...##..#.....##', // 13
  '#.###########.#####.#.#.#.#####.####', // 14
  '####HHH##...#....#.....#....#.....##', // 15
  '#.##HHH##.#####.KKKK###.#.#.###.#.##', // 16
  '#...HHH...#...#.KKKK#.#...#...#.#..G', // 17
  '#.##HHH##.###.##KKKK#.#.#.#.#####..G', // 18
  '####HHH##.....#.KKKK#.....#...#...##', // 19
  '#.#######.###.#.#######.#####.###.##', // 20
  '#.....#..#...#......#......#......##', // 21
  '#.#.#.#.#.#.#.###.#.#.#####.###.####', // 22
  '#.....#.....#...#.....#...#...#.#.##', // 23
  '#.#.#.#.#.#.###.#.#.###.#.###.#.####', // 24
  '#.....#..#...#......#......#......##', // 25
  '###.#####.###.#######.###########.##', // 26
  '#.###...#.....#PPPPP#.....#PPPPP#.##', // 27
  '#.#.#.#.#.#.#.#PPPPP###.#.#PPPPP#.##', // 28
  '#.#.#....#...##PPPPP#.....#PPPPP####', // 29
  '###.#.#.#.#.#.#PPPPP#.###.#PPPPP#.##', // 30
  '#...#...#.#...#PPPPP#.#...#PPPPP#.##', // 31
  '#.#.#####.###.#######.#.#########.##', // 32
  '#...#...#.....#......#.....#......##', // 33
  '####################################', // 34
  'T##################################T', // 35
];
