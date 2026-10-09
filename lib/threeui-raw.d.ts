/*
 * Turbopack resolves `./sources/x.html?raw` to the file's text through the
 * `turbopack.rules` entry in next.config.ts. These declarations give that import
 * shape a type so the vendored ThreeUI sources keep their authored specifiers.
 */
declare module "*.html?raw" {
  const content: string;
  export default content;
}

/*
 * Three.js r128 is installed under the package's own alias (see components/threeui/README.md).
 * The alias has no types of its own; tsconfig points `three128` at the matching
 * @types/three@0.128 so the vendored shader source stays unmodified.
 */
