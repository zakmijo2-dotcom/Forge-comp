# MediaForge Local

**MediaForge Local** (`forge-comp`) is an offline-first, client-side media compression and format conversion studio built with React 19, TypeScript, Tailwind CSS v4, and FFmpeg. All media processing runs locally in the user's browser or through an optional local hardware-accelerated Express FFmpeg bridge server — with zero cloud uploads.

---

## Features

- **Image Compression & Conversion**:
  - Convert between `WebP`, `JPG`, `PNG`, `AVIF` (with automatic `WebP` fallback when the browser lacks an AVIF encoder), and `BMP` (via a pure TypeScript 24-bit BGR encoder).
  - Aspect-ratio-locked resize presets (`Original`, `4K`, `1080p`, `720p`, `480p`, `75%`, `50%`, `25%`), quality slider (`1–100%`) with real-time size estimation, EXIF/GPS metadata stripping via clean canvas re-encoding, alpha flattening with custom background color, and luminance grayscale filtering.
  - Interactive split-screen **Before / After Comparison** slider with `2x Zoom` inspection.
- **Video Compression, Transcoding & GIF Generation**:
  - Convert between `MP4` (`H.264` / `H.265`), `WebM` (`VP9` / `VP8`), `MKV`, `MOV`, `AVI`, and palette-optimized animated `GIF`.
  - Configure CRF quality presets (`CRF 18` to `CRF 34`), resolution scaling (`Original` down to `360p`), frame rate (`Original`, `60`, `30`, `24`, `15` fps), audio track muting, or direct audio extraction.
- **Audio Extraction & Conversion**:
  - Convert audio files or extract audio tracks from video into `MP3`, `AAC (M4A)`, `WAV`, `OGG (Opus)`, or `FLAC`.
  - Configure bitrate (`320` down to `64 kbps`), sample rate (`48 kHz`, `44.1 kHz`, `22.05 kHz`), channels (`Stereo` / `Mono`), and start/end trim timestamps (`MM:SS`).
- **Smart One-Click Presets & Batch Queue**:
  - Presets for *Social Share*, *Web Ultra-Light*, *Extract Clean MP3*, *Archive / Max Quality*, and *Video to Smooth GIF*.
  - Multi-file drag-and-drop queue, sequential batch processing with cancellation, per-type settings sync, and one-click `JSZip` archive export.
- **System Theme Synchronization**:
  - Cyber-Industrial Dark Mode (`#09090b`) and Daylight Light Mode with a `Sync to System Theme` switch in Studio Settings that tracks OS `prefers-color-scheme`.

---

## Architecture Overview

```text
├── server.ts                        # Optional Local FFmpeg API Bridge (Express + child_process.spawn)
├── src/
│   ├── App.tsx                      # 3-Zone Studio layout & top-level view composition
│   ├── hooks/
│   │   ├── useMediaQueue.ts         # Queue state, ObjectUrlManager & stale-output invalidation
│   │   └── useMediaProcessor.ts     # Batch/single execution, cancellation & JSZip export
│   ├── services/
│   │   ├── mediaEngine.ts           # Engine selection, parameter validation & fallback orchestration
│   │   ├── imageEngine.ts           # OffscreenCanvas / Canvas2D image pipeline
│   │   ├── ffmpegEngine.ts          # Single-threaded @ffmpeg/ffmpeg WASM loader, CacheStorage & mutex
│   │   ├── nativeFallbackEngine.ts  # MediaRecorder + Web Audio API + GIF89a/WAV fallback
│   │   ├── bridgeEngine.ts          # HTTP client for Local FFmpeg API Bridge
│   │   └── sampleMedia.ts           # Synthetic calibration PNG, WAV, and WebM generator
│   ├── utils/
│   │   ├── binaryEncoders.ts        # Pure TypeScript 24-bit BMP, 16-bit PCM WAV & LZW GIF89a encoders
│   │   ├── ffmpegArgs.ts            # FFmpeg CLI argument builders
│   │   ├── mediaUtils.ts            # Formatting, dimensions, timestamps & defaults
│   │   ├── presets.ts               # Smart preset definitions
│   │   ├── themeUtils.ts            # System/manual theme resolution & localStorage persistence
│   │   └── mediaUtils.test.ts       # Node test suite (queue, URLs, encoders, engines & bridge server)
│   └── components/                  # DropZone, FileQueue, BeforeAfterViewer, InspectorPanel, TerminalLogs, SettingsModal
```

### Multi-Tier Engine Strategy

1. **Browser FFmpeg WASM (`src/services/ffmpegEngine.ts`)**:
   - Uses single-threaded `@ffmpeg/core@0.12.6` so it runs inside standard browser contexts and sandboxed `iframe` previews without requiring `SharedArrayBuffer` or `COOP`/`COEP` headers.
   - Serializes operations through an internal mutex queue to prevent concurrent virtual filesystem (`MEMFS`) collisions and cleans up virtual input/output files in `finally`.
2. **Native Browser Fallback (`src/services/nativeFallbackEngine.ts`)**:
   - If FFmpeg WASM cannot be loaded (e.g., restricted CSP or offline before first-run WASM cache setup), video and audio jobs automatically fall back to `HTMLCanvasElement` + `MediaRecorder` and `AudioContext` / `OfflineAudioContext`.
   - Explicitly notifies the user whenever a fallback produces a different container/codec (such as `16-bit PCM WAV` or `WebM`) and preserves accurate file extensions and MIME types.
3. **Pure TypeScript Binary Encoders (`src/utils/binaryEncoders.ts`)**:
   - Provides zero-dependency binary encoders with strict dimension and buffer validation for `24-bit BMP`, `16-bit PCM WAV`, and `256-color LZW GIF89a`.
4. **Optional Local Express Bridge (`server.ts` & `src/services/bridgeEngine.ts`)**:
   - Exposes `GET /health` and `POST /api/convert` on port `3001` (and proxied via Vite dev server at `/health` and `/api/convert`).
   - Invokes system `ffmpeg` via `spawn()` / `execFile()` with argument arrays (`shell: false`), strict parameter whitelisting, upload size caps, execution timeouts, client-disconnect process termination, and guaranteed temporary directory cleanup.

---

## Prerequisites & FFmpeg Installation

- **Node.js** `>= 20` (or **Bun** `>= 1.1`)
- **System FFmpeg** *(optional — only required when using the Local API Bridge mode)*:
  - **macOS**: `brew install ffmpeg`
  - **Ubuntu / Debian**: `sudo apt-get update && sudo apt-get install -y ffmpeg`
  - **Windows**: `winget install Gyan.FFmpeg`
  - **Android (Termux)**: `pkg install ffmpeg nodejs`

---

## Environment Variables

Copy `.env.example` to `.env` if you wish to customize the Local Bridge server:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3001` | Port for the Local FFmpeg API Bridge (`server.ts`). |
| `BRIDGE_API_KEY` | `""` *(disabled)* | Optional Bearer token required on `GET /health` and `POST /api/convert` when set. |
| `MAX_UPLOAD_SIZE` | `524288000` *(500 MB)* | Maximum multipart upload size in bytes accepted by `/api/convert`. |
| `FFMPEG_PATH` | `"ffmpeg"` | Path or binary name for the system FFmpeg executable. |

---

## Development, Testing & Build Instructions

Install dependencies:

```bash
npm install
```

Start the Vite frontend development server (runs on `http://localhost:3000`):

```bash
npm run dev
```

Start the optional Local FFmpeg API Bridge server (runs on `http://localhost:3001`):

```bash
npm run server
```

Run TypeScript type checking:

```bash
npm run lint
```

Run the unit and bridge integration test suite:

```bash
npm test
```

Build the production frontend bundle (`dist/`):

```bash
npm run build
```

---

## Browser Compatibility & Offline Behavior

- **Supported Browsers**: Chromium-based browsers (Chrome, Edge, Brave), Firefox, and Safari with HTML5 Canvas, `OffscreenCanvas`, Web Audio API, and WebAssembly support.
- **Offline Capabilities & Limitations**:
  - **Zero External Startup Dependencies**: All UI styles, icons, and system font stacks are bundled locally with no external Google Fonts requests.
  - **Image, WAV & GIF Processing**: Works 100% offline immediately on first load using browser Canvas, Web Audio API, and pure TypeScript encoders.
  - **FFmpeg WASM Caching**: On first video/audio conversion in Browser WASM mode, `ffmpeg-core.js` and `ffmpeg-core.wasm` (~31 MB) are resolved from `/ffmpeg/*` (if hosted locally in `public/ffmpeg/`) or CDN mirrors and persisted in browser `CacheStorage` (`mediaforge-ffmpeg-core-v0.12.6`). Subsequent sessions load the WASM core directly from browser `CacheStorage` offline. To bundle the WASM core for air-gapped first-run deployments, place `ffmpeg-core.js` and `ffmpeg-core.wasm` from `@ffmpeg/core@0.12.6/dist/esm/` into `public/ffmpeg/`.
  - **Local API Bridge**: Operates completely offline on `localhost:3001` using the host machine's native `ffmpeg` binary, independent of Browser WASM availability.
