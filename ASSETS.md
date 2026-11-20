# Third-Party 3D & PBR Assets

Sol Coast code is MIT-licensed ([LICENSE](LICENSE)). The bundled 3D models, HDRI environments, and photographic PBR textures in `public/assets/` retain their respective creators' licenses and attributions:

## 3D Models (`public/assets/models/`)

- **`ferrari.glb`** — Ferrari 458 Italia 3D model by **vicent091036** (via Three.js examples / Sketchfab).
  - License: **CC BY 4.0** (Creative Commons Attribution 4.0 International).
- **`character.glb`** — Rigged humanoid character (`Soldier.glb`) with `Idle`, `Walk`, and `Run` skeletal animations.
  - Origin: **Mixamo / Adobe** (via Three.js examples).

## HDRI Sky & Reflection Maps (`public/assets/hdri/`)

All HDRI environment maps are from **Poly Haven** and released under **CC0 1.0 (Public Domain)**:

- **`sunset.hdr`** — *Venice Sunset* (1K) by Greg Zaal / Poly Haven (CC0)
- **`midday.hdr`** — *Kloofendal 48d Partly Cloudy (Pure Sky)* (1K) by Greg Zaal & Jarod Guest / Poly Haven (CC0)
- **`night.hdr`** — *Moonless Golf* (1K) by Greg Zaal / Poly Haven (CC0)

## Photographic PBR Textures (`public/assets/textures/`)

All photographic PBR texture maps (Diffuse, OpenGL Normal, Roughness) are from **Poly Haven** under **CC0 1.0 (Public Domain)**:

- **`asphalt_*`** — *Asphalt 02* (1K, CC0)
- **`sand_*`** — *Sand 01* (1K, CC0)
- **`wood_*`** — *Wood Planks* (1K, CC0)
- **`concrete_*`** — *Concrete Floor 02* (1K, CC0)

## Re-fetching Assets

Run `node scripts/fetch-assets.mjs` to re-download all assets locally into `public/assets/`.
