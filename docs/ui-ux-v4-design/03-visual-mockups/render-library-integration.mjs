import { chromium } from "../../../FE/node_modules/playwright/index.mjs";
import path from "node:path";import{fileURLToPath,pathToFileURL}from"node:url";
const here=path.dirname(fileURLToPath(import.meta.url));const url=pathToFileURL(path.join(here,"library-integration.html")).href;const out=path.join(here,"screenshots");
const cases=[...["light","dark"].flatMap(t=>[[t,1440,900],[t,820,1180],[t,390,844]]),["light",320,844]];
const browser=await chromium.launch({headless:true});for(const[t,w,h]of cases){const page=await browser.newPage({viewport:{width:w,height:h}});await page.goto(`${url}?theme=${t}`);await page.screenshot({path:path.join(out,`library-integration-${w}x${h}-${t}${w===320?"-stress":""}.png`)});await page.close()}await browser.close();console.log(`Rendered ${cases.length} Library integration states.`);
