"use client";
import { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Restrained entrance: children marked [data-reveal] fade/rise in with a short stagger,
 * once, when `ready` flips true. Scoped to the container per the GSAP React rules.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(ready = true, deps: unknown[] = []) {
  const ref = useRef<T>(null);
  useGSAP(
    () => {
      if (!ready || !ref.current) return;
      const els = ref.current.querySelectorAll("[data-reveal]");
      if (!els.length) return;
      if (prefersReducedMotion()) {
        gsap.set(els, { autoAlpha: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        els,
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: 0.04, clearProps: "transform" },
      );
    },
    { scope: ref, dependencies: [ready, ...deps] },
  );
  return ref;
}

/** Smooth number count-up driven by a GSAP tween; snaps under reduced motion. */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  duration = 1.1,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(() => format(value));
  const obj = useRef({ v: 0 });
  useEffect(() => {
    if (prefersReducedMotion()) {
      obj.current.v = value;
      setDisplay(format(value));
      return;
    }
    const tween = gsap.to(obj.current, {
      v: value,
      duration,
      ease: "power3.out",
      onUpdate: () => setDisplay(format(obj.current.v)),
    });
    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span className="tnum">{display}</span>;
}
