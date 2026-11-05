"""Regenerate samples/minimal-bundle: a 3-frame synthetic Echo-3 capture bundle.

The bundle holds exactly what the capture contract requires: images with the
EXIF capture-time tags, the camera trajectory and per-frame intrinsics.

The images are flat placeholders, so this bundle is for format checks only. It
cannot be reconstructed. The poses follow a phone held in portrait (USB-C down)
that looks along world -Z and walks 10 cm per frame along world +X. They are
converted with the same formula the app uses:

    opencv_camera_from_world = diag(1, -1, -1, 1) @ inverse(arkit_world_from_camera)

Usage (needs Pillow):

    python3 samples/make_minimal_bundle.py
"""

import json
import pathlib
import shutil

from PIL import Image, ImageDraw

BUNDLE_DIR = pathlib.Path(__file__).parent / "minimal-bundle"
FRAME_COUNT = 3
WIDTH_PX, HEIGHT_PX = 1920, 1440

# EXIF capture times, as ARKit writes them: local wall time, a sub-second
# fraction and the UTC offset. Frames are 0.42 s and 0.43 s apart.
EXIF_DATE_TIME_ORIGINAL = "2026:01:01 12:00:00"
EXIF_SUB_SEC_TIME_ORIGINAL = ["520", "940", "370"]
EXIF_DATE_TIMES = [EXIF_DATE_TIME_ORIGINAL] * 2 + ["2026:01:01 12:00:01"]
EXIF_OFFSET_TIME_ORIGINAL = "+00:00"

TAG_EXIF_IFD = 0x8769
TAG_DATE_TIME_ORIGINAL = 0x9003
TAG_OFFSET_TIME_ORIGINAL = 0x9011
TAG_SUB_SEC_TIME_ORIGINAL = 0x9291

# ARKit camera axes in world coordinates for a portrait hold: the sensor's long
# edge (camera +X) points at the floor, camera +Y points to world +X, and the
# camera looks along world -Z (ARKit camera +Z points backwards, to world +Z).
ARKIT_CAMERA_X_IN_WORLD = (0.0, -1.0, 0.0)
ARKIT_CAMERA_Y_IN_WORLD = (1.0, 0.0, 0.0)
ARKIT_CAMERA_Z_IN_WORLD = (0.0, 0.0, 1.0)


def opencv_camera_from_world(camera_position_world):
    """Row-major 4x4 OpenCV camera_from_world for the fixed portrait rotation."""
    arkit_axes = (
        ARKIT_CAMERA_X_IN_WORLD,
        ARKIT_CAMERA_Y_IN_WORLD,
        ARKIT_CAMERA_Z_IN_WORLD,
    )
    # inverse(world_from_camera): rotation rows are the camera axes, and
    # translation is -R^T @ camera position.
    rows = []
    for axis_sign, axis in zip((1.0, -1.0, -1.0), arkit_axes):
        translation = -sum(a * c for a, c in zip(axis, camera_position_world))
        rows.append(
            [axis_sign * a + 0.0 for a in axis] + [axis_sign * translation + 0.0]
        )
    rows.append([0.0, 0.0, 0.0, 1.0])
    return rows


def write_json(relative_path, payload):
    path = BUNDLE_DIR / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def capture_exif(index):
    exif = Image.Exif()
    exif_ifd = exif.get_ifd(TAG_EXIF_IFD)
    exif_ifd[TAG_DATE_TIME_ORIGINAL] = EXIF_DATE_TIMES[index]
    exif_ifd[TAG_SUB_SEC_TIME_ORIGINAL] = EXIF_SUB_SEC_TIME_ORIGINAL[index]
    exif_ifd[TAG_OFFSET_TIME_ORIGINAL] = EXIF_OFFSET_TIME_ORIGINAL
    return exif


def write_images():
    (BUNDLE_DIR / "images").mkdir(parents=True, exist_ok=True)
    for index in range(FRAME_COUNT):
        image = Image.new("RGB", (WIDTH_PX, HEIGHT_PX), (52, 56, 64))
        draw = ImageDraw.Draw(image)
        draw.rectangle(
            (40, 40, WIDTH_PX - 40, HEIGHT_PX - 40), outline=(200, 200, 200), width=8
        )
        draw.text(
            (80, 80),
            f"synthetic frame {index + 1} (native landscape sensor)",
            fill=(230, 230, 230),
        )
        image.save(
            BUNDLE_DIR / "images" / f"Image_{index + 1:06d}.jpg",
            quality=60,
            exif=capture_exif(index),
        )


def write_cameras():
    positions = [(0.1 * i, 1.4, 0.0) for i in range(FRAME_COUNT)]
    write_json(
        "cameras/camera_trajectory.json",
        [opencv_camera_from_world(p) for p in positions],
    )
    write_json(
        "cameras/per_frame_intrinsics.json",
        {
            "frame_count": FRAME_COUNT,
            "width_px": WIDTH_PX,
            "height_px": HEIGHT_PX,
            "fx_px": [1350.1, 1350.2, 1350.4],
            "fy_px": [1350.1, 1350.2, 1350.4],
            "cx_px": [961.4, 961.4, 961.5],
            "cy_px": [719.8, 719.8, 719.9],
        },
    )


if __name__ == "__main__":
    shutil.rmtree(BUNDLE_DIR, ignore_errors=True)
    write_images()
    write_cameras()
    print(f"Wrote {FRAME_COUNT}-frame bundle to {BUNDLE_DIR}")
