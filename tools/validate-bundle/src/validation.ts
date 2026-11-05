/**
 * Capture bundle validation.
 * Pure functions for the camera trajectory, intrinsics, orientation and image
 * filename checks a bundle must pass.
 */

import { isCaptureCameraOrientation } from "./orientation.js";

export interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface CameraIntrinsics {
  width_px: number;
  height_px: number;
  fx_px: number;
  fy_px: number;
  cx_px: number;
  cy_px: number;
}

export interface PerFrameCameraIntrinsics {
  frame_count: number;
  width_px: number;
  height_px: number;
  fx_px: number[];
  fy_px: number[];
  cx_px: number[];
  cy_px: number[];
}

const ORTHONORMAL_TOLERANCE = 1e-4;
const FINAL_ROW_TOLERANCE = 1e-6;
export const CAPTURE_IMAGE_WIDTH_PX = 1920;
export const CAPTURE_IMAGE_HEIGHT_PX = 1440;
// Native sensor sizes. ARKit captures are 1920x1440; 1920x1080 is accepted for
// other capture clients. Frames must never be resized or rotated.
const SUPPORTED_IMAGE_SIZES = [
  { width: CAPTURE_IMAGE_WIDTH_PX, height: CAPTURE_IMAGE_HEIGHT_PX },
  { width: 1920, height: 1080 },
] as const;

function isSupportedResolution(width: unknown, height: unknown): boolean {
  return SUPPORTED_IMAGE_SIZES.some(
    (size) => size.width === width && size.height === height,
  );
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isPositiveFinite(n: unknown): n is number {
  return isFiniteNumber(n) && n > 0;
}

function dot3(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm3(v: number[]): number {
  return Math.sqrt(dot3(v, v));
}

function extractColumn(matrix: number[][], col: number): number[] {
  return [matrix[0][col], matrix[1][col], matrix[2][col]];
}

function det3x3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function validateMatrix(matrix: unknown, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `Matrix[${index}]`;

  if (!Array.isArray(matrix) || matrix.length !== 4) {
    errors.push({
      code: "MATRIX_SHAPE",
      message: `${prefix}: Expected 4x4 matrix, got ${Array.isArray(matrix) ? `${matrix.length} rows` : typeof matrix}`,
    });
    return errors;
  }

  for (let r = 0; r < 4; r++) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length !== 4) {
      errors.push({
        code: "MATRIX_SHAPE",
        message: `${prefix}: Row ${r} expected 4 columns, got ${Array.isArray(row) ? row.length : typeof row}`,
      });
      return errors;
    }
  }

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (!isFiniteNumber(matrix[r][c])) {
        errors.push({
          code: "MATRIX_NON_FINITE",
          message: `${prefix}[${r}][${c}]: Value must be finite, got ${matrix[r][c]}`,
        });
      }
    }
  }

  if (errors.length > 0) return errors;

  const rotation: number[][] = [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];

  const det = det3x3(rotation);
  if (!isFiniteNumber(det) || Math.abs(det) < 1e-10) {
    errors.push({
      code: "MATRIX_SINGULAR",
      message: `${prefix}: Matrix is singular (determinant ≈ 0)`,
      details: { determinant: det },
    });
    return errors;
  }

  const col0 = extractColumn(rotation, 0);
  const col1 = extractColumn(rotation, 1);
  const col2 = extractColumn(rotation, 2);

  const norm0 = norm3(col0);
  const norm1 = norm3(col1);
  const norm2 = norm3(col2);

  if (
    Math.abs(norm0 - 1) > ORTHONORMAL_TOLERANCE ||
    Math.abs(norm1 - 1) > ORTHONORMAL_TOLERANCE ||
    Math.abs(norm2 - 1) > ORTHONORMAL_TOLERANCE
  ) {
    errors.push({
      code: "ROTATION_NOT_UNIT",
      message: `${prefix}: Rotation columns not unit vectors`,
      details: { columnNorms: [norm0, norm1, norm2] },
    });
  }

  const dot01 = Math.abs(dot3(col0, col1));
  const dot02 = Math.abs(dot3(col0, col2));
  const dot12 = Math.abs(dot3(col1, col2));

  if (
    dot01 > ORTHONORMAL_TOLERANCE ||
    dot02 > ORTHONORMAL_TOLERANCE ||
    dot12 > ORTHONORMAL_TOLERANCE
  ) {
    errors.push({
      code: "ROTATION_NOT_ORTHOGONAL",
      message: `${prefix}: Rotation columns not orthogonal`,
      details: { dotProducts: { "0·1": dot01, "0·2": dot02, "1·2": dot12 } },
    });
  }

  if (Math.abs(det - 1) > ORTHONORMAL_TOLERANCE) {
    errors.push({
      code: "ROTATION_IMPROPER",
      message: `${prefix}: Rotation determinant not +1 (reflection detected)`,
      details: { determinant: det },
    });
  }

  const finalRow = matrix[3];
  if (
    Math.abs(finalRow[0]) > FINAL_ROW_TOLERANCE ||
    Math.abs(finalRow[1]) > FINAL_ROW_TOLERANCE ||
    Math.abs(finalRow[2]) > FINAL_ROW_TOLERANCE ||
    Math.abs(finalRow[3] - 1) > FINAL_ROW_TOLERANCE
  ) {
    errors.push({
      code: "MATRIX_FINAL_ROW",
      message: `${prefix}: Final row must be [0, 0, 0, 1]`,
      details: { finalRow },
    });
  }

  return errors;
}

export function validateTrajectory(
  trajectory: unknown,
  expectedCount: number,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Array.isArray(trajectory)) {
    errors.push({
      code: "TRAJECTORY_NOT_ARRAY",
      message: `cameras/camera_trajectory.json must be an array of 4x4 matrices`,
    });
    return errors;
  }

  if (trajectory.length !== expectedCount) {
    errors.push({
      code: "TRAJECTORY_COUNT_MISMATCH",
      message: `Trajectory has ${trajectory.length} matrices but expected ${expectedCount} (frame_count)`,
      details: { actual: trajectory.length, expected: expectedCount },
    });
  }

  for (let i = 0; i < trajectory.length; i++) {
    const matrixErrors = validateMatrix(trajectory[i], i);
    errors.push(...matrixErrors);
    if (errors.length > 10) {
      errors.push({
        code: "VALIDATION_TRUNCATED",
        message: "Too many errors, validation truncated",
      });
      break;
    }
  }

  return errors;
}

function validateIntrinsicsObject(
  intrinsics: unknown,
  sourceName: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (
    !intrinsics ||
    typeof intrinsics !== "object" ||
    Array.isArray(intrinsics)
  ) {
    errors.push({
      code: "INTRINSICS_INVALID",
      message: `${sourceName} must be an object`,
    });
    return errors;
  }

  const obj = intrinsics as Record<string, unknown>;

  const requiredFields: (keyof CameraIntrinsics)[] = [
    "width_px",
    "height_px",
    "fx_px",
    "fy_px",
    "cx_px",
    "cy_px",
  ];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      errors.push({
        code: "INTRINSICS_MISSING_FIELD",
        message: `${sourceName} missing required field: ${field}`,
      });
    } else if (!isPositiveFinite(obj[field])) {
      errors.push({
        code: "INTRINSICS_INVALID_VALUE",
        message: `${sourceName}.${field} must be a positive finite number`,
        details: { value: obj[field] },
      });
    }
  }

  if (errors.length > 0) return errors;

  const width = obj.width_px as number;
  const height = obj.height_px as number;

  if (!isSupportedResolution(width, height)) {
    errors.push({
      code: "INTRINSICS_RESOLUTION_MISMATCH",
      message: `Intrinsics resolution ${width}x${height} must be 1920x1440 or 1920x1080`,
      details: {
        actual: { width, height },
        expected: {
          width: CAPTURE_IMAGE_WIDTH_PX,
          height: CAPTURE_IMAGE_HEIGHT_PX,
        },
        supported: SUPPORTED_IMAGE_SIZES,
      },
    });
  }

  const fx = obj.fx_px as number;
  const fy = obj.fy_px as number;
  const cx = obj.cx_px as number;
  const cy = obj.cy_px as number;

  if (cx <= 0 || cx >= width) {
    errors.push({
      code: "INTRINSICS_CX_OUT_OF_BOUNDS",
      message: `Principal point cx (${cx}) must be within image width (${width})`,
    });
  }

  if (cy <= 0 || cy >= height) {
    errors.push({
      code: "INTRINSICS_CY_OUT_OF_BOUNDS",
      message: `Principal point cy (${cy}) must be within image height (${height})`,
    });
  }

  if (fx < 100 || fx > 10000) {
    errors.push({
      code: "INTRINSICS_FX_UNREASONABLE",
      message: `Focal length fx (${fx}) seems unreasonable`,
    });
  }

  if (fy < 100 || fy > 10000) {
    errors.push({
      code: "INTRINSICS_FY_UNREASONABLE",
      message: `Focal length fy (${fy}) seems unreasonable`,
    });
  }

  return errors;
}

export function validateIntrinsics(intrinsics: unknown): ValidationError[] {
  return validateIntrinsicsObject(intrinsics, "cameras/camera_intrinsics.json");
}

/**
 * Validate `cameras/per_frame_intrinsics.json`.
 *
 * Pass `sharedIntrinsics` (the parsed `cameras/camera_intrinsics.json`) so
 * both resolutions must agree. Leave it `undefined` to check the per-frame
 * header against the supported resolutions alone.
 */
export function validatePerFrameIntrinsics(
  perFrameIntrinsics: unknown,
  expectedCount: number,
  trajectoryCount: number,
  sharedIntrinsics?: unknown,
): ValidationError[] {
  if (
    !perFrameIntrinsics ||
    typeof perFrameIntrinsics !== "object" ||
    Array.isArray(perFrameIntrinsics)
  ) {
    return [
      {
        code: "PER_FRAME_INTRINSICS_INVALID",
        message: "cameras/per_frame_intrinsics.json must be an object",
      },
    ];
  }

  const payload = perFrameIntrinsics as Partial<PerFrameCameraIntrinsics>;
  const errors = validatePerFrameHeader(
    payload,
    expectedCount,
    trajectoryCount,
    sharedIntrinsics,
  );
  errors.push(...validatePerFrameArrayLengths(payload, expectedCount));
  if (
    errors.some((error) => error.code === "PER_FRAME_INTRINSICS_ARRAY_LENGTH")
  ) {
    return errors;
  }
  errors.push(
    ...validatePerFrameEntries(payload, expectedCount, errors.length),
  );
  return errors;
}

function validatePerFrameHeader(
  payload: Partial<PerFrameCameraIntrinsics>,
  expectedCount: number,
  trajectoryCount: number,
  sharedIntrinsics: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (
    !Number.isInteger(payload.frame_count) ||
    payload.frame_count !== expectedCount ||
    payload.frame_count !== trajectoryCount
  ) {
    errors.push({
      code: "PER_FRAME_INTRINSICS_COUNT_MISMATCH",
      message:
        `Per-frame intrinsics declare ${String(payload.frame_count)} frames, ` +
        `trajectory has ${trajectoryCount}, and frame_count is ${expectedCount}`,
      details: {
        declared: payload.frame_count,
        trajectory: trajectoryCount,
        expected: expectedCount,
      },
    });
  }

  const resolution = `${String(payload.width_px)}x${String(payload.height_px)}`;
  if (!isSupportedResolution(payload.width_px, payload.height_px)) {
    errors.push({
      code: "PER_FRAME_INTRINSICS_RESOLUTION_MISMATCH",
      message: `Per-frame intrinsics resolution ${resolution} must be 1920x1440 or 1920x1080`,
    });
    return errors;
  }

  if (sharedIntrinsics === undefined) return errors;

  const shared = sharedIntrinsics as Partial<CameraIntrinsics> | null;
  if (
    payload.width_px !== shared?.width_px ||
    payload.height_px !== shared?.height_px
  ) {
    errors.push({
      code: "PER_FRAME_INTRINSICS_RESOLUTION_MISMATCH",
      message: `Per-frame intrinsics resolution ${resolution} does not match cameras/camera_intrinsics.json (${String(shared?.width_px)}x${String(shared?.height_px)})`,
    });
  }
  return errors;
}

function validatePerFrameArrayLengths(
  payload: Partial<PerFrameCameraIntrinsics>,
  expectedCount: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const arrayFields = ["fx_px", "fy_px", "cx_px", "cy_px"] as const;
  for (const field of arrayFields) {
    const values = payload[field];
    if (!Array.isArray(values) || values.length !== expectedCount) {
      errors.push({
        code: "PER_FRAME_INTRINSICS_ARRAY_LENGTH",
        message: `per_frame_intrinsics.json.${field} must contain ${expectedCount} values`,
        details: {
          field,
          actual: Array.isArray(values) ? values.length : null,
          expected: expectedCount,
        },
      });
    }
  }
  return errors;
}

function validatePerFrameEntries(
  payload: Partial<PerFrameCameraIntrinsics>,
  expectedCount: number,
  priorErrorCount: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const entryErrors = validateIntrinsicsObject(
      {
        width_px: payload.width_px,
        height_px: payload.height_px,
        fx_px: payload.fx_px?.[index],
        fy_px: payload.fy_px?.[index],
        cx_px: payload.cx_px?.[index],
        cy_px: payload.cy_px?.[index],
      },
      `per_frame_intrinsics.json[${index}]`,
    );
    errors.push(...entryErrors);
    if (priorErrorCount + errors.length > 10) {
      errors.push({
        code: "VALIDATION_TRUNCATED",
        message: "Too many errors, validation truncated",
      });
      break;
    }
  }
  return errors;
}

export function validateOrientation(json: unknown): ValidationError[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return [
      {
        code: "ORIENTATION_INVALID",
        message: "cameras/orientation.json must be an object",
      },
    ];
  }

  const obj = json as Record<string, unknown>;
  const extraKeys = Object.keys(obj).filter((key) => key !== "orientation");
  if (extraKeys.length > 0) {
    return [
      {
        code: "ORIENTATION_UNKNOWN_FIELD",
        message: "cameras/orientation.json only allows orientation",
        details: { extraKeys },
      },
    ];
  }

  if (!("orientation" in obj)) {
    return [
      {
        code: "ORIENTATION_MISSING_FIELD",
        message: "cameras/orientation.json missing required field: orientation",
      },
    ];
  }

  if (!isCaptureCameraOrientation(obj.orientation)) {
    return [
      {
        code: "ORIENTATION_INVALID_VALUE",
        message:
          "cameras/orientation.json.orientation must be arkit_landscape_sensor, identity, or rotate_180",
        details: { value: obj.orientation },
      },
    ];
  }

  return [];
}

export function validateImageFilenames(
  filenames: string[],
  expectedCount: number,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (filenames.length !== expectedCount) {
    errors.push({
      code: "IMAGE_COUNT_MISMATCH",
      message: `Found ${filenames.length} images but expected ${expectedCount} (frame_count)`,
      details: { actual: filenames.length, expected: expectedCount },
    });
  }

  const imagePattern = /^images\/Image_(\d{6})\.jpg$/;
  const indices: number[] = [];

  for (const filename of filenames) {
    const match = filename.match(imagePattern);
    if (!match) {
      errors.push({
        code: "IMAGE_NAME_INVALID",
        message: `Invalid image filename: ${filename}`,
      });
    } else {
      indices.push(parseInt(match[1], 10));
    }
  }

  if (indices.length === 0) return errors;

  indices.sort((a, b) => a - b);

  if (indices[0] !== 1) {
    errors.push({
      code: "IMAGE_SEQUENCE_START",
      message: `Image sequence should start at 1, found ${indices[0]}`,
    });
  }

  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) {
      errors.push({
        code: "IMAGE_SEQUENCE_GAP",
        message: `Image sequence has gap: ${indices[i - 1]} → ${indices[i]}`,
        details: { expectedNext: indices[i - 1] + 1, actual: indices[i] },
      });
      break;
    }
  }

  return errors;
}

interface BundleValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function createValidationResult(
  errors: ValidationError[],
): BundleValidationResult {
  return {
    valid: errors.length === 0,
    errors,
  };
}
