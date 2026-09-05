# Neon reference notes

The target is the Xbox 360 music visualizer created by Jeff Minter and Ivan
Zorzin at Llamasoft, rather than a generic neon spectrum or a fractal flight demo.

## References

- [Original Neon manual](https://www.minotaurproject.co.uk/x360manual.php).
  The indexed introduction identifies Neon as an interactive visualizer; the
  full manual was unavailable during this work.
- [Llamasoft's Neon page](https://www.llamasoft.co.uk/neon.php).
  Its indexed description explains autonomous audio input and up to four
  controller-driven display elements.
- [17 original E3 images, May 13, 2005](https://www.gamersyde.com/news_e3_discover_neon_with_these_images-1502_en.html).
  All 17 images were inspected. They show a wide range, including warped
  perspective, colored surfaces, repeated texture cells, layered geometry,
  ribbon trails, radial forms, and bright highlights against dark regions.
- [Console footage](https://www.youtube.com/watch?v=2dcI6MHwLmQ).
  The page was located, but video playback did not become available in the
  research browser. It is provided for further comparison, not as a claim that
  the full recording was viewed.

The E3 material is an early build, so these references do not establish exact
pixel or timing parity with every shipped console preset.

## Visual decisions

| Observed reference feature | Newon implementation |
| --- | --- |
| Translucent, ribbed surfaces | Parametric meshes with bands, cells, and edge lighting |
| 3D forms embedded in the previous picture | Previous-frame texture sampling on the mesh |
| Recursive zoom and trails | Two alternating feedback buffers with zoom, twist, and liquid warp |
| Varied geometry and compositions | Six surface families across eight curated scenes |
| Colored highlights with readable dark regions | Bounded feedback and a color-preserving output curve |
| Interactive light synthesis | Pointer camera control, gamepad input, palettes and variations |

These are design interpretations from public references. The implementation does
not claim to reproduce the original source, complete modular architecture,
four-player role assignments, V-crew behavior, or preset catalog.

## Validation

The native rendering harness uses the actual GLSL and WebGL pipeline. It records
each scene with the same deterministic inputs, checks nonempty pixels and
overexposure, and tests the renderer's controls. Audio tests cover silence,
frequency separation, refresh-rate independence, source reset, and small FFTs.

Hardware performance, physical gamepad input, system-audio permissions, and
Spotify Automation permission still need checking on the user's Mac. The native
CI build checks packaging and rendering; it cannot grant the user's permissions
or listen to music on their computer.
