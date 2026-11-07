// Generates the app icons in public/icons from an inline SVG. Run: npx tsx scripts/make-icons.ts
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const svg = (size: number, pad: number, rounded: boolean) => {
  const inner = size - pad * 2;
  const r = rounded ? size * 0.22 : 0;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#861041"/>
  <g transform="translate(${pad} ${pad})">
    <text x="${inner / 2}" y="${inner * 0.62}" text-anchor="middle"
      font-family="DejaVu Serif, Georgia, serif" font-weight="700" font-size="${inner * 0.5}" fill="#ffffff">Ife</text>
    <rect x="${inner * 0.24}" y="${inner * 0.72}" width="${inner * 0.52}" height="${inner * 0.045}" rx="${inner * 0.02}" fill="#f2cf7a"/>
  </g>
</svg>`);
};

async function main() {
  mkdirSync("public/icons", { recursive: true });
  await sharp(svg(192, 16, true)).png().toFile("public/icons/icon-192.png");
  await sharp(svg(512, 40, true)).png().toFile("public/icons/icon-512.png");
  // Maskable icons need their content inside the central "safe zone", and a full-bleed background.
  await sharp(svg(512, 110, false)).png().toFile("public/icons/maskable-512.png");
  await sharp(svg(180, 14, false)).png().toFile("public/icons/apple-touch-icon.png");
  console.log("icons written to public/icons");
}
main();
