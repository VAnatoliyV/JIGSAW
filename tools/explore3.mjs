import { open, SITE } from './site.mjs';
const OUT = '/home/user/JIGSAW/assets/screens/explore';
const { browser, page } = await open({ width: 1440, height: 900, dpr: 1 });
await page.goto(SITE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
for (const s of ['craft','isl','calc','item','roads']) {
  await page.evaluate(s => enterApp(s), s);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/sec_${s}.png` });
  const t = await page.evaluate(() => document.querySelector('#appMain')?.innerText.slice(0,800));
  console.log('=== '+s+'\n'+t);
}
await browser.close();
