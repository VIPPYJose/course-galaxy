// GLSL for the planets: surface, clouds, atmosphere and rings.
// All shaders output linear HDR; tone mapping + sRGB happen in the OutputPass.

const common = /* glsl */ `
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Rotate a colour around the grey axis (the "colour shift" slider in the planet dialog).
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return max(c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca), 0.0);
}
`;

// ------------------------------------------------------------------ planet surface
export const surfaceVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vNorthW;
varying vec3 vUpW;
varying vec3 vCenter;
void main() {
  vUv = uv;
  vec3 n = normalize(position);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), n);
  float le = length(east);
  east = le > 1e-5 ? east / le : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(n, east);
  mat3 R = mat3(modelMatrix);
  vNormalW = normalize(R * n);
  vEastW = normalize(R * east);
  vNorthW = normalize(R * north);
  vUpW = normalize(R * vec3(0.0, 1.0, 0.0));
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const surfaceFrag = /* glsl */ `
${common}
uniform float uHue;
uniform sampler2D uColorMap;
uniform sampler2D uNormalMap;
uniform sampler2D uSpecMap;
uniform sampler2D uEmissiveMap;
uniform sampler2D uCloudMap;
uniform sampler2D uRingMap;
uniform float uHasNormal, uHasSpec, uHasEmissive, uHasClouds, uHasRings;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uHasAtmo;
uniform vec3 uTint;
uniform float uSpecStrength, uEmissiveStrength, uEmissiveAlways, uLunar, uNormalStrength;
uniform float uCloudShift, uCloudShadow;
uniform float uRadius, uRingInner, uRingOuter;
uniform float uFade;
uniform float uHover;
uniform vec3 uAtmoColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vNorthW;
varying vec3 vUpW;
varying vec3 vCenter;

void main() {
  vec3 C = vCenter;
  vec3 Ng = normalize(vNormalW);
  vec3 N = Ng;
  if (uHasNormal > 0.5) {
    vec3 t = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
    t.xy *= uNormalStrength;
    N = normalize(normalize(vEastW) * t.x + normalize(vNorthW) * t.y + Ng * max(t.z, 0.05));
  }
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);
  float ndlG = dot(Ng, L);
  float ndl = dot(N, L);

  vec3 albedo = hueShift(texture2D(uColorMap, vUv).rgb, uHue) * uTint;

  // diffuse: Lambert, blended towards Lommel-Seeliger for dusty regolith
  float mu0 = max(ndl, 0.0);
  float mu = max(dot(N, V), 0.0);
  float ls = 2.0 * mu0 / (mu0 + mu + 1e-3);
  float diff = mix(mu0, ls * 0.55, uLunar);
  diff *= smoothstep(-0.04, 0.12, ndlG);

  // cloud shadows
  float cloud = uHasClouds > 0.5 ? texture2D(uCloudMap, vUv + vec2(uCloudShift, 0.0)).r : 0.0;
  float shadow = 1.0 - uCloudShadow * cloud;

  // ring shadow cast on the globe
  if (uHasRings > 0.5) {
    vec3 ringN = normalize(vUpW);
    float den = dot(L, ringN);
    if (abs(den) > 1e-4) {
      float t = dot(C - vWorldPos, ringN) / den;
      if (t > 0.0) {
        float r = length(vWorldPos + L * t - C) / uRadius;
        float rt = (r - uRingInner) / (uRingOuter - uRingInner);
        if (rt > 0.0 && rt < 1.0) shadow *= 1.0 - 0.92 * texture2D(uRingMap, vec2(rt, 0.5)).a;
      }
    }
  }

  // Sunlight grazing the terminator travels a long path through the air and reddens
  // (the warm band seen in ISS photos of Earth's day/night line).
  vec3 sunLight = uSunColor * mix(vec3(1.0), mix(vec3(1.0, 0.5, 0.26), vec3(1.0), smoothstep(0.0, 0.28, ndlG)), uHasAtmo);

  vec3 col = albedo * sunLight * diff * shadow;

  // sun glint on water
  if (uHasSpec > 0.5) {
    float sm = texture2D(uSpecMap, vUv).r * uSpecStrength;
    vec3 H = normalize(L + V);
    float ndh = max(dot(Ng, H), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float glint = pow(ndh, 260.0) * 3.5 + pow(ndh, 36.0) * 0.28;
    col += uSunColor * sm * glint * (0.35 + fres) * smoothstep(0.0, 0.2, ndlG) * shadow * (1.0 - cloud);
  }

  // Cinematic fill: a soft, cool light from the viewer's side that only works on the night
  // hemisphere, so terrain stays readable there while still clearly reading as night.
  // The day side and the terminator are untouched.
  float night = 1.0 - smoothstep(-0.2, 0.25, ndlG);
  col += albedo * uAmbient * (0.3 + 0.7 * max(dot(N, V), 0.0)) * night;

  // night lights / lava glow
  if (uHasEmissive > 0.5) {
    vec3 em = hueShift(texture2D(uEmissiveMap, vUv).rgb, uHue);
    float night = mix(1.0 - smoothstep(-0.14, 0.06, ndlG), 1.0, uEmissiveAlways);
    col += em * uEmissiveStrength * night * (1.0 - 0.8 * cloud);
  }

  // hover: soft fresnel glow in the atmosphere colour
  float fr = pow(1.0 - max(dot(Ng, V), 0.0), 3.0);
  col += uHover * fr * mix(vec3(0.5, 0.8, 1.0), uAtmoColor, 0.5) * 0.8;

  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

// ------------------------------------------------------------------ clouds
export const cloudFrag = /* glsl */ `
uniform sampler2D uCloudMap;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uOpacity;
uniform float uFade;
uniform vec3 uCloudColor;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vCenter;
void main() {
  float d = texture2D(uCloudMap, vUv).r;
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.12, 0.2, ndl) * (0.3 + 0.7 * max(ndl, 0.0));
  vec3 tint = mix(vec3(1.0, 0.55, 0.32), vec3(1.0), smoothstep(0.02, 0.35, ndl));
  vec3 col = uCloudColor * uSunColor * lit * tint;
  float night = 1.0 - smoothstep(-0.2, 0.25, ndl);
  col += uCloudColor * uAmbient * (0.3 + 0.7 * max(dot(N, normalize(cameraPosition - vWorldPos)), 0.0)) * night;
  float a = clamp(d * uOpacity, 0.0, 1.0) * uFade;
  gl_FragColor = vec4(col * a, a);
}
`;

// ------------------------------------------------------------------ atmosphere (single scattering)
export const atmoVert = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const atmoFrag = /* glsl */ `
${common}
uniform vec3 uCenter;
uniform float uRp;
uniform float uRa;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform float uHR;
uniform float uHM;
uniform float uG;
uniform float uIntensity;
uniform float uFade;
varying vec3 vWorldPos;

#ifndef STEPS
#define STEPS 12
#endif
#ifndef LIGHT_STEPS
#define LIGHT_STEPS 4
#endif

void main() {
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec3 L = normalize(uSunDir);
  vec2 ta = raySphere(ro, rd, uRa);
  if (ta.x > ta.y || ta.y < 0.0) discard;
  float t0 = max(ta.x, 0.0);
  float t1 = ta.y;
  vec2 tp = raySphere(ro, rd, uRp);
  if (tp.x < tp.y && tp.x > 0.0) t1 = tp.x;
  float ds = (t1 - t0) / float(STEPS);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    float h = max(length(p) - uRp, 0.0);
    float dR = exp(-h / uHR) * ds;
    float dM = exp(-h / uHM) * ds;
    odR += dR;
    odM += dM;
    // soft planet shadow
    float tc = -dot(p, L);
    float lit = 1.0;
    if (tc > 0.0) lit = smoothstep(uRp * 0.985, uRp * 1.03, length(p + L * tc));
    if (lit <= 0.0) continue;
    vec2 tl = raySphere(p, L, uRa);
    float dsl = max(tl.y, 0.0) / float(LIGHT_STEPS);
    float odRl = 0.0;
    float odMl = 0.0;
    for (int j = 0; j < LIGHT_STEPS; j++) {
      float hl = max(length(p + L * (dsl * (float(j) + 0.5))) - uRp, 0.0);
      odRl += exp(-hl / uHR) * dsl;
      odMl += exp(-hl / uHM) * dsl;
    }
    vec3 att = exp(-(uBetaR * (odR + odRl) + uBetaM * 1.1 * (odM + odMl))) * lit;
    sumR += dR * att;
    sumM += dM * att;
  }
  float mu = dot(rd, L);
  float g = uG;
  float pR = 0.0596831 * (1.0 + mu * mu);
  float pM = 0.1193662 * (1.0 - g * g) * (1.0 + mu * mu) / (pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5) * (2.0 + g * g));
  vec3 inscatter = uSunColor * uIntensity * (sumR * uBetaR * pR + sumM * uBetaM * pM);
  vec3 trans = exp(-(uBetaR * odR + uBetaM * 1.1 * odM));
  float a = clamp(1.0 - dot(trans, vec3(0.3333)), 0.0, 1.0);
  gl_FragColor = vec4(inscatter * uFade, a * uFade);
}
`;

// ------------------------------------------------------------------ rings
export const ringVert = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorldPos;
varying vec3 vRingN;
void main() {
  vLocal = position;
  vRingN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ringFrag = /* glsl */ `
${common}
uniform float uHue;
uniform sampler2D uRingMap;
uniform float uInner;
uniform float uOuter;
uniform vec3 uCenter;
uniform float uRp;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uTint;
uniform float uFade;
varying vec3 vLocal;
varying vec3 vWorldPos;
varying vec3 vRingN;
void main() {
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  vec4 s = texture2D(uRingMap, vec2(t, 0.5));
  vec3 n = normalize(vRingN);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float sunSide = dot(n, L);
  float viewSide = dot(n, V);
  float lit = abs(sunSide);
  float bright = sunSide * viewSide > 0.0
      ? 0.3 + 0.9 * lit
      : (0.08 + 0.55 * (1.0 - s.a)) * (0.4 + 0.6 * lit);
  vec3 p = vWorldPos - uCenter;
  float tc = -dot(p, L);
  float shadow = 1.0;
  if (tc > 0.0) shadow = smoothstep(uRp * 0.97, uRp * 1.01, length(p + L * tc));
  vec3 col = hueShift(s.rgb, uHue) * uTint * uSunColor * bright * (0.04 + 0.96 * shadow);
  float a = s.a * uFade;
  gl_FragColor = vec4(col * a, a);
}
`;
