"""Prepare the web game's assets for upload to Roblox, into roblox/upload/.

Roblox rejects WebP, so every texture is re-encoded: PNG for loose images, and inside the models JPEG for
opaque textures, which keeps the park under the 20 MB upload limit. The park is reduced to one copy of each prop
(roblox/upload/park_props.glb); park_layout.json lists where every copy goes, so Studio can clone them
and all copies share one mesh asset.

Run with: pipenv run python tools/roblox_assets.py
"""

import io
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'game' / 'public' / 'assets'
OUT = ROOT / 'roblox' / 'upload'
# Roblox downsizes anything larger, so sending more only slows the upload.
MAX_TEXTURE = 1024


def read_glb(path):
    data = path.read_bytes()
    json_len = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    bin_len = struct.unpack('<I', data[20 + json_len:24 + json_len])[0]
    return gltf, data[bin_start:bin_start + bin_len]


def write_glb(path, gltf, binary):
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(text) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(text), b'JSON'))
        f.write(text)
        f.write(struct.pack('<I4s', len(binary), b'BIN\0'))
        f.write(binary)


def to_png(raw):
    image = Image.open(io.BytesIO(raw))
    image = image.convert('RGBA' if 'A' in image.getbands() else 'RGB')
    if max(image.size) > MAX_TEXTURE:
        image.thumbnail((MAX_TEXTURE, MAX_TEXTURE), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, 'PNG', optimize=True)
    return out.getvalue()


def to_model_texture(raw):
    """JPEG for opaque images, PNG where transparency has to survive."""
    image = Image.open(io.BytesIO(raw))
    if 'A' in image.getbands() and image.getchannel('A').getextrema()[0] < 255:
        return to_png(raw), 'image/png'
    image = image.convert('RGB')
    if max(image.size) > MAX_TEXTURE:
        image.thumbnail((MAX_TEXTURE, MAX_TEXTURE), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, 'JPEG', quality=95, subsampling=0)
    return out.getvalue(), 'image/jpeg'


def convert_textures(gltf, binary):
    """Re-encode embedded WebP images and rebuild the binary chunk around them."""
    image_views = {image['bufferView']: image for image in gltf.get('images', [])}
    rebuilt = bytearray()
    for index, view in enumerate(gltf['bufferViews']):
        start = view.get('byteOffset', 0)
        chunk = binary[start:start + view['byteLength']]
        if index in image_views:
            chunk, image_views[index]['mimeType'] = to_model_texture(chunk)
        rebuilt += b'\0' * (-len(rebuilt) % 4)
        view['byteOffset'] = len(rebuilt)
        view['byteLength'] = len(chunk)
        rebuilt += chunk
    for texture in gltf.get('textures', []):
        webp = texture.get('extensions', {}).pop('EXT_texture_webp', None)
        if webp:
            texture['source'] = webp['source']
        if not texture.get('extensions'):
            texture.pop('extensions', None)
    for key in ('extensionsUsed', 'extensionsRequired'):
        kept = [name for name in gltf.get(key, []) if name != 'EXT_texture_webp']
        if kept:
            gltf[key] = kept
        else:
            gltf.pop(key, None)
    gltf['buffers'] = [{'byteLength': len(rebuilt)}]
    return bytes(rebuilt)


def convert_park():
    gltf, binary = read_glb(ASSETS / 'park.glb')
    binary = convert_textures(gltf, binary)
    layout = []
    firsts = {}
    for node in gltf['nodes']:
        assert 'children' not in node, 'park nodes are expected to be flat'
        if 'mesh' not in node:
            continue
        prop = gltf['meshes'][node['mesh']]['name']
        firsts.setdefault(node['mesh'], node)
        layout.append({
            'name': node['name'],
            'prop': firsts[node['mesh']]['name'],
            'mesh': prop,
            'translation': node.get('translation', [0, 0, 0]),
            'rotation': node.get('rotation', [0, 0, 0, 1]),
            'scale': node.get('scale', [1, 1, 1]),
        })
    gltf['nodes'] = list(firsts.values())
    gltf['scenes'] = [{'nodes': list(range(len(gltf['nodes'])))}]
    gltf['scene'] = 0
    write_glb(OUT / 'park_props.glb', gltf, binary)
    (OUT / 'park_layout.json').write_text(json.dumps(layout, indent=1) + '\n')


def convert_kid():
    gltf, binary = read_glb(ASSETS / 'kid.glb')
    binary = convert_textures(gltf, binary)
    write_glb(OUT / 'kid.glb', gltf, binary)


def convert_images():
    for source in sorted(ASSETS.glob('*.webp')):
        (OUT / f'{source.stem}.png').write_bytes(to_png(source.read_bytes()))


# The Roblox importer keeps the kid's skeleton but drops its animation clips, so they travel as a Luau table that the
# game samples to pose the bones. Open Cloud cannot upload scripts, so paste the generated KidClips.luau (under
# roblox/src) into the ReplicatedStorage.FreezeTag.KidClips ModuleScript. Slow clips keep every Nth frame to stay small; the step must
# divide the clip's last frame so the loop point survives.
FRAME_STEP = {'idle': 12, 'walk': 2}
COMPONENTS = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}


def read_accessor(gltf, binary, index):
    accessor = gltf['accessors'][index]
    view = gltf['bufferViews'][accessor['bufferView']]
    width = COMPONENTS[accessor['type']]
    assert accessor['componentType'] == 5126 and 'byteStride' not in view
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    values = struct.unpack_from(f'<{accessor["count"] * width}f', binary, start)
    return [values[i:i + width] for i in range(0, len(values), width)]


def luau_numbers(rows):
    return '{' + ','.join(f'{round(value, 3):g}' for row in rows for value in row) + '}'


def convert_kid_clips():
    gltf, binary = read_glb(ASSETS / 'kid.glb')
    clips = []
    for animation in gltf['animations']:
        step = FRAME_STEP.get(animation['name'], 1)
        duration = 0.0
        tracks = {'rotation': [], 'translation': []}
        for channel in animation['channels']:
            path = channel['target']['path']
            if path == 'scale':
                continue
            sampler = animation['samplers'][channel['sampler']]
            times = read_accessor(gltf, binary, sampler['input'])
            keys = read_accessor(gltf, binary, sampler['output'])
            duration = max(duration, times[-1][0])
            node = gltf['nodes'][channel['target']['node']]
            # Channels that never change are exported as two identical keys.
            if all(key == keys[0] for key in keys):
                keys = keys[:1]
                rest = node.get('translation', [0, 0, 0])
                if path == 'translation' and max(abs(a - b) for a, b in zip(keys[0], rest)) < 1e-3:
                    continue  # the bone's rest position already says this
            else:
                assert (len(keys) - 1) % step == 0
                keys = keys[::step]
            tracks[path].append(f'{node["name"]}={luau_numbers(keys)}')
        lines = [f'\t{animation["name"]} = {{', f'\t\tduration = {duration:.6g},', f'\t\tstep = {step / 30:.6g},']
        for path, rows in tracks.items():
            lines += [f'\t\t{path} = {{'] + [f'\t\t\t{row},' for row in rows] + ['\t\t},']
        clips.append('\n'.join(lines + ['\t},']))
    header = [
        '-- Generated by tools/roblox_assets.py from kid.glb. Each bone lists its local rotation (quaternion x, y, z, w)',
        '-- or translation (x, y, z, in metres) every `step` seconds. One key means the value is constant, and a',
        '-- bone with no translation stays at its rest position.',
        'return {',
    ]
    source = '\n'.join(header + clips + ['}', ''])
    target = ROOT / 'roblox' / 'src' / 'ReplicatedStorage' / 'FreezeTag' / 'KidClips.luau'
    target.write_text(source.replace('-0,', '0,').replace('-0}', '0}'))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    convert_park()
    convert_kid()
    convert_images()
    convert_kid_clips()
    (OUT / 'ice_blocks.glb').write_bytes((ASSETS / 'ice_blocks.glb').read_bytes())
    (OUT / 'music.mp3').write_bytes((ASSETS / 'music.mp3').read_bytes())
    for path in sorted(OUT.iterdir()):
        print(f'{path.stat().st_size / 1e6:7.2f} MB  {path.name}')


if __name__ == '__main__':
    main()
