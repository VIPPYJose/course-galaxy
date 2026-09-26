// A star system: one star at the origin, course planets on inclined orbits.
// The planets themselves are the Blender-baked worlds from planet.js.
//
// The star (sunOf), the layout, the main belt and the lighting (systemOf) all come from the
// galaxy's settings (params.js) and can be changed live by the Galaxy Forge.
import * as THREE from 'three';
import { Planet, rand } from './planet.js';
import { AsteroidBelt } from './asteroids.js';
import { getType, createStarMaterial, glowTexture, raysTexture } from './assets.js';
import { sunOf, systemOf, PLANET_REBUILD_KEYS } from './params.js';

const ORBIT_SPEED = 2.6; // angular speed = ORBIT_SPEED / r^1.5, shared by planets and rocks
const UP = new THREE.Vector3(0, 1, 0);
const NIGHT_TINT = new THREE.Color(0.5, 0.58, 0.78);

// Orbit lines fade out around their own planet, so the path never slices across its disc.
const ORBIT_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const ORBIT_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uPlanet;
  uniform float uGap;
  varying vec3 vWorldPos;
  void main() {
    float gap = smoothstep(uGap, uGap * 2.2, distance(vWorldPos, uPlanet));
    gl_FragColor = vec4(1.0, 1.0, 1.0, uOpacity * gap);
  }
`;

const beltKey = (c) => `${c.beltRocks}|${c.beltWidth}|${c.beltThick}|${c.beltIce}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class StarSystem {
  constructor(galaxy, bank) {
    this.galaxy = galaxy;
    this.bank = bank;
    this.group = new THREE.Group();
    this.bodies = new Map();
    this.flashes = [];
    this.time = 0;
    this.focusId = null;
    this._view = new THREE.Vector3();
    this.cfg = systemOf(galaxy);
    this.sun = sunOf(galaxy);
    // Every world is lit from the star's real position, in the star's own colour. These objects
    // are shared by reference (belts hold on to them), so they're only ever updated in place.
    this.env = {
      starPos: new THREE.Vector3(),
      sunColor: new THREE.Color(...this.sun.lightColor).multiplyScalar(this.sun.light),
      ambient: NIGHT_TINT.clone().multiplyScalar(this.cfg.nightFill),
    };
    this.buildBelt();
  }

  /** The system's main asteroid belt, in its own gap between the inner and outer planets. */
  buildBelt() {
    const c = this.cfg;
    const orbit = this.belt?.orbitRadius ?? 0;
    const target = this.belt?.targetOrbit ?? 0;
    this.belt?.dispose();
    this.belt = new AsteroidBelt({
      radius: c.firstOrbit,
      width: c.beltWidth,
      thickness: c.beltThick,
      count: c.beltRocks,
      size: [0.03, 0.3],
      kepler: ORBIT_SPEED * c.orbitSpeed,
      seed: [...this.galaxy.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) >>> 0,
      sunColor: this.env.sunColor,
      ambient: this.env.ambient,
      ice: c.beltIce,
    });
    this.belt.orbitRadius = orbit;
    this.belt.targetOrbit = target;
    this.belt.mesh.visible = c.belt;
    this.beltKey = beltKey(c);
    this.group.add(this.belt.mesh);
  }

  async build(onProgress = () => {}) {
    await this.buildStar();
    for (const p of this.galaxy.planets) this.addPlanet(p, { spawn: false });
    this.layout(true);
    const bodies = [...this.bodies.values()];
    let done = 0;
    await Promise.all(bodies.map((b) => b.planet.ready.then(() => onProgress(++done / bodies.length))));
    // Everything is in behind the loading screen / warp, so show the worlds straight away.
    for (const b of bodies) b.planet.fade = 1;
    return this;
  }

  async buildStar() {
    const sun = this.sun;
    const map = await this.bank.get(sun.albedo, { srgb: true }).promise; // null if it failed to load
    const star = new THREE.Group();
    const spin = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), createStarMaterial(sun.glow, map));
    spin.add(mesh);
    star.add(spin);
    const sprite = (tex) => new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    const corona = sprite(glowTexture());
    const outer = sprite(glowTexture());
    const rays = sprite(raysTexture());
    star.add(corona, outer, rays);
    this.star = { group: star, spin, mesh, corona, outer, rays, radius: sun.radius, color: new THREE.Color(), albedo: sun.albedo };
    this.group.add(star);
    this.setSun(sun);
  }

  /** Apply star settings live (see SUN_FIELDS). */
  setSun(sun) {
    this.sun = sun;
    const s = this.star;
    this.env.sunColor.setRGB(...sun.lightColor).multiplyScalar(sun.light);
    if (!s) return;
    s.radius = sun.radius;
    s.mesh.scale.setScalar(sun.radius);
    s.color.set(sun.glow);
    const mat = s.mesh.material;
    const u = mat.userData.uniforms;
    u.uLimb.value = sun.limb;
    u.uTintCol.value.setRGB(...sun.lightColor, THREE.SRGBColorSpace);
    u.uTintAmt.value = sun.tint;
    if (!mat.map) mat.userData.base.set(sun.glow);
    s.corona.material.color.copy(s.color);
    s.corona.material.opacity = sun.corona;
    s.outer.material.color.copy(s.color);
    s.outer.material.opacity = sun.halo;
    s.outer.scale.setScalar(sun.radius * sun.haloSize);
    s.rays.material.color.copy(s.color).lerp(new THREE.Color(1, 1, 1), 0.5);
    s.rays.material.opacity = sun.spikes;
    s.rays.visible = sun.spikes > 0.001;
    s.rays.scale.setScalar(sun.radius * 9);
    if (sun.albedo !== s.albedo) {
      s.albedo = sun.albedo;
      this.bank.get(sun.albedo, { srgb: true }).promise.then((t) => {
        if (!t || s.albedo !== sun.albedo) return;
        mat.map = t;
        mat.needsUpdate = true;
      });
    }
  }

  /** Apply system settings live (see SYSTEM_FIELDS): orbits re-space smoothly. */
  setConfig(cfg) {
    const prev = this.cfg;
    this.cfg = cfg;
    this.env.ambient.copy(NIGHT_TINT).multiplyScalar(cfg.nightFill);
    if (beltKey(cfg) !== this.beltKey) this.buildBelt();
    this.belt.mesh.visible = cfg.belt;
    this.belt.uniforms.uKepler.value = ORBIT_SPEED * cfg.orbitSpeed;
    if (prev.inclination !== cfg.inclination) for (const b of this.bodies.values()) b.incline.copy(this.inclineFor(b.data.id));
    this.layout(false);
  }

  inclineFor(id) {
    const k = this.cfg.inclination;
    return new THREE.Euler((rand(id, 2) - 0.5) * k, 0, (rand(id, 6) - 0.5) * k);
  }

  addPlanet(data, { spawn = true } = {}) {
    const planet = new Planet(data, getType(data.type), this.bank);
    const body = {
      data,
      planet,
      pivot: planet.group,
      radius: planet.radius,
      // what the camera frames: the globe, or the whole ring span for ringed worlds
      viewRadius: planet.frameRadius / 1.12,
      // ringed and belted worlds turn their equator toward the resting view (see advance)
      faceView: !!(planet.rings || planet.belt),
      proxy: planet.proxy,
      // how far the world reaches from its centre (rings, belt or moons included), for orbit spacing
      extent: planet.extent,
      orbitRadius: 0,
      targetOrbit: 0,
      phase: rand(data.id, 1) * Math.PI * 2,
      incline: this.inclineFor(data.id),
      orbitLine: null,
      highlight: 0,
      // ringed and belted worlds lean their equator toward the resting camera, well off-axis so they sit on a diagonal
      ringYaw: (rand(data.id, 8) < 0.5 ? -1 : 1) * (0.8 + rand(data.id, 9) * 0.4),
    };
    this.bodies.set(data.id, body);
    this.group.add(planet.group);
    this.layout(false);
    this.orbitPosition(body, planet.group.position);
    if (spawn) planet.ready.then(() => this.bodies.get(data.id) === body && this.flash(body));
    return body;
  }

  removePlanet(id) {
    const b = this.bodies.get(id);
    if (!b) return;
    this.group.remove(b.orbitLine);
    b.planet.dispose(); // textures are shared through the bank
    b.orbitLine?.geometry.dispose();
    b.orbitLine?.material.dispose();
    this.bodies.delete(id);
    this.layout(false);
  }

  /** A planet record changed in the store: rebuild the world if its build changed, else update it live. */
  updatePlanet(data, before) {
    const b = this.bodies.get(data.id);
    if (!b) return;
    if (PLANET_REBUILD_KEYS.some((k) => !same(data[k], before[k]))) return this.rebuildPlanet(data);
    return this.refreshPlanet(data);
  }

  /** Rebuild a world in place, keeping its spot on the orbit. `instant` skips the fade-in. */
  rebuildPlanet(data, { instant = false } = {}) {
    const old = this.bodies.get(data.id);
    if (!old) return;
    const { phase, orbitRadius } = old;
    const wasHero = old.planet.isHero;
    this.removePlanet(data.id);
    const b = this.addPlanet(data, { spawn: false });
    b.phase = phase;
    b.orbitRadius = orbitRadius;
    b.planet.setHero(wasHero);
    b.planet.instant = instant;
    return b;
  }

  /** Settings that don't need a rebuild (colours, glow, spin, tilt). */
  refreshPlanet(data) {
    const b = this.bodies.get(data.id);
    if (!b) return;
    b.data = data;
    b.planet.applyLook(data);
    return b;
  }

  /** Assign orbit radii in list order and (re)draw orbit rings. */
  layout(immediate) {
    const c = this.cfg;
    const beltGap = c.beltWidth * 2 + 6;
    let r = c.firstOrbit;
    const ids = this.galaxy.planets.map((p) => p.id).filter((id) => this.bodies.has(id));
    // -1: before the first planet (an empty system keeps just the belt)
    const beltAfter = c.belt ? Math.round(c.beltAt * ids.length) - 1 : -2;
    const placeBelt = () => {
      this.belt.targetOrbit = r + beltGap / 2 - c.orbitGap / 2;
      if (immediate || !this.belt.orbitRadius) this.belt.orbitRadius = this.belt.targetOrbit;
      r += beltGap;
    };
    if (beltAfter === -1) placeBelt();
    for (const [i, id] of ids.entries()) {
      const b = this.bodies.get(id);
      r += Math.max(0, b.extent - 1) * 2.5;
      b.targetOrbit = r;
      if (immediate || !b.orbitRadius) b.orbitRadius = r;
      r += c.orbitGap + Math.max(0, b.extent - 1) * 2.5;
      this.drawOrbit(b);
      if (i === beltAfter) placeBelt();
    }
    this.outerOrbit = r;
  }

  drawOrbit(b) {
    if (b.orbitLine) {
      this.group.remove(b.orbitLine);
      b.orbitLine.geometry.dispose();
      b.orbitLine.material.dispose();
    }
    const pts = [];
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * b.targetOrbit, 0, Math.sin(a) * b.targetOrbit).applyEuler(b.incline));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: { value: 0.16 },
          uPlanet: { value: b.pivot.position }, // live reference: follows the planet
          uGap: { value: Math.min(b.extent, b.radius * 2.6) * 1.6 },
        },
        vertexShader: ORBIT_VERT,
        fragmentShader: ORBIT_FRAG,
        transparent: true,
        depthWrite: false,
      }),
    );
    line.renderOrder = 1;
    b.orbitLine = line;
    this.group.add(line);
  }

  orbitPosition(b, target = new THREE.Vector3()) {
    const a = b.phase;
    return target.set(Math.cos(a) * b.orbitRadius, 0, Math.sin(a) * b.orbitRadius).applyEuler(b.incline);
  }

  setFocus(id) {
    this.focusId = id;
    for (const b of this.bodies.values()) b.planet.setHero(b.data.id === id);
  }

  /**
   * Move everything along its orbit. Runs before the camera so it frames this frame's positions.
   * `viewYaw` is the camera rig's resting swing off the star axis; ringed worlds turn their axial
   * tilt toward that view so the rings are seen open rather than edge-on.
   */
  advance(dt, viewYaw = 0) {
    this.time += dt;
    const t = this.time;
    const sun = this.sun;
    if (this.star) {
      const s = this.star;
      s.spin.rotation.y += dt * 0.02 * sun.spin;
      const k = sun.pulse;
      const pulse = 1 + (Math.sin(t * 0.8) * 0.03 + Math.sin(t * 2.3) * 0.015) * k;
      s.corona.scale.setScalar(sun.radius * sun.coronaSize * pulse);
      s.rays.material.rotation = t * 0.01;
      s.mesh.material.color.copy(s.mesh.material.userData.base).multiplyScalar(sun.brightness + Math.sin(t * 1.3) * 0.12 * k);
    }
    const speed = ORBIT_SPEED * this.cfg.orbitSpeed;
    for (const b of this.bodies.values()) {
      b.orbitRadius += (b.targetOrbit - b.orbitRadius) * Math.min(1, dt * 2);
      b.phase += dt * (speed / Math.pow(b.orbitRadius, 1.5));
      this.orbitPosition(b, b.pivot.position);
      if (b.faceView) {
        const d = this._view.set(b.pivot.position.x, 0, b.pivot.position.z).normalize().applyAxisAngle(UP, viewYaw);
        b.planet.tilt.rotation.y = Math.atan2(d.z, -d.x) + b.ringYaw;
      }
    }
  }

  /** Shading, occlusion fades and highlights, once the camera has moved for this frame. */
  update(dt, camera) {
    const belt = this.belt;
    belt.orbitRadius += (belt.targetOrbit - belt.orbitRadius) * Math.min(1, dt * 2);
    belt.uniforms.uBeltRadius.value = belt.orbitRadius;
    belt.update(dt);
    const hero = this.bodies.get(this.focusId)?.planet;
    const heroDist = hero ? camera.position.distanceTo(hero.position) : 1;
    const heroAng = hero ? Math.asin(THREE.MathUtils.clamp(hero.frameRadius / heroDist, 0, 1)) : 0;
    const toHero = new THREE.Vector3();
    const v = new THREE.Vector3();
    if (hero) toHero.subVectors(hero.position, camera.position).normalize();

    for (const b of this.bodies.values()) {
      const p = b.planet;
      // fade planets that sit between the camera and the hero, or crowd the lens
      let vis = 1;
      if (hero && p !== hero) {
        v.subVectors(p.position, camera.position);
        const dist = v.length();
        const ang = Math.acos(THREE.MathUtils.clamp(v.dot(toHero) / dist, -1, 1));
        const pAng = Math.asin(THREE.MathUtils.clamp(p.frameRadius / dist, 0, 1));
        if (dist < heroDist && ang < heroAng + pAng) vis = 0.12;
        if (dist < p.radius * 4) vis = Math.min(vis, THREE.MathUtils.clamp((dist - p.radius * 1.5) / (p.radius * 2.5), 0, 1));
      }
      p.visibility += (vis - p.visibility) * Math.min(1, dt * 5);
      p.update(dt, this.env);
      p.moonSpeed = this.cfg.moonSpeed;
      p.updateMoons(dt, camera, this.cfg.moons);

      const focused = b.data.id === this.focusId;
      b.highlight += ((focused ? 1 : 0) - b.highlight) * Math.min(1, dt * 3);
      b.orbitLine.material.uniforms.uOpacity.value = this.cfg.orbitLines * (1 + b.highlight * 1.08);
    }
    this.updateFlashes(dt);
  }

  /** Bright bloom when a new world forms. */
  flash(b, color = new THREE.Color(0.6, 0.85, 1.0)) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        color: color.clone().multiplyScalar(3),
      }),
    );
    sp.renderOrder = 5;
    this.group.add(sp);
    this.flashes.push({ sp, b, t: 0 });
  }

  updateFlashes(dt) {
    this.flashes = this.flashes.filter((f) => {
      f.t += dt / 1.6;
      f.sp.position.copy(f.b.pivot.position);
      f.sp.scale.setScalar(f.b.radius * (1 + f.t * 9));
      f.sp.material.opacity = Math.max(0, 1 - f.t) ** 2;
      if (f.t < 1) return true;
      f.sp.material.dispose();
      f.sp.removeFromParent();
      return false;
    });
  }

  pickables() {
    return [...this.bodies.values()].map((b) => b.proxy);
  }

  dispose() {
    for (const id of [...this.bodies.keys()]) this.removePlanet(id);
    this.belt.dispose();
    for (const f of this.flashes) f.sp.material.dispose();
    if (this.star) {
      this.star.mesh.geometry.dispose();
      this.star.mesh.material.dispose();
      this.star.corona.material.dispose();
      this.star.outer.material.dispose();
      this.star.rays.material.dispose();
    }
    this.group.removeFromParent();
  }
}
