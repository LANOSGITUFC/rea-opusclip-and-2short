/**
 * Deterministic synthetic media fixture generators for E2E tests.
 * Uses ffmpeg/ffprobe and built-in Node zlib for PNG generation.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");

function createTempDir(prefix = "opus2short-e2e-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(dirPath) {
  if (dirPath && fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Generates a deterministic synthetic MP4 video with testsrc video and sine audio.
 * @param {string} outPath
 * @param {object} [opts]
 * @param {number} [opts.duration=6]
 * @param {number} [opts.width=640]
 * @param {number} [opts.height=360]
 * @param {number} [opts.fps=24]
 * @param {number} [opts.frequency=440]
 * @param {boolean} [opts.silentGap=false] Inserts a 1.5s silent gap in the middle (2.0s to 3.5s)
 */
function createTestVideo(outPath, opts = {}) {
  const duration = opts.duration ?? 6;
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const fps = opts.fps ?? 24;
  const frequency = opts.frequency ?? 440;
  const silentGap = Boolean(opts.silentGap);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `testsrc=duration=${duration}:size=${width}x${height}:rate=${fps}`,
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:duration=${duration}`
  ];

  if (silentGap) {
    args.push("-af", "volume=enable='between(t,2.0,3.5)':volume=0");
  }

  args.push(
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "ultrafast",
    "-c:a", "aac",
    "-shortest",
    outPath
  );

  execFileSync("ffmpeg", args, { stdio: "pipe" });
  return outPath;
}

/**
 * Generates a deterministic synthetic audio file (WAV or MP3).
 * @param {string} outPath
 * @param {object} [opts]
 * @param {number} [opts.duration=2]
 * @param {number} [opts.frequency=330]
 */
function createTestAudio(outPath, opts = {}) {
  const duration = opts.duration ?? 2;
  const frequency = opts.frequency ?? 330;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi",
      "-i", `sine=frequency=${frequency}:duration=${duration}`,
      outPath
    ],
    { stdio: "pipe" }
  );
  return outPath;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Writes a deterministic valid 64x64 RGBA PNG image.
 * @param {string} outPath
 * @param {object} [opts]
 * @param {number} [opts.width=64]
 * @param {number} [opts.height=64]
 * @param {number[]} [opts.rgba=[255, 64, 128, 255]]
 */
function createTestPng(outPath, opts = {}) {
  const width = opts.width ?? 64;
  const height = opts.height ?? 64;
  const rgba = opts.rgba ?? [255, 64, 128, 255];

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = rgba[0];
      raw[px + 1] = rgba[1];
      raw[px + 2] = rgba[2];
      raw[px + 3] = rgba[3];
    }
  }

  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);

  fs.writeFileSync(outPath, png);
  return outPath;
}

/**
 * Probes a media file using ffprobe and returns parsed metadata.
 * @param {string} filePath
 */
function probeMedia(filePath) {
  const raw = execFileSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { encoding: "utf8" }
  );
  const parsed = JSON.parse(raw);
  const streams = parsed.streams || [];
  const videoStream = streams.find((s) => s.codec_type === "video") || null;
  const audioStream = streams.find((s) => s.codec_type === "audio") || null;
  return {
    format: parsed.format || {},
    streams,
    videoStream,
    audioStream,
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
    duration: Number(parsed.format?.duration || 0),
    width: Number(videoStream?.width || 0),
    height: Number(videoStream?.height || 0)
  };
}

module.exports = {
  createTempDir,
  removeDir,
  createTestVideo,
  createTestAudio,
  createTestPng,
  probeMedia
};
