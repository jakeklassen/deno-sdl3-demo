#Requires -Version 5.1
<#
.SYNOPSIS
Downloads the official SDL3 runtime DLLs into .\sdl3.

Unlike Linux, libsdl-org publishes prebuilt Windows binaries, so there is
nothing to compile here - no MSVC, cmake or ninja needed. The versions match
the tags built from source by scripts/build-sdl3.sh.
#>
$ErrorActionPreference = 'Stop'
# Invoke-WebRequest is drastically slower with the progress bar enabled.
$ProgressPreference = 'SilentlyContinue'

$SdlVersion = '3.4.12'
$SdlImageVersion = '3.4.4'
$SdlTtfVersion = '3.2.2'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'sdl3'
$work = Join-Path $root '.sdl3-build'

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    'ARM64' { 'arm64' }
    'x86'   { 'x86' }
    default { 'x64' }
}
Write-Host "==> target architecture: $arch"

New-Item -ItemType Directory -Force -Path $out, $work | Out-Null

$packages = @(
    @{ Repo = 'SDL';       Tag = "release-$SdlVersion";      Asset = "SDL3-$SdlVersion-win32-$arch.zip" }
    @{ Repo = 'SDL_image'; Tag = "release-$SdlImageVersion"; Asset = "SDL3_image-$SdlImageVersion-win32-$arch.zip" }
    @{ Repo = 'SDL_ttf';   Tag = "release-$SdlTtfVersion";   Asset = "SDL3_ttf-$SdlTtfVersion-win32-$arch.zip" }
)

foreach ($pkg in $packages) {
    $zip = Join-Path $work $pkg.Asset

    if (Test-Path $zip) {
        Write-Host "==> $($pkg.Asset): already downloaded"
    }
    else {
        $url = "https://github.com/libsdl-org/$($pkg.Repo)/releases/download/$($pkg.Tag)/$($pkg.Asset)"
        Write-Host "==> $($pkg.Asset): downloading"
        Invoke-WebRequest -Uri $url -OutFile $zip
    }

    $extracted = Join-Path $work ([IO.Path]::GetFileNameWithoutExtension($pkg.Asset))
    if (Test-Path $extracted) { Remove-Item -Recurse -Force $extracted }
    Expand-Archive -Path $zip -DestinationPath $extracted -Force

    Get-ChildItem -Path $extracted -Filter '*.dll' -Recurse |
        ForEach-Object { Copy-Item $_.FullName -Destination $out -Force }
}

# Single cross-platform marker for mise's `outputs` staleness check; the real
# artifact names differ per platform (SDL3.dll / libSDL3.so / .dylib).
New-Item -ItemType File -Force -Path (Join-Path $out '.setup-complete') | Out-Null

Write-Host ''
Write-Host "==> Installed into $out"
Get-ChildItem $out | Select-Object -ExpandProperty Name
