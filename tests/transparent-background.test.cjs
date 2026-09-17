const {chromium}=require('C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('md_dark_viewer_working_final.html')).href,{waitUntil:'domcontentloaded'});await page.waitForTimeout(500);
 const partial=await page.evaluate(()=>{
   els.preview.innerHTML='<table><tbody><tr><td><span style="background-color:#00ff00">abcdef</span></td></tr></tbody></table>';
   const text=els.preview.querySelector('span').firstChild,range=document.createRange();range.setStart(text,2);range.setEnd(text,4);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);state.savedPreviewRange=range.cloneRange();
   applyPickedColor('bg','');
   return [...els.preview.querySelector('td').childNodes].map(node=>({text:node.textContent,bg:node.nodeType===1?node.style.backgroundColor:''}));
 });
 assert.deepEqual(partial,[{text:'ab',bg:'rgb(0, 255, 0)'},{text:'cd',bg:''},{text:'ef',bg:'rgb(0, 255, 0)'}]);
 const cells=await page.evaluate(()=>{
   els.preview.innerHTML='<table><tbody><tr><td><span style="background-color:#00ff00">하나</span></td><td><span style="background-color:#00ff00">둘</span></td></tr></tbody></table>';
   els.preview.querySelectorAll('td').forEach(cell=>cell.classList.add('table-cell-selected'));applyPickedColor('bg','');
   return [...els.preview.querySelectorAll('span')].map(span=>span.style.backgroundColor);
 });
 assert.deepEqual(cells,['','']);assert.deepEqual(errors,[]);console.log('PASS transparent background removes existing style for partial text and selected table cells');
 const extended=await page.evaluate(()=>{
   els.preview.innerHTML='<p>x<span style="background-color:#00ff00">one</span> / <mark>abcd</mark> / <span style="background-color:#ff0000">two</span>y</p>';
   const hosts=els.preview.querySelectorAll('span,mark'),range=document.createRange();range.setStart(hosts[0].firstChild,0);range.setEnd(hosts[2].firstChild,hosts[2].firstChild.length);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);state.savedPreviewRange=range.cloneRange();applyPickedColor('bg','');
   return {marked:els.preview.querySelectorAll('mark').length,backgrounds:[...els.preview.querySelectorAll('[style]')].map(node=>node.style.backgroundColor).filter(Boolean)};
 });
 assert.deepEqual(extended,{marked:0,backgrounds:[]});
 const whole=await page.evaluate(()=>{
   els.preview.innerHTML='<p><span style="background-color:#00ff00">하나</span><mark>둘</mark></p><table><tbody><tr><td style="background-color:#ff0000">셋</td></tr></tbody></table>';
   const range=document.createRange();range.selectNodeContents(els.preview);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);state.savedPreviewRange=range.cloneRange();applyPickedColor('bg','');return {marks:els.preview.querySelectorAll('mark').length,backgrounds:[...els.preview.querySelectorAll('[style]')].map(node=>node.style.backgroundColor).filter(Boolean)};
 });
 assert.deepEqual(whole,{marks:0,backgrounds:[]});
 assert.deepEqual(errors,[]);console.log('PASS transparent background clears partial, multi-style, mark, cell and whole-document backgrounds');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
