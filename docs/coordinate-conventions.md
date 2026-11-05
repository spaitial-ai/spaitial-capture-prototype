# Coordinate conventions

Wrong pose conventions are the most common way to produce a bundle that passes validation and then reconstructs as garbage. This page covers the four things to get right: the axis flip, the inverse, the matrix layout and the world frame.

## Frames

| Frame | +X | +Y | +Z | Source |
| --- | --- | --- | --- | --- |
| ARKit camera | right (of the landscape sensor) | up | backward, out of the screen toward the user | `ARFrame.camera.transform` |
| OpenCV camera | right | down | forward, into the scene | what the bundle stores |
| ARKit world | set at session start | up (gravity) | set at session start | `worldAlignment = .gravity` |

"Right" and "up" are for the sensor in its native landscape orientation, which is ARKit's `capturedImage` orientation (`UIInterfaceOrientation.landscapeRight`) whatever the UI is doing. Units are metres.

## The conversion

ARKit gives `arkit_world_from_camera`, a pose that maps camera points into the world. The bundle stores `opencv_camera_from_world`, which maps world points into the OpenCV camera. You get there in two steps:

1. Invert the pose. `inverse(arkit_world_from_camera)` is `arkit_camera_from_world`.
2. Flip camera Y and Z. Left-multiply by `diag(1, -1, -1, 1)` to go from ARKit camera axes to OpenCV camera axes.

```
opencv_camera_from_world = diag(1, -1, -1, 1) · inverse(arkit_world_from_camera)
```

In Swift (`ios/Capture/CameraGeometry.swift`):

```swift
static let arkitToOpenCV = simd_float4x4(
    SIMD4(1, 0, 0, 0),
    SIMD4(0, -1, 0, 0),
    SIMD4(0, 0, -1, 0),
    SIMD4(0, 0, 0, 1)
)

static func opencvCameraFromWorld(arkitWorldFromCamera: simd_float4x4) -> simd_float4x4 {
    arkitToOpenCV * arkitWorldFromCamera.inverse
}
```

The flip goes on the **left**, because it acts on camera coordinates. Putting it on the right flips world axes instead. The result is still a valid rotation, so validation passes, but every camera now looks the wrong way.

Even an identity ARKit pose converts to a non-identity matrix, `diag(1, -1, -1, 1)`.

## Matrix layout

The JSON stores each matrix **row-major**: `matrix[row][column]`, with the translation in the last column (`matrix[0][3]`, `matrix[1][3]`, `matrix[2][3]`).

`simd_float4x4` is column-major: `m.columns.3` is the translation column, and `m.columns.1.x` is row 0, column 1. Serialize through an explicit row-major helper. The prototype has `simd_float4x4.rowMajorArray` and `simd_float4x4.fromRowMajor(_:)` for this. Do not `JSONEncoder` the columns, because that writes the transpose. A transposed rotation is still orthonormal, so validation will not catch it, but the translation ends up in the last row and fails `MATRIX_FINAL_ROW`. If you are lucky, that is the error you see.

## One world frame per bundle

Every pose in a bundle must come from the same ARKit world. ARKit re-anchors the world when you call `session.run(_:options:)` with `.resetTracking`, and after some relocalization failures. Frames from before and after a reset are in different coordinate systems.

The prototype makes sure this never happens:

- The scan only starts after tracking has been `normal` for 0.5 s. This is the settle gate in `CaptureTrackingSettleGate`.
- A frame is never committed while tracking is `limited`.
- When consecutive poses jump by more than 5 m/s or 720°/s, sampling pauses and has to settle again. That catches a world shift ARKit didn't report as a tracking change.
- `.resetTracking` is used only when the preview or the scan starts, before the first frame is committed. Resuming after an interruption reruns the session without it and waits for tracking to settle again.

A mixed-epoch trajectory is valid JSON with valid matrices. The validator can't detect it. Your app's capture logic is the only guard.

## Intrinsics

ARKit's `camera.intrinsics` is a column-major 3×3 at `camera.imageResolution`:

```
fx = intrinsics.columns.0.x    fy = intrinsics.columns.1.y
cx = intrinsics.columns.2.x    cy = intrinsics.columns.2.y
```

If the pixel buffer you encode has a different size than `imageResolution`, scale `fx`/`cx` by the width ratio and `fy`/`cy` by the height ratio (`CameraGeometry.scaleIntrinsics`). With the 1920×1440 format the two sizes match and the scale is 1.

Intrinsics are always for the stored, unrotated landscape image. Never swap `fx`/`fy` or `cx`/`cy` for portrait.

## Hold orientation

The phone hold is derived from the trajectory, not from `UIDevice.orientation`. That makes it agree with the poses by construction. Row 1 of the OpenCV rotation is the camera's +Y ("down" in the image) in world coordinates. Its world-up component tells you how the sensor's long edge sits relative to gravity. The vote rule is in [bundle-format.md](bundle-format.md#hold-orientation). The bundle doesn't need `orientation.json`.

During a scan, `CameraGeometry.isClearHoldMismatch` compares each pose with the hold the scan started in, and sampling skips frames in the other hold. Views within 30° of straight up or down never count as a mismatch, because world up barely projects onto the image there.

## Tests that guard the convention

`ios/Tests/CameraGeometryTests.swift`:

| Test | Catches |
| --- | --- |
| OpenCV conversion round-trips through inverse | Wrong inverse, or the flip on the wrong side |
| Reprojection with multi-axis rotation lands on the known pixel | Any axis or sign error, using a known world point and pixel |
| Identity and pure translation also reproject | Degenerate cases that hide sign errors |
| Intrinsics scale to pixel-buffer dimensions | Wrong scaling between ARKit resolution and buffer size |
| Portrait / upright / inverted hold votes | Orientation vote |
| Only a clear hold mismatch blocks frames | Floor and ceiling passes mistaken for a rotated phone |

If you port the capture code to another language or framework, port these tests first. A projection test like this is the only check that proves the conversion is right:

```
world point P  →  opencv_camera_from_world · P  →  (fx·x/z + cx, fy·y/z + cy)  ==  known pixel
```

Validation only proves the file is well formed.
