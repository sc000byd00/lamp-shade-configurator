import type { LumaImage } from './geometry/pattern'
import { LITHO_BAND } from './geometry/pattern'
import type { ShadeParams } from './geometry/params'

/** Pixel size of the picture that wraps the shade: matches the band's aspect ratio. */
export function lithoSize(p: ShadeParams): [number, number] {
  const circ = 2 * Math.PI * ((p.radiusBottom + p.radiusTop) / 2)
  const bandH = p.height * (LITHO_BAND[1] - LITHO_BAND[0])
  const w = 900
  return [w, Math.max(60, Math.round((w * bandH) / circ))]
}

function toLuma(ctx: CanvasRenderingContext2D, w: number, h: number): LumaImage {
  const px = ctx.getImageData(0, 0, w, h).data
  const data = new Float32Array(w * h)
  for (let k = 0; k < w * h; k++) {
    // Rec. 709 luma from sRGB, then into linear-ish light for an even tone scale.
    const l = (0.2126 * px[4 * k] + 0.7152 * px[4 * k + 1] + 0.0722 * px[4 * k + 2]) / 255
    data[k] = Math.pow(l, 1.4)
  }
  return { width: w, height: h, data }
}

/** Draws an image scaled to cover the band and returns its luma. */
export function lumaFromImage(img: CanvasImageSource & { width: number; height: number }, size: [number, number]): LumaImage {
  const [w, h] = size
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const s = Math.max(w / img.width, h / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return toLuma(ctx, w, h)
}

export async function lumaFromFile(file: File, size: [number, number]): Promise<LumaImage> {
  const bmp = await createImageBitmap(file)
  try {
    return lumaFromImage(bmp, size)
  } finally {
    bmp.close()
  }
}

/** Built-in sample: night landscape with moon, hills and pines that wraps seamlessly. */
export function sampleLandscape(size: [number, number], seed = 3): LumaImage {
  const [w, h] = size
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  // Sky: light at the horizon, darker at the top.
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#6d6d6d')
  g.addColorStop(0.75, '#f2f2f2')
  g.addColorStop(1, '#ffffff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Moon with a soft halo.
  const mx = w * 0.32
  const my = h * 0.3
  const mr = h * 0.13
  const halo = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 3)
  halo.addColorStop(0, 'rgba(255,255,255,0.9)')
  halo.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(mx, my, mr, 0, Math.PI * 2)
  ctx.fill()
  // Birds.
  ctx.strokeStyle = '#333'
  ctx.lineWidth = Math.max(1.5, h * 0.008)
  for (let k = 0; k < 5; k++) {
    const bx = w * (0.55 + 0.08 * k + 0.03 * rnd())
    const by = h * (0.18 + 0.1 * rnd())
    const bs = h * 0.025
    ctx.beginPath()
    ctx.moveTo(bx - bs, by)
    ctx.quadraticCurveTo(bx - bs / 2, by - bs * 0.6, bx, by)
    ctx.quadraticCurveTo(bx + bs / 2, by - bs * 0.6, bx + bs, by)
    ctx.stroke()
  }
  // Hill layers, periodic in x so the seam is invisible.
  const layer = (base: number, amp: number, shade: string, waves: number[]) => {
    ctx.fillStyle = shade
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 2) {
      const u = (x / w) * Math.PI * 2
      let y = 0
      waves.forEach((f, i) => (y += Math.sin(u * f + i * 1.7) / (i + 1)))
      ctx.lineTo(x, h * base - y * amp * h)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
  layer(0.62, 0.08, '#a8a8a8', [2, 5, 9])
  layer(0.74, 0.06, '#6a6a6a', [3, 7, 13])
  // Pines on the front hill.
  const pine = (x: number, base: number, ph: number) => {
    ctx.fillStyle = '#1c1c1c'
    for (let k = 0; k < 4; k++) {
      const y0 = base - (ph * k) / 4.2
      const bw = (ph * (4 - k)) / 9
      ctx.beginPath()
      ctx.moveTo(x - bw, y0)
      ctx.lineTo(x + bw, y0)
      ctx.lineTo(x, y0 - ph / 2.6)
      ctx.closePath()
      ctx.fill()
    }
    ctx.fillRect(x - ph * 0.02, base, ph * 0.04, ph * 0.08)
  }
  layer(0.86, 0.04, '#2a2a2a', [4, 11])
  for (let k = 0; k < 22; k++) {
    const x = w * ((k + rnd() * 0.6) / 22)
    pine(x, h * (0.86 + 0.02 * rnd()), h * (0.18 + 0.16 * rnd()))
  }
  return toLuma(ctx, w, h)
}
