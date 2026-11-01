// Read-only unauthenticated probe of production pages. No login, no form submit.
import { chromium } from "playwright";

const urls = ["https://studymap.space/", "https://studymap.space/app", "https://studymap.space/login"];
const browser = await chromium.launch();
const out = [];
for (const url of urls) {
  for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport: vp });
    const consoleErrors = [], failed = [], insecure = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 300)));
    page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
    page.on("request", (r) => { if (r.url().startsWith("http://")) insecure.push(r.url()); });
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    out.push({
      url, viewport: `${vp.width}x${vp.height}`, status: resp?.status(), finalUrl: page.url(),
      title: await page.title(),
      overflowX: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      consoleErrors, failed, insecure,
    });
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify({ at: new Date().toISOString(), results: out }, null, 2));
