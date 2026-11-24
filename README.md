# Lamp Shade Configurator

Design a 3D-printable lamp shade in the browser. Pick a shape and a surface pattern, wrap your own photo around it as a lithophane, switch the light on to see how the wall glows, and download a watertight STL or 3MF. The design checks run on every change, so you can see before you print whether the shade fits your printer, whether the wall is thick enough and where it overhangs.

Everything runs in the browser. Nothing is uploaded, photos included.

## Features

- **Five base shapes:** drop, bell, globe, cone and cylinder. Height, radii and belly are set with sliders.
- **Six surfaces:** twisted ribs, waves, facets, voronoi cells, lithophane and plain. Ribs, waves and facets move the whole wall, so it keeps an even thickness and prints like a vase. Voronoi and lithophane change only the outside, so the thickness varies and light comes through unevenly.
- **Lithophane** from a built-in sample or your own picture. Light pixels become thin wall (0.6–1.5 mm), dark pixels thick wall (2–4 mm), on a band around the shade with a plain frame above and below.
- **Light preview:**
  - Glow through the wall depends on the local thickness, the view angle and the distance to the bulb, so the ribs and the lithophane show up the way they do on the real part.
  - The bulb casts shadows on the room, and the light colour can be set to 2700 K or 4000 K.
- **Fitting:**
  - A bottom plate with a hole for the lamp holder, shown as a table lamp or a pendant.
  - Or an open bottom for an LED puck.
- **Print checks:**
  - Fit on the chosen printer.
  - Thinnest wall, measured along the surface normal so rib flanks count.
  - Overhang share and the steepest angle, with a coloured overhang view.
  - Plate ring around the holder hole and room for the bulb.
- **Estimates:** weight per material and a rough print time.
- **Export:**
  - Binary STL and 3MF (core spec, millimetres, centred on a 256 mm plate).
  - Each export is checked first: closed, consistently oriented, no degenerate triangles. A shade that fails the bed or hole check is not exported.

## Numbers

| | |
| --- | --- |
| Bundle | about 390 kB gzip, one page, no server |
| Mesh | 156k triangles for patterns, up to about 1.2M for a lithophane (0.5 mm grid) |
| Build time | 50–130 ms for ribs, waves and facets, about 0.4 s for voronoi, 0.6 s for a lithophane. Built in a web worker, so the sliders stay responsive. |
| Tests | 66: every shape × pattern × fitting gives a closed, outward-facing mesh with the right height. Also volume against the analytic value, wall thickness, lithophane mapping, overhang detection, STL and 3MF structure. |

Exports were checked outside the app as well: four sample shades read as one closed shell with no open, non-manifold or inconsistent edges.

## How it works

The shade is a grid of rings, one ring per height step and a fixed number of points around. For each point:

1. The base profile gives a radius at that height.
2. The pattern adds an outward offset.
3. The inner surface is placed one wall thickness inside. The wall is measured normal to the profile, so sloped walls are not thinner than set.
4. The rims, the bottom plate and the hole wall close the solid.

Points on the seam are shared, so the mesh is closed by construction; the tests check it for every combination.

```
src/geometry/   shape profile, patterns, mesh, analysis, checks, STL/3MF writers (no browser code, unit tested)
src/worker.ts   builds the mesh off the main thread
src/scene/      three.js scene: shade material with the glow shader, lamp, room
src/App.tsx     controls, presets, check report, downloads
```

## Run locally

```bash
npm ci
npm run dev       # http://localhost:5173
npm test
npm run build     # static site in dist/
```

## Limits

- The lamp holder hole is a free value. Measure the thread of your holder; sizes vary between makers.
- PLA softens at about 60 °C. Use LED bulbs only and keep the shade away from halogen or filament bulbs.
- The print time is a rough estimate. The slicer gives the real one.
- The light preview is a real-time approximation, not a physical light simulation.

## License

MIT
