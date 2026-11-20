# Sol Coast

A 3D Miami-inspired persistent open-world driving and on-foot exploration sandbox built with **TypeScript**, **Three.js** (PBR + Unreal Bloom + custom ocean & sky shaders), and **Vite**.

## Features

- **Coastal Miami-Inspired Open World (8 Districts)**
  - **Ocean Drive**: Pastel Art Deco hotels, glowing neon trims, palm-lined coastal boulevard.
  - **Sol Beach & Boardwalk**: Golden sloping sand, turquoise animated GLSL Atlantic ocean, lifeguard towers, umbrellas, and palm promenade.
  - **South Pier**: Ramp-accessible wooden pier jutting into the ocean with a glowing lighthouse pavilion.
  - **Key Sol**: Arched neon causeway bridge over the bay leading to a luxury villa island loop.
  - **Downtown Biscayne**: Reflective glass skyline towers with night-lit windows.
  - **Neon Strip**: Electric Midtown clubs and marquees.
  - **Palm Plaza**: Central walkable park and glowing tiered fountain.
  - **Marina Cove**: Waterfront promenade, boat docks, and bobbing luxury yachts.
- **Seamless Driving & On-Foot Exploration**
  - Start in your modern **Solstice GT** sports coupe, or find and drive 3 other modern vehicles parked around the city (**Biscayne EV**, **Key Sol Spyder**, **Neon Apex**).
  - Arcade-sim driving physics with speed-sensitive steering, handbrake drifting (`Space`), dynamic suspension pitch/roll, headlights (`L`), horn (`H`), and 6 metallic Miami paint finishes (`P`).
  - Press `E` anytime to hop out and explore beaches, sidewalks, Palm Plaza, marina docks, and South Pier on foot (walk, sprint, jump, orbit camera).
- **6 Open-World Missions**
  - Approach any glowing cyan beacon and press `E` to launch missions — including coastal checkpoint races, timed neon courier runs, on-foot beachfront exploration, hybrid drive-and-run pier drops, and vehicle-specific valet deliveries.
  - Press `M` anytime to set your minimap GPS to the nearest mission.
- **Persistent World State**
  - Automatically saves to `localStorage` (every 15s, on enter/exit car, on mission complete, on paint change, and on exit — plus `F5` quick save and JSON export in the `Esc` menu).
  - Persists your exact position, whether you are on foot or driving, where every vehicle was parked, custom paint finishes, odometer mileage, cash, rank, discovered districts, completed missions & best times, and time of day.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (default `http://localhost:5173`).

## Controls

| Input | Action |
|---|---|
| `W A S D` / Arrows | Drive / Move on foot |
| `Space` | Handbrake Drift (in car) / Jump (on foot) |
| `Shift` | Sprint (on foot) |
| `E` / `F` | Enter or Exit car / Start Mission at beacon |
| Mouse drag + Wheel | Orbit camera / Zoom |
| `C` | Cycle camera angle (Chase / Far / Hood) |
| `M` | Set minimap GPS to nearest mission |
| `X` | Cancel active mission |
| `T` | Cycle Time of Day (Golden Hour / Neon Night / Dawn / Midday) |
| `P` | Repaint current vehicle |
| `L` | Toggle headlights |
| `H` | Horn |
| `U` | Toggle procedural audio |
| `F5` | Quick Save |
| `Esc` | Pause / World Menu (Missions, Export Save, Reset World) |

## Scripts

```bash
npm test       # Run Vitest unit suite (world, physics, missions, persistence)
npm run build  # Type-check and build production bundle
```

## License

MIT — see [LICENSE](LICENSE).
