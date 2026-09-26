// Course galaxy data model + persistence.
//
// state = {
//   activeGalaxyId,
//   galaxies: [{ id, name, style, seed, courses: [course] }]
// }
// course = { id, title, description, type, size: 's'|'m'|'l', progress: 0..1,
//            saved: bool, tint: [r,g,b], orbit: { radius, angle0, speed, incl, tilt, ... } }

import { mulberry32 } from './backdrop.js';

const KEY = 'course-galaxy:v1';
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export const ORBIT_START = 30;
export const ORBIT_GAP = 10.5;

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Orbit parameters for the n-th slot of a galaxy. Kepler-ish: outer orbits are slower. */
export function orbitForSlot(slot, seed = 1) {
  const rnd = mulberry32(seed * 7919 + slot * 104729);
  const radius = ORBIT_START + slot * ORBIT_GAP + (rnd() - 0.5) * 2.0;
  const period = 600 * Math.pow(radius / ORBIT_START, 1.5); // seconds per revolution
  return {
    slot,
    radius,
    angle0: slot * GOLDEN * 2.1 + rnd() * 0.6,
    speed: (Math.PI * 2) / period,
    incl: (rnd() - 0.5) * 5,
    tilt: 5 + rnd() * 22,
    tiltYaw: rnd() * Math.PI * 2,
    spin0: rnd() * Math.PI * 2,
    spinSpeed: 0.02 + rnd() * 0.03,
  };
}

function tintFor(seed) {
  const rnd = mulberry32(seed);
  const v = () => 0.92 + rnd() * 0.16;
  return [v(), v(), v()];
}

export function makeCourse({ title, description = '', type = 'terra', size = 'm', progress = 0, saved = false }, slot, seed) {
  return {
    id: uid('c'),
    title,
    description,
    type,
    size,
    progress,
    saved,
    tint: slot === 0 ? [1, 1, 1] : tintFor(seed * 31 + slot),
    orbit: orbitForSlot(slot, seed),
    createdAt: Date.now(),
  };
}

function defaultState() {
  const g1 = { id: uid('g'), name: 'Andromeda Academy', style: 'andromeda', seed: 7, courses: [] };
  const c1 = [
    ['Foundations of Programming', 'Variables, control flow and your first real programs.', 'terra', 'm', 1.0, true],
    ['Data Structures', 'Arrays, lists, trees, heaps and hash maps from the ground up.', 'dune', 'm', 0.72, false],
    ['Algorithms', 'Sorting, searching, graphs and the art of thinking in Big-O.', 'jovian', 'l', 0.4, false],
    ['Databases', 'Relational modelling, SQL and indexes that actually help.', 'glacier', 'm', 0.15, false],
    ['System Design', 'Scaling services, queues, caches and consistency trade-offs.', 'saturn', 'l', 0, false],
    ['Security', 'Threat models, auth, crypto basics and breaking things safely.', 'inferno', 'm', 0, false],
    ['Machine Learning', 'From linear regression to neural networks.', 'neptune', 'l', 0, false],
    ['Capstone Project', 'Ship something real and defend it.', 'luna', 'm', 0, false],
  ];
  c1.forEach(([title, description, type, size, progress, saved], i) => {
    g1.courses.push(makeCourse({ title, description, type, size, progress, saved }, i, g1.seed));
  });
  const g2 = { id: uid('g'), name: 'Orion Design Expanse', style: 'orion', seed: 21, courses: [] };
  const c2 = [
    ['Design Fundamentals', 'Composition, hierarchy, colour and rhythm.', 'neptune', 'm', 0.55, false],
    ['Typography', 'Type anatomy, pairing and setting text that sings.', 'luna', 'm', 0.2, false],
    ['UX Research', 'Interviews, synthesis and testing with real people.', 'terra', 'm', 0, false],
    ['Motion Design', 'Timing, easing and choreography for interfaces.', 'saturn', 'l', 0, false],
    ['Design Systems', 'Tokens, components and governance at scale.', 'jovian', 'l', 0, false],
  ];
  c2.forEach(([title, description, type, size, progress, saved], i) => {
    g2.courses.push(makeCourse({ title, description, type, size, progress, saved }, i, g2.seed));
  });
  return { version: 1, activeGalaxyId: g1.id, galaxies: [g1, g2] };
}

export class Store {
  constructor() {
    this.listeners = new Set();
    this.state = this._load() || defaultState();
    // orbits are derived from (slot, galaxy seed) so layout tweaks apply to saved data too
    for (const g of this.state.galaxies) {
      for (const c of g.courses) c.orbit = orbitForSlot(c.orbit?.slot ?? 0, g.seed);
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.version === 1 && Array.isArray(s.galaxies) && s.galaxies.length ? s : null;
    } catch {
      return null;
    }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* private mode etc. - keep working in memory */
    }
  }

  _emit(evt) {
    this._save();
    for (const fn of this.listeners) fn(evt, this.state);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get galaxies() {
    return this.state.galaxies;
  }

  get activeGalaxy() {
    return this.state.galaxies.find((g) => g.id === this.state.activeGalaxyId) || this.state.galaxies[0];
  }

  setActiveGalaxy(id) {
    this.state.activeGalaxyId = id;
    this._emit({ type: 'galaxy-changed', id });
  }

  addGalaxy({ name, style }) {
    const seed = 1 + Math.floor(Math.random() * 9999);
    const g = { id: uid('g'), name, style, seed, courses: [] };
    this.state.galaxies.push(g);
    this.state.activeGalaxyId = g.id;
    this._emit({ type: 'galaxy-added', id: g.id });
    return g;
  }

  nextSlot(galaxy) {
    const used = new Set(galaxy.courses.map((c) => c.orbit.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  addCourse(galaxyId, data) {
    const g = this.state.galaxies.find((x) => x.id === galaxyId);
    const course = makeCourse(data, this.nextSlot(g), g.seed);
    g.courses.push(course);
    this._emit({ type: 'course-added', galaxyId, course });
    return course;
  }

  updateCourse(id, patch) {
    for (const g of this.state.galaxies) {
      const c = g.courses.find((x) => x.id === id);
      if (c) {
        Object.assign(c, patch);
        this._emit({ type: 'course-updated', galaxyId: g.id, course: c });
        return c;
      }
    }
    return null;
  }

  removeCourse(id) {
    for (const g of this.state.galaxies) {
      const i = g.courses.findIndex((x) => x.id === id);
      if (i >= 0) {
        const [course] = g.courses.splice(i, 1);
        this._emit({ type: 'course-removed', galaxyId: g.id, course });
        return course;
      }
    }
    return null;
  }

  reset() {
    this.state = defaultState();
    this._emit({ type: 'reset' });
  }
}
