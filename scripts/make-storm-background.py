"""Generate a storm-sky background stand-in for the weather dashboard page.

The reference page used an embedded JPEG that is not part of this repository, so this
script produces a licence-free replacement at the path the page expects. It is a
procedural composite — fractal cloud noise, a lit anvil, a green field and a few
lightning bolts — not a copy of the original photograph. Dropping the real export in at
the same path needs no CSS change.

    python scripts/make-storm-background.py public/weather/assets/storm-background.jpg
"""

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

WIDTH, HEIGHT = 1600, 1200
HORIZON = int(HEIGHT * 0.70)


def value_noise(shape, cells, seed):
    """Bilinear value noise on a `cells`-wide lattice, smoothstepped."""
    rng = np.random.default_rng(seed)
    grid = rng.random((cells[0] + 1, cells[1] + 1), dtype=np.float32)
    ys = np.linspace(0, cells[0], shape[0], endpoint=False, dtype=np.float32)
    xs = np.linspace(0, cells[1], shape[1], endpoint=False, dtype=np.float32)
    y0 = np.floor(ys).astype(np.int32)
    x0 = np.floor(xs).astype(np.int32)
    fy = ys - y0
    fx = xs - x0
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    fy = fy[:, None]
    fx = fx[None, :]
    top = grid[y0][:, x0] * (1 - fx) + grid[y0][:, x0 + 1] * fx
    bottom = grid[y0 + 1][:, x0] * (1 - fx) + grid[y0 + 1][:, x0 + 1] * fx
    return top * (1 - fy) + bottom * fy


def fbm(shape, seed, octaves=6, base=(3, 4)):
    total = np.zeros(shape, dtype=np.float32)
    amplitude = 0.5
    norm = 0.0
    cells = base
    for octave in range(octaves):
        total += amplitude * value_noise(shape, cells, seed + octave * 17)
        norm += amplitude
        amplitude *= 0.52
        cells = (cells[0] * 2, cells[1] * 2)
    return total / norm


def vertical_ramp(shape, stops):
    """stops: list of (position 0..1, (r,g,b)) — returns float array shape (h,w,3)."""
    height = shape[0]
    positions = np.array([s[0] for s in stops], dtype=np.float32)
    colours = np.array([s[1] for s in stops], dtype=np.float32)
    t = np.linspace(0, 1, height, dtype=np.float32)
    out = np.empty((height, 3), dtype=np.float32)
    for channel in range(3):
        out[:, channel] = np.interp(t, positions, colours[:, channel])
    return np.repeat(out[:, None, :], shape[1], axis=1)


def main(target):
    shape = (HEIGHT, WIDTH)
    yy = np.linspace(0, 1, HEIGHT, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, WIDTH, dtype=np.float32)[None, :]

    # ---- sky: deep blue-black at the top, lifting toward a lit cloud base ----
    sky = vertical_ramp(shape, [
        (0.00, (4, 10, 16)),
        (0.28, (8, 20, 28)),
        (0.46, (16, 34, 40)),
        (0.62, (30, 54, 56)),
        (0.70, (38, 62, 60)),
    ])

    # ---- cumulonimbus: dense fbm billows, shaded by height and by a soft light ----
    billows = fbm(shape, 11, octaves=7, base=(3, 4))
    detail = fbm(shape, 53, octaves=5, base=(12, 16))
    density = np.clip(billows * 0.78 + detail * 0.30, 0, 1)
    density = np.clip((density - 0.24) * 2.15, 0, 1)

    # the anvil sits high; the mass thins toward the horizon
    height_falloff = np.clip(1.0 - (yy - 0.02) / 0.70, 0, 1) ** 0.6
    density *= 0.35 + 0.75 * height_falloff

    light = np.exp(-(((xx - 0.34) * 3.8) ** 2 + ((yy - 0.10) * 6.0) ** 2))
    lit = np.clip(density * (0.30 + 1.15 * light) + 0.05 * detail, 0, 1)

    cloud_lo = np.array([14, 23, 30], dtype=np.float32)
    cloud_hi = np.array([112, 132, 142], dtype=np.float32)
    clouds = cloud_lo[None, None, :] * (1 - lit[..., None]) + cloud_hi[None, None, :] * lit[..., None]

    sky_mask = (1.0 - np.clip((yy - 0.52) / 0.18, 0, 1))[..., None]
    sky = sky * (1 - sky_mask) + clouds * sky_mask

    # dark underbelly right above the horizon, wobbled so the base is not a ruled line
    base_wobble = (fbm(shape, 301, octaves=4, base=(4, 6)) - 0.5) * 0.055
    base_shadow = np.clip(1.0 - np.abs(yy - 0.60 - base_wobble) / 0.145, 0, 1)[..., None] * 0.72
    sky *= 1.0 - base_shadow

    # ---- field: dark green, noisier toward the camera, hazy at the horizon ----
    grass_noise = fbm(shape, 91, octaves=6, base=(24, 30))
    field = vertical_ramp(shape, [
        (0.00, (32, 50, 34)),
        (0.35, (21, 38, 24)),
        (1.00, (8, 17, 12)),
    ])
    field *= (0.82 + 0.42 * grass_noise)[..., None]
    haze = np.clip(1.0 - (yy - 0.70) / 0.07, 0, 1)[..., None] * 0.28
    field = field * (1 - haze) + np.array([46, 62, 56], dtype=np.float32)[None, None, :] * haze

    ground_mask = np.clip((yy - 0.70) / 0.006, 0, 1)[..., None]
    image = sky * (1 - ground_mask) + field * ground_mask

    # ---- lightning: branching bolts with a bloom pass ----
    bolt_layer = Image.new("L", (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(bolt_layer)
    rng = np.random.default_rng(2024)

    def bolt(start_x, start_y, end_y, spread, width):
        points = [(start_x, start_y)]
        x, y = start_x, start_y
        while y < end_y:
            y += rng.uniform(18, 40)
            x += rng.normal(0, spread)
            points.append((x, y))
        draw.line(points, fill=255, width=width, joint="curve")
        # one fork per bolt, thinner
        if len(points) > 6:
            index = rng.integers(3, len(points) - 2)
            fork = points[index]
            fx, fy = fork
            fork_points = [fork]
            for _ in range(5):
                fy += rng.uniform(14, 26)
                fx += rng.normal(0, spread * 1.6)
                fork_points.append((fx, fy))
            draw.line(fork_points, fill=210, width=max(1, width - 1), joint="curve")

    bolt(430, 210, 840, 7.0, 3)
    bolt(1005, 150, 830, 8.0, 2)
    bolt(1240, 250, 700, 6.0, 2)

    glow = bolt_layer.filter(ImageFilter.GaussianBlur(16))
    core = bolt_layer.filter(ImageFilter.GaussianBlur(1.1))
    image += np.asarray(glow, dtype=np.float32)[..., None] * np.array([0.34, 0.46, 0.56], dtype=np.float32)
    image += np.asarray(core, dtype=np.float32)[..., None] * np.array([0.95, 0.98, 1.0], dtype=np.float32)

    # ---- grain, vignette, final softening ----
    image += rng.normal(0, 2.0, (HEIGHT, WIDTH, 1)).astype(np.float32)
    radius = np.sqrt(((xx - 0.5) * 1.25) ** 2 + ((yy - 0.46) * 1.05) ** 2)
    image *= (1.0 - 0.42 * np.clip(radius, 0, 1.1))[..., None]

    image = np.clip(image, 0, 255).astype(np.uint8)
    out = Image.fromarray(image, "RGB").filter(ImageFilter.GaussianBlur(0.7))
    out.save(target, "JPEG", quality=84, optimize=True, progressive=True)
    print(f"wrote {target} ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "storm-background.jpg")
