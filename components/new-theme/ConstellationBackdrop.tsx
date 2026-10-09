"use client";

import type { CSSProperties } from "react";

import { ConstellationField } from "@/components/threeui/src/shaders/constellation-field/ConstellationField";

/*
 * New theme — hero backdrop.
 *
 * The drifting particle constellation is the one borrowed piece kept as-is: it is a
 * background and carries no copy of its own, so it is mounted straight from the
 * vendored source. `hue` turns its authored amber toward SynapFlow's cool palette.
 */
export default function ConstellationBackdrop({
  hue = 180,
  className = "",
  style,
}: {
  hue?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style} aria-hidden="true">
      <ConstellationField
        variant="constellation-field"
        mode="dark"
        speed={1}
        size={1}
        strokeWidth={1.15}
        length={1}
        density={1}
        opacity={0.85}
        hue={hue}
        saturation={0.9}
        brightness={1}
      />
    </div>
  );
}
