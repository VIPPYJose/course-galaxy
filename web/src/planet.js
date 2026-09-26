import * as THREE from 'three';
import {
  surfaceVert, surfaceFrag, cloudFrag, atmoVert, atmoFrag, ringVert, ringFrag, moonVert,
} from './shaders.js';
import { AsteroidBelt } from './asteroids.js';
import { resolvePlanet, BELT, beltAllowed, hasBelt } from './params.js';
import { getType } from './assets.js';
import { ringEntry } from './rings.js';

export { BELT, beltAllowed, hasBelt };

// Base radius (world units) per planet type; the planet's size slider scales it.
export const TYPE_RADIUS = {
  terra: 1.0, dune: 0.82, jovian: 2.0, saturn: 1.55, glacier: 0.72,
  inferno: 0.9, neptune: 1.45, luna: 0.58,
  thalassa: 1.1, sylva: 1.15, veil: 0.95, sulfura: 0.6, tholos: 0.55, halite: 0.85,
  janus: 0.9, prisma: 0.75, mesa: 0.88, pyra: 2.1, viridis: 1.75, amethyst: 1.85, cyane: 1.35,
};

// Strength of the soft fill on the night side: enough to see the features, well short of daylight.
export const NIGHT_FILL = 0.12;

// Deterministic 0..1 random from a string, so a planet keeps its tilt, spin and orbit phase.
export function rand(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;
const FLAT_N = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
FLAT_N.needsUpdate = true;

/** Shared texture cache so several planets of one type reuse the same GPU textures. */
export class TextureBank {
  constructor(renderer, baseUrl = '') {
    this.loader = new THREE.TextureLoader();
    this.cache = new Map();
    this.baseUrl = baseUrl;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  get(url, { srgb = false } = {}) {
    if (!url) return null;
    const key = url + (srgb ? '|srgb' : '');
    if (!this.cache.has(key)) {
      const entry = {};
      entry.promise = new Promise((resolve) => {
        entry.texture = this.loader.load(this.baseUrl + url, (t) => resolve(t), undefined, () => resolve(null));
      });
      const t = entry.texture;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = this.aniso;
      this.cache.set(key, entry);
    }
    return this.cache.get(key);
  }
}

const MOON_GEO = { round: null, rocky: [] };
/** Shared moon meshes: a smooth sphere, or one of a few lumpy "potatoes" for small captured moons. */
function moonGeometry(irregular, seed) {
  if (!irregular) return (MOON_GEO.round ??= new THREE.SphereGeometry(1, 48, 24));
  const k = seed % 3;
  if (!MOON_GEO.rocky[k]) {
    const g = new THREE.SphereGeometry(1, 32, 16);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    const a = 1.3 + k * 0.7;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const lobe = 0.22 * Math.sin(v.x * a + k) * Math.sin(v.y * 1.7 + 0.4) + 0.12 * Math.sin(v.z * 2.9 + k * 2) + 0.06 * Math.sin(v.x * 7.1 + v.y * 5.3);
      v.multiplyScalar(1 + lobe);
      v.x *= 1.25; // elongated, like Phobos
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    MOON_GEO.rocky[k] = g;
  }
  return MOON_GEO.rocky[k];
}
const sharedGeometry = (g) => g === MOON_GEO.round || MOON_GEO.rocky.includes(g);

export class Planet {
  /**
   * @param {object} data  planet record ({id, name, course, type, size, hue, ...overrides})
   * @param {object} def   planet type definition from assets/planets.json
   * @param {TextureBank} bank
   */
  constructor(data, def, bank) {
    this.data = data;
    this.def = def;
    this.bank = bank;
    const cfg = (this.cfg = resolvePlanet(data, def));
    this.radius = (TYPE_RADIUS[def.id] ?? 1) * (data.size ?? 1);
    this.fade = 0;          // 0..1 appear animation (only runs once the textures are in)
    this.instant = false;   // skip the appear animation (worlds rebuilt while editing)
    this.visibility = 1;    // occlusion fade
    this.hover = 0;
    this.hoverTarget = 0;
    this.spin = rand(data.id, 5) * Math.PI * 2;
    this.baseSpin = 0.02 + rand(data.id, 7) * 0.03;
    this.cloudDrift = 0;
    this.moonSpeed = 1;
    this.isHero = false;
    this.loaded = false;

    this.group = new THREE.Group();        // orbital position
    this.tilt = new THREE.Group();         // axial tilt
    this.group.add(this.tilt);
    // tidally locked worlds keep an upright axis so their day side can face the star
    this.tidal = !!def.tidal;
    this.tilt.rotation.set(0, rand(data.id, 4) * Math.PI * 2, this.tiltAngle(), 'YXZ');

    const m = def.maps;
    const tex = (key, srgb) => (m[key] ? bank.get(m[key], { srgb }) : null);
    const ringTex = cfg.rings ? (cfg.rings.map ? bank.get(cfg.rings.map, { srgb: true }) : ringEntry(cfg.rings.style)) : null;
    this.maps = {
      color: tex('color', true), normal: tex('normal', false), spec: tex('spec', false),
      emissive: tex('emissive', true), clouds: cfg.clouds ? bank.get(cfg.clouds.map) : null, rings: ringTex,
    };

    const tint = new THREE.Vector3(1, 1, 1);
    this.hue = { value: cfg.hue };
    const atmoColor = new THREE.Vector3(...(cfg.atmo?.color || [0.5, 0.7, 1]));
    this.sharedUniforms = {
      // Set every frame from the star: the direction from this planet to the star, and its light.
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color(1, 0.97, 0.92).multiplyScalar(2.1) },
      // night-side fill (moonlight blue); see the surface shader
      uAmbient: { value: new THREE.Color(0.5, 0.58, 0.78).multiplyScalar(NIGHT_FILL) },
      uFade: { value: 0 },
    };
    const S = this.sharedUniforms;

    // ---------------------------------------------------------------- surface
    this.surfaceUniforms = {
      ...S,
      uColorMap: { value: this.maps.color?.texture || WHITE },
      uNormalMap: { value: this.maps.normal?.texture || FLAT_N },
      uSpecMap: { value: this.maps.spec?.texture || BLACK },
      uEmissiveMap: { value: this.maps.emissive?.texture || BLACK },
      uCloudMap: { value: this.maps.clouds?.texture || BLACK },
      uRingMap: { value: this.maps.rings?.texture || BLACK },
      uHasNormal: { value: m.normal ? 1 : 0 },
      uHasSpec: { value: m.spec ? 1 : 0 },
      uHasEmissive: { value: m.emissive ? 1 : 0 },
      uHasClouds: { value: cfg.clouds ? 1 : 0 },
      uHasRings: { value: cfg.rings ? 1 : 0 },
      uTint: { value: tint },
      uHue: this.hue,
      uSat: { value: 1 },
      uBright: { value: 1 },
      uAlpha: { value: 1 },
      uSpecStrength: { value: def.spec ?? 0 },
      uEmissiveStrength: { value: def.emissive_strength ?? 0 },
      uEmissiveAlways: { value: def.emissive_always ? 1 : 0 },
      uLunar: { value: def.lunar ?? 0 },
      uNormalStrength: { value: 1.0 },
      uCloudShift: { value: 0 },
      uCloudShadow: { value: 0.55 },
      uRadius: { value: this.radius },
      uRingInner: { value: cfg.rings?.inner ?? 0 },
      uRingOuter: { value: cfg.rings?.outer ?? 0 },
      uHover: { value: 0 },
      uAtmoColor: { value: atmoColor },
      uHasAtmo: { value: cfg.atmo && cfg.atmo.thickness >= 0.04 ? 1 : 0 },
    };
    this.surface = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 64),
      new THREE.ShaderMaterial({
        uniforms: this.surfaceUniforms, vertexShader: surfaceVert, fragmentShader: surfaceFrag,
      }),
    );
    this.surface.scale.setScalar(this.radius);
    this.surface.userData.planet = this;
    this.tilt.add(this.surface);

    // ---------------------------------------------------------------- clouds
    if (cfg.clouds) {
      this.cloudUniforms = {
        ...S,
        uCloudMap: { value: this.maps.clouds.texture },
        uOpacity: { value: cfg.clouds.amount * 1.1 },
        uCloudColor: { value: new THREE.Color(...cfg.clouds.color) },
      };
      this.clouds = new THREE.Mesh(
        new THREE.SphereGeometry(1, 96, 48),
        new THREE.ShaderMaterial({
          uniforms: this.cloudUniforms, vertexShader: surfaceVert, fragmentShader: cloudFrag,
          transparent: true, depthWrite: false, premultipliedAlpha: true,
        }),
      );
      this.clouds.scale.setScalar(this.radius * 1.008);
      this.clouds.renderOrder = 1;
      this.tilt.add(this.clouds);
    }

    // ---------------------------------------------------------------- atmosphere
    if (cfg.atmo) {
      const th = cfg.atmo.thickness;
      const Ra = this.radius * (1 + th);
      const Hr = this.radius * th * 0.24;
      const Hm = this.radius * th * 0.12;
      const c = cfg.atmo.color;
      // scattering coefficients tuned so the vertical optical depth is ~0.3 at the
      // dominant channel, independent of planet size
      const betaR = new THREE.Vector3(c[0], c[1], c[2]).multiplyScalar(0.2 / Hr);
      this.atmoUniforms = {
        ...S,
        uCenter: { value: new THREE.Vector3() },
        uRp: { value: this.radius },
        uRa: { value: Ra },
        uBetaR: { value: betaR },
        uBetaM: { value: 0.02 / Hm },
        uHR: { value: Hr },
        uHM: { value: Hm },
        uG: { value: 0.72 },
        uIntensity: { value: 2.2 * cfg.atmo.intensity },
      };
      this.atmoMaterial = new THREE.ShaderMaterial({
        uniforms: this.atmoUniforms, vertexShader: atmoVert, fragmentShader: atmoFrag,
        transparent: true, depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
        defines: { STEPS: 8, LIGHT_STEPS: 3 },
      });
      this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.atmoMaterial);
      this.atmo.scale.setScalar(Ra * 1.002);
      this.atmo.renderOrder = 2;
      this.group.add(this.atmo);
    }

    // ---------------------------------------------------------------- rings
    if (cfg.rings && this.maps.rings) {
      const inner = this.radius * cfg.rings.inner;
      const outer = this.radius * cfg.rings.outer;
      this.ringUniforms = {
        ...S,
        uRingMap: { value: this.maps.rings.texture },
        uInner: { value: inner },
        uOuter: { value: outer },
        uCenter: { value: new THREE.Vector3() },
        uRp: { value: this.radius },
        uTint: { value: tint },
        uHue: { value: cfg.rings.hue },
        uOpacity: { value: cfg.rings.opacity },
      };
      this.rings = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 256, 1),
        new THREE.ShaderMaterial({
          uniforms: this.ringUniforms, vertexShader: ringVert, fragmentShader: ringFrag,
          transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
        }),
      );
      this.rings.rotation.x = -Math.PI / 2;
      this.rings.renderOrder = 3;
      this.tilt.add(this.rings);
    }

    // ---------------------------------------------------------------- rock belt
    this.belt = null;
    if (cfg.belt) {
      const R = this.radius;
      this.belt = new AsteroidBelt({
        radius: R * (BELT.inner + BELT.outer) / 2,
        width: R * (BELT.outer - BELT.inner) / 2,
        thickness: R * 0.018,
        count: 1800,
        size: [R * 0.005, R * 0.036],
        kepler: 0.09 * Math.pow(R * BELT.inner, 1.5),
        seed: Math.floor(rand(data.id, 11) * 1e6),
        sunColor: S.uSunColor.value,
        ambient: S.uAmbient.value,
      });
      this.belt.uniforms.uShadowRadius.value = R;
      this.tilt.add(this.belt.mesh);
    }

    // ---------------------------------------------------------------- moons
    // Moons orbit in the planet's equatorial plane (inside `tilt`), outside its rings or belt,
    // keep one face turned to it, and share its sunlight.
    this.moons = cfg.moons.map((mc) => this.buildMoon(mc));

    // framing radius: what has to fit on screen when this planet is the hero
    const reach = cfg.rings ? cfg.rings.outer : this.belt ? BELT.outer : 0;
    this.frameRadius = this.radius * (reach ? reach * 0.78 : 1.12);
    // how far the world reaches from its centre (rings, belt and moons), for orbit spacing
    const moonReach = Math.max(0, ...cfg.moons.map((mc) => mc.orbit + mc.size));
    this.extent = this.radius * Math.max(reach || 1, moonReach * 0.8);
    this.hiResRequested = false;

    const entries = [...Object.values(this.maps), ...this.moons.map((mo) => mo.map)].filter(Boolean);
    this.ready = Promise.all(entries.map((e) => e.promise)).then(() => {
      this.loaded = true;
    });

    // Invisible proxy that makes small, distant planets easy to click (follows the grow scale).
    this.proxy = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(this.radius * 1.6, this.frameRadius), 12, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.proxy.userData.planetId = data.id;
    this.group.add(this.proxy);

    this.applyLook();
  }

  tiltAngle() {
    if (this.tidal) return 0;
    if (this.data.tilt !== undefined) return THREE.MathUtils.degToRad(this.data.tilt);
    // ringed worlds get a healthy tilt so their rings rarely sit edge-on
    const tiltDeg = (this.def.tilt ?? 10) + (rand(this.data.id, 3) - 0.5) * 10;
    return THREE.MathUtils.degToRad(this.cfg.rings ? Math.max(tiltDeg, 18) : tiltDeg);
  }

  buildMoon(mc) {
    const mdef = getType(mc.type);
    const map = this.bank.get(mdef.maps.color, { srgb: true });
    const normal = mdef.maps.normal ? this.bank.get(mdef.maps.normal) : null;
    const emissive = mdef.maps.emissive ? this.bank.get(mdef.maps.emissive, { srgb: true }) : null;
    const S = this.sharedUniforms;
    const uniforms = {
      uSunDir: S.uSunDir,
      uSunColor: S.uSunColor,
      uAmbient: S.uAmbient,
      uFade: { value: 0 },
      uAlpha: { value: 1 },
      uColorMap: { value: map.texture },
      uNormalMap: { value: normal?.texture || FLAT_N },
      uSpecMap: { value: BLACK },
      uEmissiveMap: { value: emissive?.texture || BLACK },
      uCloudMap: { value: BLACK },
      uRingMap: { value: BLACK },
      uHasNormal: { value: normal ? 1 : 0 },
      uHasSpec: { value: 0 },
      uHasEmissive: { value: emissive ? 1 : 0 },
      uHasClouds: { value: 0 },
      uHasRings: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uHue: { value: mc.hue ?? 0 },
      uSat: { value: 1 },
      uBright: { value: 1 },
      uSpecStrength: { value: 0 },
      uEmissiveStrength: { value: (mdef.emissive_strength ?? 0) * 0.6 },
      uEmissiveAlways: { value: mdef.emissive_always ? 1 : 0 },
      uLunar: { value: Math.max(0.5, mdef.lunar ?? 0) }, // airless, dusty
      uNormalStrength: { value: 1 },
      uCloudShift: { value: 0 },
      uCloudShadow: { value: 0 },
      uRadius: { value: 1 },
      uRingInner: { value: 0 },
      uRingOuter: { value: 0 },
      uHover: { value: 0 },
      uAtmoColor: { value: new THREE.Vector3(1, 1, 1) },
      uHasAtmo: { value: 0 },
    };
    const r = this.radius * mc.size;
    const mesh = new THREE.Mesh(
      moonGeometry(!!mc.irregular, mc.index + Math.floor(rand(this.data.id, 20) * 7)),
      new THREE.ShaderMaterial({ uniforms, vertexShader: moonVert, fragmentShader: surfaceFrag, transparent: true }),
    );
    mesh.scale.setScalar(r);
    const orbit = new THREE.Group(); // the moon's orbital plane, slightly inclined to the equator
    orbit.rotation.set((rand(this.data.id, 30 + mc.index) - 0.5) * 0.12, 0, (rand(this.data.id, 40 + mc.index) - 0.5) * 0.12);
    orbit.add(mesh);
    this.tilt.add(orbit);
    return {
      mesh, orbit, uniforms, radius: r, dist: this.radius * mc.orbit,
      map, // counted in `ready`
      angle: rand(this.data.id, 50 + mc.index) * Math.PI * 2,
      // Kepler-ish: inner moons go round faster; retrograde moons (like Triton) go the other way
      speed: (mc.retro ? -1 : 1) * 0.5 / Math.pow(mc.orbit, 1.5),
    };
  }

  /** Push the settings that don't need a rebuild (colour grading, glow, spin, tilt) to the GPU. */
  applyLook(data = this.data) {
    this.data = data;
    const cfg = (this.cfg = resolvePlanet(data, this.def));
    const U = this.surfaceUniforms;
    this.hue.value = cfg.hue;
    U.uSat.value = cfg.sat;
    U.uBright.value = cfg.bright;
    U.uNormalStrength.value = cfg.relief;
    U.uSpecStrength.value = (this.def.spec ?? 0) * cfg.ocean;
    U.uEmissiveStrength.value = (this.def.emissive_strength ?? 0) * cfg.glow;
    this.spinSpeed = this.baseSpin * cfg.spin;
    this.tilt.rotation.z = this.tiltAngle();
    if (this.cloudUniforms && cfg.clouds) {
      this.cloudUniforms.uOpacity.value = cfg.clouds.amount * 1.1;
      this.cloudUniforms.uCloudColor.value.setRGB(...cfg.clouds.color);
    }
    if (this.atmoUniforms && cfg.atmo) this.atmoUniforms.uIntensity.value = 2.2 * cfg.atmo.intensity;
    if (this.ringUniforms && cfg.rings) {
      this.ringUniforms.uHue.value = cfg.rings.hue;
      this.ringUniforms.uOpacity.value = cfg.rings.opacity;
    }
  }

  get position() {
    return this.group.position;
  }

  setHero(isHero) {
    if (this.isHero === isHero) return;
    this.isHero = isHero;
    if (this.atmoMaterial) {
      this.atmoMaterial.defines.STEPS = isHero ? 14 : 8;
      this.atmoMaterial.defines.LIGHT_STEPS = isHero ? 5 : 3;
      this.atmoMaterial.needsUpdate = true;
    }
    if (isHero && !this.hiResRequested && this.def.maps.colorHi) {
      this.hiResRequested = true;
      const e = this.bank.get(this.def.maps.colorHi, { srgb: true });
      e.promise.then((t) => { if (t) this.surfaceUniforms.uColorMap.value = t; });
    }
  }

  /** Per-frame shading update; the star system has already placed `group` on its orbit. */
  update(dt, env) {
    if (this.loaded) this.fade = this.instant ? 1 : Math.min(1, this.fade + dt * 0.9);
    this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 8);
    const f = easeOutCubic(this.fade) * this.visibility;
    this.sharedUniforms.uFade.value = f;
    this.surfaceUniforms.uHover.value = this.hover * 0.6;
    // Sunlight comes from wherever the star actually is, so each world shows its true phase.
    this.sharedUniforms.uSunDir.value.subVectors(env.starPos, this.group.position).normalize();
    this.sharedUniforms.uSunColor.value.copy(env.sunColor);
    if (env.ambient) this.sharedUniforms.uAmbient.value.copy(env.ambient);
    const grow = 0.55 + 0.45 * easeOutBack(this.fade);
    this.group.scale.setScalar(grow);

    // spin & clouds
    this.spin += dt * this.spinSpeed;
    if (this.tidal) {
      // Keep the sub-stellar point (texture u = 0, local -X) turned toward the star.
      const q = this.tilt.getWorldQuaternion(_q).invert();
      const s = _v.copy(this.sharedUniforms.uSunDir.value).applyQuaternion(q);
      this.spin = Math.atan2(s.z, -s.x);
    }
    this.surface.rotation.y = this.spin;
    if (this.clouds) {
      if (!this.tidal) this.cloudDrift += dt * 0.004 * (this.cfg.clouds?.speed ?? 1);
      this.clouds.rotation.y = this.spin + this.cloudDrift;
      this.surfaceUniforms.uCloudShift.value = -this.cloudDrift / (Math.PI * 2);
    }
    if (this.atmoUniforms) {
      this.atmoUniforms.uCenter.value.copy(this.group.position);
      this.atmoUniforms.uRp.value = this.radius * grow;
      this.atmoUniforms.uRa.value = this.radius * (1 + this.cfg.atmo.thickness) * grow;
    }
    if (this.ringUniforms) {
      this.ringUniforms.uCenter.value.copy(this.group.position);
      this.ringUniforms.uRp.value = this.radius * grow;
    }
    this.surfaceUniforms.uRadius.value = this.radius * grow;
    if (this.belt) {
      const u = this.belt.uniforms;
      this.belt.update(dt);
      u.uSunPos.value.copy(env.starPos);
      u.uShadowCenter.value.copy(this.group.position);
      u.uShadowRadius.value = this.radius * grow;
      u.uFade.value = f;
    }
  }

  /**
   * Moons: move them along their orbits, and fade any that swing too close to the camera
   * (a moon passing the lens should never fill the screen).
   */
  updateMoons(dt, camera, show = true) {
    const f = this.sharedUniforms.uFade.value;
    for (const mo of this.moons) {
      mo.angle += dt * mo.speed * this.moonSpeed;
      mo.mesh.position.set(Math.cos(mo.angle) * mo.dist, 0, Math.sin(mo.angle) * mo.dist);
      mo.mesh.rotation.y = -mo.angle; // tidally locked: the same face always toward the planet
      mo.mesh.getWorldPosition(_v);
      const r = mo.radius * this.group.scale.x;
      const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(_v), r * 2.5, r * 6);
      mo.mesh.visible = show && near > 0.01;
      mo.uniforms.uFade.value = f;
      mo.uniforms.uAlpha.value = near * Math.min(1, f * 1.5);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        if (!sharedGeometry(o.geometry)) o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.group.removeFromParent();
  }
}

export function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

export function easeOutBack(x) {
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
