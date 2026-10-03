import { open, SITE } from './site.mjs';
const { browser, page } = await open({ width: 1440, height: 900, dpr: 1 });
await page.goto(SITE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.evaluate(() => enterApp('craft'));
await page.waitForTimeout(2000);
const html = await page.evaluate(() => {
  const m = document.querySelector('#appMain');
  const clone = m.cloneNode(true);
  clone.querySelectorAll('[title]').forEach(e => e.removeAttribute('title'));
  return clone.outerHTML.replace(/\s+/g, ' ').slice(0, 7000);
});
console.log(html);
const tabs = await page.evaluate(() => [...document.querySelectorAll('#appShell [onclick]')].slice(0,60).map(e => e.tagName + ' ' + e.getAttribute('onclick') + ' | ' + e.innerText.trim().replace(/\s+/g,' ').slice(0,30)));
console.log(tabs.join('\n'));
await browser.close();
