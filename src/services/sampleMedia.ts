/**
 * Generates deterministic, local-only test media files (PNG image, WAV audio, WebM video)
 * directly in the browser using Canvas2D & Web Audio API so users can test workflows immediately.
 */

export async function generateSampleMediaFiles(): Promise<File[]> {
  const files: File[] = [];

  // 1. High-resolution gradient & geometric studio test PNG (1280x720)
  const imgCanvas = document.createElement('canvas');
  imgCanvas.width = 1280;
  imgCanvas.height = 720;
  const ctx = imgCanvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, '#09090b');
    grad.addColorStop(0.5, '#0e7490');
    grad.addColorStop(1, '#065f46');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    // Add fine detail texture & geometry to make compression ratios meaningful
    for (let i = 0; i < 420; i++) {
      const x = (i * 97) % 1280;
      const y = (i * 53) % 720;
      const r = 10 + (i % 60);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(34, 211, 238, 0.14)' : 'rgba(16, 185, 129, 0.12)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(48, 48, 1184, 624);

    ctx.fillStyle = '#f4f4f5';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText('MEDIAFORGE CALIBRATION FRAME', 88, 130);
    ctx.font = '24px monospace';
    ctx.fillStyle = '#a5f3fc';
    ctx.fillText('1280x720 · sRGB · Synthetic Reference Target', 88, 175);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      imgCanvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (pngBlob) {
      files.push(new File([pngBlob], 'studio_calibration_frame.png', { type: 'image/png' }));
    }
  }

  // 2. Synthesized Stereo Harmonic WAV (2.5 seconds, 44.1kHz)
  const sampleRate = 44100;
  const durationSec = 2.5;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new ArrayBuffer(44 + numSamples * 4);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 4, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.sin((Math.PI * t) / durationSec);
    const left = Math.sin(2 * Math.PI * 220 * t) * 0.4 * env + Math.sin(2 * Math.PI * 440 * t) * 0.2 * env;
    const right = Math.sin(2 * Math.PI * 330 * t) * 0.4 * env + Math.sin(2 * Math.PI * 554.37 * t) * 0.2 * env;
    view.setInt16(offset, Math.round(left * 0x7fff), true);
    view.setInt16(offset + 2, Math.round(right * 0x7fff), true);
    offset += 4;
  }
  files.push(new File([buffer], 'ambient_synth_chord.wav', { type: 'audio/wav' }));

  // 3. Short animated Canvas WebM video (1.2 seconds) if MediaRecorder is available
  if (typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
    try {
      const vidCanvas = document.createElement('canvas');
      vidCanvas.width = 640;
      vidCanvas.height = 360;
      const vctx = vidCanvas.getContext('2d');
      const mime = ['video/webm;codecs=vp8', 'video/webm'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      if (vctx && mime) {
        const stream = vidCanvas.captureStream(24);
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        const finished = new Promise<Blob>((resolve) => {
          rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        });
        rec.start();
        for (let f = 0; f < 24; f++) {
          vctx.fillStyle = '#09090b';
          vctx.fillRect(0, 0, 640, 360);
          vctx.fillStyle = '#22d3ee';
          vctx.beginPath();
          vctx.arc(100 + f * 18, 180 + Math.sin(f * 0.4) * 50, 36, 0, Math.PI * 2);
          vctx.fill();
          vctx.fillStyle = '#e4e4e7';
          vctx.font = '20px monospace';
          vctx.fillText(`FRAME ${String(f + 1).padStart(2, '0')} / 24`, 28, 44);
          await new Promise((r) => setTimeout(r, 40));
        }
        rec.stop();
        const webmBlob = await finished;
        if (webmBlob.size > 0) {
          files.push(new File([webmBlob], 'motion_test_clip.webm', { type: 'video/webm' }));
        }
      }
    } catch {
      // Skip video sample if headless environment restricts MediaRecorder
    }
  }

  return files;
}
