import { useEffect, useRef, useState } from 'react'
import type { ShadeParams } from './geometry/params'
import type { LumaImage } from './geometry/pattern'
import type { BuildRequest, BuildResult } from './worker'

/** Builds the shade in a worker; only the newest request is applied. */
export function useShade(params: ShadeParams, image: LumaImage | undefined, overhangLimit: number) {
  const workerRef = useRef<Worker | null>(null)
  const latest = useRef(0)
  const busy = useRef(false)
  const pending = useRef<BuildRequest | null>(null)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w
    w.onmessage = (e: MessageEvent<BuildResult>) => {
      busy.current = false
      if (e.data.id === latest.current) {
        setResult(e.data)
        setWorking(false)
      }
      const next = pending.current
      if (next) {
        pending.current = null
        busy.current = true
        w.postMessage(next)
      }
    }
    return () => w.terminate()
  }, [])

  useEffect(() => {
    const w = workerRef.current
    if (!w) return
    const req: BuildRequest = { id: ++latest.current, params, image, overhangLimit }
    setWorking(true)
    if (busy.current) {
      pending.current = req
    } else {
      busy.current = true
      w.postMessage(req)
    }
  }, [params, image, overhangLimit])

  return { result, working }
}
