// A star system: one star at the origin, course planets on inclined orbits.
// The planets themselves are the Blender-baked worlds from planet.js.
import * as THREE from 'three';
import { Planet, rand, BELT } from './planet.js';
import { AsteroidBelt } from './asteroids.js';
import { getType, starInfo, createStarMaterial, glowTexture } from './assets.js';

const STAR_RADIUS = 3.3;
const FIRST_ORBIT = 34;
const ORBIT_GAP = 11;
// The main belt sits in its own gap partway out, like the one between Mars and Jupiter.
const BELT_HALF_WIDTH = 4.2;
const BELT_GAP = BELT_HALF_WIDTH * 2 + 6;
const ORBIT_SPEED = 2.6; // angular speed = ORBIT_SPEED / r^1.5, shared by planets and rocks
const SUN_INTENSITY = 2.1;
// The photosphere is far brighter than anything it lights: the disc burns out to white-hot at
// the centre (as in any space photo that has the Sun in frame) and keeps its colour at the limb.
const STAR_GLOW = 3;
const UP = new THREE.Vector3(0, 1, 0);

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
    const info = starInfo(galaxy.star);
    // Every world is lit from the star's real position, in the star's own colour.
    this.env = {
      starPos: new THREE.Vector3(),
      sunColor: new THREE.Color(...info.light).multiplyScalar(SUN_INTENSITY),
    };
    this.belt = new AsteroidBelt({
      radius: FIRST_ORBIT,
      width: BELT_HALF_WIDTH,
      thickness: 0.55,
      count: 5200,
      size: [0.03, 0.3],
      kepler: ORBIT_SPEED,
      seed: [...galaxy.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0,
      sunColor: this.env.sunColor,
      ambient: new THREE.Color(0.5, 0.58, 0.78).multiplyScalar(0.12),
    });
    this.belt.orbitRadius = 0;
    this.belt.targetOrbit = 0;
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
    const info = starInfo(this.galaxy.star);
    const map = await this.bank.get(info.albedo, { srgb: true }).promise; // null if it failed to load
    const star = new THREE.Group();
    const spin = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), createStarMaterial(info.glow, map));
    mesh.scale.setScalar(STAR_RADIUS);
    spin.add(mesh);
    star.add(spin);

    const glowColor = new THREE.Color(info.glow);
    const corona = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: glowColor, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    corona.material.opacity = 0.6;
    corona.scale.setScalar(STAR_RADIUS * 3.6);
    const outer = corona.clone();
    outer.material = corona.material.clone();
    outer.material.opacity = 0.09;
    outer.scale.setScalar(STAR_RADIUS * 8);
    star.add(corona, outer);

    this.star = { group: star, spin, mesh, info, corona, outer, radius: STAR_RADIUS, color: glowColor };
    this.group.add(star);
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
      // how far the world reaches from its centre (rings or belt included), for orbit spacing
      extent: planet.radius * (planet.rings ? planet.def.rings.outer : planet.belt ? BELT.outer : 1),
      orbitRadius: 0,
      targetOrbit: 0,
      phase: rand(data.id, 1) * Math.PI * 2,
      incline: new THREE.Euler((rand(data.id, 2) - 0.5) * 0.09, 0, (rand(data.id, 6) - 0.5) * 0.09),
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

  updatePlanet(data, before) {
    let b = this.bodies.get(data.id);
    if (!b) return;
    b.data = data;
    b.planet.data = data;
    if (data.type !== before.type || data.size !== before.size || data.belt !== before.belt) {
      // Rebuild the world in place, keeping its spot on the orbit. It fades in once its maps are in.
      const { phase, orbitRadius } = b;
      const wasHero = b.planet.isHero;
      this.removePlanet(data.id);
      b = this.addPlanet(data, { spawn: false });
      b.phase = phase;
      b.orbitRadius = orbitRadius;
      b.planet.setHero(wasHero);
    }
    b.planet.hue.value = data.hue ?? 0;
    return b;
  }

  /** Assign orbit radii in list order and (re)draw orbit rings. */
  layout(immediate) {
    let r = FIRST_ORBIT;
    const ids = this.galaxy.planets.map((p) => p.id).filter((id) => this.bodies.has(id));
    const beltAfter = Math.ceil(ids.length / 2) - 1; // -1: an empty system keeps just the belt
    const placeBelt = () => {
      this.belt.targetOrbit = r + BELT_GAP / 2 - ORBIT_GAP / 2;
      if (immediate || !this.belt.orbitRadius) this.belt.orbitRadius = this.belt.targetOrbit;
      r += BELT_GAP;
    };
    if (beltAfter < 0) placeBelt();
    for (const [i, id] of ids.entries()) {
      const b = this.bodies.get(id);
      r += Math.max(0, b.extent - 1) * 2.5;
      b.targetOrbit = r;
      if (immediate || !b.orbitRadius) b.orbitRadius = r;
      r += ORBIT_GAP + Math.max(0, b.extent - 1) * 2.5;
      this.drawOrbit(b);
      if (i === beltAfter) placeBelt();
    }
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
          uGap: { value: b.extent * 1.6 },
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
    if (this.star) {
      const s = this.star;
      s.spin.rotation.y += dt * 0.02;
      const pulse = 1 + Math.sin(t * 0.8) * 0.03 + Math.sin(t * 2.3) * 0.015;
      s.corona.scale.setScalar(STAR_RADIUS * 3.6 * pulse);
      s.mesh.material.color.copy(s.mesh.material.userData.base).multiplyScalar(STAR_GLOW + Math.sin(t * 1.3) * 0.12);
    }
    for (const b of this.bodies.values()) {
      b.orbitRadius += (b.targetOrbit - b.orbitRadius) * Math.min(1, dt * 2);
      b.phase += dt * (ORBIT_SPEED / Math.pow(b.orbitRadius, 1.5));
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

      const focused = b.data.id === this.focusId;
      b.highlight += ((focused ? 1 : 0) - b.highlight) * Math.min(1, dt * 3);
      b.orbitLine.material.uniforms.uOpacity.value = 0.13 + b.highlight * 0.14;
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
    }
    this.group.removeFromParent();
  }
}
