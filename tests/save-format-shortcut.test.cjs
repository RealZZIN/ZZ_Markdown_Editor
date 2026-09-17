const {chromium}=require('C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('md_dark_viewer_working_final.html')).href,{waitUntil:'domcontentloaded'});await page.waitForTimeout(500);
 await page.evaluate(()=>{localStorage.removeItem('md-shortcut-save-format');setMode('edit',false);state.files=[{name:'test.md',displayName:'test.md',path:'test.md',source:'local',text:'본문',savedText:'본문'}];state.active=0;els.editor.value='본문';renderMarkdown('본문');window.savedFormats=[];window.saveCurrent=async()=>savedFormats.push('md');window.printDocument=async()=>{savedFormats.push('pdf');return true}});
 await page.keyboard.press('Control+Shift+s');const saveAs=page.locator('.shortcut-save-name');await saveAs.waitFor();assert.equal(await saveAs.evaluate(el=>getComputedStyle(el).gap),'8px');await page.getByRole('button',{name:'취소',exact:true}).click();
 await page.keyboard.press('Control+s');const dialog=page.locator('.save-format-dialog');await dialog.waitFor();
 assert.equal(await dialog.locator('[data-save-format-remember]').isChecked(),false);assert.equal(await dialog.getByRole('button',{name:'MD로 저장'}).count(),1);assert.equal(await dialog.getByRole('button',{name:'PDF로 저장'}).count(),1);
 assert.equal(await dialog.locator('[data-save-format="pdf"]').evaluate(el=>el.classList.contains('primary')),false);assert.equal(await dialog.locator('[data-save-format="md"]').evaluate(el=>getComputedStyle(el).backgroundColor),await dialog.locator('[data-save-format="pdf"]').evaluate(el=>getComputedStyle(el).backgroundColor));
 await dialog.getByRole('button',{name:'PDF로 저장'}).click();assert.deepEqual(await page.evaluate(()=>savedFormats),['pdf']);
 await page.keyboard.press('Control+s');await dialog.waitFor();await dialog.locator('[data-save-format-remember]').check();await dialog.getByRole('button',{name:'MD로 저장'}).click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('md-shortcut-save-format')),'md');assert.deepEqual(await page.evaluate(()=>savedFormats),['pdf','md']);
 await page.keyboard.press('Control+s');await page.waitForTimeout(100);assert.equal(await dialog.count(),0);assert.deepEqual(await page.evaluate(()=>savedFormats),['pdf','md','md']);
 assert.deepEqual(errors,[]);console.log('PASS Ctrl+S format choice, default unchecked remember option, remembered direct save');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
