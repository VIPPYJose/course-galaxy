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
export const STARS = {
  star_yellow: { label: 'Yellow Star', glow: '#ffb347', albedo: 'assets/stars/star_yellow_albedo.jpg' },
  star_red: { label: 'Red Dwarf', glow: '#ff4a2a', albedo: 'assets/stars/star_red_albedo.jpg' },
  star_blue: { label: 'Blue Giant', glow: '#7fb2ff', albedo: 'assets/stars/star_blue_albedo.jpg' },
};

export const starInfo = (id) => STARS[id] ?? STARS.star_yellow;

export const CLAIM_COLOR = new THREE.Color('#ffb13b');

/**
 * Star material: the baked photosphere texture plus limb darkening, which is what makes a
 * real star read as a sphere. Without a texture it falls back to the glow colour.
 */
export function createStarMaterial(glow, map) {
  const mat = new THREE.MeshBasicMaterial({ map });
  if (!map) mat.color.set(glow);
  mat.userData.base = mat.color.clone();
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNrmV;\nvarying vec3 vPosV;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vNrmV = normalize(normalMatrix * normal);
        vPosV = (modelViewMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNrmV;\nvarying vec3 vPosV;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float mu = clamp(dot(normalize(vNrmV), normalize(-vPosV)), 0.0, 1.0);
        diffuseColor.rgb *= 0.42 + 0.58 * pow(mu, 0.55);`,
      );
  };
  mat.customProgramCacheKey = () => 'star-limb-v1';
  return mat;
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
