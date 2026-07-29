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
pixels. As in the original, `player1` snaps to integer pixels while `player2`
keeps its sub-pixel position, so you can see the difference while moving.

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
