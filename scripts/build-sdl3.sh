#!/usr/bin/env bash
# Builds SDL3, SDL3_image and SDL3_ttf from official libsdl-org sources into ./sdl3.
#
# libsdl-org publishes no prebuilt Linux binaries and Ubuntu 24.04 has no libsdl3
# package, so we build from pinned release tags. ./sdl3 is one of sdl3-deno's
# default library search paths, so no extra configuration is needed once this runs.
set -euo pipefail

SDL_TAG="release-3.4.12"
SDL_IMAGE_TAG="release-3.4.4"
SDL_TTF_TAG="release-3.2.2"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.sdl3-build"
PREFIX="$WORK/install"
OUT="$ROOT/sdl3"

mkdir -p "$WORK" "$OUT"

# Resolve the shared libs against their own directory so SDL3_image/SDL3_ttf can
# find libSDL3.so without LD_LIBRARY_PATH.
COMMON_FLAGS=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DBUILD_SHARED_LIBS=ON
  -DCMAKE_INSTALL_PREFIX="$PREFIX"
  -DCMAKE_PREFIX_PATH="$PREFIX"
  -DCMAKE_INSTALL_RPATH='$ORIGIN'
  -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
)

clone_at_tag() {
  local repo="$1" tag="$2" dir="$WORK/$3"
  if [ -d "$dir/.git" ]; then
    echo "==> $3: reusing existing checkout"
    git -C "$dir" fetch --depth 1 origin tag "$tag" --no-tags
    git -C "$dir" checkout -q FETCH_HEAD
  else
    echo "==> $3: cloning $tag"
    git clone --depth 1 --branch "$tag" "$repo" "$dir"
  fi
}

build() {
  local dir="$WORK/$1"
  shift
  cmake -S "$dir" -B "$dir/build" "${COMMON_FLAGS[@]}" "$@"
  cmake --build "$dir/build"
  cmake --install "$dir/build"
}

clone_at_tag https://github.com/libsdl-org/SDL.git       "$SDL_TAG"       SDL
clone_at_tag https://github.com/libsdl-org/SDL_image.git "$SDL_IMAGE_TAG" SDL_image
clone_at_tag https://github.com/libsdl-org/SDL_ttf.git   "$SDL_TTF_TAG"   SDL_ttf

# XSCRNSAVER is enabled by default and hard-errors when libxss-dev is absent
# (every other optional X11 extension auto-disables). It only inhibits the
# screensaver, so turning it off avoids needing a root package install.
build SDL -DSDL_X11_XSCRNSAVER=OFF

# Use the system libpng/libjpeg/libwebp rather than vendored submodules (which we
# did not clone). AVIF/JXL/TIF are off because their dev packages are not installed.
build SDL_image \
  -DSDLIMAGE_VENDORED=OFF \
  -DSDLIMAGE_SAMPLES=OFF \
  -DSDLIMAGE_DEPS_SHARED=OFF \
  -DSDLIMAGE_AVIF=OFF \
  -DSDLIMAGE_JXL=OFF \
  -DSDLIMAGE_TIF=OFF

# System freetype + harfbuzz. plutosvg is vendored-only, so it stays off.
build SDL_ttf \
  -DSDLTTF_VENDORED=OFF \
  -DSDLTTF_SAMPLES=OFF \
  -DSDLTTF_PLUTOSVG=OFF \
  -DSDLTTF_HARFBUZZ=ON

cp -aP "$PREFIX"/lib/libSDL3*.so* "$OUT"/

echo
echo "==> Installed into $OUT:"
ls -1 "$OUT"
