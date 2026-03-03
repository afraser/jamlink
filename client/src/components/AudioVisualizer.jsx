/**
 * AudioVisualizer
 *
 * Renders a real-time waveform of the provided MediaStream using
 * the Web Audio API AnalyserNode + a <canvas> element.
 *
 * Stereo streams are split via ChannelSplitterNode and drawn as two
 * overlaid waveforms — purple (left) and green (right).
 * Mono streams fall back to a single waveform using the `color` prop.
 *
 * Props:
 *   stream  — MediaStream  (required)
 *   color   — CSS color string, used for mono fallback (default: accent purple)
 *   height  — canvas height in px (default: 72)
 *   stereo  — boolean | null; explicit override (null = auto-detect from channelCount)
 */

import { useEffect, useRef } from "react";

const LEFT_COLOR = "#9d97ff"; // purple — left channel
const RIGHT_COLOR = "#34d399"; // green  — right channel

function makeAnalyser(audioCtx) {
  const a = audioCtx.createAnalyser();
  a.fftSize = 1024;
  a.smoothingTimeConstant = 0.8;
  return a;
}

export default function AudioVisualizer({
  stream,
  color = "#9d97ff",
  height = 72,
  stereo: stereoProp = null,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!stream) return;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const stereo = stereoProp !== null ? stereoProp : source.channelCount >= 2;

    let analyserL, analyserR;
    if (stereo) {
      const splitter = audioCtx.createChannelSplitter(2);
      source.connect(splitter);
      analyserL = makeAnalyser(audioCtx);
      analyserR = makeAnalyser(audioCtx);
      splitter.connect(analyserL, 0); // left  → analyserL
      splitter.connect(analyserR, 1); // right → analyserR
    } else {
      analyserL = makeAnalyser(audioCtx);
      source.connect(analyserL);
    }

    ctxRef.current = audioCtx;

    const canvas = canvasRef.current;
    const ctx2d = canvas.getContext("2d");
    const bufLen = analyserL.frequencyBinCount;
    const dataL = new Float32Array(bufLen);
    const dataR = stereo ? new Float32Array(bufLen) : null;

    function drawChannel(data, waveColor, yOffset) {
      const { width, height: h } = canvas;
      const sliceWidth = width / bufLen;

      // Waveform line
      ctx2d.beginPath();
      ctx2d.lineWidth = stereo ? 1.5 : 2;
      ctx2d.strokeStyle = waveColor;
      ctx2d.shadowBlur = 8;
      ctx2d.shadowColor = waveColor;

      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const y = (data[i] + 1) * yOffset * h;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
        x += sliceWidth;
      }
      ctx2d.lineTo(width, h / 2);
      ctx2d.stroke();

      // Glow fill underneath
      ctx2d.shadowBlur = 0;
      ctx2d.beginPath();
      x = 0;
      for (let i = 0; i < bufLen; i++) {
        const y = ((data[i] + 1) / 2) * h;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
        x += sliceWidth;
      }
      ctx2d.lineTo(width, h / 2);
      ctx2d.lineTo(0, h / 2);
      ctx2d.closePath();
      ctx2d.fillStyle = `${waveColor}22`;
      ctx2d.fill();
    }

    function draw() {
      rafRef.current = requestAnimationFrame(draw);

      analyserL.getFloatTimeDomainData(dataL);
      if (dataR) analyserR.getFloatTimeDomainData(dataR);

      const { width, height: h } = canvas;
      ctx2d.clearRect(0, 0, width, h);

      // Centre line
      ctx2d.strokeStyle = "rgba(255,255,255,0.05)";
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, h / 2);
      ctx2d.lineTo(width, h / 2);
      ctx2d.stroke();

      if (stereo) {
        drawChannel(dataL, LEFT_COLOR, 0.333);
        drawChannel(dataR, RIGHT_COLOR, 0.666);

        // Subtle L / R labels
        ctx2d.shadowBlur = 0;
        ctx2d.font = "500 10px monospace";
        ctx2d.fillStyle = LEFT_COLOR + "99";
        ctx2d.fillText("L", 6, 13);
        ctx2d.fillStyle = RIGHT_COLOR + "99";
        ctx2d.fillText("R", 18, 13);
      } else {
        drawChannel(dataL, color, 0.5);
      }
    }

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      audioCtx.close();
    };
  }, [stream, color, stereoProp]);

  return (
    <canvas
      ref={canvasRef}
      width={512}
      height={height}
      style={{
        width: "100%",
        height: `${height}px`,
        borderRadius: "8px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        display: "block",
      }}
    />
  );
}
