import sharp from "sharp";

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_GAP = 1;
const SPACE_WIDTH = 3;

const GLYPHS: Record<string, readonly string[]> = {
  "0": ["11111", "10001", "10011", "10101", "11001", "10001", "11111"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["11110", "00001", "00001", "11110", "10000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01111", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "11110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "?": ["11110", "00001", "00010", "00100", "00100", "00000", "00100"],
};

function glyphKey(character: string) {
  if (character === " ") return " ";
  const upper = character.toUpperCase();
  return GLYPHS[upper] ? upper : "?";
}

function glyphColumnWidth(character: string) {
  return character === " " ? SPACE_WIDTH : GLYPH_WIDTH;
}

function measureGlyphColumns(value: string) {
  let columns = 0;
  for (const character of value) {
    columns += glyphColumnWidth(glyphKey(character)) + GLYPH_GAP;
  }
  return Math.max(0, columns - GLYPH_GAP);
}

function fitGlyphHeight(value: string, requestedHeight: number, maxWidth: number) {
  const columns = measureGlyphColumns(value);
  if (columns === 0) return requestedHeight;
  const requestedCellSize = requestedHeight / GLYPH_HEIGHT;
  const requestedWidth = columns * requestedCellSize;
  if (requestedWidth <= maxWidth) return requestedHeight;
  return Math.max(1, Math.floor((maxWidth / columns) * GLYPH_HEIGHT));
}

function svgNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function buildGlyphPath(value: string, x: number, y: number, glyphHeight: number) {
  const cellSize = glyphHeight / GLYPH_HEIGHT;
  let cursorX = x;
  const commands: string[] = [];

  for (const character of value) {
    const key = glyphKey(character);
    if (key !== " ") {
      const rows = GLYPHS[key] ?? GLYPHS["?"];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
          if (row[columnIndex] !== "1") continue;
          const pixelX = cursorX + columnIndex * cellSize;
          const pixelY = y + rowIndex * cellSize;
          commands.push(
            `M${svgNumber(pixelX)} ${svgNumber(pixelY)}h${svgNumber(cellSize)}v${svgNumber(cellSize)}h-${svgNumber(
              cellSize,
            )}z`,
          );
        }
      }
    }
    cursorX += (glyphColumnWidth(key) + GLYPH_GAP) * cellSize;
  }

  return commands.join("");
}

export function buildConfidentialImageWatermarkText(params: {
  timestamp: Date;
  viewToken: string;
  walletAddress: string;
}) {
  const viewer = `${params.walletAddress.slice(0, 6)}...${params.walletAddress.slice(-4)}`.toUpperCase();
  const timestamp = params.timestamp.toISOString();
  const viewCode = params.viewToken.slice(0, 12).toUpperCase();

  return {
    label: `PRIVATE VIEW ${viewer} ${timestamp}`,
    token: `ACCESS LOGGED VIEW ${viewCode}`,
  };
}

export function buildConfidentialImageWatermarkOverlaySvg(params: {
  imageHeight: number;
  imageWidth: number;
  timestamp: Date;
  viewToken: string;
  walletAddress: string;
}) {
  const overlayWidth = Math.min(1200, Math.max(1, params.imageWidth));
  const overlayHeight = Math.min(160, Math.max(1, params.imageHeight));
  const paddingX = Math.max(1, Math.floor(overlayWidth * 0.03));
  const maxTextWidth = Math.max(1, overlayWidth - paddingX * 2);
  const { label, token } = buildConfidentialImageWatermarkText(params);
  const labelGlyphHeight = fitGlyphHeight(
    label,
    Math.max(1, Math.min(34, Math.floor(overlayHeight * 0.28))),
    maxTextWidth,
  );
  const tokenGlyphHeight = fitGlyphHeight(
    token,
    Math.max(1, Math.min(28, Math.floor(overlayHeight * 0.22))),
    maxTextWidth,
  );
  const lineGap = Math.max(1, Math.floor(overlayHeight * 0.08));
  const totalTextHeight = labelGlyphHeight + lineGap + tokenGlyphHeight;
  const labelY = Math.max(1, Math.floor((overlayHeight - totalTextHeight) / 2));
  const tokenY = Math.min(overlayHeight - tokenGlyphHeight, labelY + labelGlyphHeight + lineGap);
  const labelPath = buildGlyphPath(label, paddingX, labelY, labelGlyphHeight);
  const tokenPath = buildGlyphPath(token, paddingX, Math.max(1, tokenY), tokenGlyphHeight);

  return Buffer.from(`
    <svg width="${overlayWidth}" height="${overlayHeight}" viewBox="0 0 ${overlayWidth} ${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${overlayWidth}" height="${overlayHeight}" fill="rgba(0,0,0,0.42)"/>
      <path d="${labelPath}" fill="rgba(255,255,255,0.92)"/>
      <path d="${tokenPath}" fill="rgba(255,255,255,0.76)"/>
    </svg>
  `);
}

export async function watermarkConfidentialImage(
  buffer: Buffer,
  params: { timestamp: Date; viewToken: string; walletAddress: string },
) {
  const metadata = await sharp(buffer).metadata();
  const imageWidth = Math.max(1, metadata.width ?? 1200);
  const imageHeight = Math.max(1, metadata.height ?? 160);
  const overlay = buildConfidentialImageWatermarkOverlaySvg({
    imageHeight,
    imageWidth,
    timestamp: params.timestamp,
    viewToken: params.viewToken,
    walletAddress: params.walletAddress,
  });

  return sharp(buffer)
    .composite([{ input: overlay, gravity: "southeast" }])
    .webp({ quality: 86 })
    .toBuffer();
}
