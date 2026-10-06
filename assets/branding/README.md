# CypherClaw logo artwork

The logo image was supplied by the user who requested its use in CypherClaw on
2026-10-06. `cypherclaw-original.jpg` retains the latest uploaded 1254 × 1254
JPEG without modification. It depicts the black, waving CypherTrooper with a
white face emblem and the `CYPHERTROOPER` nameplate on a white background.

The opaque application icons and README image use the complete supplied photo.
Their processing is limited to deterministic uniform resizing and image format
conversion. The original white background, full figure, emblem, nameplate text,
colors, proportions, and pose are preserved.

The user also authorized a transparent background for UI and tray locations.
`cypherclaw-transparent.png` keeps the full 1254 × 1254 composition and removes
the exterior white background. The built-in image generation tool was used for
background extraction with the recorded [background extraction prompt](background-extraction-prompt.txt).
The resulting RGBA extraction is retained as `cypherclaw-background-mask.png`.
The generator combines its alpha with the original decoded RGB: interior subject
colors come from the original photo, while extracted boundary colors remove
white backdrop contamination at partially transparent edges. The complete
figure, both hands and feet, white emblem, shoes, and `CYPHERTROOPER` nameplate
remain in the transparent variant. No head crop, new pose, or alternate
illustration is used.

This records the source and processing of separate artwork. The OpenClaw
Foundation copyright and the repository's MIT code license remain unchanged;
they do not establish ownership of this image or automatically license it.
No additional ownership or redistribution rights are asserted by this record.

## Application masters

- `cypherclaw-mascot.png`: a 1254 × 1254 PNG format conversion of the complete
  uploaded image, with the same decoded pixels and an opaque background.
- `cypherclaw-app-icon.png`: an opaque 1024 × 1024 uniform resize of the
  complete supplied image for native application icons.
- `cypherclaw-mark.png`: an opaque 256 × 256 uniform resize of the complete
  supplied image. This is not a head crop.
- `cypherclaw-transparent.png`: the 1254 × 1254 complete figure with the
  authorized exterior background extraction for UI and tray images.

`node scripts/generate-cypherclaw-brand-assets.mjs` deterministically creates
these masters from the checked-in original JPEG and background extraction
using Photon and Lanczos3 resizing. The checked-in extraction and prompt record
the built-in tool operation; this script does not repeat that tool call.
`node scripts/generate-cypherclaw-logo-surfaces.mjs` regenerates the opaque
README image, transparent browser-lab assets, and transparent embedded OAuth
asset. `node scripts/generate-cypherclaw-native-icons.mjs --write` regenerates
native resources; `--check` checks the generated files without writing them.
These regeneration scripts make no image generation API calls.

Native launcher and application catalogs retain the opaque supplied photo,
including identical artwork for light, dark, and debug variants. Native UI,
tray, watch UI, and large notification images use the transparent full figure.
Functional status indicators are displayed outside the logo. The README uses
a 512px opaque full image, the browser lab uses 256px and 128px transparent full
images, and isolated OAuth pages embed a 128px transparent PNG so they need no
external asset request.

Terminals display the plain CypherClaw product name without reproducing or
reinterpreting the supplied logo. Third-party provider logos, upstream reference
images, and copyright notices are separate and are retained.

## Source and master integrity

| File                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `cypherclaw-original.jpg`          | `7a95bce256f6dfa57a12469132fcb576442ff267663ad76cfe01e9351421dcc1` |
| `cypherclaw-mascot.png`            | `c02183813eb4256a70a35f8aa57d0041795c731a7dc494e5ce59817b33da4911` |
| `cypherclaw-app-icon.png`          | `dff72558424ef7c4182aaadcc564c503812d65ef2980217c8756415c8ec3d536` |
| `cypherclaw-mark.png`              | `7ba0f837221742bca193016a241496b6e66776f13e4b4076d00dfaa7d332cc78` |
| `cypherclaw-transparent.png`       | `190f0314ac8a65ef28cafe54e752fcbf6f4d27b041c315e90190f320caf6f946` |
| `cypherclaw-background-mask.png`   | `0474049f76beac1758d0bfeceb026d93dda753dc79c0ac3d7586c2b9059659a0` |
| `background-extraction-prompt.txt` | `19d5c5989071bf8e5cc2a4b35a2809d83cc085607456a714f776a0d6e4b35159` |
