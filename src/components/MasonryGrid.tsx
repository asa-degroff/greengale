import {
  type ReactNode,
  useRef,
  useEffect,
  useState,
  Children,
  isValidElement,
  cloneElement,
  useCallback,
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

export function MasonryGrid({
  children,
  columns = { default: 1, md: 2 },
  gap = 24,
  className = '',
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(0)
  const [positions, setPositions] = useState<ItemPosition[]>([])
  const [currentColumns, setCurrentColumns] = useState(1)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const layoutRequestRef = useRef<number | null>(null)

  // Parse column configuration
  const getColumnConfig = useCallback((): ResponsiveColumns => {
    if (typeof columns === 'number') {
      return { default: columns }
    }
    return columns
  }, [columns])

  // Update column count based on viewport
  useEffect(() => {
    const columnConfig = getColumnConfig()
    const mdBreakpoint = 768

    const updateColumns = () => {
      if (columnConfig.md && window.innerWidth >= mdBreakpoint) {
        setCurrentColumns(columnConfig.md)
      } else {
        setCurrentColumns(columnConfig.default)
      }
    }

    updateColumns()

    // Use matchMedia for efficient breakpoint listening
    const mediaQuery = window.matchMedia(`(min-width: ${mdBreakpoint}px)`)
    const handleChange = () => updateColumns()
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [getColumnConfig])

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

  // Debounced layout calculation
  const requestLayout = useCallback(() => {
    if (layoutRequestRef.current) {
      cancelAnimationFrame(layoutRequestRef.current)
    }
    layoutRequestRef.current = requestAnimationFrame(() => {
      calculateLayout()
    })
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
    }
  }, [requestLayout, children])

  // Recalculate when children change
  useEffect(() => {
    requestLayout()
  }, [children, currentColumns, requestLayout])

  // Convert children to array and wrap each with positioned div
  const childArray = Children.toArray(children).filter(isValidElement)

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
            className="transition-all duration-300 ease-out"
            style={
              hasPosition
                ? {
                    position: 'absolute',
                    left: position.left,
                    top: position.top,
                    width: position.width,
                  }
                : {
                    // Initial render: use relative positioning until layout is calculated
                    position: 'relative',
                    opacity: 0,
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
