// WebGPU Animated Grid Module
// Adapted from 3fz.org wavy grid effect

import wavyGridShader from './shaders/wavy-grid.wgsl?raw'

interface Ripple {
  x: number
  y: number
  startTime: number
  strength: number
  active: boolean
}

class RippleManager {
  private maxRipples: number
  private ripples: Ripple[]
  private nextRippleIndex: number
  private lastRippleTime: number
  private minRippleInterval: number
  private maxAge: number
  private activeRippleCount: number
  private rippleData: Float32Array

  constructor(maxRipples = 128) {
    this.maxRipples = maxRipples
    this.ripples = new Array(maxRipples)
    for (let i = 0; i < maxRipples; i++) {
      this.ripples[i] = {
        x: 0,
        y: 0,
        startTime: 0,
        strength: 0,
        active: false,
      }
    }

    this.nextRippleIndex = 0
    this.lastRippleTime = 0
    this.minRippleInterval = 25
    this.maxAge = 2.0
    this.activeRippleCount = 0
    this.rippleData = new Float32Array(this.maxRipples * 4)
  }

  addRipple(x: number, y: number, timestamp: number): void {
    if (timestamp - this.lastRippleTime < this.minRippleInterval) {
      return
    }

    const ripple = this.ripples[this.nextRippleIndex]
    ripple.x = x
    ripple.y = y
    ripple.startTime = timestamp / 1000.0
    ripple.strength = 1.0
    ripple.active = true

    this.nextRippleIndex = (this.nextRippleIndex + 1) % this.maxRipples
    this.lastRippleTime = timestamp
  }

  update(timestamp: number): { data: Float32Array; activeCount: number } {
    const currentTime = timestamp / 1000.0
    this.activeRippleCount = 0

    const STRENGTH_THRESHOLD = 0.01
    for (let i = 0; i < this.maxRipples; i++) {
      const ripple = this.ripples[i]
      if (!ripple.active) continue

      const age = currentTime - ripple.startTime
      if (age >= this.maxAge) {
        ripple.active = false
        ripple.strength = 0
        continue
      }

      ripple.strength = 1.0 - age / this.maxAge

      if (ripple.strength > STRENGTH_THRESHOLD) {
        const baseIndex = this.activeRippleCount * 4
        this.rippleData[baseIndex] = ripple.x
        this.rippleData[baseIndex + 1] = ripple.y
        this.rippleData[baseIndex + 2] = ripple.strength
        this.rippleData[baseIndex + 3] = ripple.startTime
        this.activeRippleCount++
      } else {
        ripple.active = false
      }
    }

    for (let i = this.activeRippleCount; i < this.maxRipples; i++) {
      const baseIndex = i * 4
      this.rippleData[baseIndex + 2] = 0
    }

    return {
      data: this.rippleData,
      activeCount: this.activeRippleCount,
    }
  }
}

export type RGB = [number, number, number]

export class WebGPURippleGrid {
  private canvas: HTMLCanvasElement
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private pipeline: GPURenderPipeline | null = null
  private vertexBuffer: GPUBuffer | null = null
  private timeUniformBuffer: GPUBuffer | null = null
  private rippleUniformBuffer: GPUBuffer | null = null
  private bindGroup: GPUBindGroup | null = null
  private rippleManager: RippleManager
  private animationFrameId: number | null = null
  private isMouseDown = false
  private lastMouseX = 0
  private lastMouseY = 0
  private canvasRect: DOMRect | null = null
  private resizeObserver: ResizeObserver | null = null
  private eventHandlers: {
    pointerdown: (e: PointerEvent) => void
    pointermove: (e: PointerEvent) => void
    pointerup: () => void
    pointerleave: () => void
  } | null = null

  // Theme colors (normalized 0-1)
  private gridColor: RGB = [0.3, 0.35, 0.25]
  private destroyed = false
  private bgColor: RGB = [0.02, 0.01, 0.03]

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.rippleManager = new RippleManager()
  }

  setColors(gridColor: RGB, bgColor: RGB): void {
    this.gridColor = gridColor
    this.bgColor = bgColor
  }

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported')
    }

    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('No WebGPU adapter found')
    }

    this.device = await adapter.requestDevice()
    this.context = this.canvas.getContext('webgpu')

    if (!this.context) {
      throw new Error('Could not get WebGPU context')
    }

    const format = navigator.gpu.getPreferredCanvasFormat()

    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    })

    // Full-screen quad vertices
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])

    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })

    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices)

    // Uniform buffer: time(4) + aspect(4) + activeCount(4) + viewportHeight(4) + gridColor(12) + padding(4) + bgColor(12) + padding(4) = 48 bytes
    this.timeUniformBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Ripple buffer: 128 ripples * 16 bytes each = 2048 bytes
    this.rippleUniformBuffer = this.device.createBuffer({
      size: 2048,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const shaderModule = this.device.createShaderModule({
      code: wavyGridShader,
    })

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    })

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.timeUniformBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.rippleUniformBuffer },
        },
      ],
    })

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    })

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 8,
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: 'float32x2',
              },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: format,
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: 'uint32',
      },
    })

    this.setupEventListeners()
    this.updateCanvasSize()
  }

  private updateCanvasSize(): void {
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight

    this.canvas.style.width = windowWidth + 'px'
    this.canvas.style.height = windowHeight + 'px'

    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(windowWidth * dpr)
    this.canvas.height = Math.round(windowHeight * dpr)

    if (this.context && this.device) {
      this.context.configure({
        device: this.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'premultiplied',
      })
    }

    this.canvasRect = this.canvas.getBoundingClientRect()
  }

  private setupEventListeners(): void {
    const updateCanvasRect = () => {
      this.canvasRect = this.canvas.getBoundingClientRect()
    }

    this.resizeObserver = new ResizeObserver(updateCanvasRect)
    this.resizeObserver.observe(this.canvas)
    window.addEventListener('resize', () => this.updateCanvasSize())

    const getNormalizedCoordinates = (clientX: number, clientY: number) => {
      if (!this.canvasRect) {
        this.canvasRect = this.canvas.getBoundingClientRect()
      }
      return {
        x: (clientX - this.canvasRect.left) / this.canvasRect.width,
        y: 1.0 - (clientY - this.canvasRect.top) / this.canvasRect.height,
      }
    }

    const handlePointerDown = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect()
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        this.isMouseDown = true
        const coords = getNormalizedCoordinates(e.clientX, e.clientY)
        this.lastMouseX = coords.x
        this.lastMouseY = coords.y
        this.rippleManager.addRipple(coords.x, coords.y, performance.now())
      }
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!this.isMouseDown) return
      const coords = getNormalizedCoordinates(e.clientX, e.clientY)
      this.lastMouseX = coords.x
      this.lastMouseY = coords.y
    }

    const handlePointerUp = () => {
      if (this.isMouseDown) {
        this.isMouseDown = false
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, { passive: true })
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', handlePointerUp, { passive: true })
    window.addEventListener('pointerleave', handlePointerUp, { passive: true })

    this.eventHandlers = {
      pointerdown: handlePointerDown,
      pointermove: handlePointerMove,
      pointerup: handlePointerUp,
      pointerleave: handlePointerUp,
    }
  }

  private render(timestamp: number): void {
    if (this.destroyed || !this.device || !this.context || !this.pipeline) return

    if (this.isMouseDown) {
      this.rippleManager.addRipple(this.lastMouseX, this.lastMouseY, timestamp)
    }

    const rippleResult = this.rippleManager.update(timestamp)
    this.device.queue.writeBuffer(this.rippleUniformBuffer!, 0, rippleResult.data as Float32Array<ArrayBuffer>)

    // Pack uniforms: time, aspect, activeCount, viewportHeight, gridColor (r,g,b), padding, bgColor (r,g,b), padding
    const timeUniforms = new Float32Array([
      timestamp / 1000,
      this.canvas.width / this.canvas.height,
      rippleResult.activeCount,
      this.canvas.height, // viewport height in pixels for grid size calculation
      this.gridColor[0],
      this.gridColor[1],
      this.gridColor[2],
      0, // padding
      this.bgColor[0],
      this.bgColor[1],
      this.bgColor[2],
      0, // padding
    ])
    this.device.queue.writeBuffer(this.timeUniformBuffer!, 0, timeUniforms)

    const commandEncoder = this.device.createCommandEncoder()
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })

    passEncoder.setVertexBuffer(0, this.vertexBuffer!)
    passEncoder.setBindGroup(0, this.bindGroup!)
    passEncoder.setPipeline(this.pipeline)
    passEncoder.draw(4)
    passEncoder.end()

    this.device.queue.submit([commandEncoder.finish()])
  }

  start(): void {
    const frame = (timestamp: number) => {
      this.render(timestamp)
      this.animationFrameId = requestAnimationFrame(frame)
    }
    this.animationFrameId = requestAnimationFrame(frame)
  }

  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  destroy(): void {
    this.destroyed = true
    this.stop()

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    if (this.eventHandlers) {
      window.removeEventListener('pointerdown', this.eventHandlers.pointerdown)
      window.removeEventListener('pointermove', this.eventHandlers.pointermove)
      window.removeEventListener('pointerup', this.eventHandlers.pointerup)
      window.removeEventListener('pointerleave', this.eventHandlers.pointerleave)
      this.eventHandlers = null
    }

    // Unconfigure the context before destroying buffers
    if (this.context) {
      this.context.unconfigure()
    }

    if (this.vertexBuffer) {
      this.vertexBuffer.destroy()
      this.vertexBuffer = null
    }
    if (this.timeUniformBuffer) {
      this.timeUniformBuffer.destroy()
      this.timeUniformBuffer = null
    }
    if (this.rippleUniformBuffer) {
      this.rippleUniformBuffer.destroy()
      this.rippleUniformBuffer = null
    }

    this.bindGroup = null
    this.pipeline = null
    this.context = null
    this.device = null
  }
}

export async function checkWebGPUSupport(): Promise<boolean> {
  if (!navigator.gpu) {
    return false
  }

  try {
    const adapter = await navigator.gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}
