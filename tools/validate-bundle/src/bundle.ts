/**
 * Whole-bundle validation for a capture directory or ZIP.
 *
 * `errors` break the capture contract, including `IMAGE_SIZE_MISMATCH` for
 * rasters that disagree with the intrinsics. `warnings` never fail the bundle:
 * files outside the layout, and an `orientation.json` that disagrees with the
 * trajectory.
 */
import { CAPTURE_EXIF_HEAD_BYTES, readCaptureExif } from "./exif.js";
import type { CaptureFrameExif } from "./exif.js";
import { openBundleSource, readJpegSize, type BundleSource } from "./files.js";
import {
  CAPTURE_INTRINSICS_PATH,
  CAPTURE_ORIENTATION_PATH,
  CAPTURE_PER_FRAME_INTRINSICS_PATH,
  CAPTURE_TRAJECTORY_PATH,
  validatePartnerCaptureBundle,
  type PartnerCaptureBundleResult,
} from "./partner-bundle.js";
import type { ValidationError } from "./validation.js";
import {
  CAPTURE_PATH_PATTERNS,
  planCaptureZipEntries,
  type CaptureZipEntry,
  type CaptureZipSkip,
} from "./zip.js";

const JPEG_HEAD_BYTES = 256 * 1024;
const MAX_LISTED = 10;

export interface BundleReport {
  frameCount: number;
  /** Bundle-relative paths in the capture layout. */
  files: string[];
  /** Single top-level folder stripped from every path, if any. */
  wrapperFolder: string | null;
  errors: ValidationError[];
  warnings: ValidationError[];
  orientation: string | null;
  orientationSource: PartnerCaptureBundleResult["orientationSource"];
}

/** Validate a bundle directory or a `.zip` at `inputPath`. */
export function validateBundle(inputPath: string): BundleReport {
  const source = openBundleSource(inputPath);
  try {
    return validateBundleSource(source);
  } finally {
    source.close();
  }
}

export function validateBundleSource(source: BundleSource): BundleReport {
  const plan = planCaptureZipEntries(source.entries);
  const errors: ValidationError[] = [...source.errors, ...plan.errors];
  const byPath = new Map(plan.extract.map((e) => [e.bundlePath, e.entry]));
  const readCamera = (bundlePath: string) =>
    readCameraJson(source, byPath.get(bundlePath), bundlePath, errors);

  const imagePaths = [...byPath.keys()]
    .filter((p) => CAPTURE_PATH_PATTERNS.IMAGE.test(p))
    .sort();
  const perFrameIntrinsics = readCamera(CAPTURE_PER_FRAME_INTRINSICS_PATH);
  const images = readImageHeads(source, byPath, imagePaths);

  const result = validatePartnerCaptureBundle({
    imagePaths,
    trajectory: readCamera(CAPTURE_TRAJECTORY_PATH),
    perFrameIntrinsics,
    sharedIntrinsics: readCamera(CAPTURE_INTRINSICS_PATH),
    orientation: readCamera(CAPTURE_ORIENTATION_PATH),
    frameExif: images.exif,
  });
  errors.push(...result.errors);
  errors.push(...checkImageSizes(images.sizes, perFrameIntrinsics));

  return {
    frameCount: result.frameCount,
    files: [...byPath.keys()].sort(),
    wrapperFolder: plan.wrapperFolder,
    errors,
    warnings: [
      ...ignoredPathWarnings(plan.skipped),
      ...poseWarnings(result),
      ...orientationWarnings(result),
    ],
    orientation: result.orientation,
    orientationSource: result.orientationSource,
  };
}

function readCameraJson(
  source: BundleSource,
  entry: CaptureZipEntry | undefined,
  bundlePath: string,
  errors: ValidationError[],
): unknown {
  if (!entry) return undefined;
  const bytes = source.read(entry);
  if (!bytes) {
    errors.push({ code: "ZIP_ENTRY_CORRUPT", message: `${bundlePath} cannot be read` });
    return undefined;
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    errors.push({
      code: "CAMERA_FILE_INVALID_JSON",
      message: `${bundlePath} is not valid JSON: ${(error as Error).message}`,
    });
    return undefined;
  }
}

interface ImageHeads {
  exif: CaptureFrameExif[];
  sizes: { path: string; size: { width: number; height: number } | null }[];
}

function readImageHeads(
  source: BundleSource,
  byPath: Map<string, CaptureZipEntry>,
  imagePaths: string[],
): ImageHeads {
  const heads: ImageHeads = { exif: [], sizes: [] };
  for (const imagePath of imagePaths) {
    const head = source.read(byPath.get(imagePath)!, JPEG_HEAD_BYTES);
    heads.exif.push({
      path: imagePath,
      exif: head ? readCaptureExif(head.subarray(0, CAPTURE_EXIF_HEAD_BYTES)) : null,
    });
    heads.sizes.push({ path: imagePath, size: head ? readJpegSize(head) : null });
  }
  return heads;
}

function checkImageSizes(
  sizes: ImageHeads["sizes"],
  perFrameIntrinsics: unknown,
): ValidationError[] {
  const expected = perFrameIntrinsics as { width_px?: unknown; height_px?: unknown } | undefined;
  if (typeof expected?.width_px !== "number" || typeof expected.height_px !== "number") {
    return [];
  }
  const mismatched = sizes
    .filter(
      ({ size }) =>
        size?.width !== expected.width_px || size?.height !== expected.height_px,
    )
    .map(({ path, size }) => `${path} (${size ? `${size.width}x${size.height}` : "not a JPEG"})`);
  if (mismatched.length === 0) return [];
  return [
    {
      code: "IMAGE_SIZE_MISMATCH",
      message:
        `${mismatched.length} image(s) are not ${expected.width_px}x${expected.height_px} JPEGs ` +
        `(the intrinsics resolution). Never rotate or resize frames: ${summarize(mismatched)}`,
    },
  ];
}

function ignoredPathWarnings(skipped: CaptureZipSkip[]): ValidationError[] {
  const outside = skipped
    .filter((skip) => skip.reason === "not_in_bundle_layout")
    .map((skip) => skip.name);
  if (outside.length === 0) return [];
  return [
    {
      code: "IGNORED_PATHS",
      message: `${outside.length} path(s) outside the layout will be ignored: ${summarize(outside)}`,
      details: { paths: outside },
    },
  ];
}

function poseWarnings(result: PartnerCaptureBundleResult): ValidationError[] {
  if (result.posed) return [];
  return [
    {
      code: "POSES_MISSING",
      message:
        "cameras/camera_trajectory.json is missing, so Echo-3 will estimate the cameras. " +
        "Include poses for the most reliable reconstruction.",
    },
  ];
}

function orientationWarnings(result: PartnerCaptureBundleResult): ValidationError[] {
  const vote = result.orientationVote?.orientation;
  if (result.orientationSource !== "orientation_file" || !vote) return [];
  if (vote === result.orientation) return [];
  return [
    {
      code: "ORIENTATION_VOTE_MISMATCH",
      message:
        `cameras/orientation.json says ${result.orientation} but the trajectory votes ${vote}. ` +
        "Check the ARKit-to-OpenCV flip, or remove orientation.json.",
    },
  ];
}

function summarize(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown}, and ${items.length - MAX_LISTED} more` : shown;
}
