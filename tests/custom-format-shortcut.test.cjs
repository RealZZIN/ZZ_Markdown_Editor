const {chromium}=require('C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('md_dark_viewer_working_final.html')).href,{waitUntil:'domcontentloaded'});await page.waitForTimeout(700);
 await page.evaluate(()=>setMode('edit',false));await page.keyboard.press('Control+Alt+s');
 assert.equal(await page.locator('.custom-format-panel').isVisible(),true);assert.equal(await page.locator('#document-settings').count(),1);
 const iconStyle=await page.locator('#document-settings').evaluate(el=>({rightGap:Math.round(el.parentElement.getBoundingClientRect().right-el.getBoundingClientRect().right),background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,brandColor:getComputedStyle(document.querySelector('#brand-home')).color,opacity:getComputedStyle(el).opacity,borderRadius:getComputedStyle(el).borderRadius}));assert.equal(iconStyle.rightGap,0);assert.equal(iconStyle.background,'rgba(0, 0, 0, 0)');assert.equal(iconStyle.color,iconStyle.brandColor);assert.equal(iconStyle.opacity,'1');assert.equal(iconStyle.borderRadius,'0px');assert.deepEqual(errors,[]);
 console.log('PASS Ctrl+Alt+S custom-format shortcut and document settings icon');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
