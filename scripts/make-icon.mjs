import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "media/codetrail.svg");
const target = resolve(root, "images/icon.png");

await mkdir(resolve(root, "images"), { recursive: true });
await sharp(source, { density: 288 })
  .resize(256, 256, { fit: "cover" })
  .png({ compressionLevel: 9, palette: false })
  .toFile(target);

const meta = await sharp(target).metadata();
console.log(`icon: ${target} (${meta.width}x${meta.height})`);
