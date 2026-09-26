import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Planet, TextureBank } from './planet.js';
import { GalaxyBackdrop, Starfield } from './backdrop.js';
import { orbitVert, orbitFrag } from './shaders.js';

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_RIG = { az: -0.5, el: 0.22, zoom: 1 };
const BASE_FOV = 38;
// Key light ("the sun") relative to the hero framing: from the upper left, slightly in front.
const KEY_LIGHT = { right: -0.95, up: 0.4, back: 0.6 };

const STATUS_COLORS = {
  saved: new THREE.Color(1.0, 0.76, 0.38),
  active: new THREE.Color(0.42, 0.78, 1.0),
  idle: new THREE.Color(0.55, 0.62, 0.85),
};

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
const clamp = THREE.MathUtils.clamp;

export function courseStatus(c) {
  if (c.saved || c.progress >= 1) return 'saved';
  if (c.progress > 0) return 'active';
  return 'idle';
}

export class GalaxyView extends EventTarget {
  constructor(container, { manifest, labelLayer, assetBase = '' }) {
    super();
    this.container = container;
    this.labelLayer = labelLayer;
    this.types = new Map(manifest.planets.map((p) => [p.id, p]));

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add('galaxy-canvas');
    this.renderer = renderer;
    this.pixelRatio = renderer.getPixelRatio();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 9000);
    this.camera.position.set(0, 40, 120);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.8, 0.6, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.bank = new TextureBank(renderer, assetBase);
    this.starfield = new Starfield({ pixelRatio: this.pixelRatio });
    this.scene.add(this.starfield.points);
    this.system = new THREE.Group();
    this.scene.add(this.system);

    this.planets = [];
    this.orbits = new Map();
    this.backdrop = null;
    this.heroIndex = 0;
    this.time = 0;
    this.worldFade = 1;
    this.env = { sunDir: new THREE.Vector3(-1, 0.4, 0.6).normalize(), corePos: new THREE.Vector3() };
    this.rig = { ...DEFAULT_RIG, azV: 0, elV: 0, px: 0, py: 0 };
    this.heroAz = DEFAULT_RIG.az;
    this.lastInteraction = -1e9;
    this.transition = null;
    this.warp = null;
    this.flashes = [];
    this.hovered = null;
    this._tmp = { pose: { pos: new THREE.Vector3(), target: new THREE.Vector3() }, v: new THREE.Vector3() };
    this.curTarget = new THREE.Vector3();
    this.curLight = this.env.sunDir.clone();
    this.frameTimes = [];

    this._bindInput();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ======================================================================= galaxy
  /** Build a galaxy (backdrop + planets). With warp=true the switch is animated. */
  setGalaxy(galaxy, { warp = false, focusId = null } = {}) {
    if (warp && this.backdrop) {
      this.warp = { phase: 'out', t: 0, galaxy, focusId };
      this.dispatchEvent(new CustomEvent('warp', { detail: { galaxy } }));
      return;
    }
    this._buildGalaxy(galaxy, focusId);
  }

  _buildGalaxy(galaxy, focusId) {
    for (const p of this.planets) p.dispose();
    for (const o of this.orbits.values()) {
      o.geometry.dispose();
      o.material.dispose();
      o.removeFromParent();
    }
    this.planets = [];
    this.orbits.clear();
    if (this.labelLayer) this.labelLayer.innerHTML = '';
    if (this.backdrop) this.backdrop.dispose();
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.backdrop = new GalaxyBackdrop({
      style: galaxy.style, seed: galaxy.seed, pixelRatio: this.pixelRatio, count: mobile ? 60000 : 110000,
    });
    this.scene.add(this.backdrop.group);
    this.galaxy = galaxy;
    // start the clock at a galaxy-specific time so layouts differ
    this.time = (galaxy.seed % 97) * 3.1;
    for (const c of galaxy.courses) this._addPlanet(c, { instant: true });
    const idx = focusId ? this.planets.findIndex((p) => p.course.id === focusId) : 0;
    this.heroIndex = Math.max(0, idx);
    this.transition = null;
    for (const p of this.planets) p.placeAt(this.time);
    this.heroAz = this._bestAzimuth(this.hero);
    this.rig.az = this.heroAz;
    this._snapCamera();
    this._emitFocus();
  }

  _addPlanet(course, { instant = false } = {}) {
    const def = this.types.get(course.type) || this.types.values().next().value;
    const p = new Planet(course, def, this.bank);
    p.loaded = false;
    p.ready.then(() => { p.loaded = true; });
    if (instant) p.fade = 0;
    this.system.add(p.group);
    this.planets.push(p);
    this._addOrbit(p);
    this._addLabel(p);
    p.placeAt(this.time);
    return p;
  }

  _addOrbit(p) {
    const o = p.course.orbit;
    const n = 360;
    const pos = new Float32Array(n * 3);
    const aT = new Float32Array(n);
    const inc = THREE.MathUtils.degToRad(o.incl || 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * o.radius;
      pos[i * 3 + 1] = Math.sin(a) * o.radius * Math.sin(inc);
      pos[i * 3 + 2] = Math.sin(a) * o.radius * Math.cos(inc);
      aT[i] = i / n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uPhase: { value: 0 }, uBase: { value: 0.05 }, uTrail: { value: 0.5 },
        uColor: { value: STATUS_COLORS[courseStatus(p.course)].clone() }, uFade: { value: 0 },
      },
      vertexShader: orbitVert, fragmentShader: orbitFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const line = new THREE.LineLoop(g, m);
    line.renderOrder = -1;
    this.system.add(line);
    this.orbits.set(p.course.id, line);
  }

  _addLabel(p) {
    if (!this.labelLayer) return;
    const el = document.createElement('button');
    el.className = 'planet-label';
    el.type = 'button';
    el.innerHTML = '<span class="dot"></span><span class="name"></span><span class="pct"></span>';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.focusCourse(p.course.id);
    });
    this.labelLayer.appendChild(el);
    p.label = el;
    this._refreshLabel(p);
  }

  _refreshLabel(p) {
    if (!p.label) return;
    const st = courseStatus(p.course);
    p.label.dataset.status = st;
    p.label.querySelector('.name').textContent = p.course.title;
    p.label.querySelector('.pct').textContent = st === 'saved' ? 'saved' : `${Math.round(p.course.progress * 100)}%`;
    p._labelW = 0;
    p.label.setAttribute('aria-label', `Fly to ${p.course.title}`);
  }

  /** Add a course planet at runtime (with formation effect) and fly to it. */
  addCourse(course, { fly = true } = {}) {
    const p = this._addPlanet(course);
    p.fade = 0;
    this._spawnFlash(p);
    if (fly) this.focusCourse(course.id);
    return p;
  }

  removeCourse(id) {
    const i = this.planets.findIndex((p) => p.course.id === id);
    if (i < 0) return;
    const [p] = this.planets.splice(i, 1);
    p.label?.remove();
    const o = this.orbits.get(id);
    if (o) {
      o.geometry.dispose();
      o.material.dispose();
      o.removeFromParent();
      this.orbits.delete(id);
    }
    p.dispose();
    if (!this.planets.length) return;
    const next = Math.min(i, this.planets.length - 1);
    this.heroIndex = Math.min(this.heroIndex, this.planets.length - 1);
    this.focus(next, { force: true });
  }

  updateCourse(course) {
    const p = this.planets.find((x) => x.course.id === course.id);
    if (!p) return;
    p.course = course;
    this._refreshLabel(p);
    const o = this.orbits.get(course.id);
    if (o) o.material.uniforms.uColor.value.copy(STATUS_COLORS[courseStatus(course)]);
    if (this.planets[this.heroIndex] === p) this._emitFocus();
  }

  // ======================================================================= focus
  get hero() {
    return this.planets[this.heroIndex];
  }

  focusCourse(id) {
    const i = this.planets.findIndex((p) => p.course.id === id);
    if (i >= 0) this.focus(i);
  }

  next() {
    if (this.planets.length) this.focus((this.heroIndex + 1) % this.planets.length);
  }

  prev() {
    if (this.planets.length) this.focus((this.heroIndex - 1 + this.planets.length) % this.planets.length);
  }

  focus(index, { force = false } = {}) {
    if (!this.planets[index]) return;
    if (index === this.heroIndex && !force && !this.transition) {
      this.dispatchEvent(new CustomEvent('hero-click', { detail: this.hero.course }));
      return;
    }
    const from = {
      pos: this.camera.position.clone(),
      target: this.curTarget.clone(),
      light: this.curLight.clone(),
    };
    const to = this.planets[index];
    const d = from.pos.distanceTo(to.position);
    this.transition = { from, to: index, t: 0, dur: clamp(1.3 + d / 90, 1.5, 3.0) };
    this.heroIndex = index;
    // frame the new hero from the direction that shows the most of the system behind it
    this.heroAz = this._bestAzimuth(to, this.time + this.transition.dur);
    this.rig.az = this.heroAz;
    this.rig.el = DEFAULT_RIG.el;
    this.rig.zoom = DEFAULT_RIG.zoom;
    this._emitFocus();
    this.dispatchEvent(new CustomEvent('transition-start', { detail: to.course }));
  }

  /** Opening shot: start wide above the galaxy and dive in to the hero planet. */
  intro(duration = 3.4) {
    const h = this.hero;
    if (!h) return;
    const pose = this._heroFrame(h, { az: this.heroAz, el: DEFAULT_RIG.el, zoom: 1 }, {
      pos: new THREE.Vector3(), target: new THREE.Vector3(),
    });
    const dir = new THREE.Vector3(pose.pos.x, 0, pose.pos.z).normalize();
    const start = dir.multiplyScalar(250).add(new THREE.Vector3(0, 140, 0));
    this.camera.position.copy(start);
    this.curTarget.set(0, 0, 0);
    this.transition = {
      from: { pos: start.clone(), target: new THREE.Vector3(), light: this.curLight.clone() },
      to: this.heroIndex, t: 0, dur: duration,
    };
    this.dispatchEvent(new CustomEvent('transition-start', { detail: h.course }));
  }

  _emitFocus() {
    this.planets.forEach((p, i) => p.setHero(i === this.heroIndex));
    const h = this.hero;
    this.dispatchEvent(new CustomEvent('focus', {
      detail: h ? { course: h.course, index: this.heroIndex, total: this.planets.length, def: h.def } : null,
    }));
  }

  // ======================================================================= camera rig
  _frameDistance(p) {
    const vfov = THREE.MathUtils.degToRad(BASE_FOV);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const alpha = Math.min(vfov, hfov) * (this.camera.aspect < 0.8 ? 0.36 : 0.3);
    return p.frameRadius / Math.sin(alpha);
  }

  _heroFrame(p, rig, out) {
    const P = p.position;
    const rx = P.x;
    const rz = P.z;
    const rl = Math.hypot(rx, rz) || 1;
    const c = Math.cos(rig.az);
    const s = Math.sin(rig.az);
    const dx = (rx / rl) * c - (rz / rl) * s;
    const dz = (rx / rl) * s + (rz / rl) * c;
    const dist = this._frameDistance(p) * rig.zoom;
    out.pos.set(
      P.x + dx * Math.cos(rig.el) * dist,
      P.y + Math.sin(rig.el) * dist,
      P.z + dz * Math.cos(rig.el) * dist,
    );
    out.target.copy(P);
    return out;
  }

  /**
   * Pick the camera azimuth (around the hero, relative to its radial direction) that puts
   * the most planets - and ideally the glowing core - into the background of the shot.
   */
  _bestAzimuth(hero, atTime = this.time) {
    if (!hero) return DEFAULT_RIG.az;
    const saved = this.planets.map((p) => p.position.clone());
    for (const p of this.planets) p.placeAt(atTime);
    const vfov = THREE.MathUtils.degToRad(BASE_FOV);
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * this.camera.aspect;
    const pose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const v = new THREE.Vector3();
    const heroAng = Math.sin(Math.min(vfov, 2 * Math.atan(tanH)) * 0.3);
    const score = (az) => {
      this._heroFrame(hero, { az, el: DEFAULT_RIG.el, zoom: 1 }, pose);
      fwd.subVectors(pose.target, pose.pos).normalize();
      right.crossVectors(fwd, UP).normalize();
      up.crossVectors(right, fwd);
      let s = 0;
      const test = (pos, radius, weight) => {
        v.subVectors(pos, pose.pos);
        const z = v.dot(fwd);
        if (z <= radius * 3) return 0;
        const x = v.dot(right) / z;
        const y = v.dot(up) / z;
        if (Math.abs(x) > tanH * 0.88 || Math.abs(y) > tanV * 0.8) return 0;
        const rr = Math.hypot(x, y);
        if (rr < heroAng * 1.25) return -0.3 * weight; // hidden behind the hero
        return weight * (1 + Math.min((radius / z) * 25, 1.5)) * (rr > tanV * 0.25 ? 1 : 0.7);
      };
      for (const p of this.planets) if (p !== hero) s += test(p.position, p.radius, 1);
      s += test(this.env.corePos, 3, 1.4);
      if (hero.rings) {
        // show ringed heroes with their rings open rather than edge-on
        const n = new THREE.Vector3(0, 1, 0).applyQuaternion(hero.tilt.getWorldQuaternion(new THREE.Quaternion()));
        const open = Math.abs(n.dot(v.subVectors(pose.pos, pose.target).normalize()));
        s += 4 * THREE.MathUtils.smoothstep(open, 0.12, 0.42);
      }
      let da = Math.abs(az - DEFAULT_RIG.az) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      return s - da * 0.15;
    };
    let best = DEFAULT_RIG.az;
    let bestS = -Infinity;
    for (let k = 0; k < 36; k++) {
      const az = DEFAULT_RIG.az + (k / 36) * Math.PI * 2;
      const s = score(az);
      if (s > bestS) {
        bestS = s;
        best = az;
      }
    }
    this.planets.forEach((p, i) => p.position.copy(saved[i]));
    // keep the angle continuous with the current rig to avoid long spins
    const cur = this.rig.az;
    return cur + Math.atan2(Math.sin(best - cur), Math.cos(best - cur));
  }

  /** Sun direction anchored to the hero's framing (upper-left, slightly in front). */
  _keyLight(p, out) {
    const f = this._heroFrame(p, { az: this.heroAz, el: DEFAULT_RIG.el, zoom: 1 }, {
      pos: new THREE.Vector3(), target: new THREE.Vector3(),
    });
    const back = f.pos.clone().sub(f.target).normalize();       // planet -> camera
    const right = new THREE.Vector3().crossVectors(UP, back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right).normalize();
    return out.set(0, 0, 0)
      .addScaledVector(right, KEY_LIGHT.right)
      .addScaledVector(up, KEY_LIGHT.up)
      .addScaledVector(back, KEY_LIGHT.back)
      .normalize();
  }

  _snapCamera() {
    const h = this.hero;
    if (!h) {
      this.camera.position.set(0, 60, 160);
      this.curTarget.set(0, 0, 0);
      this.camera.lookAt(this.curTarget);
      return;
    }
    h.placeAt(this.time);
    const pose = this._heroFrame(h, this.rig, this._tmp.pose);
    this.camera.position.copy(pose.pos);
    this.curTarget.copy(pose.target);
    this.camera.lookAt(this.curTarget);
    this._keyLight(h, this.curLight);
  }

  _updateCamera(dt) {
    const h = this.hero;
    if (!h) {
      this.camera.lookAt(this.curTarget);
      return;
    }
    const rig = this.rig;
    // inertia from drags
    rig.az += rig.azV * dt;
    rig.el = clamp(rig.el + rig.elV * dt, -0.15, 1.2);
    const damp = Math.exp(-dt * 4);
    rig.azV *= damp;
    rig.elV *= damp;
    // drift back to the default composition after a while
    if (performance.now() - this.lastInteraction > 5000 && !this.transition) {
      const k = 1 - Math.exp(-dt * 0.6);
      rig.az += (this.heroAz - rig.az) * k;
      rig.el += (DEFAULT_RIG.el - rig.el) * k;
      rig.zoom += (DEFAULT_RIG.zoom - rig.zoom) * k;
    }
    const pr = { az: rig.az + rig.px * 0.05, el: rig.el + rig.py * 0.03, zoom: rig.zoom };
    const pose = this._heroFrame(h, pr, this._tmp.pose);
    const light = this._keyLight(h, this._tmp.v);

    if (this.transition) {
      const tr = this.transition;
      tr.t += dt / tr.dur;
      const s = Math.min(1, tr.t);
      const e = easeInOutCubic(s);
      // sweep around the galactic centre in cylindrical coordinates
      const a0 = Math.atan2(tr.from.pos.z, tr.from.pos.x);
      const a1 = Math.atan2(pose.pos.z, pose.pos.x);
      let da = a1 - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const r0 = Math.hypot(tr.from.pos.x, tr.from.pos.z);
      const r1 = Math.hypot(pose.pos.x, pose.pos.z);
      const chord = tr.from.pos.distanceTo(pose.pos);
      const hop = Math.sin(Math.PI * s);
      const a = a0 + da * e;
      const r = THREE.MathUtils.lerp(r0, r1, e) + hop * chord * 0.12;
      const y = THREE.MathUtils.lerp(tr.from.pos.y, pose.pos.y, e) + hop * chord * 0.22;
      this.camera.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.curTarget.lerpVectors(tr.from.target, pose.target, easeInOutSine(Math.min(1, s * 1.15)));
      this.curLight.copy(tr.from.light).lerp(light, e).normalize();
      this.camera.fov = BASE_FOV + hop * 9;
      if (s >= 1) {
        this.transition = null;
        this.dispatchEvent(new CustomEvent('transition-end', { detail: h.course }));
      }
    } else {
      this.camera.position.copy(pose.pos);
      this.curTarget.copy(pose.target);
      this.curLight.copy(light);
      this.camera.fov += (BASE_FOV - this.camera.fov) * Math.min(1, dt * 4);
    }
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.curTarget);
  }

  // ======================================================================= effects
  /** Golden burst when a course planet gets saved. */
  celebrate(id) {
    const p = this.planets.find((x) => x.course.id === id);
    if (p) this._spawnFlash(p, new THREE.Color(1.0, 0.74, 0.36));
  }

  _spawnFlash(p, color = new THREE.Color(0.6, 0.85, 1.0)) {
    const tex = this.backdrop?.coreTex;
    if (!tex) return;
    const m = new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      color: color.clone().multiplyScalar(3),
    });
    const sp = new THREE.Sprite(m);
    sp.renderOrder = 5;
    this.system.add(sp);
    this.flashes.push({ sp, p, t: 0 });
  }

  _updateFlashes(dt) {
    this.flashes = this.flashes.filter((f) => {
      f.t += dt / 1.6;
      f.sp.position.copy(f.p.position);
      const k = f.t;
      f.sp.scale.setScalar(f.p.radius * (1 + k * 9));
      f.sp.material.opacity = Math.max(0, 1 - k) ** 2;
      if (f.t >= 1) {
        f.sp.material.dispose();
        f.sp.removeFromParent();
        return false;
      }
      return true;
    });
  }

  _updateWarp(dt) {
    const w = this.warp;
    if (!w) return;
    w.t += dt;
    if (w.phase === 'out') {
      const k = Math.min(1, w.t / 0.7);
      this.worldFade = 1 - k;
      this.camera.fov = BASE_FOV + k * k * 50;
      this.camera.updateProjectionMatrix();
      if (k >= 1) {
        this._buildGalaxy(w.galaxy, w.focusId);
        w.phase = 'in';
        w.t = 0;
      }
    } else {
      const k = Math.min(1, w.t / 1.1);
      this.worldFade = k;
      this.camera.fov = BASE_FOV + (1 - easeInOutCubic(k)) * 50;
      this.camera.updateProjectionMatrix();
      if (k >= 1) this.warp = null;
    }
  }

  // ======================================================================= per-frame
  _updatePlanets(dt) {
    const cam = this.camera;
    const hero = this.hero;
    const heroDist = hero ? cam.position.distanceTo(hero.position) : 1;
    const heroAng = hero ? Math.asin(clamp(hero.frameRadius / heroDist, 0, 1)) : 0;
    const v = this._tmp.v;
    const toHero = new THREE.Vector3();
    if (hero) toHero.subVectors(hero.position, cam.position).normalize();
    for (const p of this.planets) {
      if (p.loaded) p.update(dt, this.time, this.env);
      else p.placeAt(this.time);
      // fade planets that sit between the camera and the hero, or crowd the lens
      let vis = 1;
      if (p !== hero && hero) {
        v.subVectors(p.position, cam.position);
        const dist = v.length();
        const ang = Math.acos(clamp(v.dot(toHero) / dist, -1, 1));
        const pAng = Math.asin(clamp(p.frameRadius / dist, 0, 1));
        if (dist < heroDist && ang < heroAng + pAng) vis = 0.12;
        if (dist < p.radius * 4) vis = Math.min(vis, clamp((dist - p.radius * 1.5) / (p.radius * 2.5), 0, 1));
      }
      p.visibility += (vis * this.worldFade - p.visibility) * Math.min(1, dt * 5);
      const orbit = this.orbits.get(p.course.id);
      if (orbit) {
        const u = orbit.material.uniforms;
        u.uPhase.value = ((p.orbitAngle(this.time) / (Math.PI * 2)) % 1 + 1) % 1;
        const isHero = p === hero;
        u.uBase.value = isHero ? 0.06 : 0.03;
        u.uTrail.value = isHero ? 0.45 : 0.22;
        u.uFade.value = Math.min(1, p.fade * 2) * this.worldFade;
      }
    }
  }

  _updateLabels() {
    if (!this.labelLayer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const cam = this.camera;
    const v = this._tmp.v;
    const hide = !!this.transition || !!this.warp;
    const hero = this.hero;
    let hx = 0;
    let hy = 0;
    let hr = 0;
    let hd = Infinity;
    if (hero) {
      v.copy(hero.position).project(cam);
      hx = (v.x * 0.5 + 0.5) * w;
      hy = (-v.y * 0.5 + 0.5) * h;
      hd = cam.position.distanceTo(hero.position);
      hr = (hero.frameRadius / (hd * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))) * (h / 2);
    }
    const placed = [];
    const order = [...this.planets].sort((a, b) => cam.position.distanceToSquared(a.position)
      - cam.position.distanceToSquared(b.position));
    for (const p of order) {
      const el = p.label;
      if (!el) continue;
      if (p === this.hero || hide) {
        el.classList.remove('show');
        continue;
      }
      v.copy(p.position).project(cam);
      const dist = cam.position.distanceTo(p.position);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      const px = (v.x * 0.5 + 0.5) * w;
      const py = (-v.y * 0.5 + 0.5) * h;
      const behindHero = dist > hd && Math.hypot(px - hx, py - hy) < hr * 1.08;
      let vis = onScreen && !behindHero && p.visibility > 0.5 && p.fade > 0.5 && dist < 420;
      const rpx = (p.radius / (dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))) * (h / 2);
      const x = px;
      const y = py + rpx + 8;
      if (vis) {
        // skip labels that would collide with a nearer planet's label
        const lw = (p._labelW ||= el.offsetWidth || 120);
        const box = [x - lw / 2 - 4, y - 2, x + lw / 2 + 4, y + 24];
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) vis = false;
        else placed.push(box);
      }
      el.classList.toggle('show', vis);
      el.classList.toggle('hover', this.hovered === p);
      if (!vis) continue;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
      el.style.opacity = String(clamp(1.3 - dist / 320, 0.35, 1));
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const raw = (now - this._last) / 1000;
    this._last = now;
    this._adaptQuality(raw);
    this.step(Math.min(0.1, raw));
  }

  /** Advance the simulation by dt seconds and render one frame. */
  step(dt) {
    this.time += dt;
    this._updateWarp(dt);
    for (const p of this.planets) p.placeAt(this.time);
    this._updateCamera(dt);
    this.env.sunDir.copy(this.curLight);
    this._updatePlanets(dt);
    this._updateFlashes(dt);
    if (this.backdrop) this.backdrop.update(this.time, this.worldFade);
    this.starfield.followCamera(this.camera);
    this.starfield.uniforms.uFade.value = 0.35 + 0.65 * this.worldFade;
    this._updateLabels();
    this.composer.render();
  }

  _adaptQuality(dt) {
    // drop the pixel ratio a notch if we are consistently slow (ignore hidden/throttled tabs)
    if (dt > 0.2 || document.visibilityState !== 'visible') return;
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (avg > 1 / 40 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this._resize();
    }
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * this.pixelRatio * 0.5, h * this.pixelRatio * 0.5);
    this.backdrop?.setPixelRatio(this.pixelRatio);
    this.starfield.uniforms.uPixelRatio.value = this.pixelRatio;
  }

  // ======================================================================= input
  _pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const cam = this.camera;
    const v = this._tmp.v;
    let best = null;
    let bestDist = Infinity;
    for (const p of this.planets) {
      if (p.visibility < 0.3) continue;
      v.copy(p.position).project(cam);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      const dist = cam.position.distanceTo(p.position);
      const rpx = (p.frameRadius / (dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))) * (h / 2);
      const d = Math.hypot(mx - sx, my - sy);
      if (d < Math.max(rpx * 1.05, 16) && dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    return best;
  }

  _bindInput() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), lx: e.clientX, ly: e.clientY, drag: false };
      el.setPointerCapture(e.pointerId);
      this.lastInteraction = performance.now();
    });
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      this.rig.px = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      this.rig.py = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      if (down) {
        const dx = e.clientX - down.lx;
        const dy = e.clientY - down.ly;
        down.lx = e.clientX;
        down.ly = e.clientY;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.drag = true;
        if (down.drag && !this.transition) {
          this.rig.azV = -dx * 0.35;
          this.rig.elV = dy * 0.25;
          this.rig.az -= dx * 0.004;
          this.rig.el = clamp(this.rig.el + dy * 0.003, -0.15, 1.2);
          this.lastInteraction = performance.now();
        }
        return;
      }
      const p = e.pointerType === 'mouse' ? this._pick(e.clientX, e.clientY) : null;
      if (p !== this.hovered) {
        if (this.hovered) this.hovered.hoverTarget = 0;
        this.hovered = p;
        if (p && p !== this.hero) p.hoverTarget = 1;
        el.style.cursor = p ? 'pointer' : 'grab';
        this.dispatchEvent(new CustomEvent('hover', { detail: p ? p.course : null }));
      }
    });
    const up = (e) => {
      if (!down) return;
      const dt = performance.now() - down.t;
      const dx = e.clientX - down.x;
      if (!down.drag) {
        const p = this._pick(e.clientX, e.clientY);
        if (p) this.focusCourse(p.course.id);
      } else if (e.pointerType !== 'mouse' && dt < 350 && Math.abs(dx) > 60) {
        // quick swipe on touch devices = next / previous planet
        if (dx < 0) this.next();
        else this.prev();
      }
      down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('pointerleave', () => {
      this.rig.px = 0;
      this.rig.py = 0;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.rig.zoom = clamp(this.rig.zoom * Math.exp(e.deltaY * 0.0012), 0.62, 2.6);
      this.lastInteraction = performance.now();
    }, { passive: false });
    el.addEventListener('dblclick', () => {
      Object.assign(this.rig, DEFAULT_RIG, { az: this.heroAz, azV: 0, elV: 0 });
    });
  }
}
