/**
 * Bundle sources and JPEG header parsing.
 *
 * A source is a bundle directory or a ZIP. Both expose their entries in ZIP
 * terms so the ZIP entry rules (`planCaptureZipEntries`) apply to either one
 * unchanged.
 */
import fs from "node:fs";
import path from "node:path";

import { openZip, type CaptureZipEntry } from "./zip.js";
import type { ValidationError } from "./validation.js";

export interface BundleSource {
  entries: CaptureZipEntry[];
  /** Archive-level problems found while opening the source. */
  errors: ValidationError[];
  /** Entry bytes (at most `maxBytes` when set), or `null` when unreadable. */
  read: (entry: CaptureZipEntry, maxBytes?: number) => Buffer | null;
  close: () => void;
}

export function openBundleSource(inputPath: string): BundleSource {
  if (fs.statSync(inputPath).isDirectory()) return openDirectory(inputPath);
  const archive = openZip(inputPath);
  return {
    entries: archive.entries,
    errors: archive.errors,
    read: (entry, maxBytes) => {
      const bytes = archive.read(entry);
      return bytes && maxBytes !== undefined ? bytes.subarray(0, maxBytes) : bytes;
    },
    close: archive.close,
  };
}

/** Every file under `root`, dotfiles included, as uncompressed ZIP entries. */
function openDirectory(root: string): BundleSource {
  const entries: CaptureZipEntry[] = [];
  const walk = (relativeDir: string): void => {
    for (const dirent of fs.readdirSync(path.join(root, relativeDir), {
      withFileTypes: true,
    })) {
      const name = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        walk(name);
        continue;
      }
      const size = dirent.isFile() ? fs.statSync(path.join(root, name)).size : 0;
      entries.push({
        name,
        compressedSize: size,
        uncompressedSize: size,
        isDirectory: false,
        isSymlink: dirent.isSymbolicLink(),
      });
    }
  };
  walk("");
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    entries,
    errors: [],
    read: (entry, maxBytes) => readFile(path.join(root, entry.name), maxBytes),
    close: () => {},
  };
}

function readFile(filePath: string, maxBytes?: number): Buffer | null {
  try {
    if (maxBytes === undefined) return fs.readFileSync(filePath);
    const handle = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return null;
  }
}

export interface ImageSize {
  width: number;
  height: number;
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Pixel size from the first JPEG start-of-frame segment, or `null` when the
 * bytes are not a JPEG. ARKit EXIF blocks are small, so 256 KiB is ample.
 */
export function readJpegSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (SOF_MARKERS.has(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}
