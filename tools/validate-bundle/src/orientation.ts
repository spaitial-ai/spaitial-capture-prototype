/**
 * Phone-hold orientation: the value of the optional `cameras/orientation.json`,
 * or the hold inferred from the trajectory when that file is absent.
 */

export const ARKIT_LANDSCAPE_SENSOR = "arkit_landscape_sensor";
export const CAPTURE_ORIENTATION_IDENTITY = "identity";
export const CAPTURE_ORIENTATION_ROTATE_180 = "rotate_180";
export const CAPTURE_CAMERA_ORIENTATIONS = [
  ARKIT_LANDSCAPE_SENSOR,
  CAPTURE_ORIENTATION_IDENTITY,
  CAPTURE_ORIENTATION_ROTATE_180,
] as const;
export type CaptureCameraOrientation =
  (typeof CAPTURE_CAMERA_ORIENTATIONS)[number];

export function isCaptureCameraOrientation(
  value: unknown,
): value is CaptureCameraOrientation {
  return CAPTURE_CAMERA_ORIENTATIONS.some(
    (orientation) => orientation === value,
  );
}

export interface HoldOrientationVote {
  orientation: CaptureCameraOrientation;
  portraitVotes: number;
  uprightLandscapeVotes: number;
  invertedLandscapeVotes: number;
}

/**
 * Majority vote of the phone hold from OpenCV `camera_from_world` matrices
 * (row-major, world +Y up). Port of `CameraGeometry.voteHoldOrientation` in
 * the iOS app: `|M[0][1]| >= |M[1][1]|` votes portrait, otherwise the sign of
 * `M[1][1]` separates upright from inverted landscape.
 *
 * Callers must validate the trajectory first; malformed matrices are skipped.
 */
export function voteHoldOrientation(
  opencvCameraFromWorld: unknown[],
): HoldOrientationVote {
  let portraitVotes = 0;
  let uprightLandscapeVotes = 0;
  let invertedLandscapeVotes = 0;

  for (const matrix of opencvCameraFromWorld) {
    const up = cameraUpInWorldXY(matrix);
    if (!up) continue;
    if (Math.abs(up.x) >= Math.abs(up.y)) {
      portraitVotes += 1;
    } else if (up.y < 0) {
      uprightLandscapeVotes += 1;
    } else {
      invertedLandscapeVotes += 1;
    }
  }

  return {
    orientation: orientationFromVotes(
      portraitVotes,
      uprightLandscapeVotes,
      invertedLandscapeVotes,
    ),
    portraitVotes,
    uprightLandscapeVotes,
    invertedLandscapeVotes,
  };
}

function orientationFromVotes(
  portraitVotes: number,
  uprightLandscapeVotes: number,
  invertedLandscapeVotes: number,
): CaptureCameraOrientation {
  if (portraitVotes >= uprightLandscapeVotes + invertedLandscapeVotes) {
    return ARKIT_LANDSCAPE_SENSOR;
  }
  return invertedLandscapeVotes > uprightLandscapeVotes
    ? CAPTURE_ORIENTATION_ROTATE_180
    : CAPTURE_ORIENTATION_IDENTITY;
}

function cameraUpInWorldXY(matrix: unknown): { x: number; y: number } | null {
  if (!Array.isArray(matrix)) return null;
  const row0: unknown = matrix[0];
  const row1: unknown = matrix[1];
  if (!Array.isArray(row0) || !Array.isArray(row1)) return null;
  const x: unknown = row0[1];
  const y: unknown = row1[1];
  if (typeof x !== "number" || typeof y !== "number") return null;
  return { x, y };
}
