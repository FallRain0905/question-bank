"use client";

/*
 * Entry point for the vendored ThreeUI components used by the new frontend theme.
 * Mirrors `@designcodeio/threeui`'s public surface for the pieces that are actually
 * vendored under ./src/shaders — see ./README.md for provenance and hashes.
 *
 * Importing this module also pulls in the shared ThreeUI stylesheet, matching the
 * `import "@designcodeio/threeui/style.css"` line from the upstream usage.
 */

import "./src/shaders/threeui.css";

export { ConstellationField } from "./src/shaders/constellation-field/ConstellationField";
export type { ConstellationFieldProps, ConstellationFieldVariant } from "./src/shaders/constellation-field/ConstellationField";

export { AnimatedTopDock, ANIMATED_TOP_DOCK_VARIANTS } from "./src/shaders/animated-top-dock/AnimatedTopDock";
export type { AnimatedTopDockProps, AnimatedTopDockVariant } from "./src/shaders/animated-top-dock/AnimatedTopDock";

export { ShaderButtons } from "./src/shaders/shader-buttons/ShaderButtons";
export type { ShaderButtonVariant, ShaderButtonsProps } from "./src/shaders/shader-buttons/ShaderButtons";

export { TextAnimationCollection } from "./src/shaders/text-animation/TextAnimationCollection";
export type { TextAnimationCollectionProps, TextAnimationVariant } from "./src/shaders/text-animation/TextAnimationCollection";
