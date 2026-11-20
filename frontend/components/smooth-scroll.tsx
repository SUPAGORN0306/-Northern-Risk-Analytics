"use client"

import { useEffect, useRef } from "react"
import Lenis from "lenis"

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 2,
      infinite: false,
      smoothWheel: !prefersReducedMotion,
      anchors: {
        immediate: prefersReducedMotion,
        duration: prefersReducedMotion ? 0 : 1.2,
      },
    })

    lenisRef.current = lenis
    let animationFrame = 0

    function raf(time: number) {
      lenis.raf(time)
      animationFrame = window.requestAnimationFrame(raf)
    }

    animationFrame = window.requestAnimationFrame(raf)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      lenis.destroy()
    }
  }, [])

  return <>{children}</>
}
