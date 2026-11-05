# validate-bundle

Checks an Echo-3 capture bundle against the capture contract before you send it. Pass it the exact ZIP you will send, or a bundle folder. It checks the ZIP structure, the layout, the EXIF capture times and the camera files, and lists every problem at once.

The contract it checks is summarized in [docs/bundle-format.md](../../docs/bundle-format.md). The authoritative version is the private beta reference at [developers.spaitial.ai/docs/beta](https://developers.spaitial.ai/docs/beta).

## Run it

```sh
cd tools/validate-bundle
npm install
npx tsx src/cli.ts ../../samples/minimal-bundle
npx tsx src/cli.ts ~/Downloads/scan.zip            # the zip exported from the app
npx tsx src/cli.ts ~/Downloads/scan.zip --json     # machine-readable report
npm test
```

```
OK: 3 frames, 0 errors, 0 warnings, orientation arkit_landscape_sensor (trajectory_vote)
```

A folder is read the same way as a ZIP. One wrapper folder (such as the `bundle/` folder in the app's export) is tolerated. Exit codes: `0` means no errors, `1` means at least one error, `2` means bad usage.

## What it checks

Errors use the issue codes from the beta reference:

| Check | Code(s) |
| --- | --- |
| The file is a readable ZIP, stored or deflate, not encrypted | `ZIP_INVALID`, `ZIP_UNSUPPORTED_COMPRESSION`, `ZIP_ENCRYPTED`, `ZIP_ENTRY_CORRUPT` |
| Size limits: 64 MiB per entry, 8 GiB total, entry count, 100:1 compression ratio | `ZIP_ENTRY_TOO_LARGE`, `ZIP_TOO_LARGE`, `ZIP_TOO_MANY_ENTRIES`, `ZIP_COMPRESSION_RATIO` |
| Safe paths: no absolute paths, `..`, symlinks or duplicates | `ZIP_UNSAFE_PATH`, `ZIP_SYMLINK`, `ZIP_DUPLICATE_ENTRY` |
| 1 to 5,000 images, named `Image_%06d.jpg`, one-based and contiguous | `IMAGES_MISSING`, `TOO_MANY_FRAMES`, `IMAGE_*` |
| `DateTimeOriginal`, `SubSecTimeOriginal` and `OffsetTimeOriginal` in each JPEG's first 64 KiB, strictly increasing; `Orientation` absent or 1 | `EXIF_*` |
| `camera_trajectory.json`: N 4×4 matrices, finite, orthonormal rotation, determinant +1, last row `[0,0,0,1]` | `TRAJECTORY_*`, `MATRIX_*`, `ROTATION_*` |
| `per_frame_intrinsics.json`: N entries per array, 1920×1440 or 1920×1080, focal length and principal point in range | `PER_FRAME_INTRINSICS_*`, `INTRINSICS_*` |
| Camera files parse as JSON | `CAMERA_FILE_INVALID_JSON` |
| Optional `orientation.json` and `camera_intrinsics.json`, when present | `ORIENTATION_*`, `INTRINSICS_*` |
| Each JPEG's pixel size equals the intrinsics resolution | `IMAGE_SIZE_MISMATCH` |

Warnings don't fail the bundle:

| Check | Code |
| --- | --- |
| Files outside the layout, which are ignored. Dotfiles and `__MACOSX/` aren't listed | `IGNORED_PATHS` |
| An `orientation.json` that disagrees with the hold implied by the trajectory, usually a missing axis flip | `ORIENTATION_VOTE_MISMATCH` |

## What it cannot check

- Whether the trajectory is right. A well-formed trajectory can still use the wrong conversion, or mix poses from two ARKit worlds (a `resetTracking` mid-scan). The round-trip and reprojection tests in `ios/Tests/CameraGeometryTests.swift` guard the conversion. Port them along with the code.

## Files

| File | Role |
| --- | --- |
| `src/zip.ts` | ZIP reader (central directory, zip64, stored/deflate) and the contract's ZIP entry rules |
| `src/files.ts` | Opens a folder or a ZIP as one entry source, and reads JPEG headers |
| `src/partner-bundle.ts` | The bundle contract: required files, frame count, orientation source |
| `src/exif.ts` | EXIF capture-time parsing and checks |
| `src/validation.ts` | Pure checks for trajectory, intrinsics, orientation and image names |
| `src/orientation.ts` | The hold-orientation vote, the same rule as `CameraGeometry.voteHoldOrientation` |
| `src/bundle.ts` | Combines the above into one report |
| `src/cli.ts` | Command-line entry point |

`ios/Storage/CaptureBundleValidator.swift` runs the same bundle checks on the device, without the ZIP rules. If you change a rule in one, change it in the other.
