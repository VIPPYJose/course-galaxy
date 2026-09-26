import * as THREE from 'three';
import { galaxyVert, galaxyFrag, dustFrag } from './shaders.js';

// Visual styles for galaxies. Colours are linear RGB; values > 1 feed the bloom.
export const GALAXY_STYLES = {
  andromeda: {
    label: 'Andromeda (blue-violet)',
    core: [1.0, 0.76, 0.5], arm: [0.5, 0.64, 1.0], young: [0.78, 0.86, 1.0],
    hii: [1.0, 0.36, 0.62], old: [1.0, 0.84, 0.66], dust: [0.06, 0.03, 0.02],
    arms: 2, pitch: 0.23, glow: [1.0, 0.72, 0.46],
  },
  orion: {
    label: 'Orion (teal-gold)',
    core: [1.0, 0.86, 0.6], arm: [0.36, 0.86, 0.95], young: [0.7, 1.0, 0.96],
    hii: [1.0, 0.56, 0.26], old: [1.0, 0.9, 0.7], dust: [0.04, 0.03, 0.02],
    arms: 3, pitch: 0.28, glow: [1.0, 0.84, 0.56],
  },
  ember: {
    label: 'Ember (crimson)',
    core: [1.0, 0.62, 0.4], arm: [1.0, 0.5, 0.42], young: [1.0, 0.78, 0.7],
    hii: [1.0, 0.3, 0.36], old: [1.0, 0.78, 0.6], dust: [0.05, 0.02, 0.015],
    arms: 4, pitch: 0.2, glow: [1.0, 0.56, 0.36],
  },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd) {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

function radialTexture(stops) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [p, a] of stops) grd.addColorStop(p, `rgba(255,255,255,${a})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Spiral galaxy made of particles. The course planets orbit inside the clear region
 * around the bright core; the arms spread out behind them.
 */
export class GalaxyBackdrop {
  constructor({ style = 'andromeda', seed = 1, pixelRatio = 1, count = 110000 } = {}) {
    this.style = GALAXY_STYLES[style] || GALAXY_STYLES.andromeda;
    this.group = new THREE.Group();
    this.uniforms = {
      uTime: { value: 0 },
      uSpin: { value: 0.012 },
      uScale: { value: 105 },
      uPixelRatio: { value: pixelRatio },
      uFade: { value: 1 },
    };
    const rnd = mulberry32(seed * 9301 + 49297);
    this._buildStars(rnd, count);
    this._buildDust(rnd, Math.round(count * 0.14));
    this._buildCore();
    // The galaxy disc is inclined to the course orbits so that, seen from any planet,
    // the spiral arms sweep across the sky instead of collapsing into an edge-on band.
    this.disc = new THREE.Group();
    this.disc.add(this.stars, this.dust);
    this.group.add(this.disc);
    this.disc.rotation.set(0.62 + (rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, 0.18 + (rnd() - 0.5) * 0.2, 'YXZ');
  }

  _buildStars(rnd, n) {
    const S = this.style;
    const aRadius = new Float32Array(n);
    const aAngle = new Float32Array(n);
    const aHeight = new Float32Array(n);
    const aSize = new Float32Array(n);
    const aColor = new Float32Array(n * 3);
    const arms = S.arms;
    const k = 1 / Math.tan(S.pitch);
    const rMax = 330;
    let hiiCentre = null;
    let hiiLeft = 0;
    for (let i = 0; i < n; i++) {
      const p = rnd();
      let r; let th; let y; let size; let col; let b;
      if (p < 0.24) {
        // bulge
        r = Math.abs(gauss(rnd)) * 3.8 + Math.abs(gauss(rnd)) * 1.6;
        th = rnd() * Math.PI * 2;
        y = gauss(rnd) * (1.0 + r * 0.3);
        size = 0.35 + rnd() * 0.7;
        b = 0.35 + rnd() * 1.3 * Math.exp(-r / 4);
        col = S.core;
      } else if (p < 0.8) {
        // spiral arms (logarithmic), thinning inside the planetary zone
        const arm = Math.floor(rnd() * arms);
        do {
          r = 55 + -Math.log(1 - rnd() * 0.995) * 85;
        } while (r > rMax || (r < 110 && rnd() > (r - 40) / 70));
        const spread = gauss(rnd) * (0.16 + 12 / r);
        th = arm * (Math.PI * 2 / arms) + Math.log(r / 40) * k + spread;
        y = gauss(rnd) * (0.8 + r * 0.008);
        const q = rnd();
        if (hiiLeft > 0 || q < 0.004) {
          // star forming knots (pink / orange), clustered
          if (hiiLeft <= 0) {
            hiiCentre = [r, th];
            hiiLeft = 20 + Math.floor(rnd() * 40);
          }
          hiiLeft--;
          r = hiiCentre[0] + gauss(rnd) * 2.2;
          th = hiiCentre[1] + gauss(rnd) * (2.2 / hiiCentre[0]);
          col = S.hii;
          size = 1.2 + rnd() * 2.5;
          b = 0.5 + rnd() * 1.1;
        } else {
          const young = rnd() < 0.45;
          col = young ? S.young : S.arm;
          size = 0.7 + Math.pow(rnd(), 3) * 3.2;
          b = (0.18 + Math.pow(rnd(), 2.5) * 1.6) * (young ? 1.1 : 0.8);
        }
      } else if (p < 0.97) {
        // diffuse old disc
        do {
          r = 60 + -Math.log(1 - rnd() * 0.99) * 95;
        } while (r > rMax || (r < 125 && rnd() > (r - 50) / 75));
        th = rnd() * Math.PI * 2;
        y = gauss(rnd) * (1.2 + r * 0.012);
        col = S.old;
        size = 0.6 + rnd() * 1.4;
        b = 0.08 + Math.pow(rnd(), 3) * 0.6;
      } else {
        // halo
        r = 60 + rnd() * 380;
        th = rnd() * Math.PI * 2;
        y = gauss(rnd) * 90;
        col = S.old;
        size = 0.6 + rnd();
        b = 0.1 + rnd() * 0.3;
      }
      aRadius[i] = r;
      aAngle[i] = th;
      aHeight[i] = y;
      aSize[i] = size;
      const jitter = 0.85 + rnd() * 0.3;
      aColor[i * 3] = col[0] * b * jitter;
      aColor[i * 3 + 1] = col[1] * b;
      aColor[i * 3 + 2] = col[2] * b * (2 - jitter);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
    g.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
    g.setAttribute('aHeight', new THREE.BufferAttribute(aHeight, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 600);
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: galaxyVert, fragmentShader: galaxyFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.stars.renderOrder = -2;
    this.group.add(this.stars);
  }

  _buildDust(rnd, n) {
    // dark lanes along the inner edge of each arm
    const S = this.style;
    const k = 1 / Math.tan(S.pitch);
    const aRadius = new Float32Array(n);
    const aAngle = new Float32Array(n);
    const aHeight = new Float32Array(n);
    const aSize = new Float32Array(n);
    const aColor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const arm = Math.floor(rnd() * S.arms);
      let r;
      do {
        r = 70 + -Math.log(1 - rnd() * 0.99) * 70;
      } while (r > 300);
      aRadius[i] = r;
      aAngle[i] = arm * (Math.PI * 2 / S.arms) + Math.log(r / 40) * k - 0.2 + gauss(rnd) * (0.06 + 4 / r);
      aHeight[i] = gauss(rnd) * 0.6;
      aSize[i] = 5 + rnd() * 9;
      aColor[i * 3] = S.dust[0];
      aColor[i * 3 + 1] = S.dust[1];
      aColor[i * 3 + 2] = S.dust[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
    g.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
    g.setAttribute('aHeight', new THREE.BufferAttribute(aHeight, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 600);
    this.dustUniforms = { ...this.uniforms, uOpacity: { value: 0.22 } };
    this.dust = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.dustUniforms, vertexShader: galaxyVert, fragmentShader: dustFrag,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    }));
    this.dust.renderOrder = -1;
    this.group.add(this.dust);
  }

  _buildCore() {
    const S = this.style;
    const tex = radialTexture([[0, 1], [0.08, 0.75], [0.25, 0.22], [0.55, 0.05], [1, 0]]);
    this.coreTex = tex;
    const mk = (scale, intensity) => {
      const m = new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        color: new THREE.Color(...S.glow).multiplyScalar(intensity),
      });
      const sp = new THREE.Sprite(m);
      sp.scale.setScalar(scale);
      sp.renderOrder = -3;
      return sp;
    };
    this.coreSprites = [mk(3.2, 4.0), mk(14, 0.7), mk(48, 0.1)];
    for (const s of this.coreSprites) this.group.add(s);
    this.coreBase = this.coreSprites.map((s) => s.material.color.clone());
  }

  update(t, fade = 1) {
    this.uniforms.uTime.value = t;
    this.uniforms.uFade.value = fade;
    this.coreSprites.forEach((s, i) => s.material.color.copy(this.coreBase[i]).multiplyScalar(fade));
  }

  setPixelRatio(pr) {
    this.uniforms.uPixelRatio.value = pr;
  }

  dispose() {
    for (const o of [this.stars, this.dust]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    for (const s of this.coreSprites) s.material.dispose();
    this.coreTex.dispose();
    this.group.removeFromParent();
  }
}

/** Distant stars all around (not part of the galaxy disc). */
export class Starfield {
  constructor({ count = 6000, seed = 3, pixelRatio = 1 } = {}) {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const temps = [[0.65, 0.75, 1.0], [0.85, 0.9, 1.0], [1.0, 1.0, 1.0], [1.0, 0.92, 0.78], [1.0, 0.78, 0.55]];
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 2600;
      pos[i * 3] = Math.cos(th) * s * R;
      pos[i * 3 + 1] = u * R;
      pos[i * 3 + 2] = Math.sin(th) * s * R;
      const c = temps[Math.floor(rnd() * temps.length)];
      const b = 0.08 + Math.pow(rnd(), 6) * 2.2;
      col[i * 3] = c[0] * b;
      col[i * 3 + 1] = c[1] * b;
      col[i * 3 + 2] = c[2] * b;
      size[i] = 1 + Math.pow(rnd(), 4) * 2.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.uniforms = { uPixelRatio: { value: pixelRatio }, uFade: { value: 1 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uPixelRatio;
        uniform float uFade;
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        void main() {
          vColor = aColor * uFade;
          gl_PointSize = aSize * uPixelRatio * 1.3;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: galaxyFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.renderOrder = -4;
    this.points.frustumCulled = false;
  }

  followCamera(camera) {
    this.points.position.copy(camera.position);
  }
}
