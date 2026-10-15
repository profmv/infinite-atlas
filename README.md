# Infinite Atlas

An endless, continuous zoom into a fractal world, like turning up a
microscope: every shape on screen keeps its form while finer detail grows out
of it. Nothing is swapped out as you descend; what you see now is the coarse
outline of what you will see later.

**Live:** https://profmv.github.io/infinite-atlas/

## Models

Pick one from the **Model** selector in the bar (or press `M`). The choice is
remembered in the browser.

| Model | What you see |
| --- | --- |
| Relief | A fractal coastline with hill-shaded land, sea and nested contour lines. The camera follows the coast, where detail never runs out. |
| Relief + textures | The same world, with surface textures (nebulae, rivers, cells, stars, crystals, currents) drawn over the land and sea. |
| Julia spiral | An exact, endless zoom into a Julia set around one of its fixed points. The picture repeats itself, turned, every time it grows by the multiplier. |

## Controls

| Input | Action |
| --- | --- |
| Model selector or `M` | Switch model |
| Zoom speed slider | Sets the descent rate (shown as magnification per minute); 0 freezes it |
| `Space` | Pause / resume |
| `R` or "New world" | Generate a new world for the current model |

The controls and readout fade out after a few seconds without input and
return on any pointer movement.

## How it works

**Relief.** The world is one height field: a sum of infinitely many octaves
of gradient noise, each twice as fine and 0.62 times as tall as the one above.
The coastline (height 0) and the contour lines are level sets of that single
field, so zooming only adds octaves; it never replaces what is there.

- Per pixel the shader evaluates 17 octaves around the current scale. Octaves
  far coarser than the screen are folded into a quadratic Taylor patch
  (value, gradient, Hessian) computed in JavaScript doubles.
- The field is rescaled by the zoom depth and each octave keeps its own small
  coordinate frame, so float precision never runs out.
- The noise hash is integer-exact and identical in GLSL and JavaScript, so the
  CPU knows where the coast is and steers the camera along it.
- Contour tiers double in spacing, so every coarse line is also a line of the
  finer tiers: lines gain neighbours as you descend instead of vanishing.

**Julia spiral.** For f(z) = z² + c with a repelling fixed point and
multiplier L, the Poincaré function P(w) satisfies P(Lw) = f(P(w)). Rendering P
instead of the plane gives a seamless zoom that repeats every factor of |L|,
using only small numbers on the GPU.

The render resolution adapts if frames run slow.

## Run locally

The page is a single self-contained `index.html` (WebGL2, no build step).
Open it in a current desktop or mobile browser, or serve the folder with any
static server.
