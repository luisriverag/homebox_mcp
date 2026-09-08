import QRCode from "qrcode";
import { PDFDocument, PDFFont, PDFPage, PageSizes, StandardFonts, rgb } from "pdf-lib";
import { config } from "../config.js";
import { homebox } from "./client.js";
import type { EntityOut } from "./entityMerge.js";

/** PDF points per millimeter (PDF space is 72 points per inch). */
const MM = 72 / 25.4;

const MARGIN_LEFT_MM = 6;
const MARGIN_RIGHT_MM = 6;
const MARGIN_TOP_MM = 12;
const MARGIN_BOTTOM_MM = 12;
const GAP_MM = 2;
const LABEL_HEIGHT_MM = 42;

export interface LabelEntry {
  /** The URL the QR code encodes -- normally a Homebox item/location page. */
  url: string;
  /** Text printed under the QR code. */
  caption: string;
  /** Which small glyph (if any) is drawn next to the caption. */
  kind: "item" | "location" | "url";
}

/**
 * Resolve item/location IDs to label entries by fetching each entity's name
 * and building its web-UI URL. Items and locations are both "entities" in
 * Homebox's API -- entityType.isLocation is what distinguishes them and
 * picks the URL route.
 */
export async function resolveEntityLabelEntries(ids: string[]): Promise<LabelEntry[]> {
  const entries: LabelEntry[] = [];
  for (const id of ids) {
    const entity = await homebox.get<EntityOut>(`/v1/entities/${id}`);
    const isLocation = Boolean(entity.entityType?.isLocation);
    entries.push({
      url: `${config.homebox.webUrl}/${isLocation ? "location" : "item"}/${id}`,
      caption: entity.name?.trim() || id,
      kind: isLocation ? "location" : "item",
    });
  }
  return entries;
}

/** Build label entries directly from caller-supplied URLs (e.g. a hand-picked list), inferring kind from the path. */
export function urlLabelEntries(urls: string[]): LabelEntry[] {
  return urls
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((url) => ({
      url,
      caption: url,
      kind: url.includes("/location/") ? "location" : url.includes("/item/") ? "item" : "url",
    }));
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && font.widthOfTextAtSize(`${truncated}…`, size) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/** A small shape distinguishing an item label from a location label at a glance -- no icon image assets required. */
function drawKindGlyph(page: PDFPage, kind: LabelEntry["kind"], centerX: number, centerY: number, size: number): void {
  if (kind === "location") {
    page.drawRectangle({
      x: centerX - size / 2,
      y: centerY - size / 2,
      width: size,
      height: size,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      color: rgb(1, 1, 1),
    });
  } else if (kind === "item") {
    page.drawCircle({
      x: centerX,
      y: centerY,
      size: size / 2,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      color: rgb(1, 1, 1),
    });
  }
}

export interface GenerateLabelSheetOptions {
  /** Labels per row on the A4 page. Default 5. */
  cols?: number;
  /** Extra text appended to every caption (e.g. a household/account name). */
  brandingText?: string;
}

/**
 * Render a printable A4 sheet of QR-code labels, one per entry, in a grid
 * with as many rows as fit the page. Each label shows the QR code, a small
 * glyph identifying an item vs. a location, and a caption.
 */
export async function generateLabelSheetPdf(
  entries: LabelEntry[],
  options: GenerateLabelSheetOptions = {},
): Promise<Uint8Array> {
  if (entries.length === 0) {
    throw new Error("No label entries to render -- resolve at least one item, location, or URL first.");
  }

  const cols = Math.max(1, Math.min(10, Math.trunc(options.cols ?? 5)));
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const [pageWidth, pageHeight] = PageSizes.A4;
  const marginLeft = MARGIN_LEFT_MM * MM;
  const marginRight = MARGIN_RIGHT_MM * MM;
  const marginTop = MARGIN_TOP_MM * MM;
  const marginBottom = MARGIN_BOTTOM_MM * MM;
  const gap = GAP_MM * MM;
  const labelHeight = LABEL_HEIGHT_MM * MM;
  const labelWidth = (pageWidth - marginLeft - marginRight - (cols - 1) * gap) / cols;
  const rows = Math.max(1, Math.floor((pageHeight - marginTop - marginBottom + gap) / (labelHeight + gap)));
  const perPage = cols * rows;

  let page = pdfDoc.addPage(PageSizes.A4);
  const qrImageCache = new Map<string, Awaited<ReturnType<typeof pdfDoc.embedPng>>>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const indexOnPage = i % perPage;
    if (i > 0 && indexOnPage === 0) {
      page = pdfDoc.addPage(PageSizes.A4);
    }
    const row = Math.floor(indexOnPage / cols);
    const col = indexOnPage % cols;
    const x = marginLeft + col * (labelWidth + gap);
    const y = pageHeight - marginTop - (row + 1) * labelHeight - row * gap;

    let qrImage = qrImageCache.get(entry.url);
    if (!qrImage) {
      const qrPngBytes = await QRCode.toBuffer(entry.url, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 400,
      });
      qrImage = await pdfDoc.embedPng(qrPngBytes);
      qrImageCache.set(entry.url, qrImage);
    }

    const padding = 3 * MM;
    const glyphSize = 3.4 * MM;
    const textHeight = 4 * MM;
    const gapBelowQr = 1.5 * MM;
    const qrSide = Math.min(labelHeight - 2 * padding - textHeight - gapBelowQr, labelWidth - 2 * padding);
    const layoutHeight = qrSide + gapBelowQr + textHeight;
    const baseY = y + (labelHeight - layoutHeight) / 2;

    page.drawImage(qrImage, {
      x: x + (labelWidth - qrSide) / 2,
      y: baseY + textHeight + gapBelowQr,
      width: qrSide,
      height: qrSide,
    });

    const captionText = [entry.caption, options.brandingText]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join(" · ");
    const fontSize = 7;
    const hasGlyph = entry.kind !== "url";
    const glyphAllowance = hasGlyph ? glyphSize + 2 : 0;
    const maxTextWidth = labelWidth - 2 * padding - glyphAllowance;
    const truncated = truncateToWidth(captionText, font, fontSize, maxTextWidth);
    const textWidth = font.widthOfTextAtSize(truncated, fontSize);
    const totalWidth = glyphAllowance + textWidth;
    const startX = x + (labelWidth - totalWidth) / 2;
    const baselineY = baseY + 1.6 * MM;

    if (hasGlyph) {
      drawKindGlyph(page, entry.kind, startX + glyphSize / 2, baselineY + glyphSize * 0.15, glyphSize);
    }
    page.drawText(truncated, {
      x: startX + glyphAllowance,
      y: baselineY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return pdfDoc.save();
}
