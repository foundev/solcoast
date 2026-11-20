# Third-Party 3D & PBR Assets

Sol Coast code is MIT-licensed ([LICENSE](LICENSE)). The bundled 3D models, HDRI environments, and photographic PBR textures in `public/assets/` retain their respective creators' licenses and attributions:

## 3D Models (`public/assets/models/`)

- **`ferrari.glb`** — Ferrari 458 Italia 3D model by **vicent091036** (via Three.js examples / Sketchfab).
  - License: **CC BY 4.0** (Creative Commons Attribution 4.0 International).
- **`person_sam.glb`, `person_maya.glb`, `person_jordan.glb`, `person_harper.glb`** — Animated civilian human characters (*Locomotion Collection* — Sam, Maya, Jordan, Harper) from the **Innerscene Free 3D Parts Library** (adapted from MakeHuman/MPFB assets), with embedded `Idle_Standing`, `Walk_Relaxed`, `Walk_Brisk`, `Jog`, and `Run` clips (embedded textures optimized to 1K JPEG/PNG via `scripts/optimize-glbs.py`).
  - License: **CC0 1.0 (Public Domain)**.

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

## Re-fetching & Optimizing Assets

```bash
node scripts/fetch-assets.mjs
python3 scripts/optimize-glbs.py public/assets/models/person_*.glb
```
