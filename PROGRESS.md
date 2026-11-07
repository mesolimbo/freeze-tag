# Freeze tag asset rebuild: progress

Goal: rebuild the playground from `raw/Game.tsx` in `models.blend` with better assets from Comfy Cloud.

## Recovery

- Blender bridge: `python C:/Users/mesol/workspace/blender-bridge/bridge_client.py script.py` (port 9876).
- Backups: `tools/blender_checkpoint.py` saves `models.blend` every 5 minutes and rotates `backups/models.{0..3}.blend`. Rerun it after a Blender restart. It registers the timer and saves at once.
- Comfy output links expire. Call `get_output` with a job ID for fresh ones.
- Python tools run with `python -m pipenv run python ...`.

## Decisions

- Each prop is built alone in `assets/blends/<name>.blend`, holding only its low-poly result. `python tools/run_props.py` skips props whose file exists, then merges them all into `models.blend`. High-res sources stay out of `models.blend`: the GLBs are in `assets/models_raw/`, the kid's high mesh in `assets/blends/kid_source.blend`.
- Quad Remesher input must be a clean voxel mesh of at most about 120k faces. Denser or decimated input stalls it. Hard-edge detection is off except on tower_red. `run_props.py` limits each attempt to 240 seconds, then retries coarser.
- A shell thinner than a voxel gets holes. Give that prop a `thicken` value in `PROPS` (tower_red roof).

- Remesh with Quad Remesher 1.4 (`bpy.ops.qremesher.remesh`), never QuadriFlow. It is modal: call it with a window override, then let control return to Blender. Result object: `Retopo_<input>`.
- Feed it a voxel remesh, because glTF imports are split along UV seams.
- Kid: game height 1.717 m, feet at z=0, faces +Y (the game's -Z). Game (x, y, z) maps to Blender (x, -z, y).
- Kid variants come from `tools/recolor_kids.py`, using `KIDS_CONFIG` colors. They need no AI edit, so the UVs stay aligned.

## Comfy jobs (TRELLIS.2 template `3d_pixal3d_trellis2_image_to_model`)

Download output from node 322, the `Save3DAdvanced` GLB, into `assets/models_raw/<name>.glb`.

- kid: bb0f28a9-cd20-47e2-a377-bd4f777fa449 (downloaded)
- tree: b13706a4-8cd0-4fdf-9cf4-5d98ed921ffa
- bench: 7bb16b07-e4c7-42d2-850e-c2da5b8191aa
- fence: 39fdfbbc-6887-4b95-92a8-9280b5d48a39
- tower_red: 0ada034f-1989-4c7a-ac76-04fb6c2b432d
- tower_blue: 6464c255-f387-4446-a3e3-200d4dee229d
- bridge: d66bfc49-03dd-4a60-8d53-bb35c4559f3e
- slide: f5337eb9-05e7-44b6-ae0c-3642f2e15ff5
- stairs: c509df7f-48ed-43dc-8328-4d1dfa0a6fb4
- swing: 34baf82f-53fb-4e51-8e28-fcc317c5f32c
- seesaw: 9960adcc-db00-47f0-8eea-6584817397d5
- sandbox: 3e1e381b-f146-4870-9c38-4e3ef9073f24

## Status

- [x] Concepts and ground materials (`assets/concepts`, `assets/materials`)
- [x] Kid remeshed and baked, 5 color variants placed at game spawn points
- [x] 11 props remeshed and baked (`assets/blends/<name>.blend`), merged into `models.blend` collection Assets
- [x] Playground laid out by `tools/layout_playground.py` (collection Playground), renders in `assets/renders`
- [x] Browser version: `models_low.blend`, built by `python tools/run_low.py` into `assets/blends_low` and `assets/textures_low`. 57.6k triangles, 3.9 MB test GLB with WebP textures at quality 80. Renders in `assets/renders_low`.
- [ ] Known blemishes up close: pale bands on the red tower rails, ragged tree roots and fence post tops
- [ ] Not started: rig and animate the kid, export to the game
