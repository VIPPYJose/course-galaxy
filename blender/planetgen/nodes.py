"""Tiny helper for building Blender shader node graphs from Python.

Every helper returns an *output socket* (or a node when several outputs are
useful) so graphs can be written as nested expressions:

    nb = NB(material.node_tree)
    h = nb.smoothstep(0.4, 0.6, nb.noise(D, scale=2, detail=8).outputs['Fac'])
"""
import bpy
import math

TAU = math.tau


def sock(sockets, identifier):
    for s in sockets:
        if s.identifier == identifier:
            return s
    raise KeyError(identifier)


class NB:
    def __init__(self, tree):
        self.t = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self._count = 0

    # ------------------------------------------------------------------ basics
    def node(self, idname, **props):
        nd = self.nodes.new(idname)
        for k, v in props.items():
            setattr(nd, k, v)
        self._count += 1
        nd.location = ((self._count % 12) * 200, -(self._count // 12) * 260)
        return nd

    def set(self, socket, val):
        if val is None:
            return
        if isinstance(val, bpy.types.NodeSocket):
            self.links.new(val, socket)
            return
        if socket.type == 'RGBA':
            if isinstance(val, (int, float)):
                val = (val, val, val, 1.0)
            elif len(val) == 3:
                val = (*val, 1.0)
        elif socket.type == 'VECTOR' and isinstance(val, (int, float)):
            val = (val, val, val)
        socket.default_value = val

    def value(self, v):
        nd = self.node('ShaderNodeValue')
        nd.outputs[0].default_value = v
        return nd.outputs[0]

    # -------------------------------------------------------------- scalar math
    def math(self, op, a, b=None, c=None, clamp=False):
        nd = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.set(nd.inputs[0], a)
        if b is not None:
            self.set(nd.inputs[1], b)
        if c is not None:
            self.set(nd.inputs[2], c)
        return nd.outputs[0]

    def add(self, a, b): return self.math('ADD', a, b)
    def sub(self, a, b): return self.math('SUBTRACT', a, b)
    def mul(self, a, b): return self.math('MULTIPLY', a, b)
    def div(self, a, b): return self.math('DIVIDE', a, b)
    def madd(self, a, b, c): return self.math('MULTIPLY_ADD', a, b, c)
    def pow(self, a, b): return self.math('POWER', a, b)
    def abs(self, a): return self.math('ABSOLUTE', a)
    def min(self, a, b): return self.math('MINIMUM', a, b)
    def max(self, a, b): return self.math('MAXIMUM', a, b)
    def clamp01(self, a): return self.math('ADD', a, 0.0, clamp=True)
    def exp(self, a): return self.math('EXPONENT', a)
    def sin(self, a): return self.math('SINE', a)
    def cos(self, a): return self.math('COSINE', a)
    def sqrt(self, a): return self.math('SQRT', a)
    def lt(self, a, b): return self.math('LESS_THAN', a, b)
    def gt(self, a, b): return self.math('GREATER_THAN', a, b)
    def one_minus(self, a): return self.math('SUBTRACT', 1.0, a)

    def gauss(self, x, center, width):
        """exp(-((x-center)/width)^2)"""
        d = self.div(self.sub(x, center), width)
        return self.exp(self.mul(self.mul(d, d), -1.0))

    def maprange(self, v, a, b, c=0.0, d=1.0, clamp=True, interp='LINEAR'):
        nd = self.node('ShaderNodeMapRange', data_type='FLOAT',
                       interpolation_type=interp, clamp=clamp)
        self.set(nd.inputs['Value'], v)
        self.set(nd.inputs['From Min'], a)
        self.set(nd.inputs['From Max'], b)
        self.set(nd.inputs['To Min'], c)
        self.set(nd.inputs['To Max'], d)
        return nd.outputs['Result']

    def smoothstep(self, e0, e1, x):
        return self.maprange(x, e0, e1, 0.0, 1.0, clamp=True, interp='SMOOTHSTEP')

    def lin(self, e0, e1, x):
        return self.maprange(x, e0, e1, 0.0, 1.0, clamp=True)

    # -------------------------------------------------------------- vector math
    def vmath(self, op, a, b=None, c=None, scale=None):
        nd = self.node('ShaderNodeVectorMath', operation=op)
        self.set(nd.inputs[0], a)
        if b is not None:
            self.set(nd.inputs[1], b)
        if c is not None:
            self.set(nd.inputs[2], c)
        if scale is not None:
            self.set(nd.inputs[3], scale)
        if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE'):
            return nd.outputs['Value']
        return nd.outputs['Vector']

    def vadd(self, a, b): return self.vmath('ADD', a, b)
    def vsub(self, a, b): return self.vmath('SUBTRACT', a, b)
    def vmul(self, a, b): return self.vmath('MULTIPLY', a, b)
    def vscale(self, a, s): return self.vmath('SCALE', a, scale=s)
    def vnorm(self, a): return self.vmath('NORMALIZE', a)
    def vlen(self, a): return self.vmath('LENGTH', a)
    def vdot(self, a, b): return self.vmath('DOT_PRODUCT', a, b)
    def vcross(self, a, b): return self.vmath('CROSS_PRODUCT', a, b)

    def sep(self, v):
        nd = self.node('ShaderNodeSeparateXYZ')
        self.set(nd.inputs[0], v)
        return nd.outputs['X'], nd.outputs['Y'], nd.outputs['Z']

    def comb(self, x, y, z):
        nd = self.node('ShaderNodeCombineXYZ')
        self.set(nd.inputs['X'], x)
        self.set(nd.inputs['Y'], y)
        self.set(nd.inputs['Z'], z)
        return nd.outputs[0]

    def sep_rgb(self, c):
        nd = self.node('ShaderNodeSeparateColor')
        self.set(nd.inputs[0], c)
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def rotate(self, v, axis, angle, center=(0, 0, 0)):
        nd = self.node('ShaderNodeVectorRotate', rotation_type='AXIS_ANGLE')
        self.set(nd.inputs['Vector'], v)
        self.set(nd.inputs['Center'], center)
        self.set(nd.inputs['Axis'], axis)
        self.set(nd.inputs['Angle'], angle)
        return nd.outputs['Vector']

    def rotate_z(self, v, angle):
        nd = self.node('ShaderNodeVectorRotate', rotation_type='Z_AXIS')
        self.set(nd.inputs['Vector'], v)
        self.set(nd.inputs['Angle'], angle)
        return nd.outputs['Vector']

    # ----------------------------------------------------------------- textures
    def noise(self, vec, scale=1.0, detail=2.0, rough=0.5, lac=2.0, dist=0.0,
              ntype='FBM', offset=None, gain=None, normalize=True):
        nd = self.node('ShaderNodeTexNoise', noise_dimensions='3D',
                       noise_type=ntype, normalize=normalize)
        self.set(nd.inputs['Vector'], vec)
        self.set(nd.inputs['Scale'], scale)
        self.set(nd.inputs['Detail'], detail)
        self.set(nd.inputs['Roughness'], rough)
        self.set(nd.inputs['Lacunarity'], lac)
        self.set(nd.inputs['Distortion'], dist)
        if offset is not None:
            self.set(nd.inputs['Offset'], offset)
        if gain is not None:
            self.set(nd.inputs['Gain'], gain)
        return nd

    def fbm(self, vec, scale=1.0, detail=2.0, rough=0.5, lac=2.0, dist=0.0):
        return self.noise(vec, scale, detail, rough, lac, dist).outputs['Fac']

    def voronoi(self, vec, scale=1.0, feature='F1', rand=1.0, detail=0.0,
                rough=0.5, lac=2.0, smooth=1.0, metric='EUCLIDEAN'):
        nd = self.node('ShaderNodeTexVoronoi', voronoi_dimensions='3D',
                       feature=feature, distance=metric)
        self.set(nd.inputs['Vector'], vec)
        self.set(nd.inputs['Scale'], scale)
        self.set(nd.inputs['Randomness'], rand)
        if feature != 'N_SPHERE_RADIUS':
            self.set(nd.inputs['Detail'], detail)
            self.set(nd.inputs['Roughness'], rough)
            self.set(nd.inputs['Lacunarity'], lac)
        if feature == 'SMOOTH_F1':
            self.set(nd.inputs['Smoothness'], smooth)
        return nd

    # ------------------------------------------------------------------- colour
    def ramp(self, fac, stops, interp='LINEAR'):
        """stops: list of (position, (r, g, b)) in *linear* colour."""
        nd = self.node('ShaderNodeValToRGB')
        cr = nd.color_ramp
        cr.interpolation = interp
        els = cr.elements
        while len(els) > 1:
            els.remove(els[-1])
        p0, c0 = stops[0]
        els[0].position = p0
        els[0].color = (*c0, 1.0) if len(c0) == 3 else c0
        for p, c in stops[1:]:
            e = els.new(p)
            e.color = (*c, 1.0) if len(c) == 3 else c
        self.set(nd.inputs['Fac'], fac)
        return nd.outputs['Color']

    def mixc(self, fac, a, b, blend='MIX', clamp=False):
        nd = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend,
                       clamp_result=clamp)
        self.set(sock(nd.inputs, 'Factor_Float'), fac)
        self.set(sock(nd.inputs, 'A_Color'), a)
        self.set(sock(nd.inputs, 'B_Color'), b)
        return sock(nd.outputs, 'Result_Color')

    def mixf(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='FLOAT')
        self.set(sock(nd.inputs, 'Factor_Float'), fac)
        self.set(sock(nd.inputs, 'A_Float'), a)
        self.set(sock(nd.inputs, 'B_Float'), b)
        return sock(nd.outputs, 'Result_Float')

    def mixv(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='VECTOR')
        self.set(sock(nd.inputs, 'Factor_Float'), fac)
        self.set(sock(nd.inputs, 'A_Vector'), a)
        self.set(sock(nd.inputs, 'B_Vector'), b)
        return sock(nd.outputs, 'Result_Vector')

    def cmul(self, a, b):
        return self.mixc(1.0, a, b, blend='MULTIPLY')

    def cscale(self, c, s):
        """colour * scalar"""
        return self.vmath('SCALE', c, scale=s)

    def curve(self, v, pts, clip=False):
        """Float curve. pts = [(x, y), ...] with x in [0, 1]."""
        nd = self.node('ShaderNodeFloatCurve')
        m = nd.mapping
        m.use_clip = clip
        c = m.curves[0]
        c.points[0].location = pts[0]
        c.points[1].location = pts[-1]
        for p in pts[1:-1]:
            c.points.new(*p)
        for p in c.points:
            p.handle_type = 'AUTO'
        m.update()
        self.set(nd.inputs['Value'], v)
        return nd.outputs['Value']

    def blackbody(self, kelvin):
        nd = self.node('ShaderNodeBlackbody')
        self.set(nd.inputs['Temperature'], kelvin)
        return nd.outputs['Color']
