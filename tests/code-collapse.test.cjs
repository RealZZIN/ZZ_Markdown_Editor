const {chromium}=require('C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('md_dark_viewer_working_final.html')).href,{waitUntil:'domcontentloaded'});await page.waitForTimeout(500);
 await page.evaluate(()=>{setMode('edit',false);setEditView('preview');els.preview.innerHTML='<pre><code class="language-python">print(1)</code></pre>';decorateCodeBlocks(els.preview)});
 assert.equal(await page.locator('.code-head-main').innerText(),'▾Python');
 assert.equal(await page.locator('.code-head-main').evaluate(el=>getComputedStyle(el).gap),'8px');
 const toggle=page.locator('.code-collapse');await toggle.evaluate(el=>el.click());
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.code-block').evaluate(el=>el.classList.contains('collapsed')),true);
 assert.equal(await page.locator('.code-block > pre').evaluate(el=>getComputedStyle(el).display),'none');
 await toggle.evaluate(el=>el.click());assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.notEqual(await page.locator('.code-block > pre').evaluate(el=>getComputedStyle(el).display),'none');
 assert.deepEqual(errors,[]);console.log('PASS code block collapse, expand, label and spacing');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
