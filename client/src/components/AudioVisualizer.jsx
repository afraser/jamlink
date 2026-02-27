/**
 * AudioVisualizer
 *
 * Renders a real-time waveform of the provided MediaStream using
 * the Web Audio API AnalyserNode + a <canvas> element.
 *
 * Props:
 *   stream  — MediaStream  (required)
 *   color   — CSS color string (optional, defaults to accent purple)
 *   height  — canvas height in px (optional, defaults to 72)
 */

import { useEffect, useRef } from 'react';

export default function AudioVisualizer({ stream, color = '#9d97ff', height = 72 }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const ctxRef    = useRef(null);     // AudioContext
  const analyserRef = useRef(null);

  useEffect(() => {
    if (!stream) return;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    // NOTE: we intentionally do NOT connect to audioCtx.destination here —
    // the HostView stream is already being sent over WebRTC and the
    // PeerView already routes through its own AudioContext.

    ctxRef.current = audioCtx;
    analyserRef.current = analyser;

    const canvas = canvasRef.current;
    const ctx2d  = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray    = new Float32Array(bufferLength);

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getFloatTimeDomainData(dataArray);

      const { width, height: h } = canvas;
      ctx2d.clearRect(0, 0, width, h);

      // Background
      ctx2d.fillStyle = 'rgba(21, 24, 32, 0.0)';
      ctx2d.fillRect(0, 0, width, h);

      // Centre line
      ctx2d.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, h / 2);
      ctx2d.lineTo(width, h / 2);
      ctx2d.stroke();

      // Waveform
      ctx2d.beginPath();
      ctx2d.lineWidth = 2;
      ctx2d.strokeStyle = color;
      ctx2d.shadowBlur = 8;
      ctx2d.shadowColor = color;

      const sliceWidth = width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i];
        const y = (v + 1) / 2 * h;  // map [-1,1] → [h,0]
        if (i === 0) ctx2d.moveTo(x, y);
        else         ctx2d.lineTo(x, y);
        x += sliceWidth;
      }

      ctx2d.lineTo(width, h / 2);
      ctx2d.stroke();

      // Glow fill underneath the waveform
      ctx2d.shadowBlur = 0;
      ctx2d.beginPath();
      x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i];
        const y = (v + 1) / 2 * h;
        if (i === 0) ctx2d.moveTo(x, y);
        else         ctx2d.lineTo(x, y);
        x += sliceWidth;
      }
      ctx2d.lineTo(width, h / 2);
      ctx2d.lineTo(0, h / 2);
      ctx2d.closePath();
      ctx2d.fillStyle = `${color}22`;
      ctx2d.fill();
    }

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      audioCtx.close();
    };
  }, [stream, color]);

  return (
    <canvas
      ref={canvasRef}
      width={512}
      height={height}
      style={{
        width: '100%',
        height: `${height}px`,
        borderRadius: '8px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        display: 'block',
      }}
    />
  );
}
