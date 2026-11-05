/**
 * Validation of an Echo-3 capture bundle.
 *
 * A bundle ships images, `cameras/camera_trajectory.json`, and
 * `cameras/per_frame_intrinsics.json`. `cameras/camera_intrinsics.json` and
 * `cameras/orientation.json` are optional; without the latter the hold
 * orientation is inferred from the trajectory.
 */

import { validateCaptureExif, type CaptureFrameExif } from "./exif.js";
import {
  voteHoldOrientation,
  type CaptureCameraOrientation,
  type HoldOrientationVote,
} from "./orientation.js";
import {
  validateImageFilenames,
  validateIntrinsics,
  validateOrientation,
  validatePerFrameIntrinsics,
  validateTrajectory,
  type ValidationError,
} from "./validation.js";

export const CAPTURE_LIMITS = { MIN_FRAMES: 1, MAX_FRAMES: 5000 } as const;

export const CAPTURE_TRAJECTORY_PATH = "cameras/camera_trajectory.json";
export const CAPTURE_INTRINSICS_PATH = "cameras/camera_intrinsics.json";
export const CAPTURE_PER_FRAME_INTRINSICS_PATH =
  "cameras/per_frame_intrinsics.json";
export const CAPTURE_ORIENTATION_PATH = "cameras/orientation.json";

export interface PartnerCaptureBundleInput {
  /** Bundle-relative image paths, any order. */
  imagePaths: string[];
  /** Parsed JSON of each camera file; `undefined` when absent from the ZIP. */
  trajectory?: unknown;
  perFrameIntrinsics?: unknown;
  sharedIntrinsics?: unknown;
  orientation?: unknown;
  /** EXIF per image, in frame order. */
  frameExif: CaptureFrameExif[];
}

export interface PartnerCaptureBundleResult {
  valid: boolean;
  errors: ValidationError[];
  frameCount: number;
  orientation: CaptureCameraOrientation | null;
  /** `orientation.json` when the bundle has one, else the trajectory vote. */
  orientationSource: "orientation_file" | "trajectory_vote" | null;
  orientationVote: HoldOrientationVote | null;
}

export function validatePartnerCaptureBundle(
  input: PartnerCaptureBundleInput,
): PartnerCaptureBundleResult {
  const frameCount = input.imagePaths.length;
  const errors: ValidationError[] = [
    ...validateFrameCount(frameCount),
    ...validateImageFilenames(input.imagePaths, frameCount),
    ...validateCameraFiles(input, frameCount),
  ];
  const trajectoryValid =
    input.trajectory !== undefined &&
    validateTrajectory(input.trajectory, frameCount).length === 0;
  const orientation = resolveOrientation(input, trajectoryValid);
  errors.push(...validateCaptureExif(input.frameExif));

  return {
    valid: errors.length === 0,
    errors,
    frameCount,
    ...orientation,
  };
}

function validateFrameCount(frameCount: number): ValidationError[] {
  if (frameCount < CAPTURE_LIMITS.MIN_FRAMES) {
    return [{ code: "IMAGES_MISSING", message: "Bundle has no images" }];
  }
  if (frameCount > CAPTURE_LIMITS.MAX_FRAMES) {
    return [
      {
        code: "TOO_MANY_FRAMES",
        message: `Bundle has ${frameCount} images; the limit is ${CAPTURE_LIMITS.MAX_FRAMES}`,
      },
    ];
  }
  return [];
}

function validateCameraFiles(
  input: PartnerCaptureBundleInput,
  frameCount: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.trajectory === undefined) {
    errors.push(missingFile("TRAJECTORY_MISSING", CAPTURE_TRAJECTORY_PATH));
  } else {
    errors.push(...validateTrajectory(input.trajectory, frameCount));
  }

  if (input.perFrameIntrinsics === undefined) {
    errors.push(
      missingFile(
        "PER_FRAME_INTRINSICS_MISSING",
        CAPTURE_PER_FRAME_INTRINSICS_PATH,
      ),
    );
  } else {
    errors.push(
      ...validatePerFrameIntrinsics(
        input.perFrameIntrinsics,
        frameCount,
        frameCount,
        input.sharedIntrinsics,
      ),
    );
  }

  if (input.sharedIntrinsics !== undefined) {
    errors.push(...validateIntrinsics(input.sharedIntrinsics));
  }
  if (input.orientation !== undefined) {
    errors.push(...validateOrientation(input.orientation));
  }
  return errors;
}

function resolveOrientation(
  input: PartnerCaptureBundleInput,
  trajectoryValid: boolean,
): Pick<
  PartnerCaptureBundleResult,
  "orientation" | "orientationSource" | "orientationVote"
> {
  const vote = trajectoryValid
    ? voteHoldOrientation(input.trajectory as unknown[])
    : null;

  if (input.orientation !== undefined) {
    const isValid = validateOrientation(input.orientation).length === 0;
    return {
      orientation: isValid
        ? (input.orientation as { orientation: CaptureCameraOrientation })
            .orientation
        : null,
      orientationSource: isValid ? "orientation_file" : null,
      orientationVote: vote,
    };
  }

  return {
    orientation: vote?.orientation ?? null,
    orientationSource: vote ? "trajectory_vote" : null,
    orientationVote: vote,
  };
}

function missingFile(code: string, path: string): ValidationError {
  return { code, message: `Bundle is missing ${path}` };
}
