import { open, SITE } from './site.mjs';
const OUT = '/home/user/JIGSAW/assets/screens/explore';
for (const [w,h,name] of [[430,932,'mobile'],[900,900,'square']]) {
  const { browser, page } = await open({ width: w, height: h, dpr: 1 });
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/home_${name}_full.png`, fullPage: true });
  await page.evaluate(() => enterApp('craft'));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/craft_${name}.png` });
  await browser.close();
}
