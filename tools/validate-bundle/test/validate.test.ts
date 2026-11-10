import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { validateBundle } from "../src/bundle.js";
import { voteHoldOrientation } from "../src/orientation.js";

const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../samples/minimal-bundle",
);

function copySample(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  fs.cpSync(SAMPLE_DIR, dir, { recursive: true });
  return dir;
}

function codes(errors: { code: string }[]): string[] {
  return errors.map((error) => error.code);
}

function editJson(dir: string, relativePath: string, edit: (value: any) => unknown): void {
  const file = path.join(dir, relativePath);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify(edit(value) ?? value));
}

/** Drops every APP1 (EXIF) segment from a JPEG. */
function stripExif(jpeg: Buffer): Buffer {
  const parts = [jpeg.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= jpeg.length && jpeg[offset + 1] !== 0xda) {
    const length = jpeg.readUInt16BE(offset + 2);
    if (jpeg[offset + 1] !== 0xe1) parts.push(jpeg.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  parts.push(jpeg.subarray(offset));
  return Buffer.concat(parts);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipInput {
  name: string;
  data: Buffer;
  deflate?: boolean;
}

/** Minimal ZIP writer: stored or deflate entries, no zip64. */
function writeZip(file: string, inputs: ZipInput[]): void {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const input of inputs) {
    const name = Buffer.from(input.name, "utf8");
    const body = input.deflate ? zlib.deflateRawSync(input.data) : input.data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(input.deflate ? 8 : 0, 8);
    header.writeUInt32LE(crc32(input.data), 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(input.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(input.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(input.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(input.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(header, name, body);
    centrals.push(central, name);
    offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(inputs.length, 8);
  end.writeUInt16LE(inputs.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, directory, end]));
}

function sampleZipInputs(prefix: string): ZipInput[] {
  const files = [
    "images/Image_000001.jpg",
    "images/Image_000002.jpg",
    "images/Image_000003.jpg",
    "cameras/camera_trajectory.json",
    "cameras/per_frame_intrinsics.json",
  ];
  return files.map((name) => ({
    name: `${prefix}${name}`,
    data: fs.readFileSync(path.join(SAMPLE_DIR, name)),
    deflate: name.endsWith(".json"),
  }));
}

function tempZip(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zip-")), "capture.zip");
}

test("sample bundle is valid with no warnings", () => {
  const report = validateBundle(SAMPLE_DIR);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.frameCount, 3);
  assert.equal(report.orientation, "arkit_landscape_sensor");
  assert.equal(report.orientationSource, "trajectory_vote");
});

test("a zip with a single wrapper folder is valid", () => {
  const file = tempZip();
  writeZip(file, [
    ...sampleZipInputs("bundle/"),
    { name: "bundle/.DS_Store", data: Buffer.from("x") },
    { name: "__MACOSX/bundle/._Image_000001.jpg", data: Buffer.from("x") },
  ]);
  const report = validateBundle(file);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.wrapperFolder, "bundle");
  assert.equal(report.frameCount, 3);
});

test("unsafe zip paths fail", () => {
  const file = tempZip();
  writeZip(file, [...sampleZipInputs(""), { name: "../evil.txt", data: Buffer.from("x") }]);
  assert.ok(codes(validateBundle(file).errors).includes("ZIP_UNSAFE_PATH"));
});

test("a file that is not a zip fails", () => {
  const file = tempZip();
  fs.writeFileSync(file, "not a zip");
  assert.ok(codes(validateBundle(file).errors).includes("ZIP_INVALID"));
});

test("files outside the layout only warn", () => {
  const dir = copySample();
  fs.mkdirSync(path.join(dir, "notes"));
  fs.writeFileSync(path.join(dir, "notes/scan.txt"), "x");
  const report = validateBundle(dir);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(codes(report.warnings), ["IGNORED_PATHS"]);
  assert.deepEqual(report.warnings[0]!.details, { paths: ["notes/scan.txt"] });
});

test("missing per-frame intrinsics fail", () => {
  const dir = copySample();
  fs.rmSync(path.join(dir, "cameras/per_frame_intrinsics.json"));
  assert.ok(codes(validateBundle(dir).errors).includes("PER_FRAME_INTRINSICS_MISSING"));
});

test("a bundle without poses passes with a warning", () => {
  const dir = copySample();
  fs.rmSync(path.join(dir, "cameras/camera_trajectory.json"));
  const report = validateBundle(dir);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(codes(report.warnings), ["POSES_MISSING"]);
  assert.equal(report.orientation, "identity");
  assert.equal(report.orientationSource, null);
});

test("unparseable camera JSON fails", () => {
  const dir = copySample();
  fs.writeFileSync(path.join(dir, "cameras/camera_trajectory.json"), "[");
  assert.ok(codes(validateBundle(dir).errors).includes("CAMERA_FILE_INVALID_JSON"));
});

test("a gap in image names fails", () => {
  const dir = copySample();
  fs.renameSync(
    path.join(dir, "images/Image_000002.jpg"),
    path.join(dir, "images/Image_000004.jpg"),
  );
  assert.ok(codes(validateBundle(dir).errors).includes("IMAGE_SEQUENCE_GAP"));
});

test("an image whose pixels disagree with the intrinsics fails", () => {
  const dir = copySample();
  editJson(dir, "cameras/per_frame_intrinsics.json", (intrinsics) => {
    intrinsics.height_px = 1080;
    intrinsics.cy_px = [540, 540, 540];
  });
  assert.ok(codes(validateBundle(dir).errors).includes("IMAGE_SIZE_MISMATCH"));
});

test("a reflected rotation fails", () => {
  const dir = copySample();
  editJson(dir, "cameras/camera_trajectory.json", (trajectory) => {
    trajectory[1][2] = trajectory[1][2].map((value: number, column: number) =>
      column < 3 ? -value : value,
    );
  });
  assert.ok(codes(validateBundle(dir).errors).includes("ROTATION_IMPROPER"));
});

test("per-frame intrinsics must cover every frame", () => {
  const dir = copySample();
  editJson(dir, "cameras/per_frame_intrinsics.json", (perFrame) => {
    perFrame.fx_px = [1350];
  });
  assert.ok(
    codes(validateBundle(dir).errors).includes("PER_FRAME_INTRINSICS_ARRAY_LENGTH"),
  );
});

test("an image without EXIF fails", () => {
  const dir = copySample();
  const file = path.join(dir, "images/Image_000002.jpg");
  fs.writeFileSync(file, stripExif(fs.readFileSync(file)));
  const report = validateBundle(dir);
  assert.deepEqual(codes(report.errors), ["EXIF_MISSING"]);
});

test("EXIF times must strictly increase in frame order", () => {
  const dir = copySample();
  const second = path.join(dir, "images/Image_000002.jpg");
  const third = path.join(dir, "images/Image_000003.jpg");
  const secondBytes = fs.readFileSync(second);
  fs.copyFileSync(third, second);
  fs.writeFileSync(third, secondBytes);
  assert.ok(
    codes(validateBundle(dir).errors).includes("EXIF_TIMESTAMPS_NOT_INCREASING"),
  );
});

test("an orientation.json that disagrees with the trajectory vote warns", () => {
  const dir = copySample();
  fs.writeFileSync(
    path.join(dir, "cameras/orientation.json"),
    JSON.stringify({ orientation: "identity" }),
  );
  const report = validateBundle(dir);
  assert.deepEqual(report.errors, []);
  assert.equal(report.orientationSource, "orientation_file");
  assert.deepEqual(codes(report.warnings), ["ORIENTATION_VOTE_MISMATCH"]);
});

test("hold vote matches the iOS rule", () => {
  const portrait = [
    [0, -1, 0, 0],
    [-1, 0, 0, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1],
  ];
  const uprightLandscape = [
    [1, 0, 0, 0],
    [0, -1, 0, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1],
  ];
  const invertedLandscape = [
    [-1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1],
  ];
  assert.equal(voteHoldOrientation([portrait]).orientation, "arkit_landscape_sensor");
  assert.equal(voteHoldOrientation([uprightLandscape]).orientation, "identity");
  assert.equal(voteHoldOrientation([invertedLandscape]).orientation, "rotate_180");
});
