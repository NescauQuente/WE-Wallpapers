# Deprecated

## starry-orbit (the CasaOS mod)

The first way Starry Orbit ran on CasaOS: a CasaMOD mod of its own that loaded the engine straight into the CasaOS page (`Starry.host`), with its own tile in the wallpaper menu, a settings panel in the CasaOS look and the tab audio tap (`audio-tap.js`, written in at the `/*__AUDIO_TAP__*/` line by the old build).

Replaced by the **Live Wallpapers** mod (`../../CasaMODs/casaos-live-wallpapers`), which runs `../wallpaper-engine` exactly as published for Wallpaper Engine: copy that folder into `/DATA/AppData/casamod/mod/wallpapers/starry-orbit/` on the CasaOS server. Same clicks, black hole and tab audio, a settings panel built from `project.json`, and isolated from CasaOS.

Kept for reference only: nothing builds or tests it.
