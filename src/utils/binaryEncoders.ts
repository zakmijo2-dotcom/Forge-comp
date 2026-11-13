/**
 * Pure TypeScript binary encoders for BMP, WAV (PCM 16-bit), and GIF89a
 * so offline browser processing never fails due to missing native canvas/Audio mime support.
 */

export function encodeRgbaToBmp(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelArraySize = rowStride * height;
  const fileSize = 54 + pixelArraySize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  // BITMAPFILEHEADER (14 bytes)
  view.setUint8(0, 0x42); // 'B'
  view.setUint8(1, 0x4d); // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint32(10, 54, true); // pixel data offset

  // BITMAPINFOHEADER (40 bytes)
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive = bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // 24-bit BGR
  view.setUint32(30, 0, true); // BI_RGB
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true); // ~72 DPI
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    const dstOffset = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      const s = (srcRow * width + x) * 4;
      const d = dstOffset + x * 3;
      out[d] = rgba[s + 2];     // B
      out[d + 1] = rgba[s + 1]; // G
      out[d + 2] = rgba[s];     // R
    }
  }

  return out;
}

export function encodeFloatChannelsToWav(
  channels: Float32Array[],
  sampleRate: number
): Uint8Array {
  const numChannels = Math.max(1, channels.length);
  const length = channels[0]?.length || 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Compact GIF89a animated encoder with 216-color 6x6x6 RGB cube + 40 grays (256 colors)
 * and standard LZW variable-bit-width compression. Used as offline fallback when FFmpeg WASM is unavailable.
 */
export function encodeFramesToGif(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  delayMs: number
): Uint8Array {
  const bytes: number[] = [];
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const writeU16 = (v: number) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };

  // Build 256-color global palette: 6x6x6 RGB (216) + 40 grayscale levels
  const palette = new Uint8Array(256 * 3);
  let pIdx = 0;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette[pIdx++] = Math.round((r * 255) / 5);
        palette[pIdx++] = Math.round((g * 255) / 5);
        palette[pIdx++] = Math.round((b * 255) / 5);
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    const v = Math.round((i * 255) / 39);
    palette[pIdx++] = v;
    palette[pIdx++] = v;
    palette[pIdx++] = v;
  }

  const quantizePixel = (r: number, g: number, b: number): number => {
    const ri = Math.round((r * 5) / 255);
    const gi = Math.round((g * 5) / 255);
    const bi = Math.round((b * 5) / 255);
    return ri * 36 + gi * 6 + bi;
  };

  // GIF Header
  writeStr('GIF89a');
  writeU16(width);
  writeU16(height);
  bytes.push(0xf7); // Global color table flag (1), color res (7), sort (0), size (7 -> 2^(7+1)=256)
  bytes.push(0x00); // Background color index
  bytes.push(0x00); // Pixel aspect ratio

  for (let i = 0; i < palette.length; i++) {
    bytes.push(palette[i]);
  }

  // Netscape 2.0 loop extension
  bytes.push(0x21, 0xff, 0x0b);
  writeStr('NETSCAPE2.0');
  bytes.push(0x03, 0x01);
  writeU16(0); // infinite loop
  bytes.push(0x00);

  const delayCentiseconds = Math.max(2, Math.round(delayMs / 10));

  for (const rgba of frames) {
    // Graphic Control Extension
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    writeU16(delayCentiseconds);
    bytes.push(0x00, 0x00);

    // Image Descriptor
    bytes.push(0x2c);
    writeU16(0);
    writeU16(0);
    writeU16(width);
    writeU16(height);
    bytes.push(0x00);

    // LZW Image Data (min code size = 8)
    const minCodeSize = 8;
    bytes.push(minCodeSize);
    const indexed = new Uint8Array(width * height);
    for (let i = 0; i < indexed.length; i++) {
      const o = i * 4;
      indexed[i] = quantizePixel(rgba[o], rgba[o + 1], rgba[o + 2]);
    }

    const compressed = lzwEncodeGif(indexed, minCodeSize);
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const chunkLen = Math.min(255, compressed.length - offset);
      bytes.push(chunkLen);
      for (let k = 0; k < chunkLen; k++) {
        bytes.push(compressed[offset + k]);
      }
    }
    bytes.push(0x00); // Block terminator
  }

  bytes.push(0x3b); // GIF Trailer
  return new Uint8Array(bytes);
}

function lzwEncodeGif(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let maxCode = 1 << codeSize;

  let dict = new Map<string, number>();
  const resetDict = () => {
    dict = new Map<string, number>();
    for (let i = 0; i < clearCode; i++) {
      dict.set(String(i), i);
    }
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
    maxCode = 1 << codeSize;
  };

  const outBytes: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;

  const emitCode = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      outBytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  };

  resetDict();
  emitCode(clearCode);

  if (indices.length > 0) {
    let prefix = String(indices[0]);
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const combined = `${prefix},${k}`;
      if (dict.has(combined)) {
        prefix = combined;
      } else {
        emitCode(dict.get(prefix)!);
        if (nextCode < 4096) {
          dict.set(combined, nextCode++);
          if (nextCode > maxCode && codeSize < 12) {
            codeSize++;
            maxCode = 1 << codeSize;
          }
        } else {
          emitCode(clearCode);
          resetDict();
        }
        prefix = String(k);
      }
    }
    emitCode(dict.get(prefix)!);
  }

  emitCode(eoiCode);
  if (bitCount > 0) {
    outBytes.push(bitBuf & 0xff);
  }
  return outBytes;
}
