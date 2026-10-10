import { useEffect, useRef, useState } from 'react'

const MARGIN = 6

interface Shown {
  text: string
  rect: DOMRect
}

// Chrome's side panel doesn't render native title tooltips, so [data-tooltip] elements get this one.
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null)
  const [left, setLeft] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const show = (e: Event) => {
      const target = (e.target as Element | null)?.closest<HTMLElement>('[data-tooltip]')
      setShown(target ? { text: target.dataset.tooltip!, rect: target.getBoundingClientRect() } : null)
    }
    const hide = () => setShown(null)
    document.addEventListener('pointerover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('focusout', hide)
    document.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerover', show)
      document.removeEventListener('focusin', show)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('scroll', hide, true)
    }
  }, [])

  useEffect(() => {
    if (!shown || !ref.current) return
    const { width } = ref.current.getBoundingClientRect()
    const center = shown.rect.left + shown.rect.width / 2 - width / 2
    setLeft(Math.max(MARGIN, Math.min(center, window.innerWidth - width - MARGIN)))
  }, [shown])

  if (!shown) return null
  const below = shown.rect.top < 48
  const top = below ? shown.rect.bottom + MARGIN : shown.rect.top - MARGIN
  return (
    <div ref={ref} role="tooltip" className="tooltip" style={{ left, top, transform: below ? undefined : 'translateY(-100%)' }}>
      {shown.text}
    </div>
  )
}
