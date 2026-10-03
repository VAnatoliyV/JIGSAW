import { open, SITE } from './site.mjs';
const { browser, page } = await open({ width: 1440, height: 900, dpr: 1 });
await page.goto(SITE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const html = await page.evaluate(() => {
  const m = document.querySelector('#home');
  const c = m.cloneNode(true);
  c.querySelectorAll('[title]').forEach(e => e.removeAttribute('title'));
  c.querySelector('#drift')?.remove(); c.querySelectorAll('.card span.proOnly, .card span.liteOnly').forEach(e => e.textContent = '…');
  return c.outerHTML.replace(/\s+/g, ' ').slice(0, 6000);
});
console.log(html);
console.log(await page.evaluate(() => typeof liveOkAt + ' ' + typeof paintHeroStats + ' ' + typeof setSkin + ' ' + typeof setUI));
await browser.close();
