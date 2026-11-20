# Third-Party 3D & PBR Assets

Sol Coast code is MIT-licensed ([LICENSE](LICENSE)). The bundled 3D models, motion-capture animations, HDRI environments, and photographic PBR textures in `public/assets/` retain their respective creators' licenses and attributions:

## 3D Models & Motion-Capture Animations

- **`public/assets/models/ferrari.glb`** — Ferrari 458 Italia 3D model by **vicent091036** (via Three.js examples / Sketchfab).
  - License: **CC BY 4.0** (Creative Commons Attribution 4.0 International).
- **`public/assets/models/avatar_5.glb`** — Exclusive street-tough protagonist avatar (black sleeveless tank, distressed black jeans, beard, equipped with dark street shades & gold Cuban chain) from **Ready Player Me** (`readyplayerme/animation-library-demo`).
- **`public/assets/models/avatar_1..4.glb`, `avatar_6.glb`, `avatar_7.glb`** — 6 distinct sidewalk civilian avatars from **Ready Player Me** (`readyplayerme/animation-library-demo`) and **TalkingHead** (`met4citizen/TalkingHead`, MIT).
  - License: **MIT / Ready Player Me Sample Assets**.
- **`public/assets/animations/anim_idle.glb`, `anim_walk.glb`, `anim_run.glb`, `anim_jump.glb`** — Studio optical motion-capture locomotion animations (`M_Standing_Idle_001`, `M_Walk_001`, `M_Run_001`, `M_Jog_Jump_001`) from **Ready Player Me Animation Library** (`readyplayerme/animation-library`).
  - License: **MIT License**.

## HDRI Sky & Reflection Maps (`public/assets/hdri/`)

All HDRI environment maps are **Pure Sky** (sky-only, ground removed) environments from **Poly Haven** under **CC0 1.0 (Public Domain)**:

- **`sunset.hdr`** — *Qwantani Sunset (Pure Sky)* (1K) by Greg Zaal / Poly Haven (CC0)
- **`midday.hdr`** — *Kloofendal 48d Partly Cloudy (Pure Sky)* (1K) by Greg Zaal & Jarod Guest / Poly Haven (CC0)
- **`night.hdr`** — *Qwantani Night (Pure Sky)* (1K) by Greg Zaal / Poly Haven (CC0)

## Photographic PBR Textures (`public/assets/textures/`)

All photographic PBR texture maps (Diffuse, OpenGL Normal, Roughness) are from **Poly Haven** under **CC0 1.0 (Public Domain)**:

- **`asphalt_*`** — *Asphalt 02* (1K, CC0)
- **`sand_*`** — *Sand 01* (1K, CC0)
- **`wood_*`** — *Wood Planks* (1K, CC0)
- **`concrete_*`** — *Concrete Floor 02* (1K, CC0)

## Re-fetching Assets

```bash
node scripts/fetch-assets.mjs
```
