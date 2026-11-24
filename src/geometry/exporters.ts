import { strToU8, zipSync } from 'fflate'
import type { ShadeMesh } from './shade'

/** Binary STL, mm, Z up. */
export function toStl(mesh: ShadeMesh, name = 'lamp-shade'): Uint8Array {
  const P = mesh.positions
  const I = mesh.indices
  const n = I.length / 3
  const buf = new ArrayBuffer(84 + 50 * n)
  const dv = new DataView(buf)
  const head = `binary STL ${name}`.slice(0, 80)
  for (let k = 0; k < head.length; k++) dv.setUint8(k, head.charCodeAt(k))
  dv.setUint32(80, n, true)
  let o = 84
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], b = 3 * I[f + 1], c = 3 * I[f + 2]
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    dv.setFloat32(o, nx, true)
    dv.setFloat32(o + 4, ny, true)
    dv.setFloat32(o + 8, nz, true)
    o += 12
    for (const v of [a, b, c]) {
      dv.setFloat32(o, P[v], true)
      dv.setFloat32(o + 4, P[v + 1], true)
      dv.setFloat32(o + 8, P[v + 2], true)
      o += 12
    }
    dv.setUint16(o, 0, true)
    o += 2
  }
  return new Uint8Array(buf)
}

const fmt = (x: number) => {
  const s = x.toFixed(4)
  return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * 3MF core spec: one object, one build item centred on a 256 mm plate.
 * The slicer reads units, the object name and the colour as a base material.
 */
export function to3mf(
  mesh: ShadeMesh,
  opts: { name: string; colorHex: string; plateCentre?: [number, number]; metadata?: Record<string, string> },
): Uint8Array {
  const P = mesh.positions
  const I = mesh.indices
  const [cx, cy] = opts.plateCentre ?? [128, 128]
  const verts: string[] = []
  for (let k = 0; k < P.length; k += 3) {
    verts.push(`<vertex x="${fmt(P[k])}" y="${fmt(P[k + 1])}" z="${fmt(P[k + 2])}"/>`)
  }
  const tris: string[] = []
  for (let f = 0; f < I.length; f += 3) {
    tris.push(`<triangle v1="${I[f]}" v2="${I[f + 1]}" v3="${I[f + 2]}"/>`)
  }
  const meta = Object.entries({ Title: opts.name, Application: 'Lamp Shade Configurator', ...opts.metadata })
    .map(([k, v]) => `<metadata name="${esc(k)}">${esc(v)}</metadata>`)
    .join('')
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    meta +
    `<resources>` +
    `<basematerials id="1"><base name="${esc(opts.name)}" displaycolor="${opts.colorHex.toUpperCase()}FF"/></basematerials>` +
    `<object id="2" type="model" name="${esc(opts.name)}" pid="1" pindex="0"><mesh>` +
    `<vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles>` +
    `</mesh></object></resources>` +
    `<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 ${cx} ${cy} 0"/></build></model>`
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`
  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  )
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
