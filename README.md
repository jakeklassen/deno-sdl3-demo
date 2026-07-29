# deno-sdl3-demo

Deno + SDL3 via [`@sdl3/sdl3-deno`](https://jsr.io/@sdl3/sdl3-deno), with the
`movement` demo ported from `~/code/gamedev/node-sdl2-demo`.

## Quick start

```sh
mise run movement
```

The first run provisions SDL3 into `./sdl3` — seconds on Windows, a few minutes
on Linux/macOS where it compiles. After that it just launches the demo. Arrow
keys move both ships, Escape quits.

Prerequisites are mise and a C toolchain **on Linux/macOS only** (cmake and ninja
come from mise; a system compiler and the X11/freetype/harfbuzz dev headers do
not). On Windows all you need is mise — see below.

## How SDL3 is managed

mise has no `sdl` in its registry, so SDL3 is not a `[tools]` entry. Instead
`mise run setup-sdl` provisions it into `./sdl3`, which is already one of
sdl3-deno's default search paths. How it does that depends on the platform,
because libsdl-org only ships prebuilt binaries for some of them:

| Platform    | What `setup-sdl` does                                          |
| ----------- | -------------------------------------------------------------- |
| Windows     | Downloads the official `win32-x64` DLLs — no compiler needed     |
| Linux/macOS | Builds from source via `scripts/build-sdl3.sh`                   |

mise's `run_windows` key selects between them, so the command is the same
everywhere. Both paths use identical pinned versions:

| Library    | Tag              |
| ---------- | ---------------- |
| SDL        | `release-3.4.12` |
| SDL_image  | `release-3.4.4`  |
| SDL_ttf    | `release-3.2.2`  |

Downloads and sources are staged in `.sdl3-build/`, and the libraries land in
`./sdl3`. sdl3-deno resolves the platform-correct filename itself — `SDL3.dll` on
Windows, `libSDL3.so` on Linux, `libSDL3.dylib` on macOS — so the same directory
works everywhere. mise also exports `DENO_SDL3_PATH` so the demo runs from any
working directory.

The task's `sources`/`outputs` keys skip the work once it is current. `outputs`
points at a `sdl3/.setup-complete` stamp rather than the libraries themselves,
because mise does not expand globs there and the real filenames are
platform-specific.

Both `sdl3/` and `.sdl3-build/` are gitignored — a fresh clone runs one command
to reproduce them.

### Windows notes

Nothing to compile: `scripts/setup-sdl3.ps1` pulls the official runtime zips and
copies the DLLs out, picking `x64`/`arm64`/`x86` from `PROCESSOR_ARCHITECTURE`.
The `cmake` and `ninja` entries in `[tools]` are only used by the Unix build; on
Windows mise installs them but nothing invokes them.

`.gitattributes` pins `*.sh` to LF so `build-sdl3.sh` still works if the repo is
checked out on Windows with `core.autocrlf` enabled and later used from WSL.

### Linux/macOS build notes

- The libraries are linked with an `$ORIGIN` RPATH, so `libSDL3_image` and
  `libSDL3_ttf` find `libSDL3.so` beside them without `LD_LIBRARY_PATH`.
- SDL_image and SDL_ttf are built with `*_VENDORED=OFF` against the system
  libpng/libjpeg/libwebp/freetype/harfbuzz. AVIF, JXL and TIFF are off because
  those dev packages are not installed.
- SDL is configured with `-DSDL_X11_XSCRNSAVER=OFF`. It is the one optional X11
  extension that hard-errors instead of auto-disabling when `libxss-dev` is
  missing; it only inhibits the screensaver, and skipping it avoids needing a
  root package install.

If you add system packages later (e.g. `libxss-dev`), delete `.sdl3-build/` and
re-run `mise run setup-sdl` to pick them up.

## The port

`src/movement.ts` mirrors the original's structure — the same `input` object,
fixed-timestep accumulator, and wall-clamping logic — but swaps the rendering
backend:

| node-sdl2-demo                                    | this demo                                          |
| ------------------------------------------------- | -------------------------------------------------- |
| node-canvas at 128x128, `window.render(...)` blit  | `setLogicalPresentation(128, 128, INTEGER_SCALE)`   |
| `context.imageSmoothingEnabled = false`            | `SCALEMODE.NEAREST`                                 |
| `loadImage()` + `drawImage()`                      | `IMG.loadTexture()` + `render.texture()`            |
| `registerFont()` + `fillText()`                    | SDL3_ttf `Font` + `RendererTextEngine`              |
| `sdl.keyboard.getState()`                          | `SDL.getKeyboardState()` read via `UnsafePointerView` |
| `while (!window.destroyed)` + `setTimeout(0)`      | `for await (const event of Event.iter(STEP, frame))` |

Rather than emulating the Canvas 2D API, drawing goes straight through SDL3's
renderer. Logical presentation replaces the manual 128x128 buffer entirely: all
coordinates stay in game space and SDL scales to the 512x512 window by whole
pixels. The original's `player1`-snaps / `player2`-sub-pixel contrast is kept and
built on — see below.

### Smooth pixel-art movement

The demo uses the technique from `~/code/gamedev/pixel-art-smoother-movement`:
keep the *art* at game resolution but give *movement* the granularity of the
upscaled surface, so slow motion does not jitter in whole game pixels.

SDL3 supplies half of it for free. `setLogicalPresentation` multiplies logical
coordinates by the render scale, so a fractional logical position resolves to an
exact device pixel — measured at 4x, a quarter of a game pixel moves the sprite
exactly one physical pixel (left edge at device px 88, 89, 90, 91 for logical
20.0, 20.25, 20.5, 20.75). That is the equivalent of the repo's 512x512 canvas;
no manual render target is needed.

The other half is render interpolation, which is implemented here. Each player
keeps `prevX`/`prevY` from the previous simulation tick, and the renderer draws
at `prev + (cur - prev) * alpha` where `alpha` is how far the accumulator sits
between ticks. `prev` is captured per *step* rather than per frame, so a frame
that runs several steps still interpolates from the state right before the last.

This is what lets `SIM_HZ` (60) sit below `RENDER_FPS` (120) without motion
quantising to the simulation rate.

The two ships demonstrate the difference, standing in for the repo's two
canvases: **player1 snaps to the 128x128 game grid**, **player2 draws at its
interpolated sub-pixel position**. Device pixels moved per frame:

| Speed          | player1 (snapped) | player2 (sub-pixel) |
| -------------- | ----------------- | ------------------- |
| `SPEED=60`     | 0 or 4            | 0 or 2              |
| `SPEED=12`     | 0 or 4            | 0 or 1              |

The default 60 px/s is exactly one game pixel per 60 Hz tick, which flatters the
snapped ship. The technique separates most clearly when movement is slower than
one game pixel per tick:

```sh
SPEED=12 mise run movement
```

### Frame rate

`RENDER_FPS` in `src/movement.ts` sets the pacing (currently 120); `SIM_HZ` sets
how often the simulation advances (60). They are genuinely decoupled — see
[Smooth pixel-art movement](#smooth-pixel-art-movement) — because the renderer
interpolates between simulation states.

Velocities are per-second and the accumulator applies a fixed `dt`, so changing
either constant does not change how fast the ships move — only how smooth it
looks, and how well motion survives a frame spike.

Run with `SHOW_FPS=1` to overlay the measured rate:

```sh
SHOW_FPS=1 mise run movement
```

Measured under WSL2 + X410, a 120 target holds at 120.3 fps (p50 8.27 ms, p95
9.59 ms); 240 starts falling short at ~224. Two caveats:

- **Your monitor caps what you actually see.** On a 60 Hz display, rendering at
  120 just does twice the work for the same visible result, and without vsync it
  can tear.
- **Vsync is not the answer under WSL2.** X410 reports `refresh_rate: 0`, and
  enabling vsync there collapsed the loop to 32.5 fps. On native Windows the
  refresh rate is reported properly, so `render.setVSync(1)` is a reasonable
  alternative *if* you have a high-refresh display and want tear-free output
  locked to it.

### Resizing

The window is resizable and scales the way retro titles do: only in whole
multiples, with the leftover margin left as bars rather than stretching the art.

`INTEGER_SCALE` logical presentation does all of it — SDL picks
`min(floor(outputW / 128), floor(outputH / 128))` and centres the result, so the
only change needed was the `RESIZABLE` window flag. Measured:

| Window size | Scale | Content                  |
| ----------- | ----- | ------------------------ |
| 512x512     | 4     | 512x512, exact fit       |
| 640x640     | 5     | 640x640, exact fit       |
| 700x500     | 3     | 384x384 centred at 158,58 |
| 1000x300    | 2     | 256x256 centred          |

`SDL_RenderClear` ignores the logical viewport, so the bars are painted with the
clear colour (black) rather than left undefined — verified by reading back the
full framebuffer at 700x500.

A minimum window size of 128x128 stops the scale factor reaching zero, since
there is no valid whole multiple below 1x.

### Window size and DPI

The window is `128 * scale` square, where `scale` is `4` multiplied by the
desktop's content scale and rounded to an integer — so it stays a whole-pixel
multiple of the 128x128 grid and `INTEGER_SCALE` never has to letterbox.

This exists because SDL3 is per-monitor DPI aware: a 512x512 request is 512
*physical* pixels, which looks small on a scaled desktop. A non-DPI-aware X
server such as X410 under WSL2 reports a content scale of 1.0 and lets Windows
bitmap-stretch the result instead, so the same numbers produced a larger but
slightly blurrier window there. Scaling ourselves matches that physical size on
native Windows while keeping every pixel exact.

Bump `BASE_SCALE` in `src/movement.ts` if you just want it bigger everywhere.

## Upstream audit

`@sdl3/sdl3-deno` was reviewed before use. It is 298 files of TypeScript with no
binaries, build scripts, or install hooks. No network calls, no subprocess
execution, no `eval`. The only host access is three `Deno.dlopen` calls for
SDL3/SDL3_image/SDL3_ttf, whose symbol tables are generated from SDL headers and
contain no non-`SDL_`/`IMG_`/`TTF_` entries. MIT licensed, published to JSR from
a tagged GitHub Action via OIDC.

Two behaviours worth knowing, neither malicious:

- `src/user_config_loader.ts` dynamically `import()`s `sdl3-deno.config.ts` from
  the current working directory if present — a normal config-file pattern, but it
  does execute that file. This project does not use one.
- Because it is an FFI library, it needs `--allow-ffi`, which is outside Deno's
  sandbox by definition. `deno run -A` is used here for convenience.
