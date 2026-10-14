# Infinite Atlas

An endless, slow zoom into a procedurally generated atlas. Every octave of
magnification reveals a new layer of structure drawn from nature and the
cosmos: nebulae, terrain relief with coastlines and contour lines, river and
vein networks, cellular tissue, starfields with spiral galaxies, snow
crystals, and banded currents. Layers never repeat, so the descent keeps
showing new patterns for as long as it runs.

**Live:** https://profmv.github.io/infinite-atlas/

![Six frames from two generated worlds](artifacts/preview.jpg)

## Controls

| Input | Action |
| --- | --- |
| Zoom speed slider | Sets the descent rate (shown as magnification per minute); 0 freezes it |
| `Space` | Pause / resume |
| `R` or "New world" | Generate a fresh set of layers |

The controls and readout fade out after a few seconds without input and
return on any pointer movement.

## How it works

- The view is a stack of 7 octave layers, each twice as fine as the one above.
- Each layer has its own randomly chosen pattern family, hue, rotation and
  offset. Hue takes a random walk between neighbouring octaves, with
  occasional jumps into a new colour world.
- Zooming in moves every layer towards the coarse end. When the coarsest
  layer outgrows the screen it is retired, and a new random layer is created
  at the fine end.
- Layer offsets live in JavaScript doubles and the shader only receives
  small, layer-relative coordinates, so precision never degrades. In testing,
  the zoom ran past 3e14x magnification (48 octaves) without artefacts.
- Layers whose features would be smaller than a few pixels are faded out to
  prevent aliasing, and the render resolution adapts if frames run slow.

## Run locally

The page is a single self-contained `index.html` (WebGL2, no build step).
Open it in a current desktop or mobile browser.

## Roadmap

- Zoom gradually follows the pointer position.
- Local weather, date/time, pointer position and geographic location feed
  extra variation into shapes, colours and behaviour.
