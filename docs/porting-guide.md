# Porting guide

How to take the capture core from this repo into your own app, and what to keep if you rewrite it on another stack.

First pick a guidance setup, Core or Full, and follow [guidance-setups.md](guidance-setups.md) to remove the one you don't want. Everything below applies to both.

## Option A: start from this app

1. Change the identity:
   - `PRODUCT_BUNDLE_IDENTIFIER` and `bundleIdPrefix` in `ios/project.yml`.
   - `CAPTURE_DISPLAY_NAME` for each target in `ios/project.yml` (it feeds `CFBundleDisplayName`).
   - Your `DEVELOPMENT_TEAM`.
   - The colors in `ios/App/Theme.swift`, and the app icon in `ios/Resources/Assets.xcassets`.
2. Run `cd ios && xcodegen generate`, then build and test (see the README).
3. Replace the screens with your own UI. Nothing in `Capture/` or `Storage/` depends on `Screens/`.
4. Send bundles to Echo-3 from your backend. See [Sending bundles](#sending-bundles).

## Option B: drop the core into an existing iOS app

Copy these files. They have no dependencies beyond Apple frameworks.

| Group | Files | Required? |
| --- | --- | --- |
| Geometry | `Capture/CameraGeometry.swift`, `Capture/CaptureTrajectory.swift` | Yes |
| Sampling and gates | `Capture/ContinuousScanSampler.swift`, `Capture/CaptureTrackingSettleGate.swift`, `Capture/CaptureFrameQualityGate.swift`, `Capture/CaptureQualityMonitor.swift` | Yes |
| Session | `Capture/ARCaptureCoordinator.swift`, `Capture/CaptureVideoFormat.swift`, `Capture/CaptureDevice.swift` | Yes |
| Camera preview | `Capture/CaptureCameraView.swift` | Optional, or use your own `ARSCNView` host |
| Coaching | `Capture/CaptureGuidanceArbiter.swift`, `Capture/CaptureAimTracker.swift`, `Screens/CaptureFlow/CaptureScanGuide.swift` | Recommended |
| Storage | `Storage/CapturePaths.swift`, `Storage/CaptureManifest.swift`, `Storage/CaptureBundleWriter.swift`, `Storage/CaptureThumbnailRenderer.swift`, `Storage/CaptureLibrary.swift` | Yes |
| Checks | `Storage/CaptureBundleValidator.swift` | Recommended. `finalize` calls it, so remove that call if you drop it |
| Guidance seams | `Capture/CaptureLiveGuide.swift`, `Screens/CaptureFlow/CaptureGuidanceExperience.swift`, `App/CaptureGuidanceSetup.swift` | Needed for Full. Optional for Core |
| Full guidance | `FullGuidance/**` | Full only. See [guidance-setups.md](guidance-setups.md#porting-full) |
| Tests | `Tests/*`, plus `FullGuidanceTests/*` for Full | Port the geometry, sampler, settle gate and writer tests at minimum |

Your app also needs:

- `NSCameraUsageDescription`.
- A privacy manifest that declares disk space (`85F4.1`) and system boot time (`35F9.1`). `ios/PrivacyInfo.xcprivacy` already has both. The boot-time entry is for `systemUptime`, which frame pacing uses. Its value is never written to disk.
- The ARKit framework, iOS 18 or later, and Swift 6.

`CaptureFlowModel` shows how to drive the coordinator: readiness, `startPreview`, `beginCapture`, `pauseSampling`/`resumeSampling` on lifecycle changes, `finish`, and saving to the background on `scenePhase == .background`. Keep that lifecycle policy even if you replace the UI. It is what makes interrupted scans recoverable.

## Option C: rewrite on another stack

If you build the capture app with a different framework, or on Android, keep these rules. Each one exists because getting it wrong produces a bundle that validates and then reconstructs badly.

1. **Native pixels.** Store the sensor image at the native capture resolution, unrotated, with EXIF `Orientation` absent or 1. Pick a camera format that gives 1920×1440 (iOS) or 1920×1080 (Android) directly, instead of resizing.
2. **EXIF capture time.** Every JPEG carries `DateTimeOriginal`, `SubSecTimeOriginal` and `OffsetTimeOriginal` in its first 64 KiB, strictly increasing. On iOS, `ARFrame.exifData` has them. On another stack, write them yourself from the frame's capture time. These capture times are important, so keep them intact.
3. **One pose convention.** Store OpenCV `camera_from_world`, row-major, in metres, in a gravity-aligned world with +Y up. Find out what your framework's pose actually is (world-from-camera or camera-from-world, and which camera axes) and write a reprojection test before trusting it. See [coordinate-conventions.md](coordinate-conventions.md).
4. **One world frame.** Never mix poses from before and after a tracking reset or a map re-anchor. When the world shifts, pause and settle again, or end the scan.
5. **Tracking-gated frames.** Commit frames only while tracking is fully normal, after a 0.5 s settle with no frame gap over 0.5 s.
6. **Keyframes, not video.** Sample on movement (7 cm or 10°), with a slow heartbeat. A few frames per second of walking is right. 60 fps is not.
7. **One hold.** Keep one physical orientation for the whole scan. Stop saving frames when the user rotates the phone.
8. **Index parity.** Image `i+1` pairs with trajectory entry `i` and per-frame intrinsics entry `i`. Assign the index only after the image is safely on disk.
9. **Intrinsics at the stored resolution.** If the encoded size differs from the camera's, scale X and Y separately.
10. **Crash safety.** Write images and per-frame records atomically as you go, and build the camera JSON at the end from those records. A crash then loses at most one frame.

Speculative, so verify with a reprojection test:

- **ARCore** `Camera.getPose()` is world-from-camera with OpenGL-style camera axes (+Y up, −Z forward), like ARKit, so the same `diag(1,-1,-1,1) · inverse(pose)` conversion should apply. Use the sensor pose, not `getDisplayOrientedPose()`.
- **Unity AR Foundation** reports poses in Unity's left-handed frame. Convert to a right-handed frame before applying the formula above.

## Sending bundles

The prototype has no network code. Zip the bundle with `CaptureBundleExporter.makeZip(for:)` (or any zipper using stored or deflate compression and no encryption), send it from your backend as a `capture_bundle` ZIP following the [capture guide](https://docs.spaitial.ai/api/capture-worlds#capture-zip), and never ship an API key in the app.

## Things you can safely change

- All UI copy, layout and colors.
- The frame cap, as long as it stays at or below 5,000.
- Guidance thresholds and wording, in `CaptureGuidanceArbiter.Policy`.

## Things you should not change

- Image resolution, orientation, encoding format, or the EXIF passthrough.
- The pose conversion and the matrix serialization order.
- File names, paths and JSON field names.
- The tracking, settle, blur and hold gating, and the sampler thresholds. They are part of the Echo-3 contract.
