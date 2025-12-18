import { useEffect, useRef } from 'react'
import { WebGPURippleGrid, type RGB } from '@/lib/webgpu-grid'

interface AnimatedGridBackgroundProps {
  gridColor: RGB
  bgColor: RGB
}

export function AnimatedGridBackground({ gridColor, bgColor }: AnimatedGridBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<WebGPURippleGrid | null>(null)

  // Initialize WebGPU on mount
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const grid = new WebGPURippleGrid(canvas)

    grid.setColors(gridColor, bgColor)

    grid
      .init()
      .then(() => {
        if (!cancelled) {
          gridRef.current = grid
          grid.start()
        } else {
          // If cancelled during init, clean up
          grid.destroy()
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('WebGPU initialization failed:', err)
        }
      })

    return () => {
      cancelled = true
      if (gridRef.current) {
        gridRef.current.destroy()
        gridRef.current = null
      } else {
        // Grid might still be initializing, destroy it anyway
        grid.destroy()
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update colors when theme changes
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.setColors(gridColor, bgColor)
    }
  }, [gridColor, bgColor])

  return <canvas ref={canvasRef} className="animated-grid-canvas" />
}
