// Asteroid belts made of individual rocks, like BlenderPlanet's rock rings.
//
// Every rock is an instance of one lumpy, low-poly "potato" (most asteroids are too small
// to pull themselves round). Orbits and tumbling run in the vertex shader, so thousands of
// rocks cost one draw call. Rocks are lit by the star with flat, faceted shading, use a
// dusty-regolith reflectance, mix charcoal C-type and brownish S-type colours, and go dark
// where their planet's shadow falls across the belt.
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

function gauss(rnd) {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

let rock = null;
/** One irregular rock (unit size): an icosphere with every corner pushed in or out. */
function rockGeometry() {
  if (rock) return rock;
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const rnd = mulberry32(911);
  const bumps = new Map(); // shared corners must move together or the rock cracks open
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!bumps.has(key)) {
      const lobe = 0.16 * Math.sin(v.x * 2.3 + 0.7) * Math.sin(v.y * 1.9 + 1.4) + 0.1 * Math.sin(v.z * 3.1);
      bumps.set(key, 0.82 + lobe + rnd() * 0.3);
    }
    v.multiplyScalar(bumps.get(key));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  rock = g;
  return rock;
}

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uBeltRadius;
uniform float uKepler;
attribute vec4 aOrbit;  // radius offset from the belt centre, start angle, height, (unused)
attribute vec4 aSpin;   // tumble axis xyz, tumble speed
attribute vec4 aShape;  // non-uniform scale xyz, start tumble angle
attribute vec3 aColor;
varying vec3 vWorldPos;
varying vec3 vColor;

mat3 axisAngle(vec3 a, float t) {
  float c = cos(t), s = sin(t), k = 1.0 - c;
  return mat3(
    c + a.x * a.x * k,       a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
    a.x * a.y * k - a.z * s, c + a.y * a.y * k,       a.z * a.y * k + a.x * s,
    a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}

void main() {
  vec3 p = axisAngle(aSpin.xyz, aShape.w + uTime * aSpin.w) * (position * aShape.xyz);
  float r = uBeltRadius + aOrbit.x;
  float ang = aOrbit.y + uTime * uKepler / pow(r, 1.5); // inner rocks lap outer ones
  vec4 wp = modelMatrix * vec4(p + vec3(cos(ang) * r, aOrbit.z, sin(ang) * r), 1.0);
  vWorldPos = wp.xyz;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunPos;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uShadowCenter;
uniform float uShadowRadius;
uniform float uFade;
varying vec3 vWorldPos;
varying vec3 vColor;
void main() {
  // flat, faceted normal from screen-space derivatives
  vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uSunPos - vWorldPos);
  float mu0 = max(dot(N, L), 0.0);
  float mu = max(dot(N, V), 0.0);
  // dusty regolith: half Lambert, half Lommel-Seeliger (no limb darkening, like the Moon)
  float diff = mix(mu0, mu0 / (mu0 + mu + 1e-3), 0.5);
  // the planet's shadow across the belt
  float lit = 1.0;
  if (uShadowRadius > 0.0) {
    vec3 toC = uShadowCenter - vWorldPos;
    float tc = dot(toC, L);
    if (tc > 0.0) lit = smoothstep(uShadowRadius * 0.96, uShadowRadius * 1.04, length(toC - L * tc));
  }
  vec3 col = vColor * (uSunColor * diff * lit + uAmbient);
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

/**
 * A belt of rocks around a centre (a planet's equator, or the star).
 *  radius       belt centre radius
 *  width        radial half-width (rocks spread roughly evenly over it, with a few thin gaps)
 *  thickness    vertical spread (1 sigma)
 *  count        number of rocks
 *  size         [min, max] rock size; sizes follow a steep power law, so big ones are rare
 *  kepler       angular speed constant: omega = kepler / r^1.5
 */
export class AsteroidBelt {
  constructor({ radius, width, thickness, count, size, kepler, seed = 1, sunColor, ambient }) {
    const rnd = mulberry32(seed * 7919 + 17);
    const base = rockGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.instanceCount = count;
    const orbit = new Float32Array(count * 4);
    const spin = new Float32Array(count * 4);
    const shape = new Float32Array(count * 4);
    const color = new Float32Array(count * 3);
    // carbonaceous (dark grey) and stony (brownish) rocks; brightened a touch from their
    // true 5-25% albedo so the belt still reads against the sky
    const cType = [0.16, 0.155, 0.15];
    const sType = [0.3, 0.25, 0.19];
    const gaps = [rnd() * 1.6 - 0.8, rnd() * 1.6 - 0.8];
    const axis = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      let off;
      do {
        off = (rnd() * 2 - 1) * width + gauss(rnd) * width * 0.08;
      } while (gaps.some((gp) => Math.abs(off / width - gp) < 0.035) && rnd() < 0.9);
      orbit.set([off, rnd() * Math.PI * 2, gauss(rnd) * thickness * (1 - 0.5 * Math.abs(off / width)), 0], i * 4);
      axis.randomDirection();
      spin.set([axis.x, axis.y, axis.z, (0.1 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1)], i * 4);
      const s = size[0] + (size[1] - size[0]) * Math.pow(rnd(), 4.5);
      shape.set([s * (0.85 + rnd() * 0.3), s * (0.5 + rnd() * 0.35), s * (0.6 + rnd() * 0.35), rnd() * Math.PI * 2], i * 4);
      const c = rnd() < 0.6 ? cType : sType;
      const shade = 0.7 + rnd() * 0.5;
      color.set([c[0] * shade, c[1] * shade, c[2] * shade], i * 3);
    }
    g.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));

    this.uniforms = {
      uTime: { value: rnd() * 1000 },
      uBeltRadius: { value: radius },
      uKepler: { value: kepler },
      uSunPos: { value: new THREE.Vector3() },
      uSunColor: { value: sunColor },
      uAmbient: { value: ambient },
      uShadowCenter: { value: new THREE.Vector3() },
      uShadowRadius: { value: 0 },
      uFade: { value: 1 },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader }));
    this.mesh.frustumCulled = false; // rocks are placed in the shader
    this.width = width;
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
  }

  dispose() {
    this.mesh.geometry.dispose(); // shares the rock's position/index buffers, which stay cached
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
