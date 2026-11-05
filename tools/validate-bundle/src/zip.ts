/**
 * The ZIP side of the Echo-3 capture contract.
 *
 * `planCaptureZipEntries` applies the contract's ZIP rules: limits, unsafe
 * names, ignored macOS/dotfile noise, a single wrapper folder, duplicates. It runs on entry
 * metadata only, so it applies to a directory on disk as well as a ZIP.
 *
 * `openZip` is a dependency-free central-directory reader (zip64 aware) for
 * stored and deflate entries, the only methods the contract allows.
 */
import fs from "node:fs";
import zlib from "node:zlib";

import { CAPTURE_LIMITS } from "./partner-bundle.js";
import type { ValidationError } from "./validation.js";

const MIB = 1024 * 1024;

export const CAPTURE_ZIP_LIMITS = {
  MAX_ENTRIES: CAPTURE_LIMITS.MAX_FRAMES * 2 + 64,
  MAX_ENTRY_UNCOMPRESSED_BYTES: 64 * MIB,
  MAX_TOTAL_UNCOMPRESSED_BYTES: 8 * 1024 * MIB,
  MAX_COMPRESSION_RATIO: 100,
  /** Entries smaller than this are exempt from the ratio check. */
  COMPRESSION_RATIO_MIN_BYTES: MIB,
} as const;

/** Paths in the capture layout. Everything else in the archive is ignored. */
export const CAPTURE_PATH_PATTERNS = {
  IMAGE: /^images\/Image_\d{6}\.jpg$/,
  TRAJECTORY: /^cameras\/camera_trajectory\.json$/,
  PER_FRAME_INTRINSICS: /^cameras\/per_frame_intrinsics\.json$/,
  INTRINSICS: /^cameras\/camera_intrinsics\.json$/,
  ORIENTATION: /^cameras\/orientation\.json$/,
} as const;

export function isValidCapturePath(path: string): boolean {
  return Object.values(CAPTURE_PATH_PATTERNS).some((pattern) =>
    pattern.test(path),
  );
}

export interface CaptureZipEntry {
  /** Raw entry name, `/`-separated. */
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface CaptureZipExtraction {
  entry: CaptureZipEntry;
  /** Bundle-relative destination, e.g. `images/Image_000001.jpg`. */
  bundlePath: string;
}

export interface CaptureZipSkip {
  name: string;
  reason: "ignored_metadata" | "not_in_bundle_layout";
}

export interface CaptureZipPlan {
  extract: CaptureZipExtraction[];
  skipped: CaptureZipSkip[];
  /** Single top-level folder stripped from every entry, if any. */
  wrapperFolder: string | null;
  errors: ValidationError[];
}

const BUNDLE_TOP_LEVEL_DIRS = new Set(["images", "cameras"]);

/**
 * Decide which entries are bundle files and where they land.
 *
 * Unsafe names (absolute, `..`, backslashes, NUL), symlinks, duplicates, and
 * limit breaches are errors; macOS/dotfile noise and anything outside
 * the capture layout is skipped. A single wrapper folder (`bundle/images/...`)
 * is stripped.
 */
export function planCaptureZipEntries(
  entries: CaptureZipEntry[],
): CaptureZipPlan {
  const errors = checkArchiveLimits(entries);
  const skipped: CaptureZipSkip[] = [];
  const candidates: CaptureZipEntry[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryError = checkEntry(entry);
    if (entryError) {
      errors.push(entryError);
      continue;
    }
    if (isIgnoredName(entry.name)) {
      skipped.push({ name: entry.name, reason: "ignored_metadata" });
      continue;
    }
    candidates.push(entry);
  }

  const wrapperFolder = findWrapperFolder(candidates.map((e) => e.name));
  const extract = mapToBundlePaths(candidates, wrapperFolder, skipped, errors);
  return { extract, skipped, wrapperFolder, errors };
}

function checkArchiveLimits(entries: CaptureZipEntry[]): ValidationError[] {
  const limits = CAPTURE_ZIP_LIMITS;
  const errors: ValidationError[] = [];
  if (entries.length > limits.MAX_ENTRIES) {
    errors.push({
      code: "ZIP_TOO_MANY_ENTRIES",
      message: `ZIP has ${entries.length} entries; the limit is ${limits.MAX_ENTRIES}`,
    });
  }
  const totalBytes = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (totalBytes > limits.MAX_TOTAL_UNCOMPRESSED_BYTES) {
    errors.push({
      code: "ZIP_TOO_LARGE",
      message: `ZIP expands to ${totalBytes} bytes; the limit is ${limits.MAX_TOTAL_UNCOMPRESSED_BYTES}`,
    });
  }
  return errors;
}

function checkEntry(entry: CaptureZipEntry): ValidationError | null {
  const limits = CAPTURE_ZIP_LIMITS;
  if (entry.isSymlink) {
    return { code: "ZIP_SYMLINK", message: `${entry.name} is a symlink` };
  }
  if (!isSafeEntryName(entry.name)) {
    return {
      code: "ZIP_UNSAFE_PATH",
      message: `${JSON.stringify(entry.name)} is not a safe relative path`,
    };
  }
  if (entry.uncompressedSize > limits.MAX_ENTRY_UNCOMPRESSED_BYTES) {
    return {
      code: "ZIP_ENTRY_TOO_LARGE",
      message: `${entry.name} expands to ${entry.uncompressedSize} bytes; the limit is ${limits.MAX_ENTRY_UNCOMPRESSED_BYTES}`,
    };
  }
  if (isSuspiciousRatio(entry)) {
    return {
      code: "ZIP_COMPRESSION_RATIO",
      message: `${entry.name} compression ratio exceeds ${limits.MAX_COMPRESSION_RATIO}:1`,
    };
  }
  return null;
}

function isSuspiciousRatio(entry: CaptureZipEntry): boolean {
  const limits = CAPTURE_ZIP_LIMITS;
  if (entry.uncompressedSize < limits.COMPRESSION_RATIO_MIN_BYTES) return false;
  if (entry.compressedSize <= 0) return true;
  return (
    entry.uncompressedSize / entry.compressedSize > limits.MAX_COMPRESSION_RATIO
  );
}

function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.includes("\0") || name.includes("\\")) {
    return false;
  }
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  return name
    .split("/")
    .every((segment) => segment !== ".." && segment !== ".");
}

function isIgnoredName(name: string): boolean {
  const segments = name.split("/");
  return segments.some((s) => s === "__MACOSX" || s.startsWith("."));
}

function findWrapperFolder(names: string[]): string | null {
  if (names.length === 0) return null;
  const firstSegments = new Set<string>();
  for (const name of names) {
    const slash = name.indexOf("/");
    if (slash === -1) return null;
    firstSegments.add(name.slice(0, slash));
  }
  if (firstSegments.size !== 1) return null;
  const [folder] = firstSegments;
  return BUNDLE_TOP_LEVEL_DIRS.has(folder!) ? null : folder!;
}

function mapToBundlePaths(
  candidates: CaptureZipEntry[],
  wrapperFolder: string | null,
  skipped: CaptureZipSkip[],
  errors: ValidationError[],
): CaptureZipExtraction[] {
  const prefix = wrapperFolder ? `${wrapperFolder}/` : "";
  const seen = new Set<string>();
  const extract: CaptureZipExtraction[] = [];

  for (const entry of candidates) {
    const bundlePath = entry.name.slice(prefix.length);
    if (!isValidCapturePath(bundlePath)) {
      skipped.push({ name: entry.name, reason: "not_in_bundle_layout" });
      continue;
    }
    if (seen.has(bundlePath)) {
      errors.push({
        code: "ZIP_DUPLICATE_ENTRY",
        message: `${bundlePath} appears more than once`,
      });
      continue;
    }
    seen.add(bundlePath);
    extract.push({ entry, bundlePath });
  }
  return extract;
}

// Reader

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

interface ZipEntryLocation extends CaptureZipEntry {
  method: number;
  localHeaderOffset: number;
}

export interface ZipArchive {
  entries: CaptureZipEntry[];
  /** Archive-level problems: bad structure, encryption, unsupported methods. */
  errors: ValidationError[];
  /** Decompressed entry bytes, or `null` when the entry is corrupt. */
  read: (entry: CaptureZipEntry) => Buffer | null;
  close: () => void;
}

export function openZip(filePath: string): ZipArchive {
  const fd = fs.openSync(filePath, "r");
  const close = () => fs.closeSync(fd);
  const size = fs.fstatSync(fd).size;
  const directory = readCentralDirectory(fd, size);
  if (!directory) {
    return {
      entries: [],
      errors: [{ code: "ZIP_INVALID", message: `${filePath} is not a ZIP` }],
      read: () => null,
      close,
    };
  }
  const entries = parseCentralEntries(directory);
  const errors = checkEntryMethods(entries);
  return {
    entries,
    errors,
    read: (entry) => readEntry(fd, entry as ZipEntryLocation),
    close,
  };
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  const bytesRead = fs.readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

function readCentralDirectory(fd: number, size: number): Buffer | null {
  const tailLength = Math.min(size, 22 + U16_MAX);
  const tail = readAt(fd, size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  let directorySize = tail.readUInt32LE(eocd + 12);
  let directoryOffset = tail.readUInt32LE(eocd + 16);
  if (directorySize === U32_MAX || directoryOffset === U32_MAX) {
    const zip64 = readZip64Directory(fd, size - tailLength + eocd);
    if (!zip64) return null;
    ({ directorySize, directoryOffset } = zip64);
  }
  if (directoryOffset + directorySize > size) return null;
  return readAt(fd, directoryOffset, directorySize);
}

function readZip64Directory(
  fd: number,
  eocdPosition: number,
): { directorySize: number; directoryOffset: number } | null {
  if (eocdPosition < 20) return null;
  const locator = readAt(fd, eocdPosition - 20, 20);
  if (locator.readUInt32LE(0) !== SIG_ZIP64_LOCATOR) return null;
  const record = readAt(fd, Number(locator.readBigUInt64LE(8)), 56);
  if (record.length < 56 || record.readUInt32LE(0) !== SIG_ZIP64_EOCD) {
    return null;
  }
  return {
    directorySize: Number(record.readBigUInt64LE(40)),
    directoryOffset: Number(record.readBigUInt64LE(48)),
  };
}

function parseCentralEntries(directory: Buffer): ZipEntryLocation[] {
  const entries: ZipEntryLocation[] = [];
  let offset = 0;
  while (offset + 46 <= directory.length) {
    if (directory.readUInt32LE(offset) !== SIG_CENTRAL) break;
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const name = directory.toString("utf8", nameStart, nameStart + nameLength);
    const extra = directory.subarray(
      nameStart + nameLength,
      nameStart + nameLength + extraLength,
    );
    const sizes = resolveZip64Sizes(directory, offset, extra);
    const madeByUnix = directory.readUInt8(offset + 5) === 3;
    const mode = directory.readUInt32LE(offset + 38) >>> 16;
    entries.push({
      name,
      compressedSize: sizes.compressedSize,
      uncompressedSize: sizes.uncompressedSize,
      isDirectory: name.endsWith("/"),
      isSymlink: madeByUnix && (mode & S_IFMT) === S_IFLNK,
      method:
        directory.readUInt16LE(offset + 8) & FLAG_ENCRYPTED
          ? -1
          : directory.readUInt16LE(offset + 10),
      localHeaderOffset: sizes.localHeaderOffset,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Applies the zip64 extra field (id 0x0001) to any saturated 32-bit field. */
function resolveZip64Sizes(
  directory: Buffer,
  offset: number,
  extra: Buffer,
): { compressedSize: number; uncompressedSize: number; localHeaderOffset: number } {
  let uncompressedSize = directory.readUInt32LE(offset + 24);
  let compressedSize = directory.readUInt32LE(offset + 20);
  let localHeaderOffset = directory.readUInt32LE(offset + 42);
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    if (id === 0x0001) {
      let field = cursor + 4;
      const next = () => {
        const value = Number(extra.readBigUInt64LE(field));
        field += 8;
        return value;
      };
      if (uncompressedSize === U32_MAX) uncompressedSize = next();
      if (compressedSize === U32_MAX) compressedSize = next();
      if (localHeaderOffset === U32_MAX) localHeaderOffset = next();
      break;
    }
    cursor += 4 + length;
  }
  return { compressedSize, uncompressedSize, localHeaderOffset };
}

function checkEntryMethods(entries: ZipEntryLocation[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (entry.method === -1) {
      errors.push({ code: "ZIP_ENCRYPTED", message: `${entry.name} is encrypted` });
    } else if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      errors.push({
        code: "ZIP_UNSUPPORTED_COMPRESSION",
        message: `${entry.name} uses compression method ${entry.method}; use stored or deflate`,
      });
    }
  }
  return errors;
}

function readEntry(fd: number, entry: ZipEntryLocation): Buffer | null {
  const header = readAt(fd, entry.localHeaderOffset, 30);
  if (header.length < 30 || header.readUInt32LE(0) !== SIG_LOCAL) return null;
  const dataStart =
    entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const data = readAt(fd, dataStart, entry.compressedSize);
  if (data.length !== entry.compressedSize) return null;
  if (entry.method === METHOD_STORED) return data;
  if (entry.method !== METHOD_DEFLATE) return null;
  try {
    const inflated = zlib.inflateRawSync(data, {
      maxOutputLength: Math.max(1, entry.uncompressedSize),
    });
    return inflated.length === entry.uncompressedSize ? inflated : null;
  } catch {
    return null;
  }
}
