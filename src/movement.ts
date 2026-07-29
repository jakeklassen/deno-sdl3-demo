/**
 * Port of the `movement` demo from ~/code/gamedev/node-sdl2-demo.
 *
 * The original draws into a 128x128 node-canvas and blits the raw BGRA buffer to
 * the window every frame. SDL3's logical presentation does that job natively:
 * everything below is drawn in 128x128 game coordinates and SDL scales it up to
 * the window using integer steps and nearest-neighbour sampling.
 *
 * Arrow keys move both ships, Escape quits.
 */
import {
  Display,
  Event,
  EventType,
  IMG,
  Render,
  SDL,
  SdlContext,
  Texture,
} from "@sdl3/sdl3-deno";
import { Font, RendererTextEngine, TtfContext } from "@sdl3/sdl3-deno/ttf";
import * as TTF from "@sdl3/sdl3-deno/TTF";
import { fromFileUrl } from "@std/path";

/** SDL takes native filesystem paths, so resolve assets off this module rather
 * than the working directory. Keeps `mise run` working from any subdirectory,
 * and yields a drive-letter path on Windows. */
const asset = (name: string) =>
  fromFileUrl(new URL(`../assets/${name}`, import.meta.url));

const GAME_WIDTH = 128;
const GAME_HEIGHT = 128;
const BASE_SCALE = 4;

/** How often we present a frame. */
const RENDER_FPS = 120;

/**
 * How often the simulation advances. Deliberately lower than RENDER_FPS: the
 * renderer interpolates between the previous and current simulation states, so
 * motion stays smooth at the render rate without simulating that often.
 * Velocities are per-second and the accumulator applies a fixed `dt`, so this
 * does not affect how fast anything moves.
 */
const SIM_HZ = 60;
const STEP = 1000 / SIM_HZ;
const dt = STEP / 1000;

/**
 * Movement speed in game pixels per second. The original demo's 60 happens to be
 * exactly one game pixel per simulation tick, which flatters the naive ship; the
 * sub-pixel technique separates from it most clearly at low speeds. Override with
 * `SPEED=12` to see the difference the way the pixel-art-smoother-movement demo
 * shows it.
 */
const SPEED = Number(Deno.env.get("SPEED") ?? 60);

using _sdl = new SdlContext();
using _ttf = new TtfContext();

// SDL3 is per-monitor DPI aware, so a window request is in *physical* pixels and
// comes out small on a scaled desktop. Non-DPI-aware X servers (X410 under WSL2)
// report 1.0 here and let Windows bitmap-stretch the result instead, which is
// why the same numbers looked bigger — but blurrier — there. Folding the desktop
// scale in ourselves matches that size natively while staying pixel-exact.
// Rounded so the 128x128 grid keeps landing on whole pixels.
const scale = Math.max(
  1,
  Math.round(BASE_SCALE * (Display.primary.contentScale || 1)),
);

using windowAndRenderer = Render.createWindowAndRenderer(
  "SDL3 Movement",
  GAME_WIDTH * scale,
  GAME_HEIGHT * scale,
  0n,
);
const { render } = windowAndRenderer;

render.setLogicalPresentation(
  GAME_WIDTH,
  GAME_HEIGHT,
  SDL.LOGICAL_PRESENTATION.INTEGER_SCALE,
);
render.setDefaultTextureScaleMode(SDL.SCALEMODE.NEAREST);

const playerTexturePointer = IMG.loadTexture(
  render.pointer,
  asset("image/player-ship.png"),
);

if (playerTexturePointer === null) {
  throw new Error(`Failed to load player sprite: ${SDL.getError()}`);
}

const playerTexture = new Texture(playerTexturePointer);
playerTexture.setScaleMode(SDL.SCALEMODE.NEAREST);

const sprite = playerTexture.size;

using font = Font.open(asset("fonts/pico-8.ttf"), 5);
// PICO-8's font is a pixel font, so keep the rasteriser from smoothing stems.
font.setHinting(TTF.HINTING.MONO);

using textEngine = RendererTextEngine.create(render.pointer);
using title = textEngine.createText(font, "Movement");
title.setColor({ r: 255, g: 255, b: 255, a: 255 });

// Opt-in so the demo looks like the original by default. Run with SHOW_FPS=1 to
// confirm the frame rate actually holds on a given machine.
const showFps = Deno.env.get("SHOW_FPS") === "1";
using fpsText = textEngine.createText(font, "");
fpsText.setColor({ r: 255, g: 236, b: 39, a: 255 });

let fpsFrames = 0;
let fpsLastSample = performance.now();

function drawFps(now: number) {
  fpsFrames++;
  if (now - fpsLastSample >= 500) {
    const fps = (fpsFrames * 1000) / (now - fpsLastSample);
    fpsText.setString(`${Math.round(fps)}`);
    fpsFrames = 0;
    fpsLastSample = now;
  }
  fpsText.drawRenderer(2, 2);
}

/**
 * @param smooth When true the sprite is drawn at its interpolated sub-pixel
 * position, letting SDL land it on an exact device pixel. When false it is
 * snapped to the 128x128 game grid first, which is what makes slow movement
 * visibly jitter — the two ships exist to show that difference side by side.
 */
function createPlayer(yOffset: number, smooth: boolean) {
  const x = Math.floor(GAME_WIDTH / 2 - sprite.w / 2);
  const y = Math.floor(GAME_HEIGHT / 2 - sprite.h / 2) + yOffset;

  return {
    boxCollider: {
      offsetX: 0,
      offsetY: 0,
      width: sprite.w,
      height: sprite.h,
    },
    x,
    y,
    // Simulation state from the previous tick, so rendering can interpolate.
    prevX: x,
    prevY: y,
    dx: 0,
    dy: 0,
    vx: SPEED,
    vy: SPEED,
    smooth,
  };
}

const player1 = createPlayer(-8, false);
const player2 = createPlayer(8, true);
const players = [player1, player2];

const input = {
  left: false,
  right: false,
  up: false,
  down: false,
};

// SDL keeps this array alive for the lifetime of the process and refreshes it on
// every event pump, which mirrors the original's `sdl.keyboard.getState()`.
const keyboardState = SDL.getKeyboardState();

if (keyboardState.ret === null) {
  throw new Error(`Failed to get keyboard state: ${SDL.getError()}`);
}

const keys = new Deno.UnsafePointerView(keyboardState.ret);

const isDown = (scancode: number) => keys.getUint8(scancode) !== 0;

let dtAccumulator = 0;
let last = performance.now();

function frame() {
  const hrt = performance.now();

  dtAccumulator += hrt - last;
  last = hrt;

  input.left = isDown(SDL.SCANCODE.LEFT);
  input.right = isDown(SDL.SCANCODE.RIGHT);
  input.up = isDown(SDL.SCANCODE.UP);
  input.down = isDown(SDL.SCANCODE.DOWN);

  while (dtAccumulator >= STEP) {
    for (const player of players) {
      // Captured per step rather than per frame, so after a frame that runs
      // several steps this still holds the state immediately before the last.
      player.prevX = player.x;
      player.prevY = player.y;

      player.dx = 0;
      player.dy = 0;

      if (input.left) {
        player.dx = -1;
      } else if (input.right) {
        player.dx = 1;
      }

      if (input.up) {
        player.dy = -1;
      } else if (input.down) {
        player.dy = 1;
      }

      player.x += player.dx * player.vx * dt;
      player.y += player.dy * player.vy * dt;

      if (player.x < 0) {
        player.x = 0;
        player.dx = 1;
      } else if (player.x > GAME_WIDTH - player.boxCollider.width) {
        player.x = GAME_WIDTH - player.boxCollider.width;
        player.dx = -1;
      }

      if (player.y < 0) {
        player.y = 0;
        player.dy = 1;
      } else if (player.y > GAME_HEIGHT - player.boxCollider.height) {
        player.y = GAME_HEIGHT - player.boxCollider.height;
        player.dy = -1;
      }
    }

    dtAccumulator -= STEP;
  }

  render.setDrawColor(0, 0, 0, 255);
  render.clear();

  const titleSize = title.size;
  title.drawRenderer(Math.floor(GAME_WIDTH / 2 - titleSize.w / 2), 3);

  if (showFps) {
    drawFps(hrt);
  }

  // How far we are between the last simulation tick and the next one.
  const alpha = dtAccumulator / STEP;

  for (const player of players) {
    const x = player.prevX + (player.x - player.prevX) * alpha;
    const y = player.prevY + (player.y - player.prevY) * alpha;

    // Logical presentation multiplies these by the render scale, so a fractional
    // logical coordinate resolves to an exact device pixel — measured: a quarter
    // of a game pixel moves the sprite exactly one physical pixel at 4x. That is
    // the whole trick: game-pixel art, device-pixel movement granularity.
    render.texture(playerTexture, null, {
      x: player.smooth ? x : x | 0,
      y: player.smooth ? y : y | 0,
      w: sprite.w,
      h: sprite.h,
    });
  }

  render.present();
}

for await (const event of Event.iter(1000 / RENDER_FPS, frame)) {
  if (event.type === EventType.QUIT) {
    break;
  }

  if (
    event.type === EventType.KEY_DOWN &&
    event.keyboard.scancode === SDL.SCANCODE.ESCAPE
  ) {
    break;
  }
}

playerTexture.destroy();
