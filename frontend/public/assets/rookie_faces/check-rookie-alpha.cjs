const fs = require("fs");
const zlib = require("zlib");

function readUInt32(buf, off) {
  return buf.readUInt32BE(off);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function inspectPng(file) {
  const buf = fs.readFileSync(file);

  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats = [];

  while (off < buf.length) {
    const len = readUInt32(buf, off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;

    if (type === "IHDR") {
      width = readUInt32(buf, dataStart);
      height = readUInt32(buf, dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    }

    if (type === "IDAT") {
      idats.push(buf.slice(dataStart, dataEnd));
    }

    off = dataEnd + 4;
  }

  if (colorType !== 6 || bitDepth !== 8) {
    return {
      file,
      width,
      height,
      bitDepth,
      colorType,
      result: colorType === 2 ? "RGB_NO_ALPHA" : "NOT_RGBA_8BIT",
    };
  }

  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;

  let pos = 0;
  let prev = Buffer.alloc(rowBytes);
  let minAlpha = 255;
  let maxAlpha = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = Buffer.from(raw.slice(pos, pos + rowBytes));
    pos += rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;

      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 255;
    }

    for (let x = 3; x < rowBytes; x += 4) {
      const a = row[x];
      if (a < minAlpha) minAlpha = a;
      if (a > maxAlpha) maxAlpha = a;
    }

    prev = row;
  }

  return {
    file,
    width,
    height,
    bitDepth,
    colorType,
    result: minAlpha < 255 ? `TRANSPARENT_ALPHA_${minAlpha}_${maxAlpha}` : "OPAQUE_RGBA_NO_TRANSPARENT_PIXELS",
  };
}

const files = fs.readdirSync(".").filter(f => /^rookie_face_\d{4}\.png$/i.test(f)).sort();

console.log("count:", files.length);
for (const f of files) {
  const r = inspectPng(f);
  console.log(`${r.file} | ${r.width}x${r.height} | ${r.result}`);
}
