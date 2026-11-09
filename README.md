# Capture Prototype

A minimal iOS app that scans a space with ARKit and saves an Echo-3 capture bundle on the device: posed JPEG keyframes with their EXIF capture time, one camera pose per frame and one calibration per frame. The exported zip is the input Echo-3 turns into a 3D world.

The Echo-3 capture API is available to every SpAItial developer account. Its reference is the [capture guide](https://docs.spaitial.ai/api/capture-worlds).

Use it as a reference when you build your own capture app. It has no accounts, no network calls and no analytics. Scans stay on the device until you export them.

The app never submits anything. The exported zip is the `capture_bundle` input, and submission belongs in your backend. See the [capture guide](https://docs.spaitial.ai/api/capture-worlds#capture-zip).

## What it does

- Scans continuously. Frames are kept on movement (7 cm or 10°), and only while ARKit tracking is normal and has settled.
- Skips frames that would be blurry, using predicted motion blur from the camera pose and exposure.
- Shows one coaching message at a time: move slower, more light, aim at walls/ceiling/floor, and so on.
- Survives interruptions. Locking the phone or getting a call pauses the scan, and backgrounding saves what was captured.
- Keeps one hold for the whole scan. Frames taken after the phone is rotated to the other orientation aren't saved.
- Validates each saved scan against the Echo-3 capture contract, and exports it as a zip through the share sheet or the Files app.

## Two guidance setups

| Scheme | Guidance |
| --- | --- |
| `CapturePrototype` (Core) | Text coaching and a walls/ceiling/floor pass guide, on any ARKit iPhone |
| `CapturePrototypeFull` (Full) | Core plus a LiDAR coverage mesh over scanned surfaces, coaching toward missed areas, a live 3D point-cloud preview, a first-scan walkthrough, and a 3D finish review with gap repair |

Both write the same bundle. Full uses LiDAR depth and mesh live and never saves them. Porting this into your own app? Pick one setup and follow [docs/guidance-setups.md](docs/guidance-setups.md). A coding agent reading [AGENTS.md](AGENTS.md) will ask you which one you want.

## Quickstart

Requirements: macOS with Xcode 26, [XcodeGen](https://github.com/yonaskolb/XcodeGen), and an iPhone or iPad running iOS 18 or later whose wide-angle camera has an ARKit 1920×1440 video format. The simulator can run the unit tests, but it can't scan.

```bash
brew install xcodegen
cd ios
xcodegen generate
open CapturePrototype.xcodeproj
```

In Xcode, pick the `CapturePrototype` or `CapturePrototypeFull` scheme and your team under Signing & Capabilities (or set `DEVELOPMENT_TEAM` in `ios/project.yml`), then run on a device. Full's mesh and coverage need a LiDAR iPhone or iPad.

To get a scan off the phone, open it in the app and tap Export bundle as zip, or use the Files app under On My iPhone > Capture Prototype (Capture Full for the Full build).

## Check a bundle

```bash
cd tools/validate-bundle
npm install
npx tsx src/cli.ts ~/Downloads/scan.zip
```

The validator checks a folder or zip against the capture contract (ZIP rules, layout, EXIF capture time, cameras) and lists every problem it finds. See [tools/validate-bundle/README.md](tools/validate-bundle/README.md).

## Tests

```bash
cd ios
for scheme in CapturePrototype CapturePrototypeFull; do
  xcodebuild test -scheme "$scheme" \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    CODE_SIGNING_ALLOWED=NO
done

cd ../tools/validate-bundle
npm test
```

## Documentation

| Doc | Read it when |
| --- | --- |
| [docs/bundle-format.md](docs/bundle-format.md) | You need the exact files, JSON schemas and invariants |
| [docs/coordinate-conventions.md](docs/coordinate-conventions.md) | You touch poses or intrinsics |
| [docs/capture-pipeline.md](docs/capture-pipeline.md) | You want to know which frames are kept and why |
| [docs/architecture.md](docs/architecture.md) | You're finding your way around the code |
| [docs/guidance-setups.md](docs/guidance-setups.md) | You're choosing between Core and Full guidance, or porting one of them |
| [docs/capture-guide.md](docs/capture-guide.md) | You're writing instructions for the people who scan |
| [docs/porting-guide.md](docs/porting-guide.md) | You're moving this into your own app, or rewriting it on another stack |
| [Echo-3 capture guide](https://docs.spaitial.ai/api/capture-worlds) | You're ready to send bundles to Echo-3 from your backend |
| [AGENTS.md](AGENTS.md) | You're a coding agent working in this repo |

A tiny synthetic bundle is in [samples/minimal-bundle](samples/minimal-bundle). It passes validation, but it can't be reconstructed.

## Layout

```
ios/
  App/        app entry, theme, shared components
  Capture/    ARKit session, sampling, gates, guidance, geometry
  Storage/    bundle writer, paths, manifest, validator, exporter, library
  Screens/    SwiftUI screens (scans list, capture flow, detail)
  FullGuidance/       Full setup only: coverage mesh, gaps, walkthrough, review
  Tests/              unit tests
  FullGuidanceTests/  Full setup unit tests
tools/validate-bundle/   TypeScript bundle validator and CLI
samples/                 synthetic sample bundle and its generator
docs/                    format, conventions, pipeline and guides
```

## Links

- [Echo-3 capture guide](https://docs.spaitial.ai/api/capture-worlds)
- [API docs](https://docs.spaitial.ai)

## License

[MIT-0](LICENSE)
