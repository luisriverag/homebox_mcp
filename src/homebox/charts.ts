import sharp from "sharp";
import type { SpendBucket } from "./spendReport.js";

const WIDTH = 900;
const HEIGHT = 500;
const MARGIN = { top: 50, right: 30, bottom: 110, left: 90 };

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function truncateLabel(label: string): string {
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

/** A hand-rolled SVG bar chart -- no charting library or native canvas dependency required. */
export function renderBarChartSvg(title: string, buckets: SpendBucket[]): string {
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const gap = 8;
  const barWidth = buckets.length > 0 ? Math.max(4, plotWidth / buckets.length - gap) : plotWidth;

  const bars = buckets
    .map((bucket, index) => {
      const barHeight = (bucket.total / maxValue) * plotHeight;
      const x = MARGIN.left + index * (barWidth + gap);
      const y = MARGIN.top + (plotHeight - barHeight);
      const labelX = x + barWidth / 2;
      const labelY = MARGIN.top + plotHeight + 16;
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="#3b82f6" />
        <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="12" text-anchor="end" transform="rotate(-40 ${labelX.toFixed(1)} ${labelY.toFixed(1)})" fill="#1f2937">${escapeXml(truncateLabel(bucket.label))}</text>
        <text x="${labelX.toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="11" text-anchor="middle" fill="#1f2937">${formatMoney(bucket.total)}</text>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
    <text x="${WIDTH / 2}" y="28" font-size="18" text-anchor="middle" font-family="sans-serif" fill="#111827">${escapeXml(title)}</text>
    <line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + plotHeight}" stroke="#9ca3af" />
    <line x1="${MARGIN.left}" y1="${MARGIN.top + plotHeight}" x2="${WIDTH - MARGIN.right}" y2="${MARGIN.top + plotHeight}" stroke="#9ca3af" />
    <g font-family="sans-serif">${bars}</g>
  </svg>`;
}

/** A hand-rolled SVG line chart, used for spend-over-time (chronological buckets). */
export function renderLineChartSvg(title: string, buckets: SpendBucket[]): string {
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const stepX = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;

  const points = buckets.map((bucket, index) => ({
    x: MARGIN.left + index * stepX,
    y: MARGIN.top + (plotHeight - (bucket.total / maxValue) * plotHeight),
    bucket,
  }));

  const pathD = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const labelY = MARGIN.top + plotHeight + 16;
  const dots = points
    .map(
      (point) => `
        <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3" fill="#3b82f6" />
        <text x="${point.x.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="11" text-anchor="end" transform="rotate(-40 ${point.x.toFixed(1)} ${labelY.toFixed(1)})" fill="#1f2937">${escapeXml(point.bucket.label)}</text>
      `,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
    <text x="${WIDTH / 2}" y="28" font-size="18" text-anchor="middle" font-family="sans-serif" fill="#111827">${escapeXml(title)}</text>
    <line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + plotHeight}" stroke="#9ca3af" />
    <line x1="${MARGIN.left}" y1="${MARGIN.top + plotHeight}" x2="${WIDTH - MARGIN.right}" y2="${MARGIN.top + plotHeight}" stroke="#9ca3af" />
    <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2" />
    <g font-family="sans-serif">${dots}</g>
  </svg>`;
}

export async function svgToPngBuffer(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}
