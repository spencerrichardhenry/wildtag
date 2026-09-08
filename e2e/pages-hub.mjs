import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output='.codex-drafts/pages-qa';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 const response=await page.goto(process.env.VERIFY_URL||'http://127.0.0.1:5218/');assert.equal(response.status(),200);await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('.game-link').count(),4);
 const links=await page.locator('.game-link').evaluateAll(nodes=>nodes.map(a=>a.href));
 assert.deepEqual(links,['https://spencerrichardhenry.github.io/wildtag/tiny-tide.html','https://spencerrichardhenry.github.io/wildtag/royal-yeet.html','https://spencerrichardhenry.github.io/mobatest/','https://spencerrichardhenry.github.io/wildtag/']);
 for(const viewport of [{width:1440,height:1050},{width:390,height:844},{width:320,height:568}]){
  await page.setViewportSize(viewport);await page.locator('footer').scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const a of await page.locator('.game-link').all()){const box=await a.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);}
  await page.screenshot({path:`${output}/hub-${viewport.width}.png`,fullPage:true});
 }
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Skip to the games');
 assert.deepEqual(errors,[]);writeFileSync(`${output}/hub-results.json`,JSON.stringify({passed:true,links,errors},null,2));console.log('PASS: four game links, loaded previews, keyboard access, desktop and 390/320 px mobile layouts.');
}finally{await browser.close();}
