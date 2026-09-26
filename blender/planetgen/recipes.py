"""Procedural planet surface recipes.

Each recipe receives a node builder ``nb`` and ``D`` - the unit direction
from the planet centre (Blender object space, Z up) - and returns a dict of
output sockets:

    color     linear albedo
    rough     roughness 0..1
    height    radial displacement in planet-radius units
    emit      emission colour (night lights / lava), 0..1 range
    spec      specular (water) mask 0..1
    clouds    cloud density 0..1 (optional)

Everything is 3D-noise based so it is seamless on the sphere and can be baked
to an equirectangular map without seams or pole pinching.
"""
import math
import bpy
from .nodes import NB

DEG = math.pi / 180.0


# --------------------------------------------------------------------------- helpers
def seeded(nb, D, seed):
    return nb.vadd(D, seed)


def warp(nb, D, strength, scale, detail, seed, rough=0.5):
    """Domain warp: D + (noise_rgb - 0.5) * strength."""
    n = nb.noise(nb.vadd(D, seed), scale=scale, detail=detail, rough=rough)
    off = nb.vsub(n.outputs['Color'], (0.5, 0.5, 0.5))
    return nb.vadd(D, nb.vscale(off, strength))


def swirl(nb, D, scale, strength, sigma, density, seed, lat=None):
    """Cyclone-like vortices around random Voronoi feature points.

    Rotates the sample point around the local normal by an angle that falls
    off with distance from the (random) vortex centre, so any texture sampled
    with the result curls into spirals. Sense of rotation flips per hemisphere.
    The angle is forced to zero at the Voronoi cell edges so there are no seams.
    lat=(centre, width) optionally restricts vortices to a band of |sin(lat)|.
    """
    Ps = nb.vadd(nb.vscale(D, scale), seed)
    vor = nb.voronoi(Ps, scale=1.0, feature='F1', rand=0.85)
    edge = nb.voronoi(Ps, scale=1.0, feature='DISTANCE_TO_EDGE', rand=0.85).outputs['Distance']
    centre = vor.outputs['Position']
    o = nb.vsub(Ps, centre)
    r2 = nb.vdot(o, o)
    fall = nb.exp(nb.mul(r2, -1.0 / (sigma * sigma)))
    fall = nb.mul(fall, nb.smoothstep(0.0, 0.3, edge))
    r, g, _ = nb.sep_rgb(vor.outputs['Color'])
    present = nb.lt(r, density)
    _, _, z = nb.sep(D)
    if lat is not None:
        present = nb.mul(present, nb.gauss(nb.abs(z), lat[0], lat[1]))
    hemi = nb.math('SIGN', z)
    amp = nb.madd(g, 0.5 * strength, 0.5 * strength)
    ang = nb.mul(nb.mul(nb.mul(fall, present), hemi), amp)
    rot = nb.rotate(Ps, axis=D, angle=ang, center=centre)
    return nb.vscale(nb.vsub(rot, seed), 1.0 / scale)


def unit_dir(lat_deg, lon_deg):
    """Direction matching the web equirect mapping (u = lon/360)."""
    lat, lon = lat_deg * DEG, lon_deg * DEG
    return (-math.cos(lon) * math.cos(lat), -math.sin(lon) * math.cos(lat), math.sin(lat))


CRATER_PROFILE = [
    (0.0, -1.0), (0.22, -0.92), (0.38, -0.55), (0.46, 0.05), (0.5, 0.32),
    (0.56, 0.12), (0.68, 0.035), (1.0, 0.0),
]


def craters(nb, D, scale, density, rmin, rmax, depth, seed):
    """One octave of craters. Returns dict(h, rim, floor, x, present, rnd, vor)."""
    Ps = nb.vadd(D, seed)
    vor = nb.voronoi(Ps, scale=scale, feature='F1', rand=1.0)
    d = vor.outputs['Distance']
    r, g, b = nb.sep_rgb(vor.outputs['Color'])
    radius = nb.madd(nb.mul(r, r), rmax - rmin, rmin)
    present = nb.lt(g, density)
    x = nb.div(d, radius)
    t = nb.clamp01(nb.mul(x, 0.5))
    prof = nb.curve(t, CRATER_PROFILE)
    # depth proportional to crater radius (planet units = scaled / scale)
    h = nb.mul(nb.mul(prof, present), nb.mul(radius, depth / scale))
    rim = nb.mul(nb.gauss(x, 1.0, 0.18), present)
    floor = nb.mul(nb.one_minus(nb.smoothstep(0.55, 0.95, x)), present)
    return dict(h=h, rim=rim, floor=floor, x=x, present=present, rnd=b, vor=vor, Ps=Ps)


# --------------------------------------------------------------------------- TERRA
def terra(nb, D):
    x, y, z = nb.sep(D)
    alat = nb.abs(z)
    D1 = warp(nb, D, 0.65, 1.2, 3, (3.1, 1.7, 5.3))
    c = nb.fbm(D1, scale=1.3, detail=14, rough=0.56, lac=2.05)
    elev = nb.sub(c, 0.535)
    landmask = nb.smoothstep(-0.0012, 0.0012, elev)

    # mountains: sharp ridges inside continents
    rn = nb.fbm(nb.vadd(D1, (7.7, 3.3, 1.9)), scale=2.4, detail=7, rough=0.5)
    ridge = nb.pow(nb.one_minus(nb.abs(nb.madd(rn, 2.0, -1.0))), 5.0)
    inland = nb.smoothstep(0.005, 0.07, elev)
    mount = nb.mul(ridge, inland)
    fine = nb.fbm(nb.vadd(D1, (1.1, 9.9, 4.4)), scale=26.0, detail=8, rough=0.6)

    # climate
    tn = nb.fbm(nb.vadd(D, (1.3, 8.1, 2.2)), scale=2.6, detail=4)
    T = nb.one_minus(nb.pow(alat, 1.25))
    T = nb.sub(T, nb.mul(nb.max(elev, 0.0), 0.9))
    T = nb.sub(T, nb.mul(mount, 0.3))
    T = nb.add(T, nb.mul(nb.sub(tn, 0.5), 0.32))

    mn = nb.fbm(nb.vadd(D1, (4.4, 0.7, 9.2)), scale=2.1, detail=7, rough=0.55)
    M = nb.madd(nb.sub(mn, 0.5), 2.6, 0.64)
    M = nb.sub(M, nb.mul(nb.gauss(alat, 0.36, 0.11), 0.38))   # subtropical deserts
    M = nb.add(M, nb.mul(nb.gauss(alat, 0.0, 0.16), 0.25))    # wet tropics
    M = nb.add(M, nb.mul(nb.one_minus(nb.smoothstep(0.0, 0.05, elev)), 0.12))  # coastal humidity
    M = nb.clamp01(M)

    land = nb.ramp(M, [
        (0.00, (0.50, 0.37, 0.20)),
        (0.18, (0.40, 0.27, 0.13)),
        (0.34, (0.22, 0.17, 0.08)),
        (0.48, (0.10, 0.11, 0.045)),
        (0.64, (0.045, 0.075, 0.025)),
        (0.82, (0.028, 0.058, 0.02)),
        (1.00, (0.02, 0.046, 0.016)),
    ])
    tundra = nb.ramp(M, [(0.0, (0.22, 0.19, 0.15)), (0.6, (0.09, 0.09, 0.06)), (1.0, (0.05, 0.07, 0.04))])
    land = nb.mixc(nb.mul(nb.one_minus(nb.smoothstep(0.16, 0.42, T)), 0.85), land, tundra)
    land = nb.mixc(nb.smoothstep(0.12, 0.55, mount), land, (0.15, 0.125, 0.1))
    land = nb.cscale(land, nb.madd(fine, 0.5, 0.75))

    # ocean
    depth = nb.mul(elev, -1.0)
    ocean = nb.ramp(nb.clamp01(nb.mul(depth, 4.0)), [
        (0.00, (0.035, 0.14, 0.15)),
        (0.05, (0.012, 0.06, 0.09)),
        (0.22, (0.006, 0.026, 0.062)),
        (0.60, (0.003, 0.013, 0.042)),
    ])

    # ice: polar caps, sea ice, snowy peaks
    icen = nb.fbm(nb.vadd(D, (6.6, 2.2, 0.3)), scale=9.0, detail=9, rough=0.6)
    Ti = nb.add(T, nb.mul(nb.sub(icen, 0.5), 0.14))
    landice = nb.one_minus(nb.smoothstep(0.035, 0.07, Ti))
    peaks = nb.mul(nb.smoothstep(0.6, 0.9, mount), nb.one_minus(nb.smoothstep(0.22, 0.45, T)))
    landice = nb.max(landice, peaks)
    seaice = nb.one_minus(nb.smoothstep(0.01, 0.045, Ti))
    ice = nb.mixf(landmask, seaice, landice)
    icecol = nb.cscale((0.80, 0.82, 0.86), nb.madd(fine, 0.2, 0.9))
    seaicecol = nb.mixc(nb.smoothstep(0.35, 0.65, icen), (0.52, 0.58, 0.64), (0.78, 0.8, 0.84))
    icecol = nb.mixc(landmask, seaicecol, icecol)

    col = nb.mixc(landmask, ocean, land)
    col = nb.mixc(ice, col, icecol)

    rough = nb.mixf(landmask, 0.38, 0.92)
    rough = nb.mixf(ice, rough, 0.6)
    spec = nb.mul(nb.one_minus(landmask), nb.one_minus(ice))

    height_land = nb.add(nb.mul(nb.max(elev, 0.0), 0.05), nb.mul(mount, 0.012))
    height_land = nb.add(height_land, nb.mul(nb.mul(nb.sub(fine, 0.5), 0.004), inland))
    height = nb.mul(height_land, landmask)

    # city lights: sparse points clustered in temperate, wet, coastal lowlands
    popn = nb.fbm(nb.vadd(D1, (2.2, 5.5, 3.3)), scale=5.0, detail=8, rough=0.65)
    pop = nb.smoothstep(0.52, 0.72, popn)
    habitable = nb.mul(nb.smoothstep(0.35, 0.55, T), nb.smoothstep(0.25, 0.45, M))
    coast = nb.one_minus(nb.smoothstep(0.0, 0.04, elev))
    dens = nb.mul(nb.mul(landmask, nb.one_minus(ice)), habitable)
    dens = nb.mul(dens, nb.clamp01(nb.add(pop, nb.mul(coast, 0.35))))
    lights = nb.mul(dens, 0.06)
    for sc, sz, seed in [(160.0, 0.3, (0.5, 0.5, 0.5)), (60.0, 0.13, (3.5, 1.5, 0.5))]:
        vor = nb.voronoi(nb.vadd(D, seed), scale=sc, feature='F1', rand=1.0)
        vr, _, _ = nb.sep_rgb(vor.outputs['Color'])
        dot = nb.one_minus(nb.smoothstep(0.0, sz, vor.outputs['Distance']))
        lights = nb.add(lights, nb.mul(dot, nb.lt(vr, nb.mul(dens, 1.3))))
    emit = nb.cscale((1.0, 0.6, 0.28), nb.clamp01(lights))

    # clouds: coverage field (fronts, gentle cyclones, zonal bands) thresholding a
    # detailed puff/streak field -> broken cumulus where coverage is low, decks where high
    # mid-latitude cyclones (large, comma shaped) and a few tropical storms (small, tight)
    Dc = swirl(nb, D, scale=2.4, strength=2.3, sigma=0.32, density=0.7, seed=(5.0, 1.0, 2.0),
               lat=(0.72, 0.16))
    Dc = swirl(nb, Dc, scale=7.0, strength=3.5, sigma=0.2, density=0.3, seed=(1.5, 4.0, 8.0),
               lat=(0.3, 0.08))
    Dz = nb.vmul(Dc, (1.0, 1.0, 1.9))
    Dz = warp(nb, Dz, 0.6, 1.6, 5, (9.0, 3.0, 6.0))
    cb = nb.fbm(Dz, scale=1.9, detail=6, rough=0.55)
    latmod = nb.mul(nb.gauss(z, 0.0, 0.09), 0.1)
    latmod = nb.sub(latmod, nb.mul(nb.gauss(alat, 0.36, 0.12), 0.1))
    latmod = nb.add(latmod, nb.mul(nb.gauss(alat, 0.72, 0.13), 0.06))
    cov = nb.maprange(nb.add(cb, latmod), 0.42, 0.74, 0.0, 1.0)
    # streaky/billowy detail: warped, zonally stretched perlin fbm + a little worley
    Dd = warp(nb, nb.vmul(Dc, (1.0, 1.0, 2.2)), 0.18, 3.5, 4, (2.0, 7.0, 1.0))
    pw = nb.fbm(Dd, scale=4.5, detail=12, rough=0.62)
    wor = nb.value(0.0)
    for sc, wt in [(16.0, 0.6), (36.0, 0.4)]:
        f1 = nb.voronoi(Dd, scale=sc, feature='F1', rand=1.0).outputs['Distance']
        wor = nb.add(wor, nb.mul(nb.one_minus(nb.clamp01(f1)), wt))
    det = nb.maprange(nb.add(nb.mul(pw, 0.82), nb.mul(wor, 0.18)), 0.33, 0.64, 0.0, 1.0)
    thr = nb.one_minus(cov)
    clouds = nb.maprange(det, nb.sub(thr, 0.2), nb.add(thr, 0.22), 0.0, 1.0)
    clouds = nb.mul(clouds, nb.madd(cov, 0.45, 0.55))
    wisp = nb.fbm(nb.vmul(Dc, (1.0, 1.0, 2.6)), scale=22.0, detail=8, rough=0.6)
    clouds = nb.mul(clouds, nb.maprange(wisp, 0.3, 0.7, 0.5, 1.0))
    return dict(color=col, rough=rough, height=height, emit=emit, spec=spec, clouds=clouds)


# --------------------------------------------------------------------------- DUNE (Mars-like)
def dune(nb, D):
    x, y, z = nb.sep(D)
    alat = nb.abs(z)
    D1 = warp(nb, D, 0.4, 1.3, 3, (2.0, 4.0, 1.0))
    a = nb.fbm(D1, scale=1.7, detail=12, rough=0.6)
    col = nb.ramp(a, [
        (0.30, (0.045, 0.028, 0.02)),
        (0.42, (0.11, 0.05, 0.025)),
        (0.50, (0.25, 0.10, 0.042)),
        (0.60, (0.38, 0.17, 0.075)),
        (0.72, (0.48, 0.27, 0.14)),
    ])
    streak = nb.fbm(nb.vmul(D1, (1.0, 1.0, 3.0)), scale=9.0, detail=8, rough=0.6)
    col = nb.cscale(col, nb.madd(streak, 0.45, 0.78))

    h = nb.value(0.0)
    rimsum = nb.value(0.0)
    floorsum = nb.value(0.0)
    for scale, dens, rmin, rmax, depth, seed in [
        (2.2, 0.35, 0.22, 0.46, 0.5, (0.1, 0.2, 0.3)),
        (5.5, 0.5, 0.15, 0.42, 0.45, (1.1, 0.4, 2.3)),
        (12.0, 0.55, 0.12, 0.4, 0.4, (3.1, 2.4, 0.3)),
        (26.0, 0.6, 0.1, 0.36, 0.35, (5.1, 1.4, 4.3)),
    ]:
        c = craters(nb, D1, scale, dens, rmin, rmax, depth, seed)
        h = nb.add(h, c['h'])
        rimsum = nb.add(rimsum, c['rim'])
        floorsum = nb.add(floorsum, nb.mul(c['floor'], 0.5))

    # great canyon system near the equator
    cn = nb.fbm(nb.vadd(D1, (8.0, 8.0, 8.0)), scale=1.6, detail=4, rough=0.45)
    canyon = nb.smoothstep(0.955, 0.99, nb.one_minus(nb.abs(nb.madd(cn, 2.0, -1.0))))
    canyon = nb.mul(canyon, nb.gauss(z, -0.08, 0.2))
    h = nb.sub(h, nb.mul(canyon, 0.02))

    # shield volcanoes
    vol = nb.voronoi(nb.vadd(D, (4.0, 4.0, 4.0)), scale=1.6, feature='F1', rand=1.0)
    vr, vg, _ = nb.sep_rgb(vol.outputs['Color'])
    cone = nb.mul(nb.one_minus(nb.smoothstep(0.0, 0.32, vol.outputs['Distance'])), nb.lt(vg, 0.3))
    caldera = nb.mul(nb.one_minus(nb.smoothstep(0.0, 0.03, vol.outputs['Distance'])), nb.lt(vg, 0.3))
    h = nb.add(h, nb.mul(nb.pow(cone, 1.6), 0.03))
    h = nb.sub(h, nb.mul(caldera, 0.01))

    col = nb.mixc(nb.clamp01(nb.mul(rimsum, 0.25)), col, nb.cscale(col, 1.35))
    col = nb.mixc(nb.clamp01(floorsum), col, nb.cscale(col, 0.8))
    col = nb.mixc(nb.mul(canyon, 0.7), col, (0.09, 0.04, 0.025))

    capn = nb.fbm(nb.vadd(D, (9.0, 1.0, 2.0)), scale=7.0, detail=6)
    cap = nb.smoothstep(0.955, 0.968, nb.add(alat, nb.mul(nb.sub(capn, 0.5), 0.06)))
    col = nb.mixc(cap, col, (0.78, 0.74, 0.7))
    rough = nb.value(0.95)
    spec = nb.value(0.0)
    emit = (0.0, 0.0, 0.0)
    return dict(color=col, rough=rough, height=h, emit=emit, spec=spec)


# --------------------------------------------------------------------------- GIANTS
# Gas/ice giants use flow-advected textures generated by gasgiant.py (numpy); the
# node group just samples them with the equirect mapping so render == bake == web.
def dir_to_uv(nb, D):
    x, y, z = nb.sep(D)
    lon = nb.math('ARCTAN2', nb.mul(y, -1.0), nb.mul(x, -1.0))
    u = nb.math('FRACT', nb.div(lon, math.tau))
    zc = nb.math('MINIMUM', nb.math('MAXIMUM', z, -1.0), 1.0)
    v = nb.add(nb.div(nb.math('ARCSINE', zc), math.pi), 0.5)
    return nb.comb(u, v, 0.0)


def image_tex(nb, uv, image_name):
    tex = nb.node('ShaderNodeTexImage', interpolation='Cubic', extension='REPEAT')
    tex.image = bpy.data.images[image_name]
    nb.set(tex.inputs['Vector'], uv)
    return tex


def giant(pid):
    def recipe(nb, D):
        uv = dir_to_uv(nb, D)
        col = image_tex(nb, uv, f'SRC_{pid}_color').outputs['Color']
        out = dict(color=col, rough=nb.value(1.0), height=nb.value(0.0), emit=(0, 0, 0),
                   spec=nb.value(0.0))
        if bpy.data.images.get(f'SRC_{pid}_clouds'):
            c = image_tex(nb, uv, f'SRC_{pid}_clouds').outputs['Color']
            out['clouds'] = nb.sep_rgb(c)[0]
        if bpy.data.images.get(f'SRC_{pid}_emissive'):
            out['emit'] = image_tex(nb, uv, f'SRC_{pid}_emissive').outputs['Color']
        return out
    return recipe


jovian = giant('jovian')
saturn = giant('saturn')
neptune = giant('neptune')


# --------------------------------------------------------------------------- GLACIER (Europa-like)
def glacier(nb, D):
    Dw = warp(nb, D, 0.3, 2.0, 3, (1.0, 5.0, 3.0))
    base = nb.fbm(Dw, scale=2.2, detail=10, rough=0.6)
    col = nb.ramp(base, [
        (0.30, (0.50, 0.40, 0.31)), (0.45, (0.66, 0.60, 0.53)),
        (0.58, (0.80, 0.80, 0.79)), (0.72, (0.70, 0.79, 0.86)),
    ])
    h = nb.value(0.0)
    linesum = nb.value(0.0)
    for scale, width, strength, seed in [
        (2.3, 0.018, 0.55, (0.3, 0.1, 0.7)),
        (5.0, 0.02, 0.45, (2.3, 1.1, 0.2)),
        (10.5, 0.025, 0.3, (4.4, 3.1, 1.2)),
        (22.0, 0.03, 0.22, (6.1, 0.3, 2.9)),
    ]:
        vw = warp(nb, D, 0.14, 3.0, 3, seed)
        vd = nb.voronoi(vw, scale=scale, feature='DISTANCE_TO_EDGE', rand=1.0).outputs['Distance']
        line = nb.one_minus(nb.smoothstep(0.0, width, vd))
        ridge = nb.gauss(vd, width * 0.55, width * 0.3)
        linesum = nb.max(linesum, nb.mul(line, strength))
        h = nb.add(h, nb.mul(ridge, 0.004 * strength / (scale ** 0.5)))
    # long ridged cracks
    for seed, sc, st in [((1.0, 2.0, 3.0), 1.1, 1.0), ((7.0, 3.0, 5.0), 1.5, 0.95),
                         ((2.0, 9.0, 4.0), 2.1, 0.85), ((5.0, 1.0, 8.0), 2.8, 0.75),
                         ((9.0, 6.0, 2.0), 3.6, 0.6)]:
        rn = nb.fbm(nb.vadd(warp(nb, D, 0.1, 3.0, 2, seed), seed), scale=sc, detail=2, rough=0.4)
        rr = nb.one_minus(nb.abs(nb.madd(rn, 2.0, -1.0)))
        cr = nb.smoothstep(0.978, 0.996, rr)
        linesum = nb.max(linesum, nb.mul(cr, st))
        h = nb.add(h, nb.mul(nb.smoothstep(0.97, 0.99, rr), 0.0012 * st))
    linecol = nb.ramp(base, [(0.3, (0.25, 0.11, 0.05)), (0.7, (0.42, 0.22, 0.11))])
    col = nb.mixc(nb.clamp01(linesum), col, linecol)
    # chaos terrain
    ch = nb.fbm(nb.vadd(D, (8.0, 8.0, 1.0)), scale=3.0, detail=6)
    chaos = nb.smoothstep(0.62, 0.66, ch)
    blocks = nb.voronoi(D, scale=60.0, feature='DISTANCE_TO_EDGE').outputs['Distance']
    chaoscol = nb.mixc(nb.smoothstep(0.02, 0.08, blocks), (0.3, 0.17, 0.09), (0.62, 0.55, 0.48))
    col = nb.mixc(chaos, col, chaoscol)
    h = nb.add(h, nb.mul(chaos, nb.mul(nb.smoothstep(0.0, 0.06, blocks), 0.002)))
    return dict(color=col, rough=nb.value(0.35), height=h, emit=(0, 0, 0), spec=nb.value(0.35))


# --------------------------------------------------------------------------- INFERNO (lava)
def inferno(nb, D):
    Dw = warp(nb, D, 0.22, 2.0, 3, (2.0, 2.0, 9.0))
    v1 = nb.voronoi(Dw, scale=3.6, feature='DISTANCE_TO_EDGE').outputs['Distance']
    v2 = nb.voronoi(warp(nb, D, 0.1, 5.0, 2, (1.0, 7.0, 3.0)), scale=10.0,
                    feature='DISTANCE_TO_EDGE').outputs['Distance']
    v3 = nb.voronoi(warp(nb, D, 0.05, 9.0, 2, (4.0, 1.0, 6.0)), scale=26.0,
                    feature='DISTANCE_TO_EDGE').outputs['Distance']
    crack1 = nb.one_minus(nb.smoothstep(0.0, 0.035, v1))
    crack2 = nb.one_minus(nb.smoothstep(0.0, 0.022, v2))
    crack3 = nb.one_minus(nb.smoothstep(0.0, 0.02, v3))
    seaN = nb.fbm(nb.vadd(Dw, (3.0, 3.0, 3.0)), scale=1.5, detail=6)
    sea = nb.smoothstep(0.585, 0.61, seaN)
    lakeN = nb.voronoi(D, scale=34.0, feature='DISTANCE_TO_EDGE').outputs['Distance']
    lake = nb.one_minus(nb.smoothstep(0.0, 0.1, lakeN))
    heat = nb.max(nb.mul(crack1, 1.0), nb.mul(crack2, 0.65))
    heat = nb.max(heat, nb.mul(crack3, 0.25))
    heat = nb.max(heat, nb.mul(sea, nb.madd(lake, 0.8, 0.14)))
    hn = nb.fbm(D, scale=12.0, detail=6)
    heat = nb.clamp01(nb.mul(heat, nb.madd(hn, 1.2, 0.35)))
    emit = nb.ramp(heat, [
        (0.00, (0.0, 0.0, 0.0)), (0.18, (0.12, 0.005, 0.0)), (0.40, (0.55, 0.05, 0.005)),
        (0.65, (1.0, 0.26, 0.02)), (0.85, (1.0, 0.56, 0.12)), (1.00, (1.0, 0.85, 0.45)),
    ])
    rockn = nb.fbm(nb.vadd(D, (5.0, 5.0, 5.0)), scale=9.0, detail=10, rough=0.6)
    col = nb.ramp(rockn, [
        (0.3, (0.03, 0.027, 0.025)), (0.5, (0.065, 0.056, 0.05)),
        (0.65, (0.11, 0.09, 0.075)), (0.8, (0.17, 0.13, 0.1)),
    ])
    col = nb.mixc(nb.smoothstep(0.1, 0.5, heat), col, (0.08, 0.02, 0.01))
    h = nb.mul(nb.one_minus(crack1), 0.006)
    h = nb.add(h, nb.mul(nb.one_minus(crack2), 0.003))
    h = nb.sub(h, nb.mul(sea, 0.006))
    h = nb.add(h, nb.mul(nb.sub(rockn, 0.5), 0.004))
    return dict(color=col, rough=nb.value(0.85), height=h, emit=emit, spec=nb.value(0.0))


# --------------------------------------------------------------------------- LUNA (cratered moon)
def luna(nb, D):
    Dw = warp(nb, D, 0.5, 1.1, 3, (6.0, 2.0, 4.0))
    mn = nb.fbm(Dw, scale=1.4, detail=5, rough=0.5)
    maria = nb.smoothstep(0.555, 0.585, mn)
    hn = nb.fbm(nb.vadd(D, (1.0, 1.0, 1.0)), scale=5.0, detail=10, rough=0.6)
    high = nb.ramp(hn, [(0.3, (0.14, 0.135, 0.13)), (0.7, (0.25, 0.24, 0.23))])
    mare = nb.ramp(hn, [(0.3, (0.045, 0.045, 0.047)), (0.7, (0.085, 0.082, 0.08))])
    col = nb.mixc(maria, high, mare)
    h = nb.mul(maria, -0.004)
    rimsum = nb.value(0.0)
    raysum = nb.value(0.0)
    for scale, dens, rmin, rmax, depth, seed in [
        (1.8, 0.3, 0.25, 0.48, 0.35, (0.4, 0.1, 0.9)),
        (4.5, 0.5, 0.15, 0.44, 0.45, (2.4, 1.3, 0.2)),
        (10.0, 0.6, 0.12, 0.42, 0.45, (4.2, 3.3, 1.1)),
        (21.0, 0.7, 0.1, 0.4, 0.4, (6.3, 0.5, 2.8)),
        (40.0, 0.7, 0.1, 0.36, 0.35, (8.8, 4.1, 3.6)),
    ]:
        c = craters(nb, D, scale, dens, rmin, rmax, depth, seed)
        h = nb.add(h, c['h'])
        rimsum = nb.add(rimsum, c['rim'])
        if scale in (4.5, 10.0):
            # rays for young craters: noise sampled by direction from the crater centre
            # Voronoi 'Position' is in input space (already divided by scale)
            o = nb.vnorm(nb.vsub(c['Ps'], c['vor'].outputs['Position']))
            rn = nb.fbm(o, scale=7.0, detail=3)
            young = nb.mul(c['present'], nb.gt(c['rnd'], 0.8))
            rays = nb.mul(nb.smoothstep(0.52, 0.72, rn), nb.one_minus(nb.smoothstep(1.0, 4.5, c['x'])))
            halo = nb.one_minus(nb.smoothstep(0.9, 1.8, c['x']))
            raysum = nb.add(raysum, nb.mul(young, nb.max(rays, nb.mul(halo, 0.8))))
    col = nb.mixc(nb.clamp01(nb.mul(rimsum, 0.2)), col, nb.cscale(col, 1.3))
    col = nb.mixc(nb.clamp01(nb.mul(raysum, 0.6)), col, (0.34, 0.33, 0.32))
    return dict(color=col, rough=nb.value(1.0), height=h, emit=(0, 0, 0), spec=nb.value(0.0))


RECIPES = dict(terra=terra, dune=dune, jovian=jovian, saturn=saturn, neptune=neptune,
               glacier=glacier, inferno=inferno, luna=luna)


# =========================================================================== shared weather
def cloud_cover(nb, D, seed, bias=0.0, mid=0.7, trop=0.3, stretch=1.9, extra=None):
    """Terra's cloud model, reseeded: coverage field (fronts, cyclones, zonal bands)
    thresholding a detailed billow/streak field. bias > 0 = cloudier.
    mid/trop = density of mid-latitude cyclones / tropical storms. `extra` adds to coverage."""
    x, y, z = nb.sep(D)
    alat = nb.abs(z)
    s = seed
    Dc = swirl(nb, D, scale=2.4, strength=2.3, sigma=0.32, density=mid, seed=(5.0 + s, 1.0, 2.0 + s),
               lat=(0.72, 0.16))
    Dc = swirl(nb, Dc, scale=7.0, strength=3.5, sigma=0.2, density=trop, seed=(1.5, 4.0 + s, 8.0),
               lat=(0.3, 0.08))
    Dz = nb.vmul(Dc, (1.0, 1.0, stretch))
    Dz = warp(nb, Dz, 0.6, 1.6, 5, (9.0 + s, 3.0, 6.0 - s))
    cb = nb.fbm(Dz, scale=1.9, detail=6, rough=0.55)
    latmod = nb.mul(nb.gauss(z, 0.0, 0.09), 0.1)
    latmod = nb.sub(latmod, nb.mul(nb.gauss(alat, 0.36, 0.12), 0.1))
    latmod = nb.add(latmod, nb.mul(nb.gauss(alat, 0.72, 0.13), 0.06))
    latmod = nb.add(latmod, bias)
    if extra is not None:
        latmod = nb.add(latmod, extra)
    cov = nb.maprange(nb.add(cb, latmod), 0.42, 0.74, 0.0, 1.0)
    Dd = warp(nb, nb.vmul(Dc, (1.0, 1.0, 2.2)), 0.18, 3.5, 4, (2.0, 7.0 + s, 1.0))
    pw = nb.fbm(Dd, scale=4.5, detail=12, rough=0.62)
    wor = nb.value(0.0)
    for sc, wt in [(16.0, 0.6), (36.0, 0.4)]:
        f1 = nb.voronoi(Dd, scale=sc, feature='F1', rand=1.0).outputs['Distance']
        wor = nb.add(wor, nb.mul(nb.one_minus(nb.clamp01(f1)), wt))
    det = nb.maprange(nb.add(nb.mul(pw, 0.82), nb.mul(wor, 0.18)), 0.33, 0.64, 0.0, 1.0)
    thr = nb.one_minus(cov)
    clouds = nb.maprange(det, nb.sub(thr, 0.2), nb.add(thr, 0.22), 0.0, 1.0)
    clouds = nb.mul(clouds, nb.madd(cov, 0.45, 0.55))
    wisp = nb.fbm(nb.vmul(Dc, (1.0, 1.0, 2.6)), scale=22.0, detail=8, rough=0.6)
    return nb.mul(clouds, nb.maprange(wisp, 0.3, 0.7, 0.5, 1.0))


def ridges(nb, D, scale, seed, sharp=5.0, detail=7):
    """Ridged noise 0..1 (1 on the crest)."""
    rn = nb.fbm(nb.vadd(D, seed), scale=scale, detail=detail, rough=0.5)
    return nb.pow(nb.one_minus(nb.abs(nb.madd(rn, 2.0, -1.0))), sharp)


def network(nb, D, scales, seed, width):
    """Branching channel network (rivers, canyons): union of warped Voronoi cell edges.
    Returns 0..1, 1 in the channel."""
    ch = nb.value(0.0)
    for i, (sc, wt) in enumerate(scales):
        sd = (seed[0] + i * 1.7, seed[1] - i * 0.9, seed[2] + i * 2.3)
        vw = warp(nb, warp(nb, D, 0.35 / sc ** 0.3, 2.0, 4, sd), 0.12, sc * 0.6, 3, (sd[1], sd[2], sd[0]))
        e = nb.voronoi(vw, scale=sc, feature='DISTANCE_TO_EDGE', rand=1.0).outputs['Distance']
        ch = nb.max(ch, nb.mul(nb.one_minus(nb.smoothstep(0.0, width / sc ** 0.15, e)), wt))
    return ch


# --------------------------------------------------------------------------- THALASSA (archipelago ocean)
def thalassa(nb, D):
    D1 = warp(nb, D, 0.5, 1.4, 3, (2.3, 7.1, 4.4))
    basin = nb.fbm(D1, scale=1.5, detail=8, rough=0.55)
    # volcanic hotspot chains: islands strung out along warped tracks
    Dt = warp(nb, D, 0.3, 2.2, 3, (9.1, 1.3, 2.2))
    track = ridges(nb, Dt, 2.3, (4.0, 1.0, 7.0), sharp=3.0, detail=3)
    isl = nb.fbm(nb.vadd(D1, (1.0, 5.0, 3.0)), scale=9.0, detail=12, rough=0.62)
    e = nb.add(nb.mul(nb.sub(basin, 0.5), 0.9), nb.mul(track, 0.5))
    e = nb.add(e, nb.mul(nb.sub(isl, 0.5), 1.1))
    elev = nb.sub(e, 0.56)
    # atolls: rings of reef around sunken volcanoes
    at = nb.voronoi(nb.vadd(D, (3.3, 3.3, 0.3)), scale=14.0, feature='F1', rand=1.0)
    ar, ag, _ = nb.sep_rgb(at.outputs['Color'])
    atoll_on = nb.mul(nb.lt(ag, 0.35), nb.smoothstep(0.05, 0.2, track))
    rw = nb.madd(ar, 0.12, 0.2)
    ring = nb.mul(nb.gauss(at.outputs['Distance'], rw, 0.035), atoll_on)
    land = nb.smoothstep(-0.002, 0.002, elev)
    land = nb.max(land, nb.smoothstep(0.55, 0.75, ring))
    lagoon = nb.mul(nb.one_minus(nb.smoothstep(0.0, rw, at.outputs['Distance'])), atoll_on)
    shallow = nb.max(nb.smoothstep(-0.16, -0.01, elev), lagoon)
    shallow = nb.max(shallow, nb.mul(ring, 0.9))
    fine = nb.fbm(nb.vadd(D1, (8.0, 2.0, 5.0)), scale=30.0, detail=8, rough=0.6)

    deep = nb.ramp(nb.clamp01(nb.mul(nb.sub(0.0, elev), 2.2)), [
        (0.0, (0.02, 0.12, 0.13)), (0.25, (0.006, 0.05, 0.075)), (0.6, (0.003, 0.022, 0.05)),
        (1.0, (0.002, 0.012, 0.035)),
    ])
    reef = nb.ramp(fine, [(0.3, (0.05, 0.26, 0.24)), (0.6, (0.12, 0.38, 0.33)), (0.8, (0.3, 0.5, 0.42))])
    sea = nb.mixc(nb.pow(shallow, 1.6), deep, reef)
    # milky plankton blooms swirled by currents
    Db = swirl(nb, D, scale=4.0, strength=3.0, sigma=0.3, density=0.6, seed=(2.0, 2.0, 9.0))
    bloom = nb.smoothstep(0.58, 0.72, nb.fbm(nb.vmul(Db, (1.0, 1.0, 2.0)), scale=6.0, detail=9, rough=0.6))
    bloom = nb.mul(bloom, nb.one_minus(shallow))
    sea = nb.mixc(nb.mul(bloom, 0.55), sea, (0.04, 0.2, 0.19))
    # islands: white sand rims, dark volcanic uplands under emerald-teal forest
    hgt = nb.clamp01(nb.mul(elev, 5.0))
    lcol = nb.ramp(hgt, [
        (0.0, (0.52, 0.47, 0.36)), (0.04, (0.3, 0.3, 0.18)), (0.1, (0.025, 0.08, 0.05)),
        (0.45, (0.015, 0.055, 0.035)), (0.75, (0.03, 0.04, 0.03)), (1.0, (0.07, 0.065, 0.06)),
    ])
    lcol = nb.cscale(lcol, nb.madd(fine, 0.5, 0.75))
    col = nb.mixc(land, sea, lcol)
    rough = nb.mixf(land, 0.3, 0.9)
    spec = nb.one_minus(land)
    height = nb.mul(nb.add(nb.mul(nb.max(elev, 0.0), 0.12), nb.mul(nb.sub(fine, 0.5), 0.002)), land)
    # bioluminescent plankton: the blooms glow cyan on the night side
    glow = nb.mul(bloom, nb.smoothstep(0.4, 0.8, nb.fbm(nb.vadd(D, (4.0, 4.0, 4.0)), scale=40.0, detail=4)))
    emit = nb.cscale((0.1, 0.9, 0.8), nb.mul(glow, 0.45))
    clouds = cloud_cover(nb, D, 3.0, bias=0.03, mid=0.55, trop=0.55, stretch=2.4)
    return dict(color=col, rough=rough, height=height, emit=emit, spec=spec, clouds=clouds)


# --------------------------------------------------------------------------- SYLVA (alien jungle)
def sylva(nb, D):
    x, y, z = nb.sep(D)
    alat = nb.abs(z)
    D1 = warp(nb, D, 0.7, 1.1, 4, (6.2, 2.5, 1.9))
    c = nb.fbm(D1, scale=1.1, detail=14, rough=0.57)
    elev = nb.sub(c, 0.47)
    landmask = nb.smoothstep(-0.0015, 0.0015, elev)
    mount = nb.mul(ridges(nb, D1, 2.8, (2.2, 8.8, 0.4)), nb.smoothstep(0.02, 0.1, elev))
    fine = nb.fbm(nb.vadd(D1, (3.1, 0.2, 7.7)), scale=28.0, detail=8, rough=0.62)
    rivers = network(nb, D1, [(7.0, 1.0), (16.0, 0.75), (34.0, 0.5)], (1.0, 4.0, 2.0), 0.035)
    rivers = nb.mul(nb.mul(rivers, nb.smoothstep(0.004, 0.02, elev)), nb.one_minus(nb.smoothstep(0.08, 0.14, elev)))
    wet = nb.fbm(nb.vadd(D1, (9.0, 9.0, 1.0)), scale=2.3, detail=7, rough=0.55)
    M = nb.clamp01(nb.madd(nb.sub(wet, 0.5), 2.4, 0.62))
    M = nb.clamp01(nb.add(M, nb.mul(rivers, 0.5)))
    # pigments tuned to a red-dwarf sky: crimson and violet canopies, amber grasslands
    flora = nb.ramp(M, [
        (0.00, (0.36, 0.22, 0.12)), (0.2, (0.3, 0.1, 0.035)), (0.38, (0.2, 0.035, 0.03)),
        (0.55, (0.12, 0.015, 0.035)), (0.75, (0.07, 0.01, 0.05)), (1.0, (0.04, 0.008, 0.045)),
    ])
    flora = nb.cscale(flora, nb.madd(fine, 0.55, 0.72))
    rock = nb.ramp(fine, [(0.3, (0.1, 0.08, 0.1)), (0.7, (0.2, 0.17, 0.2))])
    lcol = nb.mixc(nb.smoothstep(0.35, 0.8, mount), flora, rock)
    frost = nb.mul(nb.smoothstep(0.7, 0.95, mount), nb.smoothstep(0.55, 0.85, alat))
    lcol = nb.mixc(frost, lcol, (0.62, 0.58, 0.66))
    lcol = nb.mixc(nb.smoothstep(0.35, 0.8, rivers), lcol, (0.012, 0.03, 0.03))
    sea = nb.ramp(nb.clamp01(nb.mul(nb.sub(0.0, elev), 5.0)), [
        (0.0, (0.05, 0.08, 0.05)), (0.08, (0.012, 0.035, 0.03)), (0.4, (0.004, 0.018, 0.022)),
        (1.0, (0.003, 0.01, 0.018)),
    ])
    col = nb.mixc(landmask, sea, lcol)
    cap = nb.smoothstep(0.95, 0.975, nb.add(alat, nb.mul(nb.sub(fine, 0.5), 0.06)))
    col = nb.mixc(cap, col, (0.66, 0.62, 0.7))
    water = nb.max(nb.one_minus(landmask), nb.mul(landmask, nb.smoothstep(0.5, 0.9, rivers)))
    rough = nb.mixf(water, 0.9, 0.3)
    spec = nb.mul(water, nb.one_minus(cap))
    height = nb.add(nb.mul(nb.max(elev, 0.0), 0.05), nb.mul(mount, 0.014))
    height = nb.sub(height, nb.mul(rivers, 0.003))
    height = nb.mul(nb.add(height, nb.mul(nb.sub(fine, 0.5), 0.003)), landmask)
    clouds = cloud_cover(nb, D, 7.0, bias=-0.07, mid=0.6, trop=0.35, stretch=1.6)
    return dict(color=col, rough=rough, height=height, emit=(0, 0, 0), spec=spec, clouds=clouds)


# --------------------------------------------------------------------------- VEIL (Venus-like cloud world)
def veil(nb, D):
    x, y, z = nb.sep(D)
    alat = nb.abs(z)
    # super-rotating cloud tops: features sheared into sideways "Y" chevrons
    Dv = nb.rotate_z(D, nb.mul(nb.pow(alat, 0.8), 1.9))
    Dv = swirl(nb, Dv, scale=1.3, strength=4.0, sigma=0.35, density=1.0, seed=(0.0, 0.0, 0.0), lat=(0.97, 0.06))
    Dz = warp(nb, nb.vmul(Dv, (1.0, 1.0, 3.6)), 0.35, 2.0, 5, (3.0, 1.0, 4.0))
    band = nb.fbm(Dz, scale=2.0, detail=10, rough=0.6)
    streak = nb.fbm(warp(nb, nb.vmul(Dv, (1.0, 1.0, 7.0)), 0.12, 6.0, 3, (1.0, 8.0, 2.0)), scale=5.0, detail=10,
                    rough=0.62)
    cells = nb.voronoi(nb.vmul(Dv, (1.0, 1.0, 1.6)), scale=18.0, feature='SMOOTH_F1', smooth=0.6).outputs['Distance']
    conv = nb.mul(nb.gauss(z, 0.0, 0.35), nb.smoothstep(0.1, 0.5, cells))  # convective cells, sub-solar belt
    v = nb.add(nb.mul(band, 0.65), nb.mul(streak, 0.35))
    v = nb.add(v, nb.mul(nb.sub(conv, 0.3), 0.12))
    v = nb.add(v, nb.mul(nb.gauss(alat, 0.93, 0.07), 0.15))   # bright polar collar
    col = nb.ramp(v, [
        (0.3, (0.2, 0.12, 0.05)), (0.4, (0.36, 0.24, 0.1)), (0.48, (0.54, 0.42, 0.22)),
        (0.56, (0.66, 0.56, 0.34)), (0.66, (0.76, 0.7, 0.52)), (0.8, (0.84, 0.81, 0.7)),
    ])
    uvd = nb.smoothstep(0.55, 0.75, streak)     # dark UV-absorber streaks
    col = nb.mixc(nb.mul(uvd, 0.45), col, (0.22, 0.14, 0.07))
    # the hot surface glows dull red through thin spots in the deck (seen on the night side)
    thin = nb.smoothstep(0.35, 0.2, v)
    lava = nb.smoothstep(0.62, 0.8, nb.fbm(nb.vadd(D, (7.0, 3.0, 2.0)), scale=6.0, detail=6))
    emit = nb.cscale((0.9, 0.18, 0.04), nb.clamp01(nb.add(nb.mul(thin, 0.35), nb.mul(lava, 0.25))))
    return dict(color=col, rough=nb.value(1.0), height=nb.value(0.0), emit=emit, spec=nb.value(0.0))


# --------------------------------------------------------------------------- SULFURA (Io-like)
def sulfura(nb, D):
    x, y, z = nb.sep(D)
    alat = nb.abs(z)
    D1 = warp(nb, D, 0.35, 1.6, 4, (1.2, 3.4, 5.6))
    base = nb.fbm(D1, scale=2.4, detail=12, rough=0.6)
    col = nb.ramp(base, [
        (0.3, (0.45, 0.28, 0.08)), (0.42, (0.62, 0.5, 0.14)), (0.52, (0.7, 0.62, 0.26)),
        (0.6, (0.74, 0.7, 0.46)), (0.7, (0.62, 0.42, 0.14)), (0.8, (0.52, 0.2, 0.05)),
    ])
    frost = nb.smoothstep(0.6, 0.72, nb.fbm(nb.vadd(D1, (4.0, 0.0, 2.0)), scale=4.0, detail=9))
    col = nb.mixc(nb.mul(frost, 0.7), col, (0.72, 0.72, 0.64))
    col = nb.mixc(nb.mul(nb.smoothstep(0.55, 0.85, alat), 0.8), col, nb.cmul(col, (0.45, 0.32, 0.26)))
    h = nb.mul(nb.sub(base, 0.5), 0.004)
    emit = nb.value(0.0)
    # volcanic centres: black lava paterae, glowing lakes, red and pale plume rings
    for sc, dens, seed, glowk in [(3.0, 0.55, (0.3, 0.9, 0.1), 1.0), (7.5, 0.45, (2.2, 0.1, 3.3), 0.7),
                                  (16.0, 0.35, (5.5, 2.7, 1.1), 0.4)]:
        vd = nb.voronoi(warp(nb, nb.vadd(D, seed), 0.08, 5.0, 3, seed), scale=sc, feature='F1', rand=1.0)
        r, g, b = nb.sep_rgb(vd.outputs['Color'])
        on = nb.lt(g, dens)
        d = vd.outputs['Distance']
        ragged = nb.fbm(nb.vadd(D, seed), scale=sc * 5.0, detail=6)
        pat_r = nb.madd(r, 0.12, 0.07)
        dd = nb.add(d, nb.mul(nb.sub(ragged, 0.5), 0.1))
        patera = nb.mul(nb.one_minus(nb.smoothstep(pat_r, nb.add(pat_r, 0.03), dd)), on)
        col = nb.mixc(patera, col, nb.ramp(ragged, [(0.3, (0.02, 0.018, 0.016)), (0.7, (0.09, 0.06, 0.04))]))
        lake = nb.mul(patera, nb.smoothstep(0.55, 0.7, ragged))
        rim = nb.mul(nb.gauss(nb.div(d, pat_r), 1.0, 0.12), on)
        emit = nb.max(emit, nb.mul(nb.max(lake, nb.mul(rim, 0.6)), nb.mul(nb.gt(b, 0.35), glowk)))
        plume_r = nb.mul(pat_r, 3.2)
        plume = nb.mul(nb.gauss(nb.div(d, plume_r), 1.0, nb.madd(ragged, 0.25, 0.12)), nb.mul(on, nb.lt(b, 0.5)))
        col = nb.mixc(nb.mul(plume, 0.8), col, nb.mixc(nb.gt(r, 0.5), (0.5, 0.1, 0.03), (0.75, 0.72, 0.62)))
        h = nb.sub(h, nb.mul(patera, 0.003))
    # a few isolated block mountains
    mt = nb.mul(ridges(nb, D1, 3.5, (3.0, 3.0, 3.0), sharp=8.0),
                nb.smoothstep(0.62, 0.7, nb.fbm(nb.vadd(D, (8.0, 1.0, 8.0)), scale=3.0, detail=3)))
    h = nb.add(h, nb.mul(mt, 0.02))
    col = nb.mixc(nb.mul(mt, 0.4), col, (0.38, 0.28, 0.16))
    emit = nb.ramp(nb.clamp01(emit), [(0.0, (0.0, 0.0, 0.0)), (0.3, (0.5, 0.06, 0.0)), (0.7, (1.0, 0.35, 0.03)),
                                      (1.0, (1.0, 0.75, 0.3))])
    return dict(color=col, rough=nb.value(0.9), height=h, emit=emit, spec=nb.value(0.0))


# --------------------------------------------------------------------------- THOLOS (Pluto-like)
def tholos(nb, D):
    x, y, z = nb.sep(D)
    D1 = warp(nb, D, 0.4, 1.4, 4, (7.0, 2.0, 4.0))
    hn = nb.fbm(D1, scale=2.6, detail=12, rough=0.6)
    # tholin-stained highlands, dark equatorial belt
    col = nb.ramp(hn, [
        (0.3, (0.07, 0.03, 0.018)), (0.45, (0.16, 0.07, 0.035)), (0.55, (0.3, 0.17, 0.09)),
        (0.65, (0.46, 0.34, 0.22)), (0.75, (0.6, 0.52, 0.42)),
    ])
    col = nb.mixc(nb.mul(nb.gauss(z, -0.05, 0.22), 0.55), col, nb.cmul(col, (0.5, 0.32, 0.25)))
    h = nb.mul(nb.sub(hn, 0.5), 0.01)
    for scale, dens, rmin, rmax, depth, seed in [
        (3.0, 0.4, 0.2, 0.45, 0.4, (0.5, 0.2, 0.8)), (8.0, 0.5, 0.14, 0.4, 0.4, (2.1, 1.3, 0.4)),
        (18.0, 0.55, 0.1, 0.36, 0.35, (4.4, 0.7, 2.2)),
    ]:
        c = craters(nb, D1, scale, dens, rmin, rmax, depth, seed)
        h = nb.add(h, c['h'])
        col = nb.mixc(nb.clamp01(nb.mul(c['rim'], 0.3)), col, nb.cscale(col, 1.5))
        col = nb.mixc(nb.mul(c['floor'], 0.45), col, nb.cscale(col, 0.55))
    grain = nb.fbm(nb.vadd(D1, (2.0, 9.0, 4.0)), scale=34.0, detail=8, rough=0.62)
    col = nb.cscale(col, nb.madd(grain, 0.5, 0.75))
    h = nb.add(h, nb.mul(nb.sub(grain, 0.5), 0.003))
    # the great nitrogen-ice plain: a lobed basin of smooth, bright ice
    H = unit_dir(22.0, 180.0)
    H2 = unit_dir(0.0, 200.0)
    edge = nb.mul(nb.sub(nb.fbm(nb.vadd(D, (3.0, 5.0, 1.0)), scale=5.0, detail=6), 0.5), 0.25)
    lobe = nb.max(nb.smoothstep(0.78, 0.84, nb.add(nb.vdot(D, H), edge)),
                  nb.smoothstep(0.86, 0.9, nb.add(nb.vdot(D, H2), edge)))
    cells = nb.voronoi(warp(nb, D, 0.05, 20.0, 2, (1.0, 1.0, 1.0)), scale=26.0,
                       feature='DISTANCE_TO_EDGE').outputs['Distance']
    trough = nb.one_minus(nb.smoothstep(0.0, 0.05, cells))
    ice = nb.ramp(nb.fbm(nb.vadd(D, (6.0, 6.0, 0.0)), scale=12.0, detail=6),
                  [(0.3, (0.62, 0.6, 0.56)), (0.7, (0.8, 0.76, 0.7))])
    ice = nb.mixc(nb.mul(trough, 0.55), ice, (0.36, 0.3, 0.26))
    col = nb.mixc(lobe, col, ice)
    h = nb.mixf(lobe, h, nb.sub(nb.mul(trough, -0.0015), 0.004))
    # blocky water-ice mountains along the western shore; bladed terrain to the east
    shore = nb.mul(nb.gauss(nb.vdot(D, H), 0.74, 0.05), nb.gt(nb.vdot(D, unit_dir(10.0, 140.0)), 0.6))
    blocks = nb.mul(ridges(nb, D, 9.0, (5.0, 5.0, 1.0), sharp=6.0), shore)
    h = nb.add(h, nb.mul(blocks, 0.03))
    col = nb.mixc(nb.smoothstep(0.1, 0.4, blocks), col, (0.52, 0.52, 0.55))
    blades = nb.mul(nb.smoothstep(0.6, 0.9, nb.fbm(nb.vmul(D, (1.0, 1.0, 14.0)), scale=12.0, detail=4)),
                    nb.gt(nb.vdot(D, unit_dir(15.0, 250.0)), 0.8))
    h = nb.add(h, nb.mul(blades, 0.004))
    col = nb.mixc(nb.mul(blades, 0.35), col, (0.55, 0.48, 0.42))
    return dict(color=col, rough=nb.value(0.95), height=h, emit=(0, 0, 0), spec=nb.value(0.0))


# --------------------------------------------------------------------------- HALITE (salt flats & brine lakes)
def halite(nb, D):
    x, y, z = nb.sep(D)
    D1 = warp(nb, D, 0.5, 1.3, 4, (4.4, 1.1, 8.8))
    e = nb.fbm(D1, scale=1.6, detail=12, rough=0.58)
    fine = nb.fbm(nb.vadd(D1, (2.0, 6.0, 1.0)), scale=24.0, detail=8, rough=0.6)
    desert = nb.ramp(nb.fbm(nb.vadd(D1, (1.0, 1.0, 9.0)), scale=4.0, detail=8), [
        (0.3, (0.38, 0.24, 0.16)), (0.5, (0.52, 0.38, 0.26)), (0.7, (0.62, 0.5, 0.38)),
    ])
    # dune seas: long parallel crests
    crest = nb.sin(nb.add(nb.mul(x, 70.0), nb.mul(nb.fbm(D1, scale=3.0, detail=4), 25.0)))
    dunes = nb.mul(nb.madd(crest, 0.5, 0.5),
                   nb.smoothstep(0.55, 0.6, nb.fbm(nb.vadd(D, (5.0, 0.0, 5.0)), scale=2.2, detail=4)))
    desert = nb.mixc(nb.mul(dunes, 0.25), desert, (0.7, 0.52, 0.32))
    # salt pans in the lowlands, cracked into polygons
    pan = nb.smoothstep(0.47, 0.44, e)
    poly = nb.voronoi(warp(nb, D, 0.02, 30.0, 2, (1.0, 2.0, 3.0)), scale=70.0,
                      feature='DISTANCE_TO_EDGE').outputs['Distance']
    crack = nb.one_minus(nb.smoothstep(0.0, 0.06, poly))
    salt = nb.ramp(fine, [(0.3, (0.7, 0.66, 0.64)), (0.7, (0.82, 0.8, 0.78))])
    salt = nb.mixc(nb.mul(crack, 0.6), salt, (0.42, 0.36, 0.33))
    col = nb.mixc(pan, desert, salt)
    # brine lakes in the deepest pans: carmine (halophile blooms) or copper-green
    lake = nb.smoothstep(0.405, 0.395, e)
    kind = nb.fbm(nb.vadd(D, (9.0, 2.0, 2.0)), scale=2.0, detail=2)
    depth = nb.clamp01(nb.mul(nb.sub(0.405, e), 12.0))
    pink = nb.ramp(depth, [(0.0, (0.62, 0.22, 0.3)), (0.4, (0.42, 0.05, 0.12)), (1.0, (0.2, 0.02, 0.07))])
    green = nb.ramp(depth, [(0.0, (0.3, 0.5, 0.4)), (0.5, (0.05, 0.25, 0.22)), (1.0, (0.02, 0.1, 0.12))])
    brine = nb.mixc(nb.smoothstep(0.45, 0.55, kind), pink, green)
    # evaporite rings around each lake: yellow, orange, white
    rings = nb.ramp(nb.maprange(e, 0.395, 0.44, 0.0, 1.0), [
        (0.0, (0.8, 0.62, 0.2)), (0.2, (0.72, 0.36, 0.1)), (0.45, (0.85, 0.8, 0.7)), (1.0, (0.78, 0.74, 0.7)),
    ])
    col = nb.mixc(nb.mul(nb.smoothstep(0.44, 0.41, e), nb.one_minus(lake)), col, rings)
    col = nb.mixc(lake, col, brine)
    # dark mountain ranges
    mt = nb.mul(ridges(nb, D1, 2.6, (3.0, 7.0, 1.0)), nb.smoothstep(0.55, 0.65, e))
    col = nb.mixc(nb.smoothstep(0.1, 0.6, mt), col, nb.cscale((0.2, 0.14, 0.12), nb.madd(fine, 0.6, 0.7)))
    col = nb.cscale(col, nb.madd(fine, 0.2, 0.9))
    h = nb.add(nb.mul(nb.max(nb.sub(e, 0.44), 0.0), 0.06), nb.mul(mt, 0.02))
    h = nb.sub(h, nb.mul(crack, nb.mul(pan, 0.0006)))
    h = nb.add(h, nb.mul(dunes, 0.0015))
    rough = nb.mixf(lake, 0.85, 0.2)
    clouds = nb.mul(cloud_cover(nb, D, 11.0, bias=-0.12, mid=0.4, trop=0.1, stretch=3.0), 0.8)
    return dict(color=col, rough=rough, height=h, emit=(0, 0, 0), spec=lake, clouds=clouds)


# --------------------------------------------------------------------------- JANUS (tidally locked eyeball)
JANUS_NOON = unit_dir(0.0, 0.0)   # the sub-stellar point (u = 0); the web app keeps it facing the star


def janus(nb, D):
    D1 = warp(nb, D, 0.45, 1.5, 4, (2.0, 9.0, 3.0))
    s = nb.vdot(D, JANUS_NOON)
    s = nb.add(s, nb.mul(nb.sub(nb.fbm(D1, scale=2.5, detail=8), 0.5), 0.35))
    fine = nb.fbm(nb.vadd(D1, (7.0, 1.0, 3.0)), scale=26.0, detail=8, rough=0.6)
    e = nb.sub(nb.fbm(nb.vadd(D1, (1.0, 1.0, 1.0)), scale=1.8, detail=12, rough=0.56), 0.5)
    # day side: scorched rock, dust and glassy black lava plains
    scorch = nb.ramp(nb.fbm(nb.vadd(D1, (5.0, 5.0, 5.0)), scale=5.0, detail=9), [
        (0.3, (0.05, 0.035, 0.03)), (0.45, (0.28, 0.15, 0.07)), (0.6, (0.46, 0.3, 0.16)), (0.75, (0.58, 0.44, 0.28)),
    ])
    # twilight ring: shallow seas and a band of hardy amber-olive life
    ring_land = nb.ramp(nb.clamp01(nb.madd(e, 4.0, 0.3)), [
        (0.0, (0.28, 0.22, 0.12)), (0.35, (0.14, 0.12, 0.03)), (0.7, (0.07, 0.06, 0.02)), (1.0, (0.18, 0.16, 0.14)),
    ])
    ocean = nb.ramp(nb.clamp01(nb.mul(nb.sub(0.0, e), 5.0)), [
        (0.0, (0.03, 0.08, 0.1)), (0.2, (0.008, 0.028, 0.06)), (1.0, (0.003, 0.01, 0.035))])
    land = nb.smoothstep(-0.03, -0.024, e)
    twilight = nb.mixc(land, ocean, ring_land)
    # night side: a continental ice sheet with crevasse fields
    cv = nb.voronoi(warp(nb, D, 0.05, 12.0, 2, (4.0, 4.0, 4.0)), scale=45.0, feature='DISTANCE_TO_EDGE')
    crev = nb.one_minus(nb.smoothstep(0.0, 0.05, cv.outputs['Distance']))
    sastrugi = nb.fbm(warp(nb, nb.vmul(D, (1.0, 6.0, 1.0)), 0.1, 3.0, 2, (1.0, 3.0, 5.0)), scale=10.0, detail=8)
    ice = nb.ramp(nb.add(nb.mul(fine, 0.5), nb.mul(sastrugi, 0.5)),
                  [(0.3, (0.46, 0.53, 0.62)), (0.5, (0.66, 0.71, 0.78)), (0.7, (0.8, 0.83, 0.88))])
    ice = nb.mixc(nb.mul(crev, 0.55), ice, (0.28, 0.38, 0.52))
    col = nb.mixc(nb.smoothstep(0.05, 0.25, s), twilight, scorch)
    col = nb.mixc(nb.smoothstep(-0.12, -0.3, s), col, ice)
    col = nb.cscale(col, nb.madd(fine, 0.35, 0.83))
    band = nb.mul(nb.smoothstep(-0.3, -0.12, s), nb.smoothstep(0.25, 0.05, s))
    water = nb.mul(nb.one_minus(land), band)
    lava = nb.mul(nb.smoothstep(0.9, 1.0, s), nb.smoothstep(0.55, 0.7, fine))
    emit = nb.cscale((1.0, 0.35, 0.05), nb.mul(lava, 0.6))
    h = nb.add(nb.mul(nb.max(e, 0.0), 0.05), nb.mul(nb.sub(fine, 0.5), 0.003))
    h = nb.mixf(water, h, 0.0)
    # a towering convective cloud cap over the sub-stellar point, streaks along the terminator
    capc = nb.mul(nb.smoothstep(0.45, 0.85, s), 0.35)
    clouds = cloud_cover(nb, D, 13.0, bias=-0.1, mid=0.3, trop=0.2, stretch=1.3, extra=capc)
    return dict(color=col, rough=nb.mixf(water, 0.9, 0.3), height=h, emit=emit, spec=water, clouds=clouds)


# --------------------------------------------------------------------------- PRISMA (crystal world)
def prisma(nb, D):
    col = None
    h = nb.value(0.0)
    glow = nb.value(0.0)
    fac = nb.value(0.0)
    for sc, seed, wt in [(5.0, (0.2, 0.7, 0.3), 1.0), (13.0, (3.1, 0.4, 2.2), 0.6), (32.0, (1.4, 5.2, 0.9), 0.35)]:
        vw = warp(nb, nb.vadd(D, seed), 0.04, 4.0, 2, seed)
        f1 = nb.voronoi(vw, scale=sc, feature='F1', rand=1.0)
        edge = nb.voronoi(vw, scale=sc, feature='DISTANCE_TO_EDGE', rand=1.0).outputs['Distance']
        r, g, b = nb.sep_rgb(f1.outputs['Color'])
        plate = nb.ramp(r, [
            (0.0, (0.05, 0.1, 0.35)), (0.25, (0.2, 0.08, 0.42)), (0.45, (0.04, 0.3, 0.42)),
            (0.65, (0.34, 0.28, 0.6)), (0.85, (0.52, 0.6, 0.78)), (1.0, (0.1, 0.18, 0.5)),
        ])
        # each crystal is a low pyramid: faceted height from the distance to its seed
        pyr = nb.mul(nb.one_minus(nb.clamp01(nb.mul(f1.outputs['Distance'], 1.6))), 0.01 * wt / sc ** 0.3)
        seam = nb.one_minus(nb.smoothstep(0.0, 0.05, edge))
        col = plate if col is None else nb.mixc(nb.mul(nb.lt(g, 0.45), 0.55 * wt), col, plate)
        h = nb.add(h, nb.mul(pyr, nb.one_minus(nb.mul(seam, 0.7))))
        glow = nb.max(glow, nb.mul(seam, wt * 0.9))
        fac = nb.add(fac, nb.mul(nb.madd(b, 0.6, 0.4), wt))
    col = nb.cscale(col, nb.maprange(fac, 0.4, 1.9, 0.55, 1.25))
    # frost plains drifting over the crystals
    frost = nb.smoothstep(0.58, 0.7, nb.fbm(warp(nb, D, 0.4, 1.5, 3, (8.0, 1.0, 1.0)), scale=2.2, detail=10,
                                            rough=0.6))
    col = nb.mixc(nb.mul(frost, 0.85), col, (0.72, 0.72, 0.84))
    glow = nb.mul(glow, nb.one_minus(frost))
    col = nb.mixc(nb.mul(glow, 0.8), col, (0.02, 0.05, 0.08))
    hue = nb.fbm(nb.vadd(D, (2.0, 2.0, 2.0)), scale=3.0, detail=3)
    emit = nb.cscale(nb.mixc(nb.smoothstep(0.45, 0.6, hue), (0.1, 0.85, 1.0), (0.75, 0.3, 1.0)), nb.pow(glow, 1.5))
    h = nb.sub(h, nb.mul(glow, 0.004))
    spec = nb.mul(nb.one_minus(frost), nb.one_minus(glow))
    return dict(color=col, rough=nb.value(0.25), height=h, emit=emit, spec=spec)


# --------------------------------------------------------------------------- MESA (layered canyonlands)
def mesa(nb, D):
    x, y, z = nb.sep(D)
    alat = nb.abs(z)
    D1 = warp(nb, D, 0.45, 1.3, 4, (5.0, 3.0, 8.0))
    e = nb.fbm(D1, scale=1.9, detail=12, rough=0.58)
    fine = nb.fbm(nb.vadd(D1, (0.7, 7.0, 2.0)), scale=30.0, detail=8, rough=0.62)
    canyon = network(nb, D1, [(2.2, 1.0), (5.0, 0.8), (11.0, 0.55)], (2.0, 6.0, 4.0), 0.16)
    canyon = nb.mul(canyon, nb.smoothstep(0.35, 0.5, nb.fbm(nb.vadd(D, (3.0, 1.0, 6.0)), scale=2.5, detail=3)))
    cut = nb.mul(nb.pow(canyon, 1.5), 0.32)
    # plateau provinces: each terrace level is capped by a different rock
    es = nb.fbm(D1, scale=1.9, detail=3, rough=0.5)
    lvl = nb.mul(es, 6.0)
    frac = nb.math('FRACT', lvl)
    plateau = nb.ramp(nb.div(nb.math('FLOOR', lvl), 6.0), [
        (0.0, (0.24, 0.1, 0.06)), (0.3, (0.44, 0.15, 0.07)), (0.45, (0.6, 0.34, 0.18)),
        (0.58, (0.7, 0.6, 0.46)), (0.72, (0.2, 0.13, 0.1)), (0.88, (0.74, 0.7, 0.64)),
    ], interp='CONSTANT')
    scarp = nb.one_minus(nb.smoothstep(0.0, 0.06, frac))       # dark cliff lines at each step
    plateau = nb.mixc(nb.mul(scarp, 0.6), plateau, (0.2, 0.08, 0.05))
    # canyon walls: layered strata run parallel to the canyon edge
    wob = nb.mul(nb.sub(nb.fbm(nb.vadd(D, (4.0, 4.0, 4.0)), scale=9.0, detail=4), 0.5), 0.12)
    strata = nb.math('FRACT', nb.add(nb.mul(canyon, 5.0), wob))
    walls = nb.ramp(strata, [
        (0.0, (0.72, 0.62, 0.48)), (0.16, (0.6, 0.32, 0.17)), (0.3, (0.4, 0.14, 0.07)), (0.46, (0.74, 0.66, 0.54)),
        (0.6, (0.52, 0.22, 0.1)), (0.76, (0.28, 0.09, 0.05)), (0.9, (0.64, 0.42, 0.28)), (1.0, (0.72, 0.62, 0.48)),
    ])
    col = nb.mixc(nb.smoothstep(0.25, 0.55, canyon), plateau, walls)
    col = nb.cscale(col, nb.madd(fine, 0.45, 0.78))
    floor = nb.smoothstep(0.85, 0.97, canyon)
    col = nb.mixc(nb.mul(floor, 0.7), col, (0.2, 0.07, 0.04))
    river = nb.smoothstep(0.975, 0.995, canyon)
    river = nb.mul(river, nb.smoothstep(0.45, 0.55, nb.fbm(nb.vadd(D, (1.0, 8.0, 1.0)), scale=1.5, detail=2)))
    col = nb.mixc(nb.mul(river, 0.8), col, (0.03, 0.045, 0.04))
    cap = nb.smoothstep(0.965, 0.985, nb.add(alat, nb.mul(nb.sub(fine, 0.5), 0.05)))
    col = nb.mixc(cap, col, (0.72, 0.66, 0.62))
    # terraced relief matching the plateau provinces, cut by the canyons
    terr = nb.div(nb.add(nb.math('FLOOR', lvl), nb.smoothstep(0.9, 1.0, frac)), 6.0)
    h = nb.add(nb.mul(nb.sub(terr, cut), 0.06), nb.mul(nb.sub(e, 0.5), 0.01))
    h = nb.add(h, nb.mul(nb.sub(fine, 0.5), 0.002))
    return dict(color=col, rough=nb.mixf(river, 0.95, 0.3), height=h, emit=(0, 0, 0), spec=river)


# --------------------------------------------------------------------------- new giants
pyra = giant('pyra')
viridis = giant('viridis')
amethyst = giant('amethyst')
cyane = giant('cyane')

RECIPES.update(thalassa=thalassa, sylva=sylva, veil=veil, sulfura=sulfura, tholos=tholos, halite=halite,
               janus=janus, prisma=prisma, mesa=mesa, pyra=pyra, viridis=viridis, amethyst=amethyst, cyane=cyane)
