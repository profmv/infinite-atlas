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
| Relief | One fractal height field; coastline and contour lines are level sets that keep their shape and gain detail as you descend. |
| Relief + textures | The same relief with surface texture families (nebula, rivers, tissue, starfield, crystals, currents...) running across octaves. |
| Microscope | Nested layers of cells, one object per Voronoi cell (tissue with nuclei, round cells, diatoms with ribs and pore rings), shown through a round eyepiece in one of three stains (H&E, fluorescence, Giemsa). Finer layers only appear inside the room the coarser objects leave, and the camera steers away from the walls of big objects so they leave through the edge of the view. |
| Cosmos | Nested layers of galaxies (spirals, ellipticals, coloured starbursts); an unresolved galaxy is a point of the same light that opens up as you approach. Finer galaxies follow the arms of coarser ones, and the camera climbs toward bright structure. |
| Psychedelic | The same world as Relief, folded through a slowly turning kaleidoscope (5-9 mirrored wedges) and painted as flowing rainbow bands with glowing contour tiers. |
| Julia spiral | Exact self-similar zoom via the Poincaré function of z² + c at a repelling fixed point. One zoom period is q iterations (abs(L)^q), so the q arms visibly zoom instead of mostly spinning. |

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

**Nested worlds (Microscope, Cosmos).** Every octave is a Voronoi layer fixed
in its own frame. A layer's brightness is multiplied by the room left by the
coarser layers (geometric weights), so detail appears inside what is already
there instead of on top of it. Coarse layers fade only after their walls have
left the screen.

**Psychedelic.** It reuses the Relief field, so it has the same endless detail
and only changes how the field is folded and coloured.

**Julia spiral.** For f(z) = z² + c with a repelling fixed point and
multiplier L, the Poincaré function P(w) satisfies P(Lw) = f(P(w)). Rendering P
instead of the plane gives a seamless zoom. One zoom period is q iterations
(a factor of |L|^q), so the q arms visibly zoom instead of mostly spinning,
using only small numbers on the GPU.

The render resolution adapts if frames run slow.

## Run locally

The page is a single self-contained `index.html` (WebGL2, no build step).
Open it in a current desktop or mobile browser, or serve the folder with any
static server.
