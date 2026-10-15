const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

function imageSize(bytes, format) {
  if (format === "png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      throw new Error("image data is not PNG");
    }
    let width;
    let height;
    let hasData = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (offset + 12 + length > bytes.length) throw new Error("truncated PNG image");
      if (offset === 8) {
        if (type !== "IHDR" || length !== 13) throw new Error("invalid PNG header");
        width = bytes.readUInt32BE(offset + 8);
        height = bytes.readUInt32BE(offset + 12);
      }
      if (type === "acTL") throw new Error("animated PNG images are unsupported");
      if (type === "IDAT") hasData = true;
      offset += 12 + length;
      if (type === "IEND") {
        if (length !== 0 || !hasData || offset !== bytes.length) throw new Error("invalid PNG image end");
        return { width, height };
      }
    }
    throw new Error("incomplete PNG image");
  }

  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw new Error("image data is not a complete JPEG");
  }
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) throw new Error("invalid JPEG marker");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("truncated JPEG image");
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) throw new Error("invalid JPEG frame");
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error("JPEG image has no frame dimensions");
}

// Call after normalizeImageAssets when grounding coordinates in supplied pixels.
export function imageDimensions(asset) {
  return imageSize(Buffer.from(asset.data_base64, "base64"), asset.format);
}

export function normalizeImageAssets(assets) {
  if (assets === undefined) return {};
  if (!assets || typeof assets !== "object" || Array.isArray(assets)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(assets))) {
    throw new Error("assets must be an image reference map");
  }
  let referenceBytes = 0;
  let bodyBytes = 2;
  const normalized = [];
  for (const [reference, asset] of Object.entries(assets)) {
    const length = Buffer.byteLength(reference);
    referenceBytes += length;
    if (!reference.trim() || length > 1024 || referenceBytes > 65_536) {
      throw new Error("image references must be nonblank, at most 1024 UTF-8 bytes each and 65536 bytes total");
    }
    if (!asset || typeof asset !== "object" || Array.isArray(asset)
      || Object.keys(asset).some((key) => !["type", "format", "data_base64"].includes(key))
      || (asset.type !== undefined && asset.type !== "image") || !["png", "jpg", "jpeg"].includes(asset.format)) {
      throw new Error("assets accept only base64 PNG/JPG/JPEG images");
    }
    const data = asset.data_base64;
    if (typeof data !== "string" || !data.length || data.length % 4 !== 0
      || data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) {
      throw new Error("image base64 is invalid or exceeds 16 MiB decoded");
    }
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    if (data.length / 4 * 3 - padding > MAX_IMAGE_BYTES) throw new Error("image exceeds 16 MiB decoded");
    if (/[^A-Za-z0-9+/]/.test(data.slice(0, data.length - padding))) throw new Error("invalid image base64");
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data) throw new Error("invalid image base64");
    const { width, height } = imageSize(bytes, asset.format);
    if (width < 256 || height < 256 || width > 1568 || height > 1568 || width * height < 78_400) {
      throw new Error("image dimensions must be 256..1568 pixels per side and at least 78400 pixels total");
    }
    const value = { type: "image", format: asset.format, data_base64: data };
    bodyBytes += Buffer.byteLength(JSON.stringify(reference)) + Buffer.byteLength(JSON.stringify(value)) + 1 + (normalized.length ? 1 : 0);
    if (bodyBytes > MAX_BODY_BYTES) throw new Error("image assets exceed the 32 MiB request body limit");
    normalized.push([reference, value]);
  }
  return Object.fromEntries(normalized);
}
