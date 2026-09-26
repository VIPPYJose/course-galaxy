// Planet-type manifest (baked in Blender), the stars, and small shared resources.
import * as THREE from 'three';

let manifest = null;
let typeById = new Map();

export async function loadManifest() {
  if (!manifest) {
    manifest = await (await fetch('assets/planets.json')).json();
    typeById = new Map(manifest.planets.map((p) => [p.id, p]));
  }
  return manifest;
}

/** Planet type definitions, in picker order. */
export function planetTypes() {
  return manifest.planets;
}

export function getType(id) {
  return typeById.get(id) ?? manifest.planets[0];
}

/** CSS colour for a planet type's list swatch (its atmosphere tint, or grey for airless moons). */
export function typeSwatch(def) {
  const c = def.atmo?.color ?? [0.62, 0.62, 0.64];
  return `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`;
}

// The star at the centre of each galaxy. Albedo textures are baked by BlenderPlanet's generator.
// `light` is the (linear) colour of its sunlight, from its blackbody temperature: a G star like
// the Sun is essentially white in space, an M dwarf is orange, a B giant blue-white.
// (Galaxies made in the Galaxy Forge describe their star in full instead; see SUN_FIELDS in params.js.)
export const STARS = {
  star_yellow: { label: 'Yellow Star', glow: '#ffb347', light: [1.0, 0.96, 0.9], albedo: 'assets/stars/star_yellow_albedo.jpg' },
  star_red: { label: 'Red Dwarf', glow: '#ff4a2a', light: [1.0, 0.66, 0.42], albedo: 'assets/stars/star_red_albedo.jpg' },
  star_blue: { label: 'Blue Giant', glow: '#7fb2ff', light: [0.78, 0.86, 1.0], albedo: 'assets/stars/star_blue_albedo.jpg' },
};

export const starInfo = (id) => STARS[id] ?? STARS.star_yellow;

export const CLAIM_COLOR = new THREE.Color('#ffb13b');

/**
 * Star material: the baked photosphere texture plus limb darkening, which is what makes a
 * real star read as a sphere. Linear law I(mu) = 1 - u(1 - mu) with u ~ 0.65, the value
 * measured on SDO full-disc images of the Sun. Without a texture it falls back to the glow colour.
 * `mat.userData.uniforms` holds the live settings: uLimb (u), and uTintCol / uTintAmt, which
 * recolour the texture to a blackbody colour (0 keeps the texture's own colours).
 */
export function createStarMaterial(glow, map) {
  const mat = new THREE.MeshBasicMaterial({ map });
  if (!map) mat.color.set(glow);
  mat.userData.base = mat.color.clone();
  const uniforms = { uLimb: { value: 0.65 }, uTintCol: { value: new THREE.Color(1, 1, 1) }, uTintAmt: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNrmV;\nvarying vec3 vPosV;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vNrmV = normalize(normalMatrix * normal);
        vPosV = (modelViewMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNrmV;\nvarying vec3 vPosV;\nuniform float uLimb;\nuniform vec3 uTintCol;\nuniform float uTintAmt;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float lumS = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, lumS * uTintCol * 2.0, uTintAmt);
        float mu = clamp(dot(normalize(vNrmV), normalize(-vPosV)), 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - uLimb * (1.0 - mu);`,
      );
  };
  mat.customProgramCacheKey = () => 'star-limb-v3';
  return mat;
}

let raysTex = null;
/** Soft light rays (six spokes) for bright or compact stars. */
export function raysTexture() {
  if (raysTex) return raysTex;
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const long = i % 3 === 0;
    const len = s * (long ? 0.5 : 0.34);
    const grd = g.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.save();
    g.rotate((i / 6) * Math.PI * 2 + 0.3);
    g.beginPath();
    g.moveTo(0, -(long ? 2.4 : 1.6));
    g.lineTo(len, 0);
    g.lineTo(0, long ? 2.4 : 1.6);
    g.closePath();
    g.fill();
    g.restore();
  }
  raysTex = new THREE.CanvasTexture(c);
  raysTex.colorSpace = THREE.SRGBColorSpace;
  return raysTex;
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
