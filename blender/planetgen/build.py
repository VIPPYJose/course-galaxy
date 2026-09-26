"""Builds the planet library, the lab (portrait) scene and bakes web textures.

Run inside Blender:

    import sys; sys.path.insert(0, '/Users/gerald/blender planets/blender')
    import planetgen.build as B
    B.build_all()                 # node groups, materials, planet objects, lab scene
    B.render_portrait('terra')    # Cycles render on black, sun-lit
    B.bake_planet('terra')        # equirect textures for the web app
"""
import bpy
import bmesh
import math
import os
import json
from mathutils import Vector

from .nodes import NB
from . import recipes

PROJECT = '/Users/gerald/blender planets'
WEB_PLANETS = os.path.join(PROJECT, 'web', 'assets', 'planets')
RENDERS = os.path.join(PROJECT, 'renders')

# Direction *towards* the sun in the lab (upper left, slightly in front of the camera).
LAB_SUN_DIR = Vector((-0.80, -0.52, 0.34)).normalized()
LAB_SPACING = 8.0

# --------------------------------------------------------------------------------------
# Planet specs. `atmo.color` is the relative scattering colour (Rayleigh-ish), density
# is the scattering coefficient at the surface, H the scale height (planet radii).
# The `web` block is exported to the manifest consumed by the three.js app.
# --------------------------------------------------------------------------------------
SPECS = {
    'terra': dict(
        name='Terra', kind='Temperate ocean world',
        emit_strength=1.2, bump=1.0, tilt=(18.0, -12.0), spin=210.0,
        clouds=dict(radius=1.007, color=(0.93, 0.93, 0.93), bump=0.004),
        atmo=dict(radius=1.075, color=(0.16, 0.40, 1.0), density=20.0, H=0.012,
                  mie=0.18, mie_color=(1.0, 1.0, 1.0), mie_g=0.72),
        web=dict(atmo=dict(color=[0.30, 0.55, 1.0], thickness=0.075, intensity=1.2, sunset=[1.0, 0.45, 0.2]),
                 spec=1.0, night_lights=True, emissive_strength=1.6, clouds=1.0, lunar=0.0, cloud_speed=1.25),
    ),
    'jovian': dict(
        name='Jovian', kind='Banded gas giant',
        emit_strength=0.0, bump=0.0, tilt=(8.0, 3.0), spin=40.0,
        atmo=dict(radius=1.035, color=(0.55, 0.75, 1.0), density=4.0, H=0.009,
                  mie=0.5, mie_color=(1.0, 0.95, 0.85), mie_g=0.6),
        web=dict(atmo=dict(color=[0.95, 0.85, 0.7], thickness=0.035, intensity=0.55, sunset=[1.0, 0.6, 0.3]),
                 spec=0.0, night_lights=False, emissive_strength=0.0, clouds=0.0, lunar=0.0),
    ),
    'dune': dict(
        name='Dune', kind='Arid desert world',
        emit_strength=0.0, bump=1.0, tilt=(20.0, 10.0), spin=120.0,
        atmo=dict(radius=1.05, color=(1.0, 0.62, 0.40), density=5.0, H=0.01,
                  mie=0.6, mie_color=(1.0, 0.8, 0.6), mie_g=0.65),
        web=dict(atmo=dict(color=[1.0, 0.62, 0.42], thickness=0.05, intensity=0.55, sunset=[0.5, 0.65, 1.0]),
                 spec=0.0, night_lights=False, emissive_strength=0.0, clouds=0.0, lunar=0.25),
    ),
    'saturn': dict(
        name='Aurelia', kind='Ringed gas giant',
        emit_strength=0.0, bump=0.0, tilt=(24.0, -18.0), spin=10.0,
        atmo=dict(radius=1.035, color=(0.8, 0.8, 1.0), density=3.5, H=0.009,
                  mie=0.6, mie_color=(1.0, 0.92, 0.75), mie_g=0.6),
        rings=dict(inner=1.20, outer=2.35),
        web=dict(atmo=dict(color=[1.0, 0.9, 0.7], thickness=0.035, intensity=0.5, sunset=[1.0, 0.7, 0.4]),
                 spec=0.0, night_lights=False, emissive_strength=0.0, clouds=0.0, lunar=0.0),
    ),
    'glacier': dict(
        name='Glacier', kind='Frozen ice moon',
        emit_strength=0.0, bump=1.0, tilt=(12.0, 6.0), spin=300.0,
        atmo=dict(radius=1.03, color=(0.45, 0.75, 1.0), density=3.0, H=0.008,
                  mie=0.2, mie_color=(0.9, 0.95, 1.0), mie_g=0.6),
        web=dict(atmo=dict(color=[0.55, 0.8, 1.0], thickness=0.03, intensity=0.35, sunset=[0.8, 0.9, 1.0]),
                 spec=0.35, night_lights=False, emissive_strength=0.0, clouds=0.0, lunar=0.15),
    ),
    'inferno': dict(
        name='Inferno', kind='Volcanic lava world',
        emit_strength=5.0, bump=1.0, tilt=(15.0, -6.0), spin=30.0,
        atmo=dict(radius=1.05, color=(1.0, 0.42, 0.2), density=4.5, H=0.012,
                  mie=0.9, mie_color=(1.0, 0.55, 0.3), mie_g=0.5),
        web=dict(atmo=dict(color=[1.0, 0.45, 0.2], thickness=0.05, intensity=0.6, sunset=[1.0, 0.3, 0.1]),
                 spec=0.0, night_lights=False, emissive_strength=4.0, emissive_always=True,
                 clouds=0.0, lunar=0.0),
    ),
    'neptune': dict(
        name='Azure', kind='Ice giant',
        emit_strength=0.0, bump=0.0, tilt=(28.0, 8.0), spin=80.0,
        clouds=dict(radius=1.006, color=(0.95, 0.97, 1.0), bump=0.002),
        atmo=dict(radius=1.06, color=(0.25, 0.55, 1.0), density=10.0, H=0.014,
                  mie=0.15, mie_color=(0.9, 0.95, 1.0), mie_g=0.6),
        web=dict(atmo=dict(color=[0.35, 0.6, 1.0], thickness=0.06, intensity=0.9, sunset=[0.6, 0.8, 1.0]),
                 spec=0.0, night_lights=False, emissive_strength=0.0, clouds=0.9, lunar=0.0, cloud_speed=0.6),
    ),
    'luna': dict(
        name='Luna', kind='Cratered moon',
        emit_strength=0.0, bump=1.0, tilt=(6.0, 0.0), spin=90.0,
        web=dict(atmo=None, spec=0.0, night_lights=False, emissive_strength=0.0, clouds=0.0, lunar=1.0),
    ),
}
ORDER = ['terra', 'jovian', 'dune', 'saturn', 'glacier', 'inferno', 'neptune', 'luna']


# ------------------------------------------------------------------------------ utilities
def ensure_dir(p):
    os.makedirs(p, exist_ok=True)
    return p


def get_collection(name, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    if parent is not None and coll.name not in [c.name for c in parent.children]:
        parent.children.link(coll)
    return coll


def remove_objects(coll):
    for ob in list(coll.objects):
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and getattr(data, 'users', 1) == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


def new_material(name):
    old = bpy.data.materials.get(name)
    if old:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    mat.node_tree.nodes.clear()
    return mat


def uv_sphere(name, radius, coll, segments=256, rings=128):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius,
                              calc_uvs=True)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def ring_mesh(name, inner, outer, coll, segments=384):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts_in, verts_out = [], []
    for i in range(segments):
        a = math.tau * i / segments
        verts_in.append(bm.verts.new((inner * math.cos(a), inner * math.sin(a), 0.0)))
        verts_out.append(bm.verts.new((outer * math.cos(a), outer * math.sin(a), 0.0)))
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((verts_in[i], verts_out[i], verts_out[j], verts_in[j]))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


# ------------------------------------------------------------------------------ node groups
GROUP_OUTPUTS = [
    ('Color', 'NodeSocketColor'), ('Roughness', 'NodeSocketFloat'), ('Height', 'NodeSocketFloat'),
    ('Emission', 'NodeSocketColor'), ('Spec', 'NodeSocketFloat'), ('Clouds', 'NodeSocketFloat'),
]


def build_group(pid):
    name = f'PG_{pid}'
    old = bpy.data.node_groups.get(name)
    if old:
        bpy.data.node_groups.remove(old)
    ng = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    ng.interface.new_socket(name='Dir', in_out='INPUT', socket_type='NodeSocketVector')
    for n, t in GROUP_OUTPUTS:
        ng.interface.new_socket(name=n, in_out='OUTPUT', socket_type=t)
    nb = NB(ng)
    gin = nb.node('NodeGroupInput')
    gout = nb.node('NodeGroupOutput')
    D = nb.vnorm(gin.outputs['Dir'])
    out = recipes.RECIPES[pid](nb, D)
    nb.set(gout.inputs['Color'], out['color'])
    nb.set(gout.inputs['Roughness'], out['rough'])
    nb.set(gout.inputs['Height'], out['height'])
    nb.set(gout.inputs['Emission'], out['emit'])
    nb.set(gout.inputs['Spec'], out['spec'])
    nb.set(gout.inputs['Clouds'], out.get('clouds', 0.0))
    return ng


def group_node(nb, ng, D):
    g = nb.node('ShaderNodeGroup')
    g.node_tree = ng
    nb.set(g.inputs['Dir'], D)
    return g


# ------------------------------------------------------------------------------ materials
def surface_material(pid, ng):
    spec = SPECS[pid]
    mat = new_material(f'M_{pid}_surface')
    nb = NB(mat.node_tree)
    tc = nb.node('ShaderNodeTexCoord')
    D = nb.vnorm(tc.outputs['Object'])
    g = group_node(nb, ng, D)
    bsdf = nb.node('ShaderNodeBsdfPrincipled')
    nb.set(bsdf.inputs['Base Color'], g.outputs['Color'])
    nb.set(bsdf.inputs['Roughness'], g.outputs['Roughness'])
    nb.set(bsdf.inputs['IOR'], 1.35)
    nb.set(bsdf.inputs['Specular IOR Level'], nb.maprange(g.outputs['Spec'], 0.0, 1.0, 0.2, 0.5))
    nb.set(bsdf.inputs['Emission Color'], g.outputs['Emission'])
    nb.set(bsdf.inputs['Emission Strength'], spec['emit_strength'])
    if spec.get('bump', 0) > 0:
        bump = nb.node('ShaderNodeBump')
        nb.set(bump.inputs['Strength'], 1.0)
        nb.set(bump.inputs['Distance'], spec['bump'])
        nb.set(bump.inputs['Height'], g.outputs['Height'])
        nb.set(bsdf.inputs['Normal'], bump.outputs['Normal'])
    out = nb.node('ShaderNodeOutputMaterial')
    nb.set(out.inputs['Surface'], bsdf.outputs['BSDF'])
    return mat


def cloud_material(pid, ng):
    c = SPECS[pid]['clouds']
    mat = new_material(f'M_{pid}_clouds')
    nb = NB(mat.node_tree)
    tc = nb.node('ShaderNodeTexCoord')
    D = nb.vnorm(tc.outputs['Object'])
    g = group_node(nb, ng, D)
    bsdf = nb.node('ShaderNodeBsdfPrincipled')
    nb.set(bsdf.inputs['Base Color'], c['color'])
    nb.set(bsdf.inputs['Roughness'], 1.0)
    nb.set(bsdf.inputs['Specular IOR Level'], 0.1)
    nb.set(bsdf.inputs['Alpha'], nb.clamp01(nb.mul(g.outputs['Clouds'], 1.05)))
    bump = nb.node('ShaderNodeBump')
    nb.set(bump.inputs['Distance'], c.get('bump', 0.003))
    nb.set(bump.inputs['Height'], g.outputs['Clouds'])
    nb.set(bsdf.inputs['Normal'], bump.outputs['Normal'])
    out = nb.node('ShaderNodeOutputMaterial')
    nb.set(out.inputs['Surface'], bsdf.outputs['BSDF'])
    return mat


def atmo_material(pid):
    a = SPECS[pid]['atmo']
    mat = new_material(f'M_{pid}_atmo')
    nb = NB(mat.node_tree)
    tc = nb.node('ShaderNodeTexCoord')
    r = nb.vlen(tc.outputs['Object'])
    h = nb.max(nb.sub(r, 1.0), 0.0)
    top = a['radius']
    fade = nb.one_minus(nb.smoothstep(top - (top - 1.0) * 0.3, top, r))
    dens = nb.mul(nb.mul(nb.exp(nb.mul(h, -1.0 / a['H'])), a['density']), fade)
    ray = nb.node('ShaderNodeVolumeScatter')
    nb.set(ray.inputs['Color'], a['color'])
    nb.set(ray.inputs['Density'], dens)
    nb.set(ray.inputs['Anisotropy'], 0.0)
    mie = nb.node('ShaderNodeVolumeScatter')
    nb.set(mie.inputs['Color'], a['mie_color'])
    dens_m = nb.mul(nb.mul(nb.exp(nb.mul(h, -2.0 / a['H'])), a['density'] * a['mie']), fade)
    nb.set(mie.inputs['Density'], dens_m)
    nb.set(mie.inputs['Anisotropy'], a['mie_g'])
    add = nb.node('ShaderNodeAddShader')
    nb.set(add.inputs[0], ray.outputs[0])
    nb.set(add.inputs[1], mie.outputs[0])
    out = nb.node('ShaderNodeOutputMaterial')
    nb.set(out.inputs['Volume'], add.outputs[0])
    return mat


# ------------------------------------------------------------------------------ rings
def ring_profile(inner, outer, n=2048, seed=11):
    """Saturn-like ring opacity/colour profile (numpy). Returns RGBA float array (n, 4)."""
    import numpy as np
    rng = np.random.default_rng(seed)
    r = np.linspace(inner, outer, n)

    def smooth_noise(freq, amp):
        k = int(freq)
        pts = rng.random(k + 2)
        xs = np.linspace(0, 1, k + 2)
        t = (r - inner) / (outer - inner)
        return amp * (np.interp(t, xs, pts) - 0.5)

    op = np.zeros(n)
    col = np.zeros((n, 3))

    def region(a, b, o, c, ramp=0.004):
        w = 1.0 / (1.0 + np.exp(-(r - a) / ramp)) * (1.0 - 1.0 / (1.0 + np.exp(-(r - b) / ramp)))
        op[:] = op * (1 - w) + o * w
        col[:] = col * (1 - w)[:, None] + np.array(c)[None, :] * w[:, None]

    region(1.20, 1.239, 0.035, (0.22, 0.21, 0.20))            # D ring
    region(1.239, 1.527, 0.16, (0.26, 0.25, 0.24))            # C ring
    region(1.527, 1.95, 0.88, (0.56, 0.48, 0.37))             # B ring
    region(1.95, 2.025, 0.07, (0.25, 0.24, 0.23), 0.002)      # Cassini division
    region(2.025, 2.27, 0.6, (0.46, 0.42, 0.36))              # A ring
    region(2.212, 2.218, 0.02, (0.4, 0.4, 0.4), 0.0008)       # Encke gap
    region(2.262, 2.2645, 0.05, (0.4, 0.4, 0.4), 0.0005)      # Keeler gap
    # B ring gets denser outward, C ring has plateaus
    b_mask = (r > 1.527) & (r < 1.95)
    op[b_mask] *= 0.75 + 0.25 * (r[b_mask] - 1.527) / (1.95 - 1.527)
    # ringlets at many scales
    mod = 1.0 + smooth_noise(40, 0.45) + smooth_noise(160, 0.45) + smooth_noise(700, 0.4) \
        + smooth_noise(1400, 0.25)
    op = np.clip(op * mod, 0.0, 0.97)
    # C ring plateaus: a few narrow dense ringlets
    for rc in (1.29, 1.35, 1.45, 1.495):
        op += 0.25 * np.exp(-((r - rc) / 0.004) ** 2)
    # F ring
    op += 0.45 * np.exp(-((r - 2.325) / 0.0025) ** 2)
    col *= (1.0 + smooth_noise(90, 0.35) + smooth_noise(500, 0.25))[:, None]
    fade = np.clip((r - inner) / 0.01, 0, 1) * np.clip((outer - r) / 0.01, 0, 1)
    op *= fade
    rgba = np.zeros((n, 4), dtype=np.float32)
    rgba[:, :3] = np.clip(col, 0, 1)
    rgba[:, 3] = np.clip(op, 0, 1)
    return rgba


def ring_image(pid):
    import numpy as np
    rs = SPECS[pid]['rings']
    rgba = ring_profile(rs['inner'], rs['outer'])
    n = rgba.shape[0]
    h = 4
    name = f'IMG_{pid}_rings'
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, n, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = 'sRGB'
    px = np.zeros((h, n, 4), dtype=np.float32)
    # store colour in sRGB (image is sRGB byte)
    lin = rgba[:, :3]
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    px[:, :, :3] = srgb[None, :, :]
    px[:, :, 3] = rgba[None, :, 3]
    img.pixels.foreach_set(px.ravel())
    d = ensure_dir(os.path.join(WEB_PLANETS, pid))
    img.filepath_raw = os.path.join(d, 'rings.png')
    img.file_format = 'PNG'
    img.save()
    img.alpha_mode = 'STRAIGHT'
    return img


def ring_material(pid, img):
    rs = SPECS[pid]['rings']
    mat = new_material(f'M_{pid}_rings')
    nb = NB(mat.node_tree)
    tc = nb.node('ShaderNodeTexCoord')
    x, y, _ = nb.sep(tc.outputs['Object'])
    r = nb.sqrt(nb.add(nb.mul(x, x), nb.mul(y, y)))
    t = nb.maprange(r, rs['inner'], rs['outer'], 0.0, 1.0)
    tex = nb.node('ShaderNodeTexImage', interpolation='Linear', extension='EXTEND')
    tex.image = img
    nb.set(tex.inputs['Vector'], nb.comb(t, 0.5, 0.0))
    diff = nb.node('ShaderNodeBsdfDiffuse')
    nb.set(diff.inputs['Color'], tex.outputs['Color'])
    trans = nb.node('ShaderNodeBsdfTranslucent')
    nb.set(trans.inputs['Color'], nb.cscale(tex.outputs['Color'], 0.6))
    mix = nb.node('ShaderNodeMixShader')
    nb.set(mix.inputs[0], 0.35)
    nb.set(mix.inputs[1], diff.outputs[0])
    nb.set(mix.inputs[2], trans.outputs[0])
    tr = nb.node('ShaderNodeBsdfTransparent')
    mix2 = nb.node('ShaderNodeMixShader')
    nb.set(mix2.inputs[0], tex.outputs['Alpha'])
    nb.set(mix2.inputs[1], tr.outputs[0])
    nb.set(mix2.inputs[2], mix.outputs[0])
    out = nb.node('ShaderNodeOutputMaterial')
    nb.set(out.inputs['Surface'], mix2.outputs[0])
    return mat


# ------------------------------------------------------------------------------ planets
def lab_position(pid):
    return Vector((-LAB_SPACING * ORDER.index(pid), 0.0, 0.0))


TEXTURES = os.path.join(PROJECT, 'blender', 'textures')


def _srgb(lin):
    import numpy as np
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, None), 1 / 2.4) - 0.055)


def _image_from_array(name, arr, colorspace, path):
    """arr: (H, W, 3) or (H, W) float in 0..1, row 0 = bottom (south)."""
    import numpy as np
    H, W = arr.shape[:2]
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, W, H, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    px = np.ones((H, W, 4), dtype=np.float32)
    if arr.ndim == 2:
        px[:, :, :3] = arr[:, :, None]
    else:
        px[:, :, :3] = _srgb(arr) if colorspace == 'sRGB' else arr
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def gas_textures(pid, force=False, W=4096, H=2048):
    """Generate (or load cached) flow-advected giant textures as SRC_<pid>_* images."""
    from . import gasgiant
    ensure_dir(TEXTURES)
    cpath = os.path.join(TEXTURES, f'{pid}_color.png')
    kpath = os.path.join(TEXTURES, f'{pid}_clouds.png')
    cfg, seed = gasgiant.PRESETS[pid]
    wants_clouds = 'clouds' in cfg
    if force or not os.path.exists(cpath) or (wants_clouds and not os.path.exists(kpath)):
        import time
        t = time.time()
        col, clouds = gasgiant.generate(cfg, W=W, H=H, seed=seed)
        _image_from_array(f'SRC_{pid}_color', col, 'sRGB', cpath)
        if clouds is not None:
            _image_from_array(f'SRC_{pid}_clouds', clouds, 'Non-Color', kpath)
        print(f'[gas] generated {pid} in {time.time() - t:.1f}s')
    for name, path, cs in [(f'SRC_{pid}_color', cpath, 'sRGB'), (f'SRC_{pid}_clouds', kpath, 'Non-Color')]:
        if os.path.exists(path):
            img = bpy.data.images.get(name)
            if img is None or bpy.path.abspath(img.filepath) != path:
                if img:
                    bpy.data.images.remove(img)
                img = bpy.data.images.load(path)
                img.name = name
            img.colorspace_settings.name = cs
            img.reload()


def build_planet(pid, library):
    spec = SPECS[pid]
    coll = get_collection(f'PT_{pid}', library)
    remove_objects(coll)
    if pid in ('jovian', 'saturn', 'neptune'):
        gas_textures(pid)
    ng = build_group(pid)
    root = bpy.data.objects.new(f'{pid}_root', None)
    root.empty_display_type = 'SPHERE'
    root.empty_display_size = 1.2
    coll.objects.link(root)

    surf = uv_sphere(f'{pid}_surface', 1.0, coll)
    surf.data.materials.append(surface_material(pid, ng))
    surf.parent = root
    # planet spin (around its own axis) lives on the surface object
    surf.rotation_euler = (0.0, 0.0, math.radians(spec.get('spin', 0.0)))

    if 'clouds' in spec:
        cl = uv_sphere(f'{pid}_clouds', spec['clouds']['radius'], coll)
        cl.data.materials.append(cloud_material(pid, ng))
        cl.parent = root
        cl.rotation_euler = surf.rotation_euler
    if 'atmo' in spec:
        at = uv_sphere(f'{pid}_atmo', spec['atmo']['radius'], coll, 128, 64)
        at.data.materials.append(atmo_material(pid))
        at.parent = root
    if 'rings' in spec:
        img = ring_image(pid)
        rg = ring_mesh(f'{pid}_rings', spec['rings']['inner'], spec['rings']['outer'], coll)
        rg.data.materials.append(ring_material(pid, img))
        rg.parent = root

    tx, ty = spec.get('tilt', (0.0, 0.0))
    root.rotation_euler = (math.radians(tx), math.radians(ty), 0.0)
    root.location = lab_position(pid)
    coll.instance_offset = root.location
    return coll


# ------------------------------------------------------------------------------ lab scene
def configure_cycles(scene, samples=64, res=(900, 900)):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.volume_bounces = 1
    scene.cycles.transparent_max_bounces = 16
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = 'PNG'


def black_world(scene, name='Space Black'):
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    bg.inputs['Strength'].default_value = 0.0
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    scene.world = w
    return w


def sun_lamp(name, direction_to_sun, strength, coll, angle_deg=0.5):
    ob = bpy.data.objects.get(name)
    if ob is None:
        ld = bpy.data.lights.new(name, 'SUN')
        ob = bpy.data.objects.new(name, ld)
        coll.objects.link(ob)
    ob.data.energy = strength
    ob.data.angle = math.radians(angle_deg)
    ob.data.color = (1.0, 0.97, 0.93)
    ob.rotation_euler = (-direction_to_sun).to_track_quat('-Z', 'Y').to_euler()
    return ob


def setup_lab():
    scene = bpy.data.scenes.get('Planet Lab') or bpy.data.scenes.new('Planet Lab')
    configure_cycles(scene)
    black_world(scene)
    library = get_collection('Planet Library', scene.collection)
    rig = get_collection('Lab Rig', scene.collection)
    cam = bpy.data.objects.get('LabCam')
    if cam is None:
        cam = bpy.data.objects.new('LabCam', bpy.data.cameras.new('LabCam'))
        rig.objects.link(cam)
    cam.data.lens = 50
    cam.data.clip_start = 0.05
    cam.data.clip_end = 500
    scene.camera = cam
    sun_lamp('LabSun', LAB_SUN_DIR, 4.5, rig)
    return scene, library


def frame_lab_camera(pid):
    cam = bpy.data.objects['LabCam']
    p = lab_position(pid)
    dist = 5.3 if 'rings' not in SPECS[pid] else 8.2
    cam.location = p + Vector((0.0, -dist, 0.0))
    cam.rotation_euler = (math.radians(90), 0.0, 0.0)


def build_all(pids=None):
    scene, library = setup_lab()
    for pid in (pids or ORDER):
        build_planet(pid, library)
    return scene


def render_portrait(pid, path=None, samples=64, res=(900, 900)):
    scene = bpy.data.scenes['Planet Lab']
    configure_cycles(scene, samples=samples, res=res)
    frame_lab_camera(pid)
    path = path or os.path.join(ensure_dir(RENDERS), f'{pid}.png')
    ensure_dir(os.path.dirname(path))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=scene.name)
    return path


def flat_preview(pid, path, width=1024):
    """Quick equirect preview of the albedo (+ clouds composited) for iteration."""
    import numpy as np
    scene, plane = setup_bake_scene()
    ng = bpy.data.node_groups[f'PG_{pid}']
    w, h = width, width // 2
    col = bake_channel(scene, plane, ng, 'color', w, h)
    ensure_dir(os.path.dirname(path))
    save_image(col, path, 'PNG')
    extra = []
    for ch in ('clouds', 'emissive', 'height'):
        if ch in channels_for(pid) or (ch == 'height' and SPECS[pid].get('bump', 0) > 0):
            img = bake_channel(scene, plane, ng, ch, w, h)
            if ch == 'height':
                a = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(a)
                a = a.reshape(h, w, 4)
                hv = a[:, :, 0]
                lo, hi = float(hv.min()), float(hv.max())
                a[:, :, :3] = ((hv - lo) / max(hi - lo, 1e-6))[:, :, None]
                img2 = bpy.data.images.new('HPREV', w, h, alpha=False, float_buffer=False)
                img2.colorspace_settings.name = 'Non-Color'
                img2.pixels.foreach_set(a.ravel())
                img = img2
                print(f'[flat] height range {lo:.4f} .. {hi:.4f}')
            p = path.replace('.png', f'_{ch}.png')
            save_image(img, p, 'PNG')
            extra.append(p)
    return [path] + extra


# ------------------------------------------------------------------------------ baking
BAKE_CHANNELS = {
    # channel: (group output, float image?, colourspace)
    'color': ('Color', False, 'sRGB'),
    'height': ('Height', True, 'Non-Color'),
    'rough': ('Roughness', False, 'Non-Color'),
    'spec': ('Spec', False, 'Non-Color'),
    'emissive': ('Emission', False, 'sRGB'),
    'clouds': ('Clouds', False, 'Non-Color'),
}


def uv_to_dir(nb):
    """Equirect UV -> unit direction, matching three.js SphereGeometry mapping
    after the glTF Y-up conversion (Blender (x,y,z) = three (x,-z,y))."""
    tc = nb.node('ShaderNodeTexCoord')
    u, v, _ = nb.sep(tc.outputs['UV'])
    lon = nb.mul(u, math.tau)
    lat = nb.mul(nb.sub(v, 0.5), math.pi)
    cl = nb.cos(lat)
    x = nb.mul(nb.mul(nb.cos(lon), cl), -1.0)
    y = nb.mul(nb.mul(nb.sin(lon), cl), -1.0)
    z = nb.sin(lat)
    return nb.comb(x, y, z)


def setup_bake_scene():
    if bpy.context.window is None:
        # headless: bake inside the context scene (bake operator reads context.scene)
        scene = bpy.context.scene
    else:
        scene = bpy.data.scenes.get('Bake') or bpy.data.scenes.new('Bake')
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = False
    black_world(scene)
    plane = bpy.data.objects.get('BakePlane')
    if plane is None:
        me = bpy.data.meshes.new('BakePlane')
        me.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name='UVMap')
        for loop, co in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            loop.uv = co
        plane = bpy.data.objects.new('BakePlane', me)
        scene.collection.objects.link(plane)
    return scene, plane


def bake_channel(scene, plane, ng, channel, width, height):
    out_name, is_float, cs = BAKE_CHANNELS[channel]
    mat = new_material('M_bake')
    nb = NB(mat.node_tree)
    D = uv_to_dir(nb)
    g = group_node(nb, ng, D)
    em = nb.node('ShaderNodeEmission')
    src = g.outputs[out_name]
    if out_name in ('Color', 'Emission'):
        nb.set(em.inputs['Color'], src)
    else:
        nb.set(em.inputs['Color'], nb.comb(src, src, src))
    nb.set(em.inputs['Strength'], 1.0)
    out = nb.node('ShaderNodeOutputMaterial')
    nb.set(out.inputs['Surface'], em.outputs[0])
    img_name = f'BAKE_{channel}'
    old = bpy.data.images.get(img_name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(img_name, width, height, alpha=False, float_buffer=is_float)
    img.colorspace_settings.name = cs
    tex = nb.node('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.nodes.active = tex
    plane.data.materials.clear()
    plane.data.materials.append(mat)

    win = bpy.context.window
    prev = win.scene if win else None
    if win:
        win.scene = scene
    try:
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'GPU'
        scene.cycles.samples = 4
        scene.cycles.use_denoising = False
        scene.cycles.use_adaptive_sampling = False
        for ob in scene.objects:
            ob.select_set(False)
        plane.select_set(True)
        bpy.context.view_layer.objects.active = plane
        scene.render.bake.margin = 0
        scene.render.bake.use_clear = True
        scene.render.bake.target = 'IMAGE_TEXTURES'
        bpy.ops.object.bake(type='EMIT')
    finally:
        if win:
            win.scene = prev
    return img


def save_image(img, path, fmt='WEBP', quality=90):
    """Write pixels as stored (no view transform - textures must stay albedo-true)."""
    img.file_format = fmt
    img.save(filepath=path, quality=quality)
    return path


def thumbnail(pid, size=512, render_res=768, samples=96):
    """Sun-lit portrait on black, used as the planet picker thumbnail in the web app."""
    png = os.path.join(ensure_dir(RENDERS), f'{pid}.png')
    render_portrait(pid, png, samples=samples, res=(render_res, render_res))
    img = bpy.data.images.load(png)
    img.scale(size, size)
    out = os.path.join(ensure_dir(os.path.join(WEB_PLANETS, pid)), 'thumb.webp')
    save_image(img, out, 'WEBP', 88)
    bpy.data.images.remove(img)
    return out


def height_to_normal(himg, strength=1.0, name='NORMAL'):
    """Equirect height (planet radii) -> tangent normal map in (east, north, up)."""
    import numpy as np
    w, h = himg.size
    H = np.empty(w * h * 4, dtype=np.float32)
    himg.pixels.foreach_get(H)
    H = H.reshape(h, w, 4)[:, :, 0].astype(np.float64)   # row 0 = v=0 (south)
    lat = ((np.arange(h) + 0.5) / h - 0.5) * math.pi
    coslat = np.maximum(np.cos(lat), 0.02)[:, None]
    du = math.tau / w
    dv = math.pi / h
    dHe = (np.roll(H, -1, axis=1) - np.roll(H, 1, axis=1)) / (2 * du * coslat)
    Hn = np.vstack([H[1:], H[-1:]])
    Hs = np.vstack([H[:1], H[:-1]])
    dHn = (Hn - Hs) / (2 * dv)
    nx = -dHe * strength
    ny = -dHn * strength
    nz = np.ones_like(H)
    # fade detail near the poles where the map degenerates
    pole = np.clip((np.abs(lat) - 1.45) / 0.1, 0, 1)[:, None]
    nx *= 1 - pole
    ny *= 1 - pole
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.zeros((h, w, 4), dtype=np.float32)
    out[:, :, 0] = nx / ln * 0.5 + 0.5
    out[:, :, 1] = ny / ln * 0.5 + 0.5
    out[:, :, 2] = nz / ln * 0.5 + 0.5
    out[:, :, 3] = 1.0
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(out.ravel())
    return img, float(np.abs(H).max())


def channels_for(pid):
    spec = SPECS[pid]
    ch = ['color']
    if spec.get('bump', 0) > 0:
        ch.append('height')
    if spec['web'].get('spec', 0) > 0:
        ch.append('spec')
    if spec['web'].get('emissive_strength', 0) > 0:
        ch.append('emissive')
    if spec['web'].get('clouds', 0) > 0:
        ch.append('clouds')
    return ch


def bake_planet(pid, width=4096, height=2048, web_width=2048):
    import time
    t0 = time.time()
    scene, plane = setup_bake_scene()
    ng = bpy.data.node_groups[f'PG_{pid}']
    d = ensure_dir(os.path.join(WEB_PLANETS, pid))
    files = {}
    for ch in channels_for(pid):
        img = bake_channel(scene, plane, ng, ch, width, height)
        if ch == 'height':
            nimg, hmax = height_to_normal(img, strength=SPECS[pid].get('bump', 1.0))
            files['normal'] = save_image(nimg, os.path.join(d, 'normal.png'), 'PNG')
            if web_width != width:
                nimg.scale(web_width, web_width // 2)
            files['normal'] = save_image(nimg, os.path.join(d, 'normal.webp'), 'WEBP', 92)
            os.remove(os.path.join(d, 'normal.png'))
            continue
        if ch == 'color':
            save_image(img, os.path.join(d, 'color_4k.webp'), 'WEBP', 88)
        if web_width != width:
            img.scale(web_width, web_width // 2)
        q = 90 if ch in ('color', 'emissive') else 88
        files[ch] = save_image(img, os.path.join(d, f'{ch}.webp'), 'WEBP', q)
    return dict(pid=pid, files=files, seconds=round(time.time() - t0, 1))


def write_manifest():
    items = []
    for pid in ORDER:
        s = SPECS[pid]
        d = os.path.join(WEB_PLANETS, pid)
        maps = {}
        for key, fn in [('color', 'color.webp'), ('colorHi', 'color_4k.webp'), ('normal', 'normal.webp'),
                        ('spec', 'spec.webp'), ('emissive', 'emissive.webp'), ('clouds', 'clouds.webp'),
                        ('rings', 'rings.png'), ('thumb', 'thumb.webp')]:
            if os.path.exists(os.path.join(d, fn)):
                maps[key] = f'assets/planets/{pid}/{fn}'
        item = dict(id=pid, name=s['name'], kind=s['kind'], maps=maps,
                    tilt=s.get('tilt', (0, 0))[0], **s['web'])
        if 'rings' in s:
            item['rings'] = dict(inner=s['rings']['inner'], outer=s['rings']['outer'])
        items.append(item)
    path = os.path.join(PROJECT, 'web', 'assets', 'planets.json')
    with open(path, 'w') as f:
        json.dump(dict(generator='blender/planetgen', planets=items), f, indent=2)
    return path
