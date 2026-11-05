# Samples

`minimal-bundle/` is a 3-frame synthetic Echo-3 capture bundle with exactly the files the app writes:

- `images/Image_00000{1,2,3}.jpg`, 1920×1440, each with the EXIF capture time (`DateTimeOriginal`, `SubSecTimeOriginal`, `OffsetTimeOriginal`)
- `cameras/camera_trajectory.json`
- `cameras/per_frame_intrinsics.json`

Use it to check a parser or your export path, and to see real file shapes next to [docs/bundle-format.md](../docs/bundle-format.md).

The images are flat placeholders, so the bundle can't be reconstructed. The poses describe a phone held in portrait that walks 10 cm per frame, converted with the same ARKit-to-OpenCV formula as the app, so the hold vote is `arkit_landscape_sensor`. The EXIF times span 0.85 s.

Validate it, as a folder or zipped:

```bash
cd tools/validate-bundle
npm install
npx tsx src/cli.ts ../../samples/minimal-bundle
(cd ../../samples && zip -qr /tmp/minimal-bundle.zip minimal-bundle)
npx tsx src/cli.ts /tmp/minimal-bundle.zip
```

Regenerate it after a format change (needs Pillow):

```bash
python3 samples/make_minimal_bundle.py
```

For a real bundle, scan on a device and export the zip from the scan's detail screen.
