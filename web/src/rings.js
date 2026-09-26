// Ring textures for worlds whose type has no baked rings. A ring texture is a 1D radial profile
// (inner edge at u = 0, outer at u = 1): colour in rgb, optical depth in alpha, like the baked ones.
import * as THREE from 'three';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLES = {
  // many bright, icy ringlets with clean gaps
  ice: { seed: 71, color: [228, 236, 246], alt: [196, 214, 236], lanes: 26, base: 0.55, gap: 0.8 },
  // faint, reddish dust sheet (like Jupiter's gossamer rings, exaggerated)
  dust: { seed: 19, color: [176, 132, 104], alt: [140, 112, 96], lanes: 6, base: 0.22, gap: 0.3 },
};

const cache = new Map();

/** A texture-bank style entry ({ texture, promise }) for a generated ring style. */
export function ringEntry(style) {
  if (cache.has(style)) return cache.get(style);
  const s = STYLES[style] ?? STYLES.ice;
  const rnd = mulberry32(s.seed);
  const W = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 4;
  const g = c.getContext('2d');
  const img = g.createImageData(W, 4);
  const lanes = Array.from({ length: s.lanes }, () => ({ at: rnd(), w: 0.003 + rnd() * 0.02, depth: rnd() }));
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    // soft inner and outer edges, slow density waves
    let a = s.base * Math.min(1, u / 0.06) * Math.min(1, (1 - u) / 0.1);
    a *= 0.75 + 0.25 * Math.sin(u * 40 + 1.3) * Math.sin(u * 17);
    for (const l of lanes) {
      const d = Math.abs(u - l.at) / l.w;
      if (d < 1) a *= 1 - s.gap * l.depth * (1 - d * d);
    }
    a = Math.max(0, Math.min(1, a * (0.85 + rnd() * 0.3)));
    const m = 0.5 + 0.5 * Math.sin(u * 23.0);
    for (let y = 0; y < 4; y++) {
      const i = (y * W + x) * 4;
      img.data[i] = s.color[0] * m + s.alt[0] * (1 - m);
      img.data[i + 1] = s.color[1] * m + s.alt[1] * (1 - m);
      img.data[i + 2] = s.color[2] * m + s.alt[2] * (1 - m);
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  const entry = { texture, promise: Promise.resolve(texture) };
  cache.set(style, entry);
  return entry;
}
