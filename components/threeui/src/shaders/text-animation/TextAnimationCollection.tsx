"use client";

/*
 * Thin dispatcher around the vendored `ThreeUIIntro` effect.
 *
 * The registered bundle for this component lists `NeuformIsolatedEffects.tsx` as the
 * component file and `sources/creator-studio-intro.html` as its canonical source, so
 * the effect itself is vendored byte-for-byte. The public `TextAnimationCollection`
 * entry point lives in ThreeUI's own `shaders/article-headings/TextAnimationCollection`
 * module and is responsible for exactly one thing: resolving `variant="threeui-intro"`
 * to that effect behind a <Suspense> whose fallback is the dark stage. Only the
 * configured variant is wired here; the other variants of the collection
 * (article-headings, neon-sign, particle-wordmark, audio-wordmark) are not part of
 * this task and are deliberately absent rather than approximated.
 */

import { Suspense, lazy } from "react";

import type { NeuformIsolatedEffectProps } from "../neuform-isolated/NeuformIsolatedEffects";

const ThreeUIIntro = lazy(() =>
  import("../neuform-isolated/NeuformIsolatedEffects").then((module) => ({ default: module.ThreeUIIntro })),
);

const stageFallback = <div className="threeui-background" style={{ background: "#090909" }} />;

export type TextAnimationVariant = "threeui-intro";

export type TextAnimationCollectionProps = NeuformIsolatedEffectProps & {
  variant?: TextAnimationVariant;
};

export function TextAnimationCollection({ variant = "threeui-intro", ...props }: TextAnimationCollectionProps) {
  if (variant !== "threeui-intro") return stageFallback;
  return (
    <Suspense fallback={stageFallback}>
      <ThreeUIIntro {...props} />
    </Suspense>
  );
}
