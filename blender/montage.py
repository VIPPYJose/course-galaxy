"""Contact sheet of renders (dev helper).
Blender -b --factory-startup -P blender/montage.py -- out.png cols img1.png img2.png ...
"""
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
out, cols, files = argv[0], int(argv[1]), argv[2:]
imgs = []
for f in files:
    im = bpy.data.images.load(f)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    imgs.append(a.reshape(h, w, 4))
h = max(i.shape[0] for i in imgs)
w = max(i.shape[1] for i in imgs)
rows = (len(imgs) + cols - 1) // cols
sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
sheet[:, :, 3] = 1
for k, a in enumerate(imgs):
    r, c = divmod(k, cols)
    r = rows - 1 - r  # blender images are bottom-up
    sheet[r * h:r * h + a.shape[0], c * w:c * w + a.shape[1]] = a
res = bpy.data.images.new('sheet', cols * w, rows * h, alpha=False)
res.pixels.foreach_set(sheet.ravel())
res.filepath_raw = out
res.file_format = 'PNG'
res.save()
print('[montage] saved', out)
