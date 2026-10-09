# ThreeUI components (vendored)

ThreeUI's sources are vendored here so the new frontend theme owns what it borrows:
`ConstellationField`, `TextAnimationCollection` (`threeui-intro`), `AnimatedTopDock`
(`modern`) and `ShaderButtons` (`star-portal`).

They are used in two ways, and the split is deliberate:

- **Reference mounts** — `app/theme/reference/page.tsx` mounts all four at their
  registered props, untouched. This is where the originals stay comparable.
- **Borrowed into SynapFlow** — `app/theme/page.tsx` is SynapFlow's own page. It reuses
  the two pieces that carry no copy of the author's at all: `topDockController.ts` (the
  proximity spring, which is pure behaviour) and `ConstellationField` (a background
  field). The command bar's markup and labels, the opening wordmark, the holographic CTA
  and the palette are written locally under `components/new-theme/`, following the
  originals' structure and motion rather than reproducing their content.

Nothing in `src/shaders/` was hand-written or approximated: every registered file was
copied byte-for-byte from its source bundle and its SHA-256 re-checked after the copy.

## Sources

| Component | Variant | Bundle |
|-----------|---------|--------|
| `ConstellationField` | `constellation-field` | <https://threeui.com/source-code/constellation-field.json> |
| `TextAnimationCollection` | `threeui-intro` | <https://threeui.com/source-code/threeui-intro.json> |
| `AnimatedTopDock` | `modern` | <https://threeui.com/source-code/animated-top-dock.json> |
| `ShaderButtons` | `star-portal` | <https://threeui.com/source-code/star-portal.json> |

All 31 registered files across those four bundles verify. The registered set only names
the files its own variant needs, so the two aggregator modules
(`NeuformBatchEffects.tsx`, `NeuformIsolatedEffects.tsx`) also import sources belonging
to sibling variants; those were taken from `@designcodeio/threeui@1.2.0`, which embeds
the same documents as `sources/*.html.js` modules. Their extraction is trustworthy for
exactly the reason the registered files are: every one of the 16 registered `.html`
sources extracted this way reproduced its registered SHA-256 exactly.

The one binary asset, `src/shaders/fonts/fragment-mono.woff2`, is not published as a
file. It is inlined as a base64 data URI in the package's `style.css`; decoding it
yields 15176 bytes hashing to `4f4dc27f4a770c0d02fde800daa836c8adc0d1e423b28da74baaf0d1cc3ab96c`,
which is the registered hash for the asset.

## Local adaptations (complete list)

1. **`?raw` imports.** The sources pull each authored HTML document
   (`import source from "./sources/x.html?raw"`). Turbopack in Next 16.2.4 does not turn
   the query into a string on its own — its `raw` module type resolves to `undefined`,
   and its `text` type is not accepted at all. `next.config.ts` therefore matches the
   query condition and runs `raw-loader` over it. Import specifiers are unchanged.
   `lib/threeui-raw.d.ts` types the import shape.
2. **`three128`.** `animated-top-dock/glassParticleField.ts` imports Three.js r128 under
   the package's own alias. `package.json` declares the same alias
   (`"three128": "npm:three@0.128.0"`) instead of rewriting the import.
3. **`shader-buttons/ShaderButtonStudies.tsx`.** Not part of any registered bundle and
   not published in the npm package, so the authored source could not be retrieved and
   has deliberately not been recreated. The file here is a documented stub: it declares
   the ten study variants and renders nothing for them. `variant="star-portal"` never
   reaches it.
4. **`text-animation/TextAnimationCollection.tsx`.** The public entry point lives in
   ThreeUI's `shaders/article-headings/TextAnimationCollection`, which the `threeui-intro`
   bundle does not register. This module is the same thin dispatch — `threeui-intro` →
   `ThreeUIIntro` behind a `<Suspense>` with the dark stage as fallback — for the one
   configured variant.
5. **`sources/recursive-erosion.html`, `sources/synthesis-orb.html`.** Imported by
   `NeuformIsolatedEffects.tsx` for the `RecursiveErosionBackground` and
   `ParticleOrbField` variants. Neither is registered nor published; both are committed
   as clearly-marked empty dark stages so the host module compiles unmodified.

`src/shaders/threeui.css` is imported once, from `components/threeui/index.tsx`. It has
no `html`, `body`, `*` or `:root` selectors, so it does not leak into the app shell.

## Licenses

Code is MIT (`LICENSE`, Copyright © 2026 Meng To, `@designcodeio/threeui@1.2.0`).
The bundled Fragment Mono webfont is under the SIL Open Font License 1.1
(<https://github.com/weiweihuanghuang/fragment-mono>); it is redistributed here under
that license and must not be sold on its own.

## Re-verifying

```bash
python - <<'PY'
import json, hashlib, os, urllib.request
for b in ("constellation-field", "threeui-intro", "animated-top-dock", "star-portal"):
    d = json.load(urllib.request.urlopen(f"https://threeui.com/source-code/{b}.json"))
    for e in d["files"]:
        with open(os.path.join("components/threeui", e["path"]), "rb") as fh:
            h = hashlib.sha256(fh.read()).hexdigest()
        print("OK  " if h == e["sha256"] else "DIFF", e["path"])
PY
```
