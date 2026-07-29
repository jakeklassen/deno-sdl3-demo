# deno-sdl3-demo

Deno + SDL3 via [`@sdl3/sdl3-deno`](https://jsr.io/@sdl3/sdl3-deno), with the
`movement` demo ported from `~/code/gamedev/node-sdl2-demo`.

## Quick start

```sh
mise run movement
```

The first run builds SDL3 into `./sdl3` (a few minutes); after that it just
launches the demo. Arrow keys move both ships, Escape quits.

## How SDL3 is managed

mise has no `sdl` in its registry, libsdl-org publishes no prebuilt Linux
binaries (only win32/dmg/mingw/android), and Ubuntu 24.04 has no `libsdl3`
package — SDL3 landed in Ubuntu 25.04. So SDL3 is not a `[tools]` entry.

Instead `mise run setup-sdl` builds it from pinned upstream release tags via
`scripts/build-sdl3.sh`:

| Library    | Tag              |
| ---------- | ---------------- |
| SDL        | `release-3.4.12` |
| SDL_image  | `release-3.4.4`  |
| SDL_ttf    | `release-3.2.2`  |

Sources are cloned into `.sdl3-build/` and the resulting shared libraries land in
`./sdl3`, which is already one of sdl3-deno's default search paths. mise also
exports `DENO_SDL3_PATH` so the demo runs from any working directory, and the
task's `sources`/`outputs` keys mean the build is skipped once it is up to date.

Both `sdl3/` and `.sdl3-build/` are gitignored — a fresh clone runs one command
to reproduce them.

### Build notes

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
pixels. As in the original, `player1` snaps to integer pixels while `player2`
keeps its sub-pixel position, so you can see the difference while moving.

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
