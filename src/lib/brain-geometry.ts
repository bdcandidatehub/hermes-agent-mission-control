// Geometry for the Friday "neural brain": a Fibonacci-sphere of nodes shaped like a brain (two hemispheres with a
// groove between them, ripple-like folds, slightly elongated front to back), wired to their nearest neighbours.
// Deterministic (no Math.random) so it renders the same every time and can be tested.

export interface Vec3 { x: number; y: number; z: number }
export interface Brain { points: Vec3[]; edges: [number, number][] }

export function buildBrain(n = 560, neighbours = 3): Brain {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    const groove = 1 - 0.17 * Math.exp(-Math.pow(x / 0.11, 2)) * (y > -0.25 ? 1 : 0.25); // longitudinal fissure between the hemispheres
    const folds = 1 + 0.05 * Math.sin(7 * x + 3 * y) * Math.cos(6 * z - 2 * y) + 0.03 * Math.sin(11 * y + 5 * z);
    const s = groove * folds;
    points.push({ x: x * s * 0.92, y: y * s * 0.86, z: z * s * 1.12 });
  }
  const seen = new Set<number>();
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const near: { j: number; d: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y, dz = points[i].z - points[j].z;
      near.push({ j, d: dx * dx + dy * dy + dz * dz });
    }
    near.sort((a, b) => a.d - b.d);
    for (const { j } of near.slice(0, neighbours)) {
      const a = Math.min(i, j), b = Math.max(i, j);
      const key = a * n + b;
      if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
    }
  }
  return { points, edges };
}
