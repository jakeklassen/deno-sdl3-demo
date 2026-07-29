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

const GAME_WIDTH = 128;
const GAME_HEIGHT = 128;
const SCALE = 4;

const TARGET_FPS = 60;
const STEP = 1000 / TARGET_FPS;
const dt = STEP / 1000;

using _sdl = new SdlContext();
using _ttf = new TtfContext();

using windowAndRenderer = Render.createWindowAndRenderer(
  "SDL3 Movement",
  GAME_WIDTH * SCALE,
  GAME_HEIGHT * SCALE,
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
  "assets/image/player-ship.png",
);

if (playerTexturePointer === null) {
  throw new Error(`Failed to load player sprite: ${SDL.getError()}`);
}

const playerTexture = new Texture(playerTexturePointer);
playerTexture.setScaleMode(SDL.SCALEMODE.NEAREST);

const sprite = playerTexture.size;

using font = Font.open("assets/fonts/pico-8.ttf", 5);
// PICO-8's font is a pixel font, so keep the rasteriser from smoothing stems.
font.setHinting(TTF.HINTING.MONO);

using textEngine = RendererTextEngine.create(render.pointer);
using title = textEngine.createText(font, "Movement");
title.setColor({ r: 255, g: 255, b: 255, a: 255 });

function createPlayer(yOffset: number) {
  return {
    boxCollider: {
      offsetX: 0,
      offsetY: 0,
      width: sprite.w,
      height: sprite.h,
    },
    x: Math.floor(GAME_WIDTH / 2 - sprite.w / 2),
    y: Math.floor(GAME_HEIGHT / 2 - sprite.h / 2) + yOffset,
    dx: 0,
    dy: 0,
    vx: 60,
    vy: 60,
  };
}

const player1 = createPlayer(-8);
const player2 = createPlayer(8);
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

  // player1 snaps to whole pixels while player2 keeps its sub-pixel position,
  // exactly as in the original demo.
  render.texture(playerTexture, null, {
    x: player1.x | 0,
    y: player1.y | 0,
    w: sprite.w,
    h: sprite.h,
  });
  render.texture(playerTexture, null, {
    x: player2.x,
    y: player2.y,
    w: sprite.w,
    h: sprite.h,
  });

  render.present();
}

for await (const event of Event.iter(STEP, frame)) {
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
