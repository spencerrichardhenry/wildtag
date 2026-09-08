import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const output = '.codex-drafts/game-hub/assets';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
try {
 for(const [name,url] of [
  ['tiny-tide','http://127.0.0.1:5207/wildtag/tiny-tide.html?qa'],
  ['royal-yeet','http://127.0.0.1:5207/wildtag/royal-yeet.html?seed=42'],
  ['dungeon-run','https://spencerrichardhenry.github.io/mobatest/'],
  ['wildtag','https://spencerrichardhenry.github.io/wildtag/'],
 ]) {
  const page=await browser.newPage({viewport:{width:1200,height:760}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  if(name==='tiny-tide'){await page.waitForFunction(()=>window.__tinyTide?.time>.5);await page.locator('#start').click();}
  if(name==='royal-yeet')await page.waitForFunction(()=>window.__siege?.time>.5);
  if(name==='dungeon-run'){await page.getByRole('button',{name:'Start expedition',exact:true}).click();await page.getByRole('button',{name:'START RUN',exact:true}).click();}
  if(name==='wildtag'){await page.locator('#game').click();await page.mouse.move(600,445);}
  await page.waitForTimeout(2200);
  await page.screenshot({path:`${output}/${name}.jpg`,type:'jpeg',quality:84});
  console.log(JSON.stringify({name,status:response.status(),url:page.url(),title:await page.title(),buttons:await page.locator('button').allTextContents(),errors}));await page.close();
 }
} finally {await browser.close();}
