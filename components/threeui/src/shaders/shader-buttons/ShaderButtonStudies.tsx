"use client";

/*
 * PLACEHOLDER — this module is NOT part of the registered ThreeUI source bundle.
 *
 * `ShaderButtons.tsx` (which IS the registered source, vendored unmodified) imports
 * `./ShaderButtonStudies` for its secondary study variants. The registry bundle for
 * `star-portal` ships `SelectedButtonStudies.tsx` but not this file, and it is not
 * published in @designcodeio/threeui@1.2.0 either, so the authored source could not
 * be retrieved and has deliberately not been recreated.
 *
 * Nothing on the configured path needs it: `variant="star-portal"` resolves to
 * `StarPortal` in ../neuform-isolated/NeuformIsolatedEffects and never touches this
 * module. Only the ten study variants listed below would, and those render nothing
 * until the real file is supplied. See ../../../../README.md.
 */

import type { NeuformIsolatedEffectProps } from "../neuform-isolated/NeuformIsolatedEffects";

export const SHADER_BUTTON_STUDIES = [
  "liquid-glass",
  "intelligence",
  "holo-foil",
  "particles",
  "voice-orb",
  "water",
  "dither-hold",
  "lava-lamp",
  "gold",
  "ink",
] as const;

export type ShaderButtonStudyVariant = (typeof SHADER_BUTTON_STUDIES)[number];

export function ShaderButtonStudy({ variant }: NeuformIsolatedEffectProps & { variant: ShaderButtonStudyVariant }) {
  if (typeof console !== "undefined") {
    console.error(
      `[threeui] ShaderButtonStudy "${variant}" is unavailable: ShaderButtonStudies.tsx was not included in the registered source bundle.`,
    );
  }
  return null;
}
