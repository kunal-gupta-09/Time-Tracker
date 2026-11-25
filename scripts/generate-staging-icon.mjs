// Yellow launcher icon for the STAGING build, so it can't be mistaken for the
// production app on the home screen.
//
// Reads the production icons in android/app/src/main/res/mipmap-*/ and writes
// recoloured copies to android/app/src/staging/res/mipmap-*/. Android's build
// merges the staging folder over main for `assembleStaging` / `installStaging`
// only — release and debug builds keep the indigo icon.
//
//   ic_launcher_background.png   adaptive-icon background → yellow gradient
//   ic_launcher.png / _round.png legacy full icons → repainted yellow
//   ic_launcher_foreground.png   unchanged (the white clock), not copied
//
// Re-run after changing the production icon:  node scripts/generate-staging-icon.mjs

import sharp from "sharp";
import { mkdir, readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const mainRes = join(root, "android/app/src/main/res");
const stagingRes = join(root, "android/app/src/staging/res");

// Yellow → amber, dark enough that the white clock stays readable.
const FROM = "#EAB308"; // Tailwind yellow-500
const TO = "#D97706"; // Tailwind amber-600

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const [F, T] = [hex(FROM), hex(TO)];

/**
 * Repaints a legacy icon: each pixel is a mix of the indigo gradient and the
 * white clock, so its lowest channel says how "white" it is (the gradient's
 * lowest channel is ≤ 0x5C, white's is 0xFF). Keep that whiteness and alpha,
 * swap the gradient for yellow. A plain hue rotation came out olive green.
 */
async function recolorLegacy(file, outFile) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const GRADIENT_MIN = 0x5c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = Math.min(1, Math.max(0, (Math.min(data[i], data[i + 1], data[i + 2]) - GRADIENT_MIN) / (255 - GRADIENT_MIN)));
      const g = (x + y) / (w + h - 2); // diagonal, like the background
      for (let c = 0; c < 3; c++) {
        const yellow = F[c] + (T[c] - F[c]) * g;
        data[i + c] = Math.round(yellow + (255 - yellow) * t);
      }
    }
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outFile);
}

const exists = (p) => access(p).then(() => true, () => false);

function gradientSvg(w, h) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${FROM}"/>
          <stop offset="100%" stop-color="${TO}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`);
}

const dirs = (await readdir(mainRes)).filter((d) => d.startsWith("mipmap-") && d !== "mipmap-anydpi-v26");
let written = 0;

for (const dir of dirs) {
  const src = join(mainRes, dir);
  const out = join(stagingRes, dir);
  await mkdir(out, { recursive: true });

  const bg = join(src, "ic_launcher_background.png");
  if (await exists(bg)) {
    const { width, height } = await sharp(bg).metadata();
    await sharp(gradientSvg(width, height)).png().toFile(join(out, "ic_launcher_background.png"));
    written++;
  }

  for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
    const file = join(src, name);
    if (!(await exists(file))) continue;
    await recolorLegacy(file, join(out, name));
    written++;
  }
}

console.log(`Wrote ${written} staging icon files to ${stagingRes}`);
