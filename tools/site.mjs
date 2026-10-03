// Shared Playwright helper: serves the real site (local clone) and maps the
// Google Fonts requests to the font files saved in ./assets/fonts.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
const ROOT = '/home/user/JIGSAW';
const FONTS = path.join(ROOT, 'assets/fonts');
export const SITE = process.env.SITE || 'http://localhost:8765/';
const PASS = (process.env.PASS_HOSTS || '').split(',').filter(Boolean);

export async function open({ width = 1440, height = 900, dpr = 2, lang = 'en' } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, locale: lang === 'en' ? 'en-US' : lang });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost') return route.continue();
    if (u.hostname === 'fonts.googleapis.com') {
      let css = fs.readFileSync(path.join(FONTS, 'pixelify.css'), 'utf8');
      css = css.replace(/https:\/\/fonts\.gstatic\.com\/s\/pixelifysans\/v3\//g, 'https://fonts.gstatic.com/local/');
      return route.fulfill({ status: 200, contentType: 'text/css', body: css });
    }
    if (u.hostname === 'fonts.gstatic.com') {
      const f = path.join(FONTS, path.basename(u.pathname));
      if (fs.existsSync(f)) return route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) });
      return route.abort();
    }
    if (PASS.includes(u.hostname)) return route.continue();
    return route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}
