# Capture bundle format

This is the bundle the prototype writes and Echo-3 accepts as `capture_bundle` input: ordered JPEG frames plus one camera pose and one pinhole calibration per frame, packaged as one ZIP. It is a posed image set, not a video.

The authoritative contract is the private beta reference at [developers.spaitial.ai/docs/beta](https://developers.spaitial.ai/docs/beta). If you can't see it, email [support@spaitial.ai](mailto:support@spaitial.ai). This page summarizes it and notes where the prototype makes a choice. Where the two disagree, the beta reference wins.

`samples/minimal-bundle/` is a complete 3-frame example. `tools/validate-bundle` checks a folder or a ZIP against this page.

## Layout

```
capture.zip
├── images/
│   ├── Image_000001.jpg
│   ├── Image_000002.jpg
│   └── ...
└── cameras/
    ├── camera_trajectory.json
    └── per_frame_intrinsics.json
```

That is everything the prototype writes, and everything Echo-3 needs. Both guidance setups write this same layout. The LiDAR depth and mesh that the Full setup uses for live coaching are never saved.

- `images/` and `cameras/` sit at the ZIP root. One wrapper folder is tolerated, so the app's export (`bundle/images/...`) can be sent as is.
- Two optional files are also accepted: `cameras/orientation.json` (`{ "orientation": ... }`) and `cameras/camera_intrinsics.json` (one shared calibration). The prototype writes neither. When both intrinsics files are present, the per-frame one takes precedence.
- Anything outside the layout, such as `__MACOSX/` or dotfiles, is ignored. Don't add other files. The validator lists those paths as a warning.

## Limits

| Rule | Value |
| --- | --- |
| Frames | 1 to 5,000 |
| Entry size | at most 64 MiB uncompressed |
| Total size | at most 8 GiB uncompressed |
| Compression | stored or deflate only. Entries of 1 MiB or more may not compress better than 100:1 |
| Forbidden | encryption, symlinks, absolute paths, `..` segments, duplicate entries |
| Image names | `Image_%06d.jpg`, one-based, contiguous, no gaps or duplicates |
| Index parity | `images/Image_{i+1}`, trajectory entry `i` and intrinsics entry `i` describe the same `ARFrame` |

## Images

- JPEG in the sensor's native landscape orientation: 1920×1440 on iOS. 1920×1080 is also accepted, for Android capture apps. The size must match `width_px` and `height_px` in the intrinsics.
- Never resize or rotate pixels. A portrait scan comes out 1920 wide and 1440 high and looks rotated 90° when opened. That is expected, so don't rotate it.
- EXIF `Orientation` is absent or 1.
- One fixed physical hold for the whole scan. If the user rotates the device, stop saving frames or start a new capture.
- Include every frame the capture accepted. Don't thin frames yourself.

### EXIF capture time

Embed `ARFrame.exifData` in every JPEG. Three tags are mandatory and must sit within the first 64 KiB of the file:

| Tag | Example |
| --- | --- |
| `DateTimeOriginal` | `2026:01:01 12:00:00` |
| `SubSecTimeOriginal` | `520` (digits only; second-only timestamps are not enough) |
| `OffsetTimeOriginal` | `+01:00` |

The capture time of a frame is `DateTimeOriginal` read in the `OffsetTimeOriginal` zone, plus `0.<SubSecTimeOriginal>` seconds. Capture times must strictly increase in frame order. **These capture times are important: keep them intact, and never strip or rewrite them.**

The prototype passes `ARFrame.exifData` through unchanged (`CaptureBundleWriter.jpegData`). ImageIO writes the EXIF block in the JPEG's first segment, well inside 64 KiB.

## `cameras/camera_trajectory.json`

One 4×4 row-major matrix per image, as a JSON array of shape `[N][4][4]`:

```json
[
  [
    [0.0, -1.0, 0.0, 1.4],
    [-1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, -1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0]
  ]
]
```

- Convention: OpenCV **`camera_from_world`**, mapping a world point into camera coordinates. Camera axes are +X right, +Y down, +Z forward. Units are metres.
- Convert each ARKit pose `T_wc = ARFrame.camera.transform` (world_from_camera, -Z forward, +Y up) with `M = diag(1, -1, -1, 1) · inverse(T_wc)`.
- Rotation columns unit length and mutually orthogonal within 1e-4, determinant +1 within 1e-4, last row `[0, 0, 0, 1]` within 1e-6.
- All poses belong to one ARKit world. The first entry doesn't need to be identity.

See [coordinate-conventions.md](coordinate-conventions.md) for the derivation and the tests that guard it. Validation checks matrix shape, not correctness, so a wrongly converted trajectory passes and then reconstructs badly.

## `cameras/per_frame_intrinsics.json`

One pinhole calibration per image, as parallel arrays indexed like the trajectory:

```json
{
  "frame_count": 3,
  "width_px": 1920,
  "height_px": 1440,
  "fx_px": [1350.1, 1350.2, 1350.4],
  "fy_px": [1350.1, 1350.2, 1350.4],
  "cx_px": [961.4, 961.4, 961.5],
  "cy_px": [719.8, 719.8, 719.9]
}
```

- `frame_count` = N, and each of the four arrays holds exactly N finite values.
- `width_px` and `height_px` are the encoded JPEG size, uniform across the capture.
- `100 <= fx_px, fy_px <= 10000`, `0 < cx_px < width_px`, `0 < cy_px < height_px`.
- Read `ARFrame.camera.intrinsics` columns `0.x`, `1.y`, `2.x`, `2.y`. If `camera.imageResolution` differs from the encoded size, scale X and Y separately: `fx_px = fx * encoded_width / imageResolution.width`, and the same for `cx`. Y uses the height.

## Hold orientation

The prototype works out how the phone was held from the trajectory, to show portrait or landscape thumbnails. The result is stored in the local manifest, not the bundle. For each matrix `M`, let `upX = M[0][1]` and `upY = M[1][1]`:

- If `|upX| >= |upY|`, the frame votes portrait.
- Otherwise, if `upY < 0`, it votes upright landscape.
- Otherwise it votes upside-down landscape.

| Result | Hold |
| --- | --- |
| `arkit_landscape_sensor` | Portrait, when portrait votes are at least half |
| `rotate_180` | Upside-down landscape, when those votes outnumber upright ones |
| `identity` | Upright landscape otherwise |

If you do write `cameras/orientation.json`, it must hold one of those three values, and the validator warns when it disagrees with the trajectory. A disagreement usually means a missing axis flip.

## What gets checked where

| Check | On device (`CaptureBundleValidator`) | `tools/validate-bundle` |
| --- | --- | --- |
| ZIP structure, paths, compression, sizes | n/a (no zip yet) | yes |
| Image names and counts | yes | yes |
| Image pixel size vs intrinsics | yes | yes (`IMAGE_SIZE_MISMATCH`) |
| EXIF capture time and `Orientation` | yes | yes |
| Trajectory matrices | yes | yes |
| Per-frame intrinsics | yes | yes |
| Hold orientation from the trajectory | written to the manifest | reported |

Both validators report every problem at once, using the issue codes listed in the beta reference.
