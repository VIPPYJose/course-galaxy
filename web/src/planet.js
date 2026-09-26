import * as THREE from 'three';
import {
  surfaceVert, surfaceFrag, cloudFrag, atmoVert, atmoFrag, ringVert, ringFrag,
} from './shaders.js';

// Base radius (world units) per planet type; a course can scale it (size S/M/L).
export const TYPE_RADIUS = {
  terra: 1.0, dune: 0.82, jovian: 2.0, saturn: 1.55, glacier: 0.72,
  inferno: 0.9, neptune: 1.45, luna: 0.58,
};

const SIZE_SCALE = { s: 0.8, m: 1.0, l: 1.25 };

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

export class Planet {
  /**
   * @param {object} course  course record ({id, title, type, size, orbit, ...})
   * @param {object} def     planet type definition from assets/planets.json
   * @param {TextureBank} bank
   */
  constructor(course, def, bank) {
    this.course = course;
    this.def = def;
    this.bank = bank;
    this.radius = TYPE_RADIUS[def.id] * (SIZE_SCALE[course.size] || 1);
    this.fade = 0;          // 0..1 appear animation
    this.visibility = 1;    // occlusion fade
    this.hover = 0;
    this.hoverTarget = 0;
    this.spin = (course.orbit.spin0 ?? 0);
    this.cloudDrift = 0;
    this.isHero = false;

    this.group = new THREE.Group();        // orbital position
    this.tilt = new THREE.Group();         // axial tilt
    this.group.add(this.tilt);
    // ringed worlds get a healthy tilt so their rings rarely sit edge-on
    const tiltDeg = course.orbit.tilt ?? def.tilt ?? 10;
    const tilt = THREE.MathUtils.degToRad(def.rings ? Math.max(tiltDeg, 18) : tiltDeg);
    this.tilt.rotation.set(0, course.orbit.tiltYaw ?? 0, tilt, 'YXZ');

    const m = def.maps;
    const tex = (key, srgb) => (m[key] ? bank.get(m[key], { srgb }) : null);
    this.maps = {
      color: tex('color', true), normal: tex('normal', false), spec: tex('spec', false),
      emissive: tex('emissive', true), clouds: tex('clouds', false), rings: tex('rings', true),
    };
    this.ready = Promise.all(Object.values(this.maps).filter(Boolean).map((e) => e.promise));

    const tint = new THREE.Vector3(...(course.tint || [1, 1, 1]));
    const atmoColor = new THREE.Vector3(...(def.atmo?.color || [0.5, 0.7, 1]));
    this.sharedUniforms = {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color(1, 0.97, 0.92).multiplyScalar(2.1) },
      uCorePos: { value: new THREE.Vector3() },
      uRimColor: { value: new THREE.Color(1.0, 0.72, 0.45).multiplyScalar(0.22) },
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
      uHasClouds: { value: m.clouds ? 1 : 0 },
      uHasRings: { value: def.rings ? 1 : 0 },
      uTint: { value: tint },
      uSpecStrength: { value: def.spec ?? 0 },
      uEmissiveStrength: { value: def.emissive_strength ?? 0 },
      uEmissiveAlways: { value: def.emissive_always ? 1 : 0 },
      uLunar: { value: def.lunar ?? 0 },
      uNormalStrength: { value: 1.0 },
      uCloudShift: { value: 0 },
      uCloudShadow: { value: 0.55 },
      uRadius: { value: this.radius },
      uRingInner: { value: def.rings?.inner ?? 0 },
      uRingOuter: { value: def.rings?.outer ?? 0 },
      uHover: { value: 0 },
      uAtmoColor: { value: atmoColor },
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
    if (m.clouds) {
      this.cloudUniforms = {
        ...S,
        uCloudMap: { value: this.maps.clouds.texture },
        uOpacity: { value: (def.clouds ?? 1) * 1.1 },
        uCloudColor: { value: new THREE.Color(0.95, 0.96, 0.98) },
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
    if (def.atmo) {
      const th = def.atmo.thickness;
      const Ra = this.radius * (1 + th);
      const Hr = this.radius * th * 0.24;
      const Hm = this.radius * th * 0.12;
      const c = def.atmo.color;
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
        uIntensity: { value: 2.2 * (def.atmo.intensity ?? 1) },
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
    if (def.rings && m.rings) {
      const inner = this.radius * def.rings.inner;
      const outer = this.radius * def.rings.outer;
      this.ringUniforms = {
        ...S,
        uRingMap: { value: this.maps.rings.texture },
        uInner: { value: inner },
        uOuter: { value: outer },
        uCenter: { value: new THREE.Vector3() },
        uRp: { value: this.radius },
        uTint: { value: tint },
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

    // framing radius: what has to fit on screen when this planet is the hero
    this.frameRadius = this.radius * (def.rings ? def.rings.outer * 0.78 : 1.12);
    this.hiResRequested = false;
  }

  get position() {
    return this.group.position;
  }

  /** orbital angle at time t (seconds) */
  orbitAngle(t) {
    const o = this.course.orbit;
    return o.angle0 + o.speed * t;
  }

  placeAt(t, target = this.group.position) {
    const o = this.course.orbit;
    const a = this.orbitAngle(t);
    const inc = THREE.MathUtils.degToRad(o.incl || 0);
    const x = Math.cos(a) * o.radius;
    const z = Math.sin(a) * o.radius;
    // inclined orbit: rotate around the line of nodes (x axis)
    target.set(x, Math.sin(a) * o.radius * Math.sin(inc), z * Math.cos(inc));
    return target;
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

  update(dt, t, env) {
    this.placeAt(t);
    this.fade = Math.min(1, this.fade + dt * 0.9);
    this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 8);
    const f = easeOutCubic(this.fade) * this.visibility;
    this.sharedUniforms.uFade.value = f;
    this.surfaceUniforms.uHover.value = this.hover * 0.6;
    this.sharedUniforms.uSunDir.value.copy(env.sunDir);
    this.sharedUniforms.uCorePos.value.copy(env.corePos);
    const grow = 0.55 + 0.45 * easeOutBack(this.fade);
    this.group.scale.setScalar(grow);

    // spin & clouds
    const o = this.course.orbit;
    this.spin += dt * (o.spinSpeed ?? 0.03);
    this.surface.rotation.y = this.spin;
    if (this.clouds) {
      this.cloudDrift += dt * 0.004 * (this.def.cloud_speed ?? 1);
      this.clouds.rotation.y = this.spin + this.cloudDrift;
      this.surfaceUniforms.uCloudShift.value = -this.cloudDrift / (Math.PI * 2);
    }
    if (this.atmoUniforms) {
      this.atmoUniforms.uCenter.value.copy(this.group.position);
      this.atmoUniforms.uRp.value = this.radius * grow;
      this.atmoUniforms.uRa.value = this.radius * (1 + this.def.atmo.thickness) * grow;
    }
    if (this.ringUniforms) {
      this.ringUniforms.uCenter.value.copy(this.group.position);
      this.ringUniforms.uRp.value = this.radius * grow;
    }
    this.surfaceUniforms.uRadius.value = this.radius * grow;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
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
