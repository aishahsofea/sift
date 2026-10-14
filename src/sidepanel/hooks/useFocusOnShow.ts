import { useEffect, type RefObject } from 'react'

// Only reclaim focus from nothing: never from a button, link or other field the user is using.
export function canTakeFocus(active: Element | null, input: Element): boolean {
  return !active || active === document.body || active === input
}

export function useFocusOnShow(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const focus = () => {
      const input = ref.current
      if (input && canTakeFocus(document.activeElement, input)) input.focus()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') focus()
    }
    focus()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', focus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', focus)
    }
  }, [ref])
}
