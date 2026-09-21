import { histogramPosition } from '../color/analyze';

const TICKS = [1, 10, 100, 1000, 10000];
const BAR_COLOR = '#9aa0ab';
const TICK_COLOR = '#2e3138';
const LABEL_COLOR = '#9aa0ab';
const LABEL_HEIGHT = 14;

export interface HistogramMarker {
  nits: number;
  color: string;
}

/** Draws a log-luminance histogram with decade ticks and markers such as SDR white and the peak. */
export function drawHistogram(
  canvas: HTMLCanvasElement,
  bins: Uint32Array,
  markers: HistogramMarker[],
) {
  const scale = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  const plotHeight = height - LABEL_HEIGHT;

  context.font = '10px system-ui, sans-serif';
  context.textAlign = 'center';
  for (const nits of TICKS) {
    const x = histogramPosition(nits) * width;
    context.fillStyle = TICK_COLOR;
    context.fillRect(Math.round(x), 0, 1, plotHeight);
    context.fillStyle = LABEL_COLOR;
    context.fillText(
      nits >= 1000 ? `${nits / 1000}k` : String(nits),
      Math.min(Math.max(x, 8), width - 10),
      height - 3,
    );
  }

  // the first bin collects everything below the axis (usually black) and would flatten the rest
  let max = 1;
  for (let i = 1; i < bins.length; i++) max = Math.max(max, bins[i]);
  const barWidth = width / bins.length;
  context.fillStyle = BAR_COLOR;
  bins.forEach((count, i) => {
    // square root scale keeps small highlight populations visible
    const barHeight = Math.min(Math.sqrt(count / max), 1) * plotHeight;
    context.fillRect(i * barWidth, plotHeight - barHeight, Math.ceil(barWidth), barHeight);
  });

  for (const marker of markers) {
    context.fillStyle = marker.color;
    context.fillRect(Math.round(histogramPosition(marker.nits) * width), 0, 1.5, plotHeight);
  }
}
