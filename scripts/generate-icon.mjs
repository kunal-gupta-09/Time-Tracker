// Renders the TimeSheet app icon as PNGs that @capacitor/assets consumes.
// Three outputs, each 1024×1024:
//   assets/icon-only.png         — full-bleed icon (used for legacy/iOS)
//   assets/icon-foreground.png   — adaptive icon FG (centered, safe-zone)
//   assets/icon-background.png   — adaptive icon BG (the gradient only)

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const outDir = resolve(__dirname, "..", "assets");
await mkdir(outDir, { recursive: true });

const SIZE = 1024;

// --- Shared visual elements -------------------------------------------------
// Indigo → violet gradient (matches Tailwind indigo-600 → violet-500)
const gradient = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#8B5CF6"/>
    </linearGradient>
    <linearGradient id="bg-soft" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366F1"/>
      <stop offset="100%" stop-color="#A78BFA"/>
    </linearGradient>
  </defs>
`;

// Centered clock mark used in both icon-only and adaptive foreground.
// Drawn within a "safe zone" of ~640px (≈62% of canvas) so it survives
// adaptive masking on Android.
function clockMark(centerX, centerY, radius, strokeWidth) {
  // Hands at 10:10 (classic watch-display pose).
  // Hour hand → 10 o'clock = 300° (i.e. -60° from 12); short.
  // Minute hand → 2 o'clock = 60°; longer.
  const hourLen = radius * 0.45;
  const minuteLen = radius * 0.65;

  const hourEnd = {
    x: centerX + hourLen * Math.cos((-60 - 90) * (Math.PI / 180)),
    y: centerY + hourLen * Math.sin((-60 - 90) * (Math.PI / 180)),
  };
  const minuteEnd = {
    x: centerX + minuteLen * Math.cos((60 - 90) * (Math.PI / 180)),
    y: centerY + minuteLen * Math.sin((60 - 90) * (Math.PI / 180)),
  };

  return `
    <!-- Clock face -->
    <circle cx="${centerX}" cy="${centerY}" r="${radius}"
            fill="none" stroke="#FFFFFF" stroke-width="${strokeWidth}"/>

    <!-- 12 / 3 / 6 / 9 ticks -->
    ${[-90, 0, 90, 180]
      .map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = centerX + (radius - strokeWidth * 0.6) * Math.cos(rad);
        const y1 = centerY + (radius - strokeWidth * 0.6) * Math.sin(rad);
        const x2 = centerX + (radius - strokeWidth * 2.2) * Math.cos(rad);
        const y2 = centerY + (radius - strokeWidth * 2.2) * Math.sin(rad);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                       stroke="#FFFFFF" stroke-width="${strokeWidth * 0.85}"
                       stroke-linecap="round"/>`;
      })
      .join("")}

    <!-- Hands -->
    <line x1="${centerX}" y1="${centerY}" x2="${hourEnd.x}" y2="${hourEnd.y}"
          stroke="#FFFFFF" stroke-width="${strokeWidth * 1.15}"
          stroke-linecap="round"/>
    <line x1="${centerX}" y1="${centerY}" x2="${minuteEnd.x}" y2="${minuteEnd.y}"
          stroke="#FFFFFF" stroke-width="${strokeWidth * 0.95}"
          stroke-linecap="round"/>

    <!-- Center pin -->
    <circle cx="${centerX}" cy="${centerY}" r="${strokeWidth * 0.9}"
            fill="#FFFFFF"/>
  `;
}

// --- 1) icon-only (full-bleed; used for legacy iOS / fallback) -------------
const iconOnlySvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  ${gradient}
  <rect width="${SIZE}" height="${SIZE}" rx="220" fill="url(#bg)"/>
  ${clockMark(SIZE / 2, SIZE / 2, 320, 38)}
</svg>`;

// --- 2) icon-foreground (adaptive; safe inner content, transparent bg) -----
// Adaptive icons are masked; content must live in the inner ~66% of canvas.
const iconForegroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  ${clockMark(SIZE / 2, SIZE / 2, 240, 32)}
</svg>`;

// --- 3) icon-background (adaptive; the gradient only) ----------------------
const iconBackgroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  ${gradient}
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg-soft)"/>
</svg>`;

async function render(svg, fileName, transparent = false) {
  const out = resolve(outDir, fileName);
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(SIZE, SIZE, {
      fit: "contain",
      background: transparent
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : { r: 79, g: 70, b: 229, alpha: 1 },
    })
    .png()
    .toFile(out);
  console.log(`✓ wrote ${fileName}`);
}

await render(iconOnlySvg, "icon-only.png");
await render(iconForegroundSvg, "icon-foreground.png", true);
await render(iconBackgroundSvg, "icon-background.png");

console.log("\nIcon source PNGs ready in assets/.");