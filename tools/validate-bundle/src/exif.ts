/**
 * Minimal JPEG EXIF reader for capture-time tags.
 *
 * Reads only the capture-time tags the contract requires (`DateTimeOriginal`,
 * `SubSecTimeOriginal`, `OffsetTimeOriginal`) plus `Orientation`, from the
 * first bytes of a JPEG. Pure byte parsing so it runs in Node and browsers
 * without a native or third-party dependency.
 */

import type { ValidationError } from "./validation.js";

/** The capture EXIF must sit within this many leading bytes of each JPEG. */
export const CAPTURE_EXIF_HEAD_BYTES = 64 * 1024;

export interface CaptureExif {
  dateTimeOriginal?: string;
  subSecTimeOriginal?: string;
  offsetTimeOriginal?: string;
  orientation?: number;
}

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_SUB_SEC_TIME_ORIGINAL = 0x9291;

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;

const MAX_IFD_ENTRIES = 512;

interface TiffView {
  view: DataView;
  start: number;
  end: number;
  littleEndian: boolean;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

/**
 * Parse capture EXIF from the head of a JPEG.
 *
 * @param jpegHead Leading bytes of the JPEG; {@link CAPTURE_EXIF_HEAD_BYTES} is enough.
 * @returns Tags found, or `null` when the bytes are not a JPEG with an EXIF APP1 segment.
 */
export function readCaptureExif(jpegHead: Uint8Array): CaptureExif | null {
  const tiff = findExifTiff(jpegHead);
  if (!tiff) return null;

  const ifd0Offset = readUint32(tiff, 4);
  if (ifd0Offset === null) return null;

  const exif: CaptureExif = {};
  let exifIfdOffset: number | null = null;
  for (const entry of readIfdEntries(tiff, ifd0Offset)) {
    if (entry.tag === TAG_ORIENTATION && entry.type === TYPE_SHORT) {
      exif.orientation = readInlineShort(tiff, entry);
    } else if (entry.tag === TAG_EXIF_IFD_POINTER && entry.type === TYPE_LONG) {
      exifIfdOffset = readUint32(tiff, entry.valueOffset);
    }
  }
  if (exifIfdOffset === null) return exif;

  for (const entry of readIfdEntries(tiff, exifIfdOffset)) {
    if (entry.type !== TYPE_ASCII) continue;
    if (entry.tag === TAG_DATE_TIME_ORIGINAL) {
      exif.dateTimeOriginal = readAscii(tiff, entry);
    } else if (entry.tag === TAG_SUB_SEC_TIME_ORIGINAL) {
      exif.subSecTimeOriginal = readAscii(tiff, entry);
    } else if (entry.tag === TAG_OFFSET_TIME_ORIGINAL) {
      exif.offsetTimeOriginal = readAscii(tiff, entry);
    }
  }
  return exif;
}

const DATE_TIME_PATTERN = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const SUB_SEC_PATTERN = /^\d+$/;
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/;

/**
 * Absolute capture time in Unix seconds from complete capture EXIF.
 *
 * @returns `null` when any of the three tags is missing or malformed.
 */
export function captureExifTimestampSeconds(exif: CaptureExif): number | null {
  const dateTime = DATE_TIME_PATTERN.exec(exif.dateTimeOriginal ?? "");
  const subSec = exif.subSecTimeOriginal?.trim() ?? "";
  const offset = OFFSET_PATTERN.exec(exif.offsetTimeOriginal ?? "");
  if (!dateTime || !SUB_SEC_PATTERN.test(subSec) || !offset) return null;

  const [, year, month, day, hour, minute, second] = dateTime.map(Number);
  const localMs = Date.UTC(year!, month! - 1, day, hour, minute, second);
  if (Number.isNaN(localMs)) return null;

  const offsetSign = offset[1] === "-" ? -1 : 1;
  const offsetMinutes =
    offsetSign * (Number(offset[2]) * 60 + Number(offset[3]));
  const fraction = Number(`0.${subSec}`);
  return localMs / 1000 - offsetMinutes * 60 + fraction;
}

export interface CaptureFrameExif {
  /** Bundle-relative image path, e.g. `images/Image_000001.jpg`. */
  path: string;
  /** Parsed tags, or `null` when the JPEG had no EXIF segment. */
  exif: CaptureExif | null;
}

/**
 * Validate capture EXIF across all frames, in frame order.
 *
 * Every JPEG needs parseable `DateTimeOriginal`, `SubSecTimeOriginal`, and
 * `OffsetTimeOriginal`; `Orientation` must be absent or 1; timestamps must be
 * strictly increasing. Errors are capped per code so 5000 bad frames stay a
 * readable report.
 */
export function validateCaptureExif(
  frames: CaptureFrameExif[],
): ValidationError[] {
  const errors = createCappedErrors();
  let previous: { path: string; seconds: number } | null = null;

  for (const frame of frames) {
    const seconds = validateFrameExif(frame, errors);
    if (seconds === null) continue;
    if (previous && seconds <= previous.seconds) {
      errors.push({
        code: "EXIF_TIMESTAMPS_NOT_INCREASING",
        message: `${frame.path} EXIF time is not after ${previous.path}`,
      });
    }
    previous = { path: frame.path, seconds };
  }
  return errors.toList();
}

function validateFrameExif(
  frame: CaptureFrameExif,
  errors: CappedErrors,
): number | null {
  if (!frame.exif) {
    errors.push({
      code: "EXIF_MISSING",
      message: `${frame.path} has no EXIF segment in its first ${CAPTURE_EXIF_HEAD_BYTES} bytes`,
    });
    return null;
  }
  if (frame.exif.orientation !== undefined && frame.exif.orientation !== 1) {
    errors.push({
      code: "EXIF_ORIENTATION_NOT_IDENTITY",
      message: `${frame.path} EXIF Orientation is ${frame.exif.orientation}; it must be absent or 1`,
    });
  }
  const seconds = captureExifTimestampSeconds(frame.exif);
  if (seconds === null) {
    errors.push({
      code: "EXIF_CAPTURE_TIME_INVALID",
      message: `${frame.path} needs DateTimeOriginal, SubSecTimeOriginal, and OffsetTimeOriginal`,
      details: {
        dateTimeOriginal: frame.exif.dateTimeOriginal ?? null,
        subSecTimeOriginal: frame.exif.subSecTimeOriginal ?? null,
        offsetTimeOriginal: frame.exif.offsetTimeOriginal ?? null,
      },
    });
  }
  return seconds;
}

const MAX_ERRORS_PER_CODE = 5;

interface CappedErrors {
  push: (error: ValidationError) => void;
  toList: () => ValidationError[];
}

function createCappedErrors(): CappedErrors {
  const kept: ValidationError[] = [];
  const counts = new Map<string, number>();

  return {
    push(error) {
      const count = (counts.get(error.code) ?? 0) + 1;
      counts.set(error.code, count);
      if (count <= MAX_ERRORS_PER_CODE) kept.push(error);
    },
    toList() {
      const summaries: ValidationError[] = [];
      for (const [code, count] of counts) {
        if (count <= MAX_ERRORS_PER_CODE) continue;
        summaries.push({
          code,
          message: `${count - MAX_ERRORS_PER_CODE} more frames failed with ${code}`,
          details: { total: count },
        });
      }
      return [...kept, ...summaries];
    },
  };
}

function findExifTiff(bytes: Uint8Array): TiffView | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) return null;
    const segmentLength = view.getUint16(offset + 2);
    if (marker === 0xe1 && isExifHeader(bytes, offset + 4)) {
      const start = offset + 10;
      const end = Math.min(offset + 2 + segmentLength, bytes.length);
      return tiffViewAt(view, start, end);
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function isExifHeader(bytes: Uint8Array, offset: number): boolean {
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  return header.every((byte, index) => bytes[offset + index] === byte);
}

function tiffViewAt(
  view: DataView,
  start: number,
  end: number,
): TiffView | null {
  if (start + 8 > end) return null;
  const byteOrder = view.getUint16(start);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const tiff = { view, start, end, littleEndian: byteOrder === 0x4949 };
  return readUint16(tiff, 2) === 0x002a ? tiff : null;
}

function readIfdEntries(tiff: TiffView, ifdOffset: number): IfdEntry[] {
  const count = readUint16(tiff, ifdOffset);
  if (count === null || count > MAX_IFD_ENTRIES) return [];
  const entries: IfdEntry[] = [];
  for (let index = 0; index < count; index++) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = readUint16(tiff, entryOffset);
    const type = readUint16(tiff, entryOffset + 2);
    const valueCount = readUint32(tiff, entryOffset + 4);
    if (tag === null || type === null || valueCount === null) break;
    entries.push({
      tag,
      type,
      count: valueCount,
      valueOffset: entryOffset + 8,
    });
  }
  return entries;
}

function readInlineShort(tiff: TiffView, entry: IfdEntry): number | undefined {
  return readUint16(tiff, entry.valueOffset) ?? undefined;
}

function readAscii(tiff: TiffView, entry: IfdEntry): string | undefined {
  const dataOffset =
    entry.count <= 4 ? entry.valueOffset : readUint32(tiff, entry.valueOffset);
  if (dataOffset === null) return undefined;
  const absoluteStart = tiff.start + dataOffset;
  if (absoluteStart + entry.count > tiff.end) return undefined;

  let text = "";
  for (let index = 0; index < entry.count; index++) {
    const code = tiff.view.getUint8(absoluteStart + index);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

function readUint16(tiff: TiffView, offset: number): number | null {
  const absolute = tiff.start + offset;
  if (offset < 0 || absolute + 2 > tiff.end) return null;
  return tiff.view.getUint16(absolute, tiff.littleEndian);
}

function readUint32(tiff: TiffView, offset: number): number | null {
  const absolute = tiff.start + offset;
  if (offset < 0 || absolute + 4 > tiff.end) return null;
  return tiff.view.getUint32(absolute, tiff.littleEndian);
}
