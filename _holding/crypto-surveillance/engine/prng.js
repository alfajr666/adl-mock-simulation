/* Seeded PRNG utilities. No Math.random, no Date.now anywhere in the engine. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over "seed|label" -> uint32. Gives every component its own stream. */
export function hashSeed(seed, label) {
  let h = 0x811c9dc5;
  const s = `${seed}|${label}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  u() { return this.next(); }
  /** integer in [lo, hi] inclusive */
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** approx. standard normal (Irwin-Hall, 6 uniforms, fixed order) */
  norm() {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return (s - 3) * 1.4142135623730951;
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
}

export function streams(seed) {
  return (label) => new Rng(hashSeed(seed, label));
}
