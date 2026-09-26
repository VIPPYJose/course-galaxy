"""Headless entry point for heavy work (renders / bakes) so the Blender UI stays free.

    Blender -b --factory-startup -P blender/cli.py -- portrait terra,dune --samples 48 --res 700
    Blender -b --factory-startup -P blender/cli.py -- flat terra --res 1024
    Blender -b --factory-startup -P blender/cli.py -- bake all
"""
import sys
import os
import time
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import planetgen.build as B  # noqa: E402


def enable_gpu():
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'METAL'
    except Exception as e:  # pragma: no cover
        print('GPU setup failed:', e)


def clean_default_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd')
    ap.add_argument('pids')
    ap.add_argument('--samples', type=int, default=48)
    ap.add_argument('--res', type=int, default=700)
    ap.add_argument('--out', default=None)
    ap.add_argument('--suffix', default='')
    a = ap.parse_args(argv)
    enable_gpu()
    clean_default_scene()
    pids = B.ORDER if a.pids == 'all' else a.pids.split(',')
    t0 = time.time()
    if a.cmd == 'scene':
        # full production file: planet library + lab + galaxy scene, saved to blender/galaxy.blend
        import planetgen.galaxy_scene as G
        B.build_all(B.ORDER)
        G.build_galaxy_scene()
        bpy.context.window_manager  # noqa
        bpy.data.scenes['Galaxy'].render.filepath = os.path.join(B.RENDERS, 'galaxy_hero.png')
        # the startup scene becomes the (empty) bake scene; open the file on 'Galaxy'
        for s in list(bpy.data.scenes):
            if s.name not in ('Galaxy', 'Planet Lab', 'Bake'):
                s.name = 'Bake'
        for wm in bpy.data.window_managers:
            for win in wm.windows:
                win.scene = bpy.data.scenes['Galaxy']
        blend = os.path.join(HERE, 'galaxy.blend')
        bpy.ops.wm.save_as_mainfile(filepath=blend)
        bpy.ops.file.make_paths_relative()
        bpy.ops.wm.save_mainfile()
        print('[cli] saved', blend, f'in {time.time() - t0:.1f}s')
        if a.samples > 0:
            t = time.time()
            out = a.out or os.path.join(B.RENDERS, 'galaxy_hero.png')
            G.render_galaxy(out, samples=a.samples, res=(a.res, round(a.res * 9 / 16)))
            G.render_galaxy(out.replace('hero', 'system'), samples=a.samples,
                            res=(a.res, round(a.res * 9 / 16)), camera='SystemCam')
            print(f'[cli] galaxy render in {time.time() - t:.1f}s')
        return
    B.build_all(pids)
    print(f'[cli] built {pids} in {time.time() - t0:.1f}s')
    for pid in pids:
        t = time.time()
        if a.cmd == 'portrait':
            out = a.out or os.path.join(B.RENDERS, f'_preview_{pid}{a.suffix}.png')
            B.render_portrait(pid, out, samples=a.samples, res=(a.res, a.res))
        elif a.cmd == 'flat':
            out = a.out or os.path.join(B.RENDERS, f'_flat_{pid}{a.suffix}.png')
            B.flat_preview(pid, out, width=a.res)
        elif a.cmd == 'bake':
            info = B.bake_planet(pid)
            print('[cli] baked', info)
        elif a.cmd == 'thumbs':
            print('[cli] thumb', B.thumbnail(pid, samples=a.samples))
        print(f'[cli] {a.cmd} {pid} done in {time.time() - t:.1f}s')
    if a.cmd in ('bake', 'thumbs', 'manifest'):
        print('[cli] manifest', B.write_manifest())


main()
