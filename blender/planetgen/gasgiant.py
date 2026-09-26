"""Gas / ice giant texture generator (numpy, runs inside Blender's Python).

Latitude bands are advected through a steady velocity field made of zonal jets,
Gaussian vortices (storms) and anisotropic curl noise. The result is a flow map:
every pixel knows which latitude its "air" came from, so the band palette gets
wrapped into swirls, festoons and storm spirals the way real giants look.

Output is an equirectangular map (row 0 = south, u = longitude/360) in the same
convention as the baked textures, so it can be sampled on the sphere and baked.
"""
import math
import numpy as np

TAU = math.tau


def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def value_noise(W, H, fx, fy, rng):
    """Smooth value noise in [-1, 1], periodic in x, on a W x H grid."""
    fx = max(int(fx), 1)
    fy = max(int(fy), 1)
    g = (rng.random((fy + 2, fx), dtype=np.float32) * 2.0 - 1.0)
    x = (np.arange(W, dtype=np.float32) + 0.5) / W * fx
    y = (np.arange(H, dtype=np.float32) + 0.5) / H * fy
    i0 = np.floor(x).astype(np.int32)
    tx = _fade(x - i0)
    i0 %= fx
    i1 = (i0 + 1) % fx
    j0 = np.floor(y).astype(np.int32)
    ty = _fade(y - j0)
    j1 = j0 + 1
    a = g[:, i0] * (1.0 - tx) + g[:, i1] * tx
    return a[j0, :] * (1.0 - ty)[:, None] + a[j1, :] * ty[:, None]


def fbm(W, H, fx, fy, octaves, rng, persistence=0.5, lacunarity=2.0):
    out = np.zeros((H, W), dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(W, H, fx * lacunarity ** o, fy * lacunarity ** o, rng)
        norm += amp
        amp *= persistence
    return out / norm


def sample(field, X, Y):
    """Bilinear sample, pixel centres at integer coords, wrap in x, clamp in y."""
    H, W = field.shape[:2]
    x0f = np.floor(X)
    fx = (X - x0f).astype(np.float32)
    x0 = x0f.astype(np.int64) % W
    x1 = (x0 + 1) % W
    Yc = np.clip(Y, 0.0, H - 1.001)
    y0 = np.floor(Yc).astype(np.int64)
    fy = (Yc - y0).astype(np.float32)
    y1 = np.minimum(y0 + 1, H - 1)
    if field.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    a = field[y0, x0] * (1 - fx) + field[y0, x1] * fx
    b = field[y1, x0] * (1 - fx) + field[y1, x1] * fx
    return a * (1 - fy) + b * fy


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def palette(stops, s01):
    xs = np.array([p for p, _ in stops], dtype=np.float32)
    cs = np.array([c for _, c in stops], dtype=np.float32)
    out = np.empty(s01.shape + (3,), dtype=np.float32)
    for k in range(3):
        out[..., k] = np.interp(s01, xs, cs[:, k])
    return out


class Vortex:
    def __init__(self, lat, lon, sigma, omega, aspect=1.0):
        self.lat, self.lon = math.radians(lat), math.radians(lon)
        self.sigma, self.omega, self.aspect = sigma, omega, aspect

    def fields(self, LON, LAT):
        dlon = (LON - self.lon + math.pi) % TAU - math.pi
        dx = dlon * np.cos(LAT) / self.aspect
        dy = LAT - self.lat
        q = (dx * dx + dy * dy) / (self.sigma * self.sigma)
        w = self.omega * np.exp(-q)
        u = -w * dy * self.aspect     # physical (radians of arc per step)
        v = w * dx / self.aspect * self.aspect
        return u, v, np.sqrt(q)


def generate(cfg, W=4096, H=2048, fw=2048, fh=1024, seed=1, steps=64, log=print):
    """cfg keys: stops, jets(list of (amp, freq, phase)), curl_amp, curl_f=(fx, fy),
    vortices(list of Vortex), n_eddies, eddy_lat_bias, tint(fn), clouds(fn)."""
    rng = np.random.default_rng(seed)
    # ------------------------------------------------------------ flow at low res
    lat = ((np.arange(fh, dtype=np.float32) + 0.5) / fh - 0.5) * math.pi
    lon = (np.arange(fw, dtype=np.float32) + 0.5) / fw * TAU
    LON, LAT = np.meshgrid(lon, lat)
    coslat = np.maximum(np.cos(LAT), 0.06)
    px_lon = TAU / fw
    px_lat = math.pi / fh
    pole = smoothstep(0.995, 0.96, np.abs(np.sin(LAT)))  # 1 away from the poles

    U = np.zeros((fh, fw), dtype=np.float32)
    V = np.zeros((fh, fw), dtype=np.float32)
    # zonal jets (physical rad/step -> px/step)
    for amp, freq, phase in cfg.get('jets', []):
        U += (amp * np.sin(LAT * freq + phase)).astype(np.float32)
    # curl noise turbulence: psi varies faster in latitude -> zonally stretched eddies
    cf = cfg.get('curl_f', (4, 14))
    psi = fbm(fw, fh, cf[0], cf[1], cfg.get('curl_octaves', 4), rng,
              persistence=cfg.get('curl_persistence', 0.42))
    dpsi_dy = (np.vstack([psi[1:], psi[-1:]]) - np.vstack([psi[:1], psi[:-1]])) * 0.5
    dpsi_dx = (np.roll(psi, -1, axis=1) - np.roll(psi, 1, axis=1)) * 0.5
    ca = cfg.get('curl_amp', 1.0)
    # convert: psi gradient per px -> physical velocity; keep result in px units later
    U += (ca * dpsi_dy / px_lat * 1e-3).astype(np.float32)
    V += (-ca * dpsi_dx / (px_lon * coslat) * 1e-3).astype(np.float32)

    vortices = list(cfg.get('vortices', []))
    # eddies rolling up along band boundaries (where the palette changes most)
    stops = cfg['stops']
    lum = np.array([sum(c) for _, c in stops])
    edges = [(stops[i][0] + stops[i + 1][0]) * 0.5 for i in range(len(stops) - 1)
             if abs(lum[i + 1] - lum[i]) > 0.12]
    smin, smax = cfg.get('eddy_sigma', (0.02, 0.05))
    wmin, wmax = cfg.get('eddy_omega', (0.05, 0.13))
    for _ in range(cfg.get('n_eddies', 0)):
        la = (rng.choice(edges) - 0.5) * 180.0 + rng.normal(0, 1.2)
        if abs(la) > 70:
            continue
        vortices.append(Vortex(la, rng.uniform(0, 360), rng.uniform(smin, smax),
                               rng.choice([-1, 1]) * rng.uniform(wmin, wmax), rng.uniform(1.2, 2.4)))
    for _ in range(cfg.get('n_polar', 0)):
        la = rng.choice([-1, 1]) * rng.uniform(58, 84)
        vortices.append(Vortex(la, rng.uniform(0, 360), rng.uniform(0.012, 0.03),
                               rng.choice([-1, 1]) * rng.uniform(0.06, 0.16), 1.0))
    for vx in vortices:
        u, v, _ = vx.fields(LON, LAT)
        U += u.astype(np.float32)
        V += v.astype(np.float32)
    # physical -> pixel units
    U = U / (coslat * px_lon) * pole
    V = V / px_lat * pole
    dt = cfg.get('dt', 1.0)
    # --------------------------------------------------------- backward advection
    X = np.tile(np.arange(fw, dtype=np.float32), (fh, 1))
    Y = np.tile(np.arange(fh, dtype=np.float32)[:, None], (1, fw))
    X0, Y0 = X.copy(), Y.copy()
    for s in range(steps):
        u = sample(U, X, Y)
        v = sample(V, X, Y)
        X -= dt * u
        Y -= dt * v
    dX, dY = X - X0, Y - Y0
    log(f'[gas] advected {steps} steps; max |dY| {float(np.abs(dY).max()):.1f}px')

    # ------------------------------------------------ upsample flow map to output
    sx, sy = W / fw, H / fh
    Xo = np.tile(np.arange(W, dtype=np.float32), (H, 1))
    Yo = np.tile(np.arange(H, dtype=np.float32)[:, None], (1, W))
    qx = (Xo + 0.5) / sx - 0.5
    qy = (Yo + 0.5) / sy - 0.5
    dXo = sample(dX, qx, qy) * sx
    dYo = sample(dY, qx, qy) * sy
    SX = Xo + dXo            # source position (output px)
    SY = Yo + dYo
    del dXo, dYo, qx, qy
    latO = ((np.arange(H, dtype=np.float32) + 0.5) / H - 0.5) * math.pi
    lonO = (np.arange(W, dtype=np.float32) + 0.5) / W * TAU
    LONO, LATO = np.meshgrid(lonO, latO)

    # source latitude (+ tiny initial perturbation to break symmetry)
    pert = fbm(W, H, 4, 8, 3, rng) * cfg.get('band_wobble', 0.02)
    s_lat = ((np.clip(SY, 0, H - 1) + 0.5) / H - 0.5) * math.pi + sample(pert, SX, SY)
    s01 = np.clip(s_lat / math.pi + 0.5, 0.0, 1.0)
    col = palette(cfg['stops'], s01)

    # advected tracers for fine texture
    t_fine = sample(fbm(W, H, 40, 200, 5, rng, 0.55), SX, SY)
    t_mid = sample(fbm(W, H, 10, 48, 5, rng, 0.55), SX, SY)
    t_streak = sample(fbm(W, H, 6, 160, 5, rng, 0.6), SX, SY)
    bright = 1.0 + cfg.get('fine_amp', 0.10) * t_fine + cfg.get('mid_amp', 0.08) * t_mid \
        + cfg.get('streak_amp', 0.05) * t_streak
    col *= bright[..., None]
    ctx = dict(LON=LONO, LAT=LATO, s01=s01, t_fine=t_fine, t_mid=t_mid, t_streak=t_streak,
               rng=rng, W=W, H=H)
    if 'tint' in cfg:
        col = cfg['tint'](col, ctx)
    col = np.clip(col, 0.0, 1.0)
    clouds = cfg['clouds'](ctx) if 'clouds' in cfg else None
    return col, clouds


# ============================================================================ presets
def _storm_mask(LON, LAT, lat, lon, sigma, aspect):
    dlon = (LON - math.radians(lon) + math.pi) % TAU - math.pi
    dx = dlon * np.cos(LAT) / aspect
    dy = LAT - math.radians(lat)
    return np.sqrt(dx * dx + dy * dy) / sigma


JOVIAN = dict(
    stops=[
        (0.00, (0.19, 0.17, 0.16)), (0.05, (0.24, 0.21, 0.18)), (0.09, (0.31, 0.26, 0.21)),
        (0.12, (0.24, 0.19, 0.15)), (0.15, (0.50, 0.41, 0.30)), (0.18, (0.36, 0.24, 0.14)),
        (0.215, (0.66, 0.55, 0.39)), (0.25, (0.44, 0.27, 0.14)), (0.28, (0.62, 0.48, 0.32)),
        (0.305, (0.82, 0.72, 0.55)), (0.335, (0.76, 0.62, 0.44)),
        (0.355, (0.44, 0.19, 0.07)), (0.38, (0.36, 0.15, 0.06)), (0.405, (0.52, 0.28, 0.12)),
        (0.43, (0.72, 0.54, 0.34)), (0.46, (0.87, 0.78, 0.60)), (0.50, (0.82, 0.62, 0.38)),
        (0.54, (0.88, 0.80, 0.63)), (0.565, (0.40, 0.17, 0.065)), (0.60, (0.33, 0.14, 0.055)),
        (0.625, (0.50, 0.28, 0.13)), (0.65, (0.80, 0.70, 0.53)), (0.69, (0.72, 0.60, 0.43)),
        (0.72, (0.46, 0.29, 0.16)), (0.75, (0.68, 0.57, 0.41)), (0.78, (0.46, 0.33, 0.21)),
        (0.81, (0.60, 0.50, 0.37)), (0.84, (0.40, 0.31, 0.22)), (0.87, (0.50, 0.42, 0.32)),
        (0.90, (0.31, 0.26, 0.21)), (0.94, (0.24, 0.21, 0.18)), (1.00, (0.19, 0.17, 0.16)),
    ],
    jets=[(0.0035, 14.0, 0.3), (0.0018, 29.0, 1.1), (0.0010, 47.0, 2.0)],
    curl_amp=0.9, curl_f=(4, 16), n_eddies=170, n_polar=70, band_wobble=0.012,
    eddy_sigma=(0.018, 0.05), eddy_omega=(0.05, 0.13),
    fine_amp=0.035, mid_amp=0.07, streak_amp=0.05,
    vortices=[
        Vortex(-22.0, 60.0, 0.085, 0.11, aspect=1.9),            # great red storm
        Vortex(-33.0, 150.0, 0.03, 0.12, aspect=1.4),            # white ovals
        Vortex(-33.5, 185.0, 0.028, 0.12, aspect=1.4),
        Vortex(-32.5, 215.0, 0.026, 0.12, aspect=1.4),
        Vortex(41.0, 280.0, 0.03, -0.1, aspect=1.6),
    ],
)


def _jovian_tint(col, c):
    LON, LAT = c['LON'], c['LAT']
    # great red storm core + pale collar
    r = _storm_mask(LON, LAT, -22.0, 60.0, 0.085, 1.9)
    # the flow wraps the source latitude into a spiral inside the storm -> striped spiral
    spiral = 0.5 + 0.5 * np.sin(c['s01'] * 260.0 + c['t_mid'] * 3.0)
    k = (0.72 + 0.28 * spiral + 0.1 * c['t_fine'])
    red = np.stack([0.56 * k, 0.2 * k * k, 0.085 * k * k], -1)
    core = (1 - smoothstep(0.0, 0.5, r))[..., None] * 0.4
    red = red * (1 - core) + np.array([0.62, 0.3, 0.14]) * core
    m = (1 - smoothstep(0.6, 1.1, r))[..., None]
    col = col * (1 - m) + red * m
    collar = (np.exp(-((r - 1.3) / 0.25) ** 2) * 0.3)[..., None]
    col = col * (1 - collar) + np.array([0.88, 0.8, 0.66]) * collar
    # white ovals
    for lat, lon, sg, asp in [(-33.0, 150.0, 0.03, 1.4), (-33.5, 185.0, 0.028, 1.4),
                              (-32.5, 215.0, 0.026, 1.4), (41.0, 280.0, 0.03, 1.6)]:
        ro = _storm_mask(LON, LAT, lat, lon, sg, asp)
        mo = (1 - smoothstep(0.5, 1.0, ro))[..., None] * 0.9
        col = col * (1 - mo) + np.array([0.86, 0.83, 0.78]) * mo
    # mottled polar regions
    pol = smoothstep(52.0, 66.0, np.abs(np.degrees(LAT)))[..., None]
    col = col * (1 + pol * (0.35 * c['t_mid'] + 0.2 * c['t_fine'])[..., None])
    # blue-grey festoons at the north edge of the equatorial zone
    band = np.exp(-((np.degrees(LAT) - 7.0) / 3.0) ** 2)
    fest = (smoothstep(0.25, 0.55, c['t_mid']) * band * 0.7)[..., None]
    col = col * (1 - fest) + np.array([0.26, 0.27, 0.29]) * fest
    return col


JOVIAN['tint'] = _jovian_tint

SATURN = dict(
    stops=[
        (0.00, (0.34, 0.36, 0.38)), (0.08, (0.42, 0.41, 0.38)), (0.14, (0.55, 0.49, 0.38)),
        (0.20, (0.63, 0.55, 0.41)), (0.26, (0.56, 0.47, 0.33)), (0.31, (0.69, 0.61, 0.46)),
        (0.36, (0.60, 0.50, 0.34)), (0.42, (0.75, 0.67, 0.51)), (0.47, (0.81, 0.73, 0.57)),
        (0.52, (0.77, 0.68, 0.51)), (0.57, (0.66, 0.55, 0.38)), (0.62, (0.73, 0.64, 0.48)),
        (0.68, (0.61, 0.51, 0.36)), (0.74, (0.67, 0.59, 0.44)), (0.80, (0.56, 0.50, 0.39)),
        (0.87, (0.47, 0.45, 0.41)), (0.93, (0.39, 0.41, 0.43)), (1.00, (0.34, 0.37, 0.41)),
    ],
    jets=[(0.004, 16.0, 0.0), (0.0015, 37.0, 0.7)],
    curl_amp=0.35, curl_f=(4, 20), n_eddies=40, n_polar=20, band_wobble=0.008,
    eddy_sigma=(0.015, 0.035), eddy_omega=(0.03, 0.08),
    fine_amp=0.05, mid_amp=0.05, streak_amp=0.06,
    vortices=[Vortex(38.0, 120.0, 0.035, 0.08, aspect=2.0)],
)


def _saturn_tint(col, c):
    LAT = c['LAT']
    fine_bands = 1.0 + 0.035 * np.sin(c['s01'] * 260.0) + 0.02 * np.sin(c['s01'] * 610.0 + 1.3)
    col = col * fine_bands[..., None]
    r = _storm_mask(c['LON'], LAT, 38.0, 120.0, 0.035, 2.0)
    m = ((1 - smoothstep(0.4, 1.0, r)) * 0.6)[..., None]
    return col * (1 - m) + np.array([0.86, 0.82, 0.72]) * m


SATURN['tint'] = _saturn_tint

NEPTUNE = dict(
    stops=[
        (0.00, (0.035, 0.09, 0.26)), (0.10, (0.04, 0.11, 0.33)), (0.20, (0.05, 0.15, 0.42)),
        (0.28, (0.032, 0.10, 0.34)), (0.36, (0.06, 0.18, 0.48)), (0.45, (0.05, 0.16, 0.46)),
        (0.52, (0.07, 0.20, 0.53)), (0.60, (0.045, 0.14, 0.43)), (0.70, (0.06, 0.17, 0.47)),
        (0.80, (0.04, 0.12, 0.38)), (0.90, (0.04, 0.10, 0.30)), (1.00, (0.035, 0.09, 0.26)),
    ],
    jets=[(-0.005, 3.0, 0.0), (0.0015, 21.0, 0.5)],
    curl_amp=0.7, curl_f=(3, 14), n_eddies=40, n_polar=10, band_wobble=0.015,
    eddy_sigma=(0.02, 0.05), eddy_omega=(0.04, 0.1),
    fine_amp=0.06, mid_amp=0.10, streak_amp=0.05,
    vortices=[Vortex(-22.0, 100.0, 0.07, 0.1, aspect=1.7), Vortex(-55.0, 250.0, 0.03, 0.1, 1.3)],
)


def _neptune_tint(col, c):
    r = _storm_mask(c['LON'], c['LAT'], -22.0, 100.0, 0.07, 1.7)
    m = ((1 - smoothstep(0.5, 1.0, r)) * 0.85)[..., None]
    return col * (1 - m) + np.array([0.012, 0.03, 0.12]) * m


def _neptune_clouds(c):
    LAT = np.degrees(c['LAT'])
    band = (np.exp(-((LAT + 26) / 3.5) ** 2) + np.exp(-((LAT - 22) / 3.0) ** 2)
            + 0.8 * np.exp(-((LAT + 48) / 3.0) ** 2) + 0.5 * np.exp(-((LAT - 40) / 4.0) ** 2))
    streak = smoothstep(0.1, 0.45, c['t_streak']) * np.clip(band, 0, 1)
    r = _storm_mask(c['LON'], c['LAT'], -22.0, 100.0, 0.07, 1.7)
    comp = np.exp(-((r - 1.25) / 0.18) ** 2) * smoothstep(-0.1, 0.4, c['t_mid'])
    return np.clip(np.maximum(streak, comp), 0.0, 1.0)


NEPTUNE['tint'] = _neptune_tint
NEPTUNE['clouds'] = _neptune_clouds

PRESETS = dict(jovian=(JOVIAN, 7), saturn=(SATURN, 3), neptune=(NEPTUNE, 5))
