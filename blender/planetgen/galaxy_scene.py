"""The full course galaxy as a Blender scene.

Mirrors the web app exactly: the spiral galaxy particles and the planet orbits are
produced by 1:1 Python ports of the seeded generators in web/src/backdrop.js and
web/src/store.js, so the Blender render and the browser show the same galaxy.
Web space is Y-up; Blender is Z-up: blender(x, y, z) = web(x, -z, y).
"""
import bpy
import math
import numpy as np
from mathutils import Matrix, Vector, Euler

from . import build as B

TAU = math.tau
GOLDEN = math.pi * (3 - math.sqrt(5))
ORBIT_START = 30.0
ORBIT_GAP = 10.5
TYPE_RADIUS = dict(terra=1.0, dune=0.82, jovian=2.0, saturn=1.55, glacier=0.72,
                   inferno=0.9, neptune=1.45, luna=0.58)
SIZE_SCALE = dict(s=0.8, m=1.0, l=1.25)

STYLES = {
    'andromeda': dict(core=(1.0, 0.76, 0.5), arm=(0.5, 0.64, 1.0), young=(0.78, 0.86, 1.0),
                      hii=(1.0, 0.36, 0.62), old=(1.0, 0.84, 0.66), arms=2, pitch=0.23,
                      glow=(1.0, 0.72, 0.46)),
    'orion': dict(core=(1.0, 0.86, 0.6), arm=(0.36, 0.86, 0.95), young=(0.7, 1.0, 0.96),
                  hii=(1.0, 0.56, 0.26), old=(1.0, 0.9, 0.7), arms=3, pitch=0.28,
                  glow=(1.0, 0.84, 0.56)),
    'ember': dict(core=(1.0, 0.62, 0.4), arm=(1.0, 0.5, 0.42), young=(1.0, 0.78, 0.7),
                  hii=(1.0, 0.3, 0.36), old=(1.0, 0.78, 0.6), arms=4, pitch=0.2,
                  glow=(1.0, 0.56, 0.36)),
}

# The demo galaxy from web/src/store.js (title, type, size)
DEMO_COURSES = [
    ('Foundations of Programming', 'terra', 'm'), ('Data Structures', 'dune', 'm'),
    ('Algorithms', 'jovian', 'l'), ('Databases', 'glacier', 'm'), ('System Design', 'saturn', 'l'),
    ('Security', 'inferno', 'm'), ('Machine Learning', 'neptune', 'l'), ('Capstone Project', 'luna', 'm'),
]


# ------------------------------------------------------------------ seeded RNG (JS parity)
def mulberry32(seed):
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & 0xFFFFFFFF

    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t = t ^ ((t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    return rnd


def gauss(rnd):
    u = 0.0
    while u == 0.0:
        u = rnd()
    return math.sqrt(-2.0 * math.log(u)) * math.cos(TAU * rnd())


def orbit_for_slot(slot, seed):
    rnd = mulberry32(seed * 7919 + slot * 104729)
    radius = ORBIT_START + slot * ORBIT_GAP + (rnd() - 0.5) * 2.0
    period = 600 * (radius / ORBIT_START) ** 1.5
    return dict(slot=slot, radius=radius, angle0=slot * GOLDEN * 2.1 + rnd() * 0.6,
                speed=TAU / period, incl=(rnd() - 0.5) * 5, tilt=5 + rnd() * 22,
                tiltYaw=rnd() * TAU, spin0=rnd() * TAU, spinSpeed=0.02 + rnd() * 0.03)


def web_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def planet_position_web(o, t):
    a = o['angle0'] + o['speed'] * t
    inc = math.radians(o['incl'])
    return (math.cos(a) * o['radius'], math.sin(a) * o['radius'] * math.sin(inc),
            math.sin(a) * o['radius'] * math.cos(inc))


# ------------------------------------------------------------------ galaxy particles
def galaxy_particles(style='andromeda', seed=7, count=110000, t=0.0):
    """Port of GalaxyBackdrop._buildStars/_buildDust + disc rotation. Returns
    (positions Nx3 blender space, colours Nx3, sizes N)."""
    S = STYLES[style]
    rnd = mulberry32(seed * 9301 + 49297)
    arms = S['arms']
    k = 1.0 / math.tan(S['pitch'])
    r_max = 330
    R = np.zeros(count)
    TH = np.zeros(count)
    Y = np.zeros(count)
    SZ = np.zeros(count)
    COL = np.zeros((count, 3))
    hii_c = None
    hii_left = 0
    for i in range(count):
        p = rnd()
        if p < 0.24:
            r = abs(gauss(rnd)) * 3.8 + abs(gauss(rnd)) * 1.6
            th = rnd() * TAU
            y = gauss(rnd) * (1.0 + r * 0.3)
            size = 0.35 + rnd() * 0.7
            b = 0.35 + rnd() * 1.3 * math.exp(-r / 4)
            col = S['core']
        elif p < 0.8:
            arm = math.floor(rnd() * arms)
            while True:
                r = 55 + -math.log(1 - rnd() * 0.995) * 85
                if not (r > r_max or (r < 110 and rnd() > (r - 40) / 70)):
                    break
            spread = gauss(rnd) * (0.16 + 12 / r)
            th = arm * (TAU / arms) + math.log(r / 40) * k + spread
            y = gauss(rnd) * (0.8 + r * 0.008)
            q = rnd()
            if hii_left > 0 or q < 0.004:
                if hii_left <= 0:
                    hii_c = (r, th)
                    hii_left = 20 + math.floor(rnd() * 40)
                hii_left -= 1
                r = hii_c[0] + gauss(rnd) * 2.2
                th = hii_c[1] + gauss(rnd) * (2.2 / hii_c[0])
                col = S['hii']
                size = 1.2 + rnd() * 2.5
                b = 0.5 + rnd() * 1.1
            else:
                young = rnd() < 0.45
                col = S['young'] if young else S['arm']
                size = 0.7 + rnd() ** 3 * 3.2
                b = (0.18 + rnd() ** 2.5 * 1.6) * (1.1 if young else 0.8)
        elif p < 0.97:
            while True:
                r = 60 + -math.log(1 - rnd() * 0.99) * 95
                if not (r > r_max or (r < 125 and rnd() > (r - 50) / 75)):
                    break
            th = rnd() * TAU
            y = gauss(rnd) * (1.2 + r * 0.012)
            col = S['old']
            size = 0.6 + rnd() * 1.4
            b = 0.08 + rnd() ** 3 * 0.6
        else:
            r = 60 + rnd() * 380
            th = rnd() * TAU
            y = gauss(rnd) * 90
            col = S['old']
            size = 0.6 + rnd()
            b = 0.1 + rnd() * 0.3
        R[i], TH[i], Y[i], SZ[i] = r, th, y, size
        jitter = 0.85 + rnd() * 0.3
        COL[i] = (col[0] * b * jitter, col[1] * b, col[2] * b * (2 - jitter))
    # dust lanes (consumed for RNG parity; not rendered here)
    n_dust = round(count * 0.14)
    for _ in range(n_dust):
        math.floor(rnd() * arms)
        while True:
            r = 70 + -math.log(1 - rnd() * 0.99) * 70
            if not r > 300:
                break
        gauss(rnd)
        gauss(rnd)
        rnd()
    ex = 0.62 + (rnd() - 0.5) * 0.2
    ey = rnd() * TAU
    ez = 0.18 + (rnd() - 0.5) * 0.2
    # three.js Euler order 'YXZ' => M = Ry * Rx * Rz (web space)
    M = (Matrix.Rotation(ey, 3, 'Y') @ Matrix.Rotation(ex, 3, 'X') @ Matrix.Rotation(ez, 3, 'Z'))
    ang = TH + t * 0.012 / (1 + R / 45)
    local = np.stack([np.cos(ang) * R, Y, np.sin(ang) * R], axis=1)
    Mn = np.array(M)
    web = local @ Mn.T
    pos = np.stack([web[:, 0], -web[:, 2], web[:, 1]], axis=1)
    return pos, COL, SZ


# ------------------------------------------------------------------ scene pieces
def _points_object(name, pos, col, radius, coll, material):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(pos))
    me.vertices.foreach_set('co', pos.astype(np.float32).ravel())
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    rgba = np.ones((len(pos), 4), dtype=np.float32)
    rgba[:, :3] = col
    ca.data.foreach_set('color', rgba.ravel())
    ra = me.attributes.new('radius', 'FLOAT', 'POINT')
    ra.data.foreach_set('value', radius.astype(np.float32))
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    # geometry nodes: mesh -> points (rendered as spheres by Cycles)
    ng = bpy.data.node_groups.get('GN_MeshToStars')
    if ng is None:
        ng = bpy.data.node_groups.new('GN_MeshToStars', 'GeometryNodeTree')
        ng.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
        ng.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        gi = ng.nodes.new('NodeGroupInput')
        go = ng.nodes.new('NodeGroupOutput')
        m2p = ng.nodes.new('GeometryNodeMeshToPoints')
        rad = ng.nodes.new('GeometryNodeInputNamedAttribute')
        rad.data_type = 'FLOAT'
        rad.inputs['Name'].default_value = 'radius'
        setm = ng.nodes.new('GeometryNodeSetMaterial')
        ng.links.new(gi.outputs[0], m2p.inputs['Mesh'])
        ng.links.new(rad.outputs['Attribute'], m2p.inputs['Radius'])
        ng.links.new(m2p.outputs['Points'], setm.inputs['Geometry'])
        ng.links.new(setm.outputs['Geometry'], go.inputs[0])
    mod = ob.modifiers.new('Stars', 'NODES')
    mod.node_group = ng
    ob.data.materials.append(material)
    # the Set Material node needs the material too
    for n in ng.nodes:
        if n.bl_idname == 'GeometryNodeSetMaterial':
            n.inputs['Material'].default_value = material
    return ob


def star_material(strength=60.0):
    mat = B.new_material('M_galaxy_stars')
    nt = mat.node_tree
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_type = 'GEOMETRY'
    attr.attribute_name = 'Col'
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(attr.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return mat


def core_objects(style, coll):
    S = STYLES[style]
    # hot compact core
    me = bpy.data.meshes.new('GalacticCore')
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.9)
    bm.to_mesh(me)
    bm.free()
    core = bpy.data.objects.new('GalacticCore', me)
    coll.objects.link(core)
    m = B.new_material('M_galactic_core')
    nt = m.node_tree
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*S['glow'], 1)
    em.inputs['Strength'].default_value = 60.0
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    me.materials.append(m)
    # soft halo: a camera-facing additive glow card (same idea as the web sprites)
    me2 = bpy.data.meshes.new('CoreHalo')
    s = 40.0
    me2.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    uv = me2.uv_layers.new(name='UVMap')
    for loop, co in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = co
    halo = bpy.data.objects.new('CoreHalo', me2)
    coll.objects.link(halo)
    hm = B.new_material('M_core_halo')
    nt = hm.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sub = nt.nodes.new('ShaderNodeVectorMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.5, 0.5, 0.0)
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    # glow(r) = 1.6 * exp(-r / 0.035) + 0.18 * exp(-r / 0.12)   (r in card units, 0..0.7)
    def expo(scale, amp):
        m1 = nt.nodes.new('ShaderNodeMath')
        m1.operation = 'MULTIPLY'
        m1.inputs[1].default_value = -1.0 / scale
        nt.links.new(ln.outputs['Value'], m1.inputs[0])
        ex = nt.nodes.new('ShaderNodeMath')
        ex.operation = 'EXPONENT'
        nt.links.new(m1.outputs[0], ex.inputs[0])
        m2 = nt.nodes.new('ShaderNodeMath')
        m2.operation = 'MULTIPLY'
        m2.inputs[1].default_value = amp
        nt.links.new(ex.outputs[0], m2.inputs[0])
        return m2.outputs[0]
    nt.links.new(tc.outputs['UV'], sub.inputs[0])
    nt.links.new(sub.outputs['Vector'], ln.inputs[0])
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(expo(0.035, 1.6), add.inputs[0])
    nt.links.new(expo(0.12, 0.18), add.inputs[1])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*S['glow'], 1)
    nt.links.new(add.outputs[0], em.inputs['Strength'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    addsh = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(tr.outputs[0], addsh.inputs[0])
    nt.links.new(em.outputs[0], addsh.inputs[1])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(addsh.outputs[0], out.inputs['Surface'])
    me2.materials.append(hm)
    halo.visible_shadow = False
    halo.visible_diffuse = False
    halo.visible_glossy = False
    # warm back-light from the core (rim light on the planets)
    ld = bpy.data.lights.new('CoreLight', 'POINT')
    ld.energy = 14000
    ld.color = S['glow']
    ld.shadow_soft_size = 1.0
    lo = bpy.data.objects.new('CoreLight', ld)
    coll.objects.link(lo)
    return core, halo, lo


def orbit_ring(name, o, coll, material):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.008
    cu.bevel_resolution = 1
    sp = cu.splines.new('POLY')
    n = 256
    sp.points.add(n - 1)
    inc = math.radians(o['incl'])
    for i in range(n):
        a = TAU * i / n
        w = (math.cos(a) * o['radius'], math.sin(a) * o['radius'] * math.sin(inc),
             math.sin(a) * o['radius'] * math.cos(inc))
        b = web_to_blender(w)
        sp.points[i].co = (b.x, b.y, b.z, 1)
    sp.use_cyclic_u = True
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(material)
    ob.visible_shadow = False
    ob.visible_diffuse = False
    ob.visible_glossy = False
    coll.objects.link(ob)
    return ob


def orbit_material():
    mat = B.new_material('M_orbit')
    nt = mat.node_tree
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.45, 0.62, 1.0, 1)
    em.inputs['Strength'].default_value = 0.35
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = 0.35
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return mat


def setup_compositor(scene):
    name = f'{scene.name} Compositor'
    ng = bpy.data.node_groups.get(name)
    if ng:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(name, 'CompositorNodeTree')
    ng.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = ng.nodes.new('CompositorNodeRLayers')
    rl.scene = scene
    glare = ng.nodes.new('CompositorNodeGlare')
    for key, val in (('Type', 'Fog Glow'), ('Quality', 'High')):
        try:
            glare.inputs[key].default_value = val
        except Exception as e:  # menu names differ between versions
            print('[galaxy] glare', key, e)
    glare.inputs['Threshold'].default_value = 1.2
    glare.inputs['Size'].default_value = 0.8
    glare.inputs['Strength'].default_value = 0.6
    out = ng.nodes.new('NodeGroupOutput')
    ng.links.new(rl.outputs['Image'], glare.inputs['Image'])
    ng.links.new(glare.outputs['Image'], out.inputs[0])
    scene.compositing_node_group = ng
    scene.render.use_compositing = True
    return ng


def _frame(loc, az, el, dist):
    radial = Vector((loc.x, loc.y, 0)).normalized()
    d = Matrix.Rotation(az, 3, 'Z') @ radial
    return loc + (d * math.cos(el) + Vector((0, 0, math.sin(el)))) * dist


def best_azimuth(loc, dist, others, vfov, aspect, el=0.22, default=0.5):
    """Port of GalaxyView._bestAzimuth: frame the hero so most planets (and the
    glowing core) sit in the background of the shot."""
    tan_v = math.tan(vfov / 2)
    tan_h = tan_v * aspect
    hero_ang = math.sin(min(vfov, 2 * math.atan(tan_h)) * 0.3)
    up_w = Vector((0, 0, 1))
    targets = [(p, r, 1.0) for p, r in others] + [(Vector((0, 0, 0)), 3.0, 1.4)]
    best, best_s = default, -1e9
    for k in range(72):
        az = default + k / 72 * TAU
        pos = _frame(loc, az, el, dist)
        fwd = (loc - pos).normalized()
        right = fwd.cross(up_w).normalized()
        up = right.cross(fwd)
        s = 0.0
        for p, r, w in targets:
            v = p - pos
            z = v.dot(fwd)
            if z <= r * 3:
                continue
            x, y = v.dot(right) / z, v.dot(up) / z
            if abs(x) > tan_h * 0.88 or abs(y) > tan_v * 0.8:
                continue
            rr = math.hypot(x, y)
            if rr < hero_ang * 1.25:
                s -= 0.3 * w
                continue
            s += w * (1 + min(r / z * 25, 1.5)) * (1.0 if rr > tan_v * 0.25 else 0.7)
        da = abs(az - default) % TAU
        s -= min(da, TAU - da) * 0.15
        if s > best_s:
            best, best_s = az, s
    return best


def build_galaxy_scene(style='andromeda', seed=7, courses=DEMO_COURSES, hero=0, t=None,
                       count=110000, res=(1920, 1080)):
    """Create/refresh the 'Galaxy' scene. Returns the scene."""
    if t is None:
        t = (seed % 97) * 3.1 + 8.0      # web: galaxy clock starts at (seed % 97) * 3.1
    scene = bpy.data.scenes.get('Galaxy') or bpy.data.scenes.new('Galaxy')
    B.configure_cycles(scene, samples=128, res=res)
    scene.cycles.use_denoising = True
    scene.cycles.transparent_max_bounces = 24
    scene.view_settings.look = 'AgX - Medium High Contrast'
    B.black_world(scene)
    root = scene.collection
    for cname in ('Galaxy Disc', 'Course Planets', 'Orbits', 'Galaxy Rig'):
        c = bpy.data.collections.get(cname)
        if c:
            for ob in list(c.objects):
                bpy.data.objects.remove(ob, do_unlink=True)
    disc_c = B.get_collection('Galaxy Disc', root)
    planets_c = B.get_collection('Course Planets', root)
    orbit_c = B.get_collection('Orbits', root)
    rig_c = B.get_collection('Galaxy Rig', root)

    # galaxy disc (same particles as the web)
    pos, col, sz = galaxy_particles(style, seed, count, t)
    brightness = col.max(axis=1, keepdims=True)
    col_n = col / np.maximum(brightness, 1e-6)
    radius = 0.02 * sz * (1 + np.linalg.norm(pos, axis=1) / 120)
    _points_object('GalaxyStars', pos, col_n * brightness, radius, disc_c, star_material(4.5))
    core_objects(style, disc_c)

    # planets as instances of the planet library collections
    orb_mat = orbit_material()
    hero_obj = None
    hero_data = None
    for slot, (title, ptype, size) in enumerate(courses):
        o = orbit_for_slot(slot, seed)
        w = planet_position_web(o, t)
        loc = web_to_blender(w)
        empty = bpy.data.objects.new(f'Course {slot + 1:02d} - {title}', None)
        empty.instance_type = 'COLLECTION'
        empty.instance_collection = bpy.data.collections[f'PT_{ptype}']
        r = TYPE_RADIUS[ptype] * SIZE_SCALE[size]
        empty.scale = (r, r, r)
        empty.location = loc
        tilt = max(o['tilt'], 18) if ptype == 'saturn' else o['tilt']
        empty.rotation_euler = Euler((math.radians(tilt), 0, o['tiltYaw']), 'ZXY')
        empty['course_title'] = title
        empty['planet_type'] = ptype
        planets_c.objects.link(empty)
        if slot != hero:  # the hero's own orbit would cut straight through the shot
            orbit_ring(f'Orbit {slot + 1:02d}', o, orbit_c, orb_mat)
        if slot == hero:
            hero_obj, hero_data = empty, (loc, r, ptype)

    # hero camera + key light (same framing idea as the web rig)
    loc, r, ptype = hero_data
    frame_r = r * (2.35 * 0.78 if ptype == 'saturn' else 1.12)
    vfov = math.radians(38)
    aspect = res[0] / res[1]
    hfov = 2 * math.atan(math.tan(vfov / 2) * aspect)
    dist = frame_r / math.sin(min(vfov, hfov) * 0.3)
    others = [(ob.location.copy(), ob.scale.x) for ob in planets_c.objects if ob is not hero_obj]
    el = 0.22
    az = best_azimuth(loc, dist, others, vfov, aspect, el)
    cam_pos = _frame(loc, az, el, dist)
    cam = bpy.data.objects.get('GalaxyCam') or bpy.data.objects.new('GalaxyCam', bpy.data.cameras.new('GalaxyCam'))
    if cam.name not in rig_c.objects:
        rig_c.objects.link(cam)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = vfov
    cam.data.clip_start = 0.05
    cam.data.clip_end = 5000
    cam.location = cam_pos
    cam.rotation_euler = (loc - cam_pos).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    halo = bpy.data.objects.get('CoreHalo')
    if halo is not None:
        halo.constraints.clear()
        c = halo.constraints.new('DAMPED_TRACK')
        c.target = cam
        c.track_axis = 'TRACK_Z'
    # key light: upper-left, slightly in front of the camera
    back = (cam_pos - loc).normalized()
    right = Vector((0, 0, 1)).cross(back).normalized()
    up = back.cross(right).normalized()
    sun_dir = (right * -0.95 + up * 0.4 + back * 0.6).normalized()
    B.sun_lamp('GalaxySun', sun_dir, 4.5, rig_c)
    # overview camera: the whole course system around the core, disc sweeping behind
    ov = bpy.data.objects.get('SystemCam') or bpy.data.objects.new('SystemCam', bpy.data.cameras.new('SystemCam'))
    if ov.name not in rig_c.objects:
        rig_c.objects.link(ov)
    ov.data.sensor_fit = 'VERTICAL'
    ov.data.angle_y = math.radians(42)
    ov.data.clip_start = 0.1
    ov.data.clip_end = 5000
    ov_pos = Vector((sun_dir.x, sun_dir.y, 0)).normalized() * 190 + Vector((0, 0, 125))
    ov.location = ov_pos
    ov.rotation_euler = (Vector((0, 0, -8)) - ov_pos).to_track_quat('-Z', 'Y').to_euler()
    setup_compositor(scene)
    return scene


def render_galaxy(path, samples=128, res=(1920, 1080), camera='GalaxyCam'):
    scene = bpy.data.scenes['Galaxy']
    prev = scene.camera
    scene.camera = bpy.data.objects[camera]
    # orbit rings read well from above but turn into streaks in the low hero shot
    orbits = bpy.data.collections.get('Orbits')
    if orbits:
        orbits.hide_render = camera == 'GalaxyCam'
    scene.cycles.samples = samples
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=scene.name)
    scene.camera = prev
    if orbits:
        orbits.hide_render = False
    return path
