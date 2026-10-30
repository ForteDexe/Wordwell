import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Keep Chrome's required PNG assets reproducible from the vector master.
const directory = new URL('../extension/icons/', import.meta.url);
const svg = await readFile(new URL('wordwell.svg', directory), 'utf8');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    const padding = size === 128 ? 16 : 0;
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:100%;height:100%}body{box-sizing:border-box;padding:${padding}px}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`icon${size}.png`, directory)), omitBackground: true });
  }
  console.log('Wordwell icons generated: 16, 32, 48, and 128 pixels.');
} finally { await browser.close(); }
