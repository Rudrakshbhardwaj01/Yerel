const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public', 'logo.svg');
const publicIcons = path.join(root, 'public', 'icons');
fs.mkdirSync(publicIcons, { recursive: true });

const sizes = [16, 32, 48, 180, 192, 256, 512];
Promise.all(sizes.map((size) => {
  const name = size === 180 ? 'apple-touch-icon' : size === 256 ? 'icon' : `favicon-${size}`;
  return sharp(source).resize(size, size, { fit: 'contain' }).png().toFile(path.join(publicIcons, `${name}.png`));
})).then(() => {
  console.log('Generated browser PNG icons from the canonical SVG.');
}).catch((error) => { console.error(error); process.exitCode = 1; });
