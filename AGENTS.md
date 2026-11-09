# AGENTS.md

Guidance for coding agents working in this repo, or using it as a reference for another capture app.

## What this repo is

A reference iOS capture app. It writes an Echo-3 capture bundle (posed JPEG keyframes with EXIF capture time, plus a trajectory and per-frame intrinsics) to local storage. The bundle holds only what Echo-3 requires; don't add files to it. It has no network code, no auth and no analytics on purpose. Keep it that way.

The Echo-3 capture reference is the public [capture guide](https://docs.spaitial.ai/api/capture-worlds). `docs/bundle-format.md` summarizes the capture contract, and where they differ the capture guide wins. Bundles are submitted as a `capture_bundle` ZIP on `POST /v1/worlds`.

Start with [docs/architecture.md](docs/architecture.md) for the code map and [docs/bundle-format.md](docs/bundle-format.md) for the contract.

## Ask which guidance setup first

The app has two guidance setups, and they write the same bundle. Before you port, copy or restructure anything, ask the user which one they want, unless they already said:

> Which capture guidance do you want?
>
> 1. **Core.** Text coaching and a walls/ceiling/floor pass guide. Works on any ARKit iPhone. Smallest code.
> 2. **Full.** Core plus a LiDAR coverage mesh painted over scanned surfaces, coaching that points at missed areas, a live 3D point-cloud preview, a first-scan walkthrough, and a 3D finish review that sends the user back to fill gaps. About 7,500 more lines. Phones without LiDAR fall back to most of Core.

Then follow the matching section of [docs/guidance-setups.md](docs/guidance-setups.md):

- **Core:** delete `ios/FullGuidance/` and `ios/FullGuidanceTests/`, return `nil` from `CaptureGuidanceSetup.makeExperience()` without the `#if`, delete the `CapturePrototypeFull` and `CapturePrototypeFullTests` targets and the `CapturePrototypeFull` scheme from `ios/project.yml`, and regenerate.
- **Full:** keep `FullGuidance/`. Either keep both targets as they are, or fold `FullGuidance/` into the single target and return `CoverageGuidanceExperience()` without the `#if`.

Whichever they pick, the depth and mesh Full reads are live-only. Never write them into the bundle.

## Invariants

Breaking any of these produces bundles that either fail validation or, worse, pass and reconstruct badly.

- **Poses are OpenCV `camera_from_world`.** Each matrix is `diag(1,-1,-1,1) · inverse(arkit_world_from_camera)`, serialized row-major as 16 numbers. simd matrices are column-major, so always go through the `simd_float4x4.rowMajorArray` and `fromRowMajor(_:)` helpers in `Storage/CaptureManifest.swift`. See [docs/coordinate-conventions.md](docs/coordinate-conventions.md).
- **One ARKit world per scan.** `.resetTracking` runs only when the preview starts (or at scan start with no warm preview). Never reset or relocalize mid-scan.
- **Pixels are never rotated.** Images stay in the sensor's native landscape orientation, with no EXIF `Orientation` tag. The intrinsics describe the stored, unrotated image.
- **EXIF capture time passes through.** Every JPEG embeds `ARFrame.exifData`, which carries `DateTimeOriginal`, `SubSecTimeOriginal` and `OffsetTimeOriginal`. These capture times are important: keep them intact and strictly increasing. Don't strip or rewrite EXIF.
- **Exactly 1920×1440 on the wide-angle camera.** The video format is selected by `CaptureVideoFormatSelector.selectExact1920x1440`. Don't fall back to another size or lens, and don't resize.
- **Contiguous, one-based names.** `images/Image_000001.jpg` up to `Image_<frame_count>.jpg`, with no gaps.
- **Index parity.** Image `i+1`, trajectory entry `i` and per-frame intrinsics entry `i` describe the same frame. The writer assigns an index only after the JPEG is on disk.
- **One hold per scan.** Frames clearly in the other hold are not sampled (`CameraGeometry.isClearHoldMismatch`).
- **Contract capture settings.** Gravity alignment, autofocus on, exposure left to ARKit, the 0.5 s settle gate, the 7 cm / 10° sampler and the 64 px blur gate all come from the capture guide. Don't tune them.
- **At most 5,000 frames.**

## Keep these in sync

- `ios/Storage/CaptureBundleValidator.swift` and `tools/validate-bundle/src/` implement the same checks (the TypeScript side adds the ZIP rules). Change both together, and update [docs/bundle-format.md](docs/bundle-format.md).
- `CapturePaths` owns every file name. Don't hand-build bundle paths elsewhere.
- The samples are generated. After a format change, edit `samples/make_minimal_bundle.py` and regenerate.

## Project mechanics

- The Xcode project is generated from `ios/project.yml` by XcodeGen and isn't committed. After adding, removing or renaming a Swift file, run `cd ios && xcodegen generate`.
- Swift 6 strict concurrency. ARKit callbacks arrive off the main actor and go through `LatestValueInbox`, and file I/O runs on the `capture.writer` queue. Don't move disk writes onto the main actor.
- `Capture/` and `Storage/` must not depend on `App/` or `Screens/`. That is what makes the core copyable.
- Core never references `FullGuidance/`. Full plugs in only through `CaptureGuidanceExperience`, `CaptureLiveGuide` and `CaptureGuidanceAdvisory`, and `CaptureGuidanceSetup.swift` holds the only `#if FULL_GUIDANCE`. Keep it that way, so deleting `FullGuidance/` always leaves a building app.
- Full can observe frames but must not change which frames are kept. The gates, sampler and writer stay in `ARCaptureCoordinator`.

## Verify

```bash
# Build and unit-test both setups (pick any available simulator)
cd ios && xcodegen generate
for scheme in CapturePrototype CapturePrototypeFull; do
  xcodebuild test -scheme "$scheme" \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    CODE_SIGNING_ALLOWED=NO
done

# Validator
cd tools/validate-bundle && npm install && npm test && npx tsc --noEmit
npx tsx src/cli.ts ../../samples/minimal-bundle
```

Real capture needs a physical device, and Full's mesh and coverage need a LiDAR one. Before you call a capture change done, scan a room on a device, export the zip, and run the validator on the zip itself.

## Don't add

- API keys, tokens or backend URLs. A key in a shipped app is a leaked key.
- Analytics or crash-reporting SDKs.
- Third-party dependencies in the app target. It uses only Apple frameworks.
