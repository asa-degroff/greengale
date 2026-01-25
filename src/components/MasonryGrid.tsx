import {
  type ReactNode,
  useRef,
  useEffect,
  useState,
  Children,
  isValidElement,
  cloneElement,
  useCallback,
  useMemo,
} from 'react'

interface ResponsiveColumns {
  default: number
  md?: number
}

interface MasonryGridProps {
  children: ReactNode
  columns?: number | ResponsiveColumns
  gap?: number
  className?: string
}

interface ItemPosition {
  left: number
  top: number
  width: number
}

// Get initial column count based on window width (avoids flash on iPad)
function getInitialColumns(columns: number | ResponsiveColumns): number {
  if (typeof columns === 'number') return columns
  if (typeof window === 'undefined') return columns.default
  const mdBreakpoint = 768
  if (columns.md && window.innerWidth >= mdBreakpoint) {
    return columns.md
  }
  return columns.default
}

export function MasonryGrid({
  children,
  columns = { default: 1, md: 2 },
  gap = 24,
  className = '',
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(0)
  const [positions, setPositions] = useState<ItemPosition[]>([])
  // Initialize with correct column count to avoid flash on iPad/tablet
  const [currentColumns, setCurrentColumns] = useState(() => getInitialColumns(columns))
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const layoutRequestRef = useRef<number | null>(null)
  const batchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cachedHeightsRef = useRef<number[]>([])
  const isScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parse column configuration
  const columnConfig = useMemo((): ResponsiveColumns => {
    if (typeof columns === 'number') {
      return { default: columns }
    }
    return columns
  }, [columns])

  // Update column count based on viewport
  useEffect(() => {
    const mdBreakpoint = 768

    const updateColumns = () => {
      if (columnConfig.md && window.innerWidth >= mdBreakpoint) {
        setCurrentColumns(columnConfig.md)
      } else {
        setCurrentColumns(columnConfig.default)
      }
    }

    // Use matchMedia for efficient breakpoint listening
    const mediaQuery = window.matchMedia(`(min-width: ${mdBreakpoint}px)`)
    const handleChange = () => updateColumns()
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [columnConfig])

  // Track scrolling state to avoid layout recalc during scroll (iOS address bar issue)
  useEffect(() => {
    const handleScroll = () => {
      isScrollingRef.current = true
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false
      }, 150)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Convert children to array
  const childArray = useMemo(
    () => Children.toArray(children).filter(isValidElement),
    [children]
  )

  // Calculate layout
  const calculateLayout = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const items = itemRefs.current.filter(Boolean) as HTMLDivElement[]
    if (items.length === 0) {
      setPositions([])
      setContainerHeight(0)
      return
    }

    const containerWidth = container.offsetWidth
    if (containerWidth === 0) return

    const columnWidth = (containerWidth - gap * (currentColumns - 1)) / currentColumns

    // Track height of each column
    const columnHeights = new Array(currentColumns).fill(0)
    const newPositions: ItemPosition[] = []

    items.forEach((item) => {
      // Find the shortest column
      let shortestColumn = 0
      let minHeight = columnHeights[0]
      for (let i = 1; i < currentColumns; i++) {
        if (columnHeights[i] < minHeight) {
          minHeight = columnHeights[i]
          shortestColumn = i
        }
      }

      // Calculate position
      const left = shortestColumn * (columnWidth + gap)
      const top = columnHeights[shortestColumn]

      newPositions.push({
        left,
        top,
        width: columnWidth,
      })

      // Update column height
      columnHeights[shortestColumn] += item.offsetHeight + gap
    })

    // Container height is the tallest column (minus the last gap)
    const maxHeight = Math.max(...columnHeights)
    setContainerHeight(maxHeight > 0 ? maxHeight - gap : 0)
    setPositions(newPositions)
  }, [currentColumns, gap])

  // Debounced layout calculation with batching
  const requestLayout = useCallback(() => {
    // Skip layout during scroll to avoid iOS address bar jank
    if (isScrollingRef.current) return

    // Clear any pending batch timeout
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current)
      batchTimeoutRef.current = null
    }
    if (layoutRequestRef.current) {
      cancelAnimationFrame(layoutRequestRef.current)
    }
    // Batch: wait 16ms after last resize event to coalesce multiple image loads
    batchTimeoutRef.current = setTimeout(() => {
      layoutRequestRef.current = requestAnimationFrame(() => {
        // Check if heights actually changed before recalculating
        const items = itemRefs.current.filter(Boolean) as HTMLDivElement[]
        const currentHeights = items.map((item) => item.offsetHeight)
        const cached = cachedHeightsRef.current

        const heightsChanged =
          currentHeights.length !== cached.length ||
          currentHeights.some((h, i) => Math.abs(h - cached[i]) >= 2)

        if (heightsChanged) {
          cachedHeightsRef.current = currentHeights
          calculateLayout()
        }
      })
    }, 16)
  }, [calculateLayout])

  // Observe children for size changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver(() => {
      requestLayout()
    })

    // Observe the container
    resizeObserver.observe(container)

    // Observe all items
    itemRefs.current.forEach((item) => {
      if (item) resizeObserver.observe(item)
    })

    return () => {
      resizeObserver.disconnect()
      if (layoutRequestRef.current) {
        cancelAnimationFrame(layoutRequestRef.current)
      }
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
      }
    }
  }, [requestLayout, childArray])

  // Recalculate when children or columns change
  useEffect(() => {
    cachedHeightsRef.current = []
    requestLayout()
  }, [childArray, currentColumns, requestLayout])

  // Reset refs array length
  itemRefs.current = itemRefs.current.slice(0, childArray.length)

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{ height: containerHeight || 'auto' }}
    >
      {childArray.map((child, index) => {
        const position = positions[index]
        const hasPosition = position !== undefined

        return (
          <div
            key={isValidElement(child) && child.key ? child.key : index}
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            style={
              hasPosition
                ? {
                    position: 'absolute',
                    left: position.left,
                    top: position.top,
                    width: position.width,
                  }
                : {
                    // Initial render: position off-screen until layout is calculated
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: `calc((100% - ${gap * (currentColumns - 1)}px) / ${currentColumns})`,
                    visibility: 'hidden',
                  }
            }
          >
            {cloneElement(child)}
          </div>
        )
      })}
    </div>
  )
}
