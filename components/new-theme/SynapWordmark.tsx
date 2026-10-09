"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/*
 * New theme — opening wordmark beat.
 *
 * Borrowed from the ThreeUI intro: the word assembles letter by letter out of blur,
 * with a chromatic pass in front of it that converges and drops away. The text, the
 * palette and the timing are SynapFlow's; the motion is driven by the Web Animations
 * API so nothing is added to the global stylesheet.
 */

const CHROMATIC_LAYERS = [
  { className: "text-cyan-300/70", from: "-10px" },
  { className: "text-fuchsia-400/60", from: "10px" },
] as const;

export default function SynapWordmark({
  text = "SynapFlow",
  className = "",
}: {
  text?: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const letters = Array.from(text);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const glyphs = Array.from(root.querySelectorAll<HTMLElement>("[data-glyph]"));
    const ghosts = Array.from(root.querySelectorAll<HTMLElement>("[data-ghost]"));
    const settle = () => {
      glyphs.forEach((el) => {
        el.style.opacity = "1";
        el.style.filter = "none";
        el.style.transform = "none";
      });
      ghosts.forEach((el) => { el.style.opacity = "0"; });
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settle();
      return undefined;
    }

    const animations = [
      ...glyphs.map((el, index) =>
        el.animate(
          [
            { opacity: 0, transform: "translateY(18px) scale(1.06)", filter: "blur(14px)" },
            { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0px)" },
          ],
          {
            duration: 900,
            delay: 140 + index * 62,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            fill: "both",
          },
        ),
      ),
      ...ghosts.map((el, index) =>
        el.animate(
          [
            { opacity: 1, transform: `translateX(${CHROMATIC_LAYERS[index]?.from ?? "0px"})`, filter: "blur(7px)" },
            { opacity: 0, transform: "translateX(0px)", filter: "blur(0px)" },
          ],
          {
            duration: 1150,
            delay: 150,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "both",
          },
        ),
      ),
    ];

    // the resting opacity lives in the markup so nothing flashes before hydration;
    // write the settled value back once the run is over
    const last = animations[glyphs.length - 1];
    last?.addEventListener("finish", () => {
      glyphs.forEach((el) => { el.style.opacity = "1"; });
    });

    return () => animations.forEach((animation) => animation.cancel());
  }, [text]);

  return (
    <span
      ref={rootRef}
      role="img"
      aria-label={text}
      className={`relative inline-block leading-[0.94] tracking-[-0.035em] ${className}`}
    >
      {CHROMATIC_LAYERS.map((layer, index) => (
        <span
          key={layer.from}
          data-ghost
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 ${layer.className}`}
          style={{ "--ghost-index": index } as CSSProperties}
        >
          {text}
        </span>
      ))}
      <span className="relative">
        {letters.map((letter, index) => (
          <span
            key={`${letter}-${index}`}
            data-glyph
            className="inline-block whitespace-pre"
            style={{ opacity: 0 }}
          >
            {letter}
          </span>
        ))}
      </span>
    </span>
  );
}
