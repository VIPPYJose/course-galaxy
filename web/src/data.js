// Galaxy / planet data, persistence and change notifications.
//
// Shape:
//   { activeGalaxy, galaxies: [{ id, name, star, nebula, sky?, sun?, system?, planets: [Planet] }] }
//   Planet = { id, name, course, type, hue, size, lessons, completed, belt?, moons?, ...look }
//
// `type` is a planet type from assets/planets.json (terra, jovian, dune, saturn, ...).
// `star` and `nebula` pick a preset star and sky. Galaxies made in the Galaxy Forge also carry
// `sky`, `sun` and `system` overrides, and planets any of the look settings in params.js
// (rings, atmosphere, clouds, moons, tilt, ...). Everything left out follows the defaults, so
// older saves keep working unchanged.
// A planet is "saved" when completed === lessons.

// v3: the demo galaxies grew to seven planets each (21 distinct worlds)
const STORAGE_KEY = 'course-galaxy/v3';

// Sky presets. `sky` holds any other environment settings the preset changes (see params.js).
export const NEBULAE = {
  violet: { label: 'Violet', a: '#2a1250', b: '#0c1a4a' },
  ember: { label: 'Ember', a: '#4a1210', b: '#2a0c30' },
  teal: { label: 'Teal', a: '#0b3a4a', b: '#10204a' },
  rose: { label: 'Rose', a: '#4a1038', b: '#1a0c40' },
  emerald: { label: 'Emerald', a: '#0d4028', b: '#08243a', sky: { knots: 1.3, bandColor: '#c8e6dc' } },
  gold: { label: 'Gold', a: '#4a3208', b: '#3a1408', sky: { core: 1.6, coreColor: '#ffe3b0', dust: 0.95 } },
  ice: { label: 'Ice', a: '#1a3a5c', b: '#0a1830', sky: { bandColor: '#d4e4ff', coreColor: '#eef4ff', starTemp: 0.5 } },
  void: { label: 'Void', a: '#10101c', b: '#06060c', sky: { nebula: 0.35, band: 0.45, haze: 0.2, galaxies: 2.2, starCount: 9000 } },
};

const uid = () => Math.random().toString(36).slice(2, 10);

function planet(name, course, type, lessons, completed, extra = {}) {
  return { id: uid(), name, course, type, hue: 0, size: 1, lessons, completed, ...extra };
}

function defaults() {
  return {
    activeGalaxy: 'core',
    galaxies: [
      {
        id: 'core',
        name: 'Core Sciences',
        star: 'star_yellow',
        nebula: 'violet',
        planets: [
          planet('Algebra', 'Algebra I: Equations & Functions', 'terra', 12, 12),
          planet('Vulcan', 'Physics: Forces & Energy', 'inferno', 10, 4),
          planet('Miasma', 'Chemistry: Reactions', 'veil', 14, 2),
          planet('Verdant', 'Biology: Life Systems', 'sylva', 12, 7),
          planet('Prism', 'Computer Science: Algorithms', 'prisma', 16, 1),
          planet('Kepler', 'Calculus: Limits & Derivatives', 'jovian', 9, 3),
          planet('Titan', 'Astronomy: The Cosmos', 'saturn', 8, 0),
        ],
      },
      {
        id: 'humanities',
        name: 'Humanities Reach',
        star: 'star_red',
        nebula: 'ember',
        planets: [
          planet('Dunehold', 'World History: Ancient Empires', 'dune', 10, 6),
          planet('Cinder', 'Literature: The Novel', 'sulfura', 9, 9),
          planet('Selene', 'Philosophy: Ethics', 'luna', 6, 1),
          planet('Atlas', 'Geography: Earth Systems', 'thalassa', 11, 3),
          planet('Chronos', 'Archaeology: Lost Civilizations', 'mesa', 8, 2),
          planet('Babel', 'Linguistics: How Language Works', 'janus', 10, 0),
          planet('Agora', 'Economics: Markets & Trade', 'pyra', 12, 5),
        ],
      },
      {
        id: 'arts',
        name: 'Creative Nebula',
        star: 'star_blue',
        nebula: 'teal',
        planets: [
          planet('Aria', 'Music Theory', 'neptune', 8, 2),
          planet('Chroma', 'Visual Design', 'amethyst', 10, 10),
          planet('Frost', 'Film & Story', 'glacier', 7, 0),
          planet('Lumen', 'Photography: Light & Lens', 'cyane', 9, 4),
          planet('Salina', 'Architecture: Space & Form', 'halite', 11, 1),
          planet('Tholos', 'Poetry: Form & Voice', 'tholos', 6, 3),
          planet('Verdigris', 'Game Design: Systems & Play', 'viridis', 12, 6),
        ],
      },
    ],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.galaxies) && data.galaxies.length) return data;
    }
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return defaults();
}

class Store extends EventTarget {
  constructor() {
    super();
    this.state = load();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* ignore quota / private mode */
    }
  }

  emit(type, detail) {
    this.save();
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get galaxy() {
    return this.state.galaxies.find((g) => g.id === this.state.activeGalaxy) ?? this.state.galaxies[0];
  }

  findPlanet(id) {
    for (const g of this.state.galaxies) {
      const p = g.planets.find((x) => x.id === id);
      if (p) return { galaxy: g, planet: p };
    }
    return null;
  }

  setActiveGalaxy(id) {
    if (!this.state.galaxies.some((g) => g.id === id)) return;
    this.state.activeGalaxy = id;
    this.emit('galaxy', { id });
  }

  /** Add a galaxy. A full galaxy from the Forge keeps its id and planets, so it looks as previewed. */
  addGalaxy({ id, name, star = 'star_yellow', nebula = 'violet', planets = [], ...rest }) {
    const taken = !id || this.state.galaxies.some((g) => g.id === id);
    const g = { ...rest, id: taken ? uid() : id, name, star, nebula, planets: planets.map((p) => ({ ...p, id: p.id ?? uid() })) };
    this.state.galaxies.push(g);
    this.emit('galaxies', { galaxy: g });
    return g;
  }

  /** Replace a galaxy's settings (and planets) with an edited copy from the Forge. */
  updateGalaxy(id, data) {
    const i = this.state.galaxies.findIndex((g) => g.id === id);
    if (i < 0) return null;
    const g = { ...data, id, planets: (data.planets ?? []).map((p) => ({ ...p, id: p.id ?? uid() })) };
    this.state.galaxies[i] = g;
    this.emit('galaxies', { galaxy: g });
    return g;
  }

  removeGalaxy(id) {
    if (this.state.galaxies.length < 2) return;
    this.state.galaxies = this.state.galaxies.filter((g) => g.id !== id);
    if (this.state.activeGalaxy === id) this.state.activeGalaxy = this.state.galaxies[0].id;
    this.emit('galaxies', { removed: id });
  }

  addPlanet(galaxyId, data) {
    const g = this.state.galaxies.find((x) => x.id === galaxyId);
    if (!g) throw new Error(`Unknown galaxy ${galaxyId}`);
    const p = {
      id: uid(),
      name: 'New Planet',
      course: 'Untitled course',
      type: 'terra',
      hue: 0,
      size: 1,
      lessons: 10,
      completed: 0,
      ...data,
    };
    g.planets.push(p);
    this.emit('planets', { galaxy: g, added: p });
    return p;
  }

  updatePlanet(id, patch) {
    const hit = this.findPlanet(id);
    if (!hit) return null;
    const before = { ...hit.planet };
    Object.assign(hit.planet, patch);
    hit.planet.lessons = Math.max(1, Math.round(hit.planet.lessons));
    hit.planet.completed = Math.max(0, Math.min(hit.planet.lessons, Math.round(hit.planet.completed)));
    const visual = Object.keys(patch).some((k) => !['name', 'course', 'lessons', 'completed'].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(hit.planet[k]));
    this.emit('planet', { galaxy: hit.galaxy, planet: hit.planet, before, visual });
    return hit.planet;
  }

  removePlanet(id) {
    const hit = this.findPlanet(id);
    if (!hit) return;
    hit.galaxy.planets = hit.galaxy.planets.filter((p) => p.id !== id);
    this.emit('planets', { galaxy: hit.galaxy, removed: id });
  }

  reset() {
    this.state = defaults();
    this.emit('galaxy', { id: this.state.activeGalaxy });
  }
}

export const store = new Store();
export const newId = uid;

export const isSaved = (p) => p.completed >= p.lessons;
export const progressOf = (p) => (p.lessons ? p.completed / p.lessons : 0);
