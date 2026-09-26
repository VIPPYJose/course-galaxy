// Everything a galaxy can be customised with: the environment (sky), the star, each planet and
// the system as a whole. Every control is described once in a schema. The Galaxy Forge builds its
// panels from these, the random buttons pick within their ranges, and the resolvers merge a
// galaxy's or planet's overrides with its defaults.
//
// All overrides are optional. A galaxy or planet saved before the Forge existed has none of them
// and resolves to exactly how it looked before (plus the realistic moons of its planet type).
import * as THREE from 'three';
import { NEBULAE } from './data.js';
import { STARS, getType, planetTypes } from './assets.js';

// Planet-local belt of rocks, in planet radii.
export const BELT = { inner: 1.45, outer: 2.05 };
// Giant planets carry a belt of rocks by default (BlenderPlanet's gas giants did).
const BELT_TYPES = new Set(['jovian', 'neptune', 'viridis', 'amethyst']);
export const GIANTS = new Set(['jovian', 'saturn', 'neptune', 'pyra', 'viridis', 'amethyst', 'cyane']);

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];
const chance = (p) => Math.random() < p;
const round = (v, step) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return +(Math.round(v / step) * step).toFixed(d);
};
export const rgbHex = (c) => `#${new THREE.Color(...c).getHexString()}`;
export const hexRgb = (h) => new THREE.Color(h).toArray();
const hsl = (h, s, l) => `#${new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l).getHexString()}`;

/** Default value of a schema field, for a planet type when the default depends on it. */
export function fieldDefault(f, ctx) {
  return typeof f.def === 'function' ? f.def(ctx) : f.def;
}

/** A value picked at random within a field's range (or its own `rand`). */
export function randomValue(f, ctx) {
  if (f.rand) return f.rand(ctx);
  if (f.type === 'range') return round(rnd(f.min, f.max), f.step);
  if (f.type === 'toggle') return chance(0.5);
  if (f.type === 'select') return pick(f.options(ctx)).value;
  if (f.type === 'color') return hsl(Math.random(), rnd(0.4, 0.9), rnd(0.3, 0.6));
  return fieldDefault(f, ctx);
}

// =========================================================================== //
//  1. Environment: the sky all around the system
// =========================================================================== //

export const SKY_FIELDS = [
  { group: 'Nebula', key: 'colorA', label: 'Primary colour', type: 'color', def: '#2a1250', rand: () => hsl(Math.random(), rnd(0.5, 0.85), rnd(0.12, 0.22)) },
  { group: 'Nebula', key: 'colorB', label: 'Secondary colour', type: 'color', def: '#0c1a4a', rand: () => hsl(Math.random(), rnd(0.5, 0.85), rnd(0.08, 0.16)) },
  { group: 'Nebula', key: 'nebula', label: 'Intensity', type: 'range', min: 0, max: 2.5, step: 0.05, def: 1, rand: () => round(rnd(0.4, 1.8), 0.05) },
  { group: 'Nebula', key: 'nebulaScale', label: 'Cloud scale', type: 'range', min: 0.4, max: 2.5, step: 0.05, def: 1, hint: 'Small = huge clouds, large = fine wisps' },
  { group: 'Nebula', key: 'spread', label: 'Spread across the sky', type: 'range', min: 0, max: 1, step: 0.01, def: 0.15 },
  { group: 'Nebula', key: 'knots', label: 'Glowing knots', type: 'range', min: 0, max: 2.5, step: 0.05, def: 1 },
  { group: 'Nebula', key: 'seed', label: 'Cloud pattern', type: 'range', min: 0, max: 100, step: 1, def: 0, hint: 'Reshapes every cloud' },
  { group: 'Nebula', key: 'drift', label: 'Drift speed', type: 'range', min: 0, max: 6, step: 0.1, def: 1 },

  { group: 'Milky Way', key: 'band', label: 'Band brightness', type: 'range', min: 0, max: 3, step: 0.05, def: 1, rand: () => round(rnd(0.4, 2), 0.05) },
  { group: 'Milky Way', key: 'bandWidth', label: 'Band width', type: 'range', min: 0.3, max: 3, step: 0.05, def: 1, rand: () => round(rnd(0.6, 2), 0.05) },
  { group: 'Milky Way', key: 'bandColor', label: 'Band colour', type: 'color', def: '#ced7ed', rand: () => hsl(rnd(0.5, 0.75), rnd(0.2, 0.55), rnd(0.75, 0.88)) },
  { group: 'Milky Way', key: 'core', label: 'Core glow', type: 'range', min: 0, max: 3, step: 0.05, def: 1 },
  { group: 'Milky Way', key: 'coreColor', label: 'Core colour', type: 'color', def: '#ffefd4', rand: () => hsl(rnd(0.02, 0.14), rnd(0.6, 1), rnd(0.78, 0.9)) },
  { group: 'Milky Way', key: 'dust', label: 'Dust lanes', type: 'range', min: 0, max: 1, step: 0.01, def: 0.88 },
  { group: 'Milky Way', key: 'tilt', label: 'Band tilt', type: 'range', min: -90, max: 90, step: 1, def: 0, unit: '°' },
  { group: 'Milky Way', key: 'turn', label: 'Band rotation', type: 'range', min: 0, max: 360, step: 1, def: 0, unit: '°' },

  { group: 'Stars', key: 'starCount', label: 'Number of stars', type: 'range', min: 2000, max: 40000, step: 1000, def: 16000, rebuild: true },
  { group: 'Stars', key: 'bandStars', label: 'Stars crowding the band', type: 'range', min: 0, max: 0.95, step: 0.01, def: 0.55, rebuild: true },
  { group: 'Stars', key: 'starTemp', label: 'Star colours (cool → hot)', type: 'range', min: -1, max: 1, step: 0.05, def: 0, rebuild: true },
  { group: 'Stars', key: 'starBright', label: 'Star brightness', type: 'range', min: 0.2, max: 2.5, step: 0.05, def: 1 },
  { group: 'Stars', key: 'starSize', label: 'Star size', type: 'range', min: 0.5, max: 2.2, step: 0.05, def: 1, rand: () => round(rnd(0.7, 1.5), 0.05) },
  { group: 'Stars', key: 'twinkle', label: 'Twinkle', type: 'range', min: 0, max: 1, step: 0.01, def: 0.2 },

  { group: 'Deep space', key: 'haze', label: 'Background haze', type: 'range', min: 0, max: 4, step: 0.05, def: 1, rand: () => round(rnd(0.3, 2.5), 0.05) },
  { group: 'Deep space', key: 'galaxies', label: 'Distant galaxies', type: 'range', min: 0, max: 4, step: 0.05, def: 1 },
];

export const SKY_DEFAULTS = Object.fromEntries(SKY_FIELDS.map((f) => [f.key, f.def]));

/** Full sky parameters for a galaxy: its nebula preset, then its own overrides. */
export function skyOf(g) {
  const neb = NEBULAE[g.nebula] ?? NEBULAE.violet;
  return { ...SKY_DEFAULTS, colorA: neb.a, colorB: neb.b, ...(neb.sky ?? {}), ...(g.sky ?? {}) };
}

export function skyPreset(id) {
  const neb = NEBULAE[id];
  return { colorA: neb.a, colorB: neb.b, ...(neb.sky ?? {}) };
}

export function randomSky() {
  const s = Object.fromEntries(SKY_FIELDS.map((f) => [f.key, randomValue(f)]));
  // keep the two nebula tints related (split-complementary at most) so the sky reads as one place
  const h = Math.random();
  s.colorA = hsl(h, rnd(0.55, 0.85), rnd(0.13, 0.22));
  s.colorB = hsl(h + rnd(-0.25, 0.25), rnd(0.5, 0.85), rnd(0.07, 0.15));
  s.starCount = round(rnd(8000, 30000), 1000);
  s.dust = round(rnd(0.3, 1), 0.01);
  return s;
}

// =========================================================================== //
//  2. The star
// =========================================================================== //

/** sRGB-ish colour of a blackbody (Tanner Helland's fit), each channel 0..1. */
export function kelvinRGB(k) {
  const t = k / 100;
  let r;
  let g;
  let b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((v) => Math.min(1, Math.max(0, v / 255)));
}

/** Saturated corona colour for a temperature (the photosphere itself burns out near white). */
export function glowForTemp(k) {
  const c = kelvinRGB(k).map((v) => v ** 3);
  const col = new THREE.Color(...c);
  const h = col.getHSL({}).h;
  const chroma = Math.max(...c) - Math.min(...c);
  return hsl(h, Math.min(1, 0.15 + chroma * 1.4), 0.62);
}

// Star classes offered as one-click presets in the Forge.
export const STAR_PRESETS = {
  g: { label: 'Yellow Dwarf', note: 'G class, like the Sun', sun: { temp: 5800, radius: 3.3, brightness: 3, corona: 0.6, coronaSize: 3.6, halo: 0.09, haloSize: 8, pulse: 1, spin: 1, spikes: 0 } },
  k: { label: 'Orange Dwarf', note: 'K class', sun: { temp: 4500, radius: 2.9, brightness: 3, corona: 0.65, coronaSize: 3.6, halo: 0.1, haloSize: 8, pulse: 1, spin: 1, spikes: 0 } },
  m: { label: 'Red Dwarf', note: 'M class, the most common star', sun: { temp: 3100, radius: 2.3, brightness: 3, corona: 0.7, coronaSize: 3.8, halo: 0.12, haloSize: 9, pulse: 1.6, spin: 1.2, spikes: 0 } },
  f: { label: 'White Star', note: 'F / A class', sun: { temp: 7600, radius: 3.8, brightness: 3.4, corona: 0.55, coronaSize: 3.5, halo: 0.1, haloSize: 9, pulse: 0.8, spin: 1.4, spikes: 0.2 } },
  b: { label: 'Blue Giant', note: 'B class, hot and huge', sun: { temp: 16000, radius: 5.2, brightness: 3.6, corona: 0.7, coronaSize: 3.4, halo: 0.16, haloSize: 11, pulse: 0.6, spin: 0.8, spikes: 0.35 } },
  rg: { label: 'Red Giant', note: 'a dying, swollen star', sun: { temp: 3500, radius: 8, brightness: 2.2, corona: 0.45, coronaSize: 3, halo: 0.14, haloSize: 6.5, pulse: 2.2, spin: 0.3, spikes: 0 } },
  wd: { label: 'White Dwarf', note: 'a tiny, hot stellar core', sun: { temp: 12000, radius: 1.3, brightness: 5, corona: 1.1, coronaSize: 5, halo: 0.2, haloSize: 16, pulse: 0.4, spin: 3, spikes: 0.8 } },
};

const SURFACES = [
  { value: 'auto', label: 'Match temperature' },
  { value: 'star_yellow', label: 'Granulated (yellow)' },
  { value: 'star_red', label: 'Spotted (red)' },
  { value: 'star_blue', label: 'Turbulent (blue)' },
];

export const SUN_FIELDS = [
  { group: 'Star', key: 'temp', label: 'Temperature', type: 'range', min: 2400, max: 30000, step: 100, def: 5800, unit: ' K', hint: 'Sets the colour of the star and of its light', rand: () => round(Math.exp(rnd(Math.log(2600), Math.log(24000))), 100) },
  { group: 'Star', key: 'radius', label: 'Size', type: 'range', min: 1, max: 9, step: 0.1, def: 3.3, rand: () => round(rnd(1.6, 6.5), 0.1) },
  { group: 'Star', key: 'brightness', label: 'Surface brightness', type: 'range', min: 1, max: 7, step: 0.1, def: 3, rand: () => round(rnd(2, 4.5), 0.1) },
  { group: 'Star', key: 'surface', label: 'Surface texture', type: 'select', def: 'auto', options: () => SURFACES },
  { group: 'Star', key: 'tint', label: 'Colour by temperature', type: 'range', min: 0, max: 1, step: 0.01, def: 0.85, hint: '0 keeps the texture’s own colours' },
  { group: 'Star', key: 'limb', label: 'Limb darkening', type: 'range', min: 0, max: 1, step: 0.01, def: 0.65 },
  { group: 'Star', key: 'spin', label: 'Rotation speed', type: 'range', min: 0, max: 10, step: 0.1, def: 1 },
  { group: 'Star', key: 'pulse', label: 'Pulse / flicker', type: 'range', min: 0, max: 4, step: 0.05, def: 1 },

  { group: 'Glow', key: 'corona', label: 'Corona strength', type: 'range', min: 0, max: 1.6, step: 0.01, def: 0.6 },
  { group: 'Glow', key: 'coronaSize', label: 'Corona size', type: 'range', min: 1.6, max: 7, step: 0.05, def: 3.6 },
  { group: 'Glow', key: 'halo', label: 'Outer halo', type: 'range', min: 0, max: 0.4, step: 0.005, def: 0.09 },
  { group: 'Glow', key: 'haloSize', label: 'Halo size', type: 'range', min: 4, max: 18, step: 0.1, def: 8 },
  { group: 'Glow', key: 'spikes', label: 'Light rays', type: 'range', min: 0, max: 1, step: 0.01, def: 0, rand: () => (chance(0.5) ? 0 : round(rnd(0.1, 0.8), 0.01)) },

  { group: 'Light', key: 'light', label: 'Light on planets', type: 'range', min: 0.4, max: 4, step: 0.05, def: 2.1, rand: () => round(rnd(1.5, 2.8), 0.05) },
];

export const SUN_DEFAULTS = Object.fromEntries(SUN_FIELDS.map((f) => [f.key, f.def]));

const surfaceForTemp = (k) => (k < 4000 ? 'star_red' : k < 9000 ? 'star_yellow' : 'star_blue');
const legacyTemp = { star_yellow: 5800, star_red: 3100, star_blue: 16000 };

/** A galaxy's old `star` id as Forge settings (texture colours kept as they were). */
export function sunFromLegacy(starId) {
  return { temp: legacyTemp[starId] ?? 5800, surface: STARS[starId] ? starId : 'star_yellow', tint: 0 };
}

/**
 * Full star parameters. Galaxies from before the Forge only have `star` (one of STARS) and keep
 * those exact colours; Forge galaxies derive their colours from the temperature.
 */
export function sunOf(g) {
  if (!g.sun) {
    const info = STARS[g.star] ?? STARS.star_yellow;
    return {
      ...SUN_DEFAULTS, ...sunFromLegacy(g.star),
      label: info.label, glow: info.glow, lightColor: info.light, albedo: info.albedo,
    };
  }
  const s = { ...SUN_DEFAULTS, ...g.sun };
  const surf = s.surface === 'auto' ? surfaceForTemp(s.temp) : s.surface;
  return {
    ...s,
    label: s.label ?? nearestPreset(s.temp).label,
    glow: glowForTemp(s.temp),
    lightColor: kelvinRGB(s.temp),
    albedo: (STARS[surf] ?? STARS.star_yellow).albedo,
  };
}

function nearestPreset(temp) {
  let best = STAR_PRESETS.g;
  for (const p of Object.values(STAR_PRESETS)) if (Math.abs(p.sun.temp - temp) < Math.abs(best.sun.temp - temp)) best = p;
  return best;
}

/** The old STARS id closest to a temperature (the HUD and older code still read `galaxy.star`). */
export const legacyStarFor = (temp) => (temp < 4200 ? 'star_red' : temp < 10000 ? 'star_yellow' : 'star_blue');

export function randomSun() {
  const base = pick(Object.values(STAR_PRESETS));
  const s = { ...base.sun, surface: 'auto', tint: 0.85, limb: 0.65, light: 2.1 };
  for (const f of SUN_FIELDS) if (chance(0.55)) s[f.key] = randomValue(f);
  s.temp = Math.max(2400, Math.min(30000, round(base.sun.temp * rnd(0.85, 1.18), 100)));
  s.label = base.label;
  return s;
}

// =========================================================================== //
//  3. Planets
// =========================================================================== //

// Realistic moons per planet type, so every world gets the companions a real one would.
// size: moon radius as a fraction of the planet's; dist: extra orbital distance in planet radii.
// Earth-likes keep one big moon; Mars-likes two captured rocks; giants a family of moons;
// Pluto-likes a Charon. Worlds a real one would lose its moons to (hot Jupiters, tidally locked
// eyeballs, lava worlds hugging their star) or that are moons themselves get none.
export const MOON_DEFAULTS = {
  terra: [{ type: 'luna', size: 0.27, dist: 0.7 }],
  thalassa: [{ type: 'luna', size: 0.22, dist: 0.6 }],
  sylva: [{ type: 'luna', size: 0.16, dist: 0.45 }, { type: 'dune', size: 0.07, dist: 1.2, irregular: true }],
  dune: [{ type: 'luna', size: 0.1, dist: 0.25, irregular: true }, { type: 'luna', size: 0.07, dist: 0.9, irregular: true }],
  mesa: [{ type: 'dune', size: 0.09, dist: 0.35, irregular: true }, { type: 'luna', size: 0.06, dist: 1.0, irregular: true }],
  halite: [{ type: 'luna', size: 0.13, dist: 0.55 }],
  prisma: [{ type: 'luna', size: 0.12, dist: 0.5, irregular: true }],
  veil: [],
  tholos: [{ type: 'luna', size: 0.5, dist: 0.6 }],
  jovian: [
    { type: 'sulfura', size: 0.12, dist: 0.2 },
    { type: 'glacier', size: 0.1, dist: 0.55 },
    { type: 'luna', size: 0.16, dist: 0.95 },
    { type: 'tholos', size: 0.15, dist: 1.4 },
  ],
  saturn: [
    { type: 'glacier', size: 0.06, dist: 0.15 },
    { type: 'glacier', size: 0.08, dist: 0.5 },
    { type: 'veil', size: 0.16, dist: 1.1 },
  ],
  neptune: [{ type: 'tholos', size: 0.15, dist: 0.45, retro: true }, { type: 'luna', size: 0.05, dist: 1.3, irregular: true }],
  cyane: [
    { type: 'glacier', size: 0.07, dist: 0.2 },
    { type: 'luna', size: 0.1, dist: 0.6 },
    { type: 'luna', size: 0.1, dist: 1.0 },
  ],
  viridis: [
    { type: 'glacier', size: 0.11, dist: 0.3 },
    { type: 'luna', size: 0.13, dist: 0.8 },
    { type: 'sulfura', size: 0.09, dist: 1.3 },
  ],
  amethyst: [{ type: 'tholos', size: 0.12, dist: 0.4 }, { type: 'luna', size: 0.1, dist: 1.0 }],
};

// Worlds that make believable moons (no gas giants).
export const MOON_TYPES = ['luna', 'glacier', 'sulfura', 'tholos', 'dune', 'mesa', 'halite', 'veil', 'inferno', 'prisma', 'terra', 'thalassa', 'sylva', 'janus'];

const RING_STYLES = [
  { value: 'aurelia', label: 'Broad icy (Saturn)' },
  { value: 'cyane', label: 'Narrow dark (Uranus)' },
  { value: 'ice', label: 'Bright ringlets' },
  { value: 'dust', label: 'Faint dust' },
];

const typeOptions = () => planetTypes().map((t) => ({ value: t.id, label: t.name }));
const atmoOf = (t) => t.atmo;

export const PLANET_FIELDS = [
  // --- world
  { group: 'World', key: 'type', label: 'Planet type', type: 'types', def: 'terra', rebuild: true, options: typeOptions },
  { group: 'World', key: 'size', label: 'Size', type: 'range', min: 0.4, max: 2.2, step: 0.05, def: 1, rebuild: true, rand: () => round(rnd(0.7, 1.5), 0.05) },
  { group: 'World', key: 'tilt', label: 'Axial tilt', type: 'range', min: 0, max: 90, step: 1, def: (t) => t.tilt ?? 10, unit: '°', rand: () => round(chance(0.85) ? rnd(0, 35) : rnd(35, 90), 1) },
  { group: 'World', key: 'spin', label: 'Rotation speed', type: 'range', min: 0, max: 6, step: 0.05, def: 1, rand: () => round(rnd(0.3, 2.5), 0.05) },
  // --- surface look
  { group: 'Surface', key: 'hue', label: 'Colour shift', type: 'range', min: -3.14, max: 3.14, step: 0.01, def: 0, hue: true, rand: () => (chance(0.45) ? 0 : round(rnd(-3.14, 3.14), 0.01)) },
  { group: 'Surface', key: 'sat', label: 'Saturation', type: 'range', min: 0, max: 2, step: 0.01, def: 1, rand: () => round(rnd(0.7, 1.4), 0.01) },
  { group: 'Surface', key: 'bright', label: 'Brightness', type: 'range', min: 0.4, max: 1.8, step: 0.01, def: 1, rand: () => round(rnd(0.85, 1.2), 0.01) },
  { group: 'Surface', key: 'relief', label: 'Terrain relief', type: 'range', min: 0, max: 3, step: 0.05, def: 1, when: (t) => !!t.maps.normal, rand: () => round(rnd(0.6, 2), 0.05) },
  { group: 'Surface', key: 'ocean', label: 'Ocean glint', type: 'range', min: 0, max: 3, step: 0.05, def: 1, when: (t) => !!t.maps.spec, rand: () => round(rnd(0.5, 1.8), 0.05) },
  { group: 'Surface', key: 'glow', label: (t) => (t.night_lights ? 'City lights' : 'Glow (lava, crystals)'), type: 'range', min: 0, max: 4, step: 0.05, def: 1, when: (t) => !!t.maps.emissive, rand: () => round(rnd(0.4, 2.2), 0.05) },
  // --- atmosphere
  { group: 'Atmosphere', key: 'atmo', label: 'Atmosphere', type: 'toggle', def: (t) => !!atmoOf(t), rebuild: true, rand: (t) => (atmoOf(t) ? chance(0.9) : chance(0.2)) },
  { group: 'Atmosphere', key: 'atmoColor', label: 'Sky colour', type: 'color', def: (t) => rgbHex(atmoOf(t)?.color ?? [0.5, 0.7, 1]), rebuild: true, needs: 'atmo', rand: (t) => (chance(0.6) ? rgbHex(atmoOf(t)?.color ?? [0.5, 0.7, 1]) : hsl(Math.random(), rnd(0.4, 0.8), rnd(0.6, 0.75))) },
  { group: 'Atmosphere', key: 'atmoThick', label: 'Thickness', type: 'range', min: 0.01, max: 0.16, step: 0.005, def: (t) => atmoOf(t)?.thickness ?? 0.05, rebuild: true, needs: 'atmo', rand: () => round(rnd(0.03, 0.1), 0.005) },
  { group: 'Atmosphere', key: 'atmoGlow', label: 'Glow', type: 'range', min: 0, max: 3, step: 0.05, def: (t) => atmoOf(t)?.intensity ?? 1, needs: 'atmo', rand: () => round(rnd(0.5, 1.6), 0.05) },
  // --- clouds
  { group: 'Clouds', key: 'clouds', label: 'Cloud cover', type: 'range', min: 0, max: 1.5, step: 0.05, def: (t) => (t.maps.clouds ? t.clouds ?? 1 : 0), rebuild: true, rand: (t) => (t.maps.clouds ? round(rnd(0.5, 1.3), 0.05) : chance(0.25) ? round(rnd(0.3, 0.9), 0.05) : 0) },
  { group: 'Clouds', key: 'cloudSpeed', label: 'Wind speed', type: 'range', min: 0, max: 5, step: 0.05, def: (t) => t.cloud_speed ?? 1, needs: 'clouds' },
  { group: 'Clouds', key: 'cloudColor', label: 'Cloud colour', type: 'color', def: '#f2f5fa', needs: 'clouds', rand: () => (chance(0.7) ? '#f2f5fa' : hsl(Math.random(), rnd(0.2, 0.6), rnd(0.75, 0.9))) },
  // --- rings
  { group: 'Rings', key: 'rings', label: 'Rings', type: 'toggle', def: (t) => !!t.rings, rebuild: true, rand: (t) => (t.rings ? chance(0.85) : chance(GIANTS.has(t.id) ? 0.35 : 0.08)) },
  { group: 'Rings', key: 'ringStyle', label: 'Ring style', type: 'select', def: (t) => (t.id === 'cyane' ? 'cyane' : 'aurelia'), rebuild: true, needs: 'rings', options: () => RING_STYLES },
  { group: 'Rings', key: 'ringInner', label: 'Inner edge', type: 'range', min: 1.1, max: 2.6, step: 0.05, def: (t) => t.rings?.inner ?? 1.3, rebuild: true, needs: 'rings', unit: '× r', rand: () => round(rnd(1.15, 1.7), 0.05) },
  { group: 'Rings', key: 'ringOuter', label: 'Outer edge', type: 'range', min: 1.3, max: 3.4, step: 0.05, def: (t) => t.rings?.outer ?? 2.3, rebuild: true, needs: 'rings', unit: '× r', rand: () => round(rnd(1.9, 2.8), 0.05) },
  { group: 'Rings', key: 'ringHue', label: 'Ring colour shift', type: 'range', min: -3.14, max: 3.14, step: 0.01, def: 0, hue: true, needs: 'rings', rand: () => (chance(0.6) ? 0 : round(rnd(-3.14, 3.14), 0.01)) },
  { group: 'Rings', key: 'ringOpacity', label: 'Ring density', type: 'range', min: 0.1, max: 1.6, step: 0.05, def: 1, needs: 'rings', rand: () => round(rnd(0.6, 1.3), 0.05) },
  // --- belt
  { group: 'Rings', key: 'belt', label: 'Asteroid belt', type: 'toggle', def: (t) => BELT_TYPES.has(t.id), rebuild: true, blocked: 'rings', rand: (t) => (BELT_TYPES.has(t.id) ? chance(0.7) : chance(0.15)) },
];

export const PLANET_FIELD = Object.fromEntries(PLANET_FIELDS.map((f) => [f.key, f]));

/** Keys whose change needs the planet rebuilt (everything else updates live). */
export const PLANET_REBUILD_KEYS = [...PLANET_FIELDS.filter((f) => f.rebuild).map((f) => f.key), 'moons'];
/** Keys that only affect the course, not the world. */
export const COURSE_KEYS = ['name', 'course', 'lessons', 'completed'];
/** Everything that changes a planet's look, when set on it. */
export const PLANET_LOOK_KEYS = [...PLANET_FIELDS.map((f) => f.key), 'moons'];

/** A planet's value for a field: its own override, or its type's default. */
export function planetValue(data, key, def = getType(data.type)) {
  return data[key] ?? fieldDefault(PLANET_FIELD[key], def);
}

export function beltAllowed(data, def) {
  return !planetValue(data, 'rings', def);
}

export function hasBelt(data, def) {
  return beltAllowed(data, def) && !!planetValue(data, 'belt', def);
}

/** The moons a planet really has: its own list, or the realistic ones for its type. */
export function moonsOf(data, def = getType(data.type)) {
  return data.moons ?? MOON_DEFAULTS[def.id] ?? [];
}

/**
 * Everything the renderer needs to know about one planet, with every override applied.
 * Distances are in planet radii.
 */
export function resolvePlanet(data, def) {
  const v = (k) => planetValue(data, k, def);
  const rings = v('rings')
    ? (() => {
        const inner = v('ringInner');
        const style = v('ringStyle');
        const baked = style === 'aurelia' ? getType('saturn') : style === 'cyane' ? getType('cyane') : null;
        return {
          style,
          inner,
          outer: Math.max(v('ringOuter'), inner + 0.15),
          map: baked?.maps.rings ?? null, // null: generated on a canvas (see rings.js)
          hue: v('ringHue'),
          opacity: v('ringOpacity'),
        };
      })()
    : null;
  const atmo = v('atmo')
    ? { color: hexRgb(v('atmoColor')), thickness: v('atmoThick'), intensity: v('atmoGlow'), sunset: def.atmo?.sunset }
    : null;
  const cloudAmt = v('clouds');
  // Worlds without their own cloud map borrow a matching one: Terra's weather, or Azure's bands.
  const cloudMap = def.maps.clouds ?? getType(GIANTS.has(def.id) ? 'neptune' : 'terra').maps.clouds;
  const clouds = cloudAmt > 0.001 && cloudMap
    ? { amount: cloudAmt, map: cloudMap, speed: v('cloudSpeed'), color: hexRgb(v('cloudColor')) }
    : null;
  const belt = !rings && !!v('belt');
  const clearance = Math.max(rings ? rings.outer : 0, belt ? BELT.outer : 0, 1.15);
  const moons = moonsOf(data, def).map((m, i) => {
    const size = m.size ?? 0.15;
    return { ...m, index: i, size, orbit: clearance + 0.35 + size + (m.dist ?? 0.5) };
  });
  return {
    rings,
    atmo,
    clouds,
    belt,
    moons,
    clearance,
    tilt: data.tilt, // undefined: the type's tilt plus a little per-planet jitter
    spin: v('spin'),
    hue: v('hue'),
    sat: v('sat'),
    bright: v('bright'),
    relief: v('relief'),
    ocean: v('ocean'),
    glow: v('glow'),
  };
}

// --------------------------------------------------------------------------- random planets

const SYL_A = ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hel', 'Ix', 'Jor', 'Kal', 'Lum', 'Mor', 'Nex', 'Or', 'Pra', 'Quor', 'Ryn', 'Sol', 'Tal', 'Um', 'Vey', 'Xan', 'Zel', 'Ca', 'Ny', 'Vor', 'Aeg', 'Ith', 'Sy'];
const SYL_B = ['a', 'e', 'i', 'o', 'u', 'ae', 'io', 'ara', 'eon', 'yra', 'ari', 'ora'];
const SYL_C = ['n', 'x', 'th', 'ris', 'nia', 'dor', 'lis', 'mus', 'tis', 'ra', 'on', 'us', 'ia', 'ek', 'um', ''];

export function randomName() {
  const n = pick(SYL_A) + pick(SYL_B) + pick(SYL_C);
  return chance(0.12) ? `${n} ${pick(['Prime', 'II', 'IV', 'Major', 'Minor', 'b', 'c'])}` : n;
}

const GAL_A = ['Advanced', 'Applied', 'Modern', 'Classical', 'Foundations of', 'Deep', 'Outer', 'Inner', 'Frontier'];
const GAL_B = ['Mathematics', 'Engineering', 'Sciences', 'Arts', 'Languages', 'Medicine', 'Economics', 'Design', 'Computing', 'Humanities', 'Music'];
export const randomGalaxyName = () => `${pick(GAL_A)} ${pick(GAL_B)}`;

const COURSES = [
  'Statistics: Data & Chance', 'Linear Algebra', 'Organic Chemistry', 'Intro to Programming', 'Spanish I',
  'World Religions', 'Microeconomics', 'Creative Writing', 'Genetics', 'Discrete Math', 'Art History',
  'Machine Learning Basics', 'Public Speaking', 'Climate Science', 'Psychology 101', 'Web Development',
  'Geometry: Proofs & Shapes', 'Anatomy & Physiology', 'Music Production', 'Ethics in Technology',
];

/** Random moons for a planet type: giants get families, rocky worlds zero to two. */
export function randomMoons(typeId) {
  const giant = GIANTS.has(typeId);
  const n = giant ? (Math.random() * 5) | 0 : chance(0.5) ? 0 : 1 + (chance(0.3) ? 1 : 0);
  const moons = [];
  let dist = rnd(0.1, 0.4);
  for (let i = 0; i < n; i++) {
    const irregular = chance(giant ? 0.2 : 0.35);
    moons.push({
      type: pick(MOON_TYPES.slice(0, 9)),
      size: round(irregular ? rnd(0.05, 0.1) : rnd(0.07, giant ? 0.17 : 0.3), 0.01),
      dist: round(dist, 0.05),
      irregular,
      retro: chance(0.1),
    });
    dist += rnd(0.3, 0.6);
  }
  return moons;
}

/** A complete random world: every look parameter picked within its range. */
export function randomPlanet(extra = {}) {
  const types = planetTypes();
  const t = pick(types);
  const p = { name: randomName(), course: pick(COURSES), lessons: 6 + ((Math.random() * 11) | 0), completed: 0, type: t.id };
  for (const f of PLANET_FIELDS) if (f.key !== 'type') p[f.key] = randomValue(f, t);
  if (p.rings) p.belt = false;
  p.moons = chance(0.4) ? undefined : randomMoons(t.id);
  return { ...p, ...extra };
}

/** Clear the per-type settings, so they follow the new type's defaults (used when the type changes). */
export function clearTypeOverrides(p) {
  for (const f of PLANET_FIELDS) if (typeof f.def === 'function' && f.key !== 'type') delete p[f.key];
  delete p.moons;
  return p;
}

// =========================================================================== //
//  4. The system as a whole
// =========================================================================== //

export const SYSTEM_FIELDS = [
  { group: 'Orbits', key: 'firstOrbit', label: 'Inner orbit distance', type: 'range', min: 14, max: 70, step: 1, def: 34 },
  { group: 'Orbits', key: 'orbitGap', label: 'Orbit spacing', type: 'range', min: 5, max: 26, step: 0.5, def: 11 },
  { group: 'Orbits', key: 'orbitSpeed', label: 'Orbit speed', type: 'range', min: 0, max: 5, step: 0.05, def: 1, rand: () => round(rnd(0.4, 2), 0.05) },
  { group: 'Orbits', key: 'inclination', label: 'Orbit tilt spread', type: 'range', min: 0, max: 0.6, step: 0.005, def: 0.09, rand: () => round(rnd(0, 0.25), 0.005) },
  { group: 'Orbits', key: 'orbitLines', label: 'Orbit lines', type: 'range', min: 0, max: 0.6, step: 0.01, def: 0.13 },

  { group: 'Main asteroid belt', key: 'belt', label: 'Main belt', type: 'toggle', def: true, rand: () => chance(0.8) },
  { group: 'Main asteroid belt', key: 'beltAt', label: 'Position (inner → outer)', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5, needs: 'belt' },
  { group: 'Main asteroid belt', key: 'beltRocks', label: 'Number of rocks', type: 'range', min: 500, max: 14000, step: 100, def: 5200, needs: 'belt' },
  { group: 'Main asteroid belt', key: 'beltWidth', label: 'Width', type: 'range', min: 1, max: 12, step: 0.1, def: 4.2, needs: 'belt' },
  { group: 'Main asteroid belt', key: 'beltThick', label: 'Thickness', type: 'range', min: 0.05, max: 2.5, step: 0.05, def: 0.55, needs: 'belt' },
  { group: 'Main asteroid belt', key: 'beltIce', label: 'Icy rocks', type: 'range', min: 0, max: 1, step: 0.01, def: 0, needs: 'belt', hint: 'Mixes in bright, icy bodies' },

  { group: 'Moons', key: 'moons', label: 'Show moons', type: 'toggle', def: true, rand: () => true },
  { group: 'Moons', key: 'moonSpeed', label: 'Moon orbit speed', type: 'range', min: 0, max: 5, step: 0.05, def: 1, needs: 'moons' },

  { group: 'Camera & light', key: 'nightFill', label: 'Night-side fill light', type: 'range', min: 0, max: 0.5, step: 0.01, def: 0.12, rand: () => round(rnd(0.05, 0.22), 0.01) },
  { group: 'Camera & light', key: 'exposure', label: 'Exposure', type: 'range', min: 0.4, max: 2, step: 0.01, def: 1, rand: () => round(rnd(0.85, 1.2), 0.01) },
  { group: 'Camera & light', key: 'bloom', label: 'Bloom', type: 'range', min: 0, max: 2.5, step: 0.01, def: 0.8, rand: () => round(rnd(0.4, 1.3), 0.01) },
  { group: 'Camera & light', key: 'labels', label: 'Planet labels', type: 'toggle', def: true, rand: () => true },
];

export const SYSTEM_DEFAULTS = Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, f.def]));

export const systemOf = (g) => ({ ...SYSTEM_DEFAULTS, ...(g.system ?? {}) });

export function randomSystem() {
  return Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, chance(0.6) ? randomValue(f) : f.def]));
}

/** The star's display name for the HUD. */
export const starLabel = (g) => sunOf(g).label;
