const {chromium}=require('C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.goto(pathToFileURL(path.resolve('md_dark_viewer_working_final.html')).href,{waitUntil:'domcontentloaded'});
 await page.waitForTimeout(2000);
 console.log('startup',errors);
 const result=await page.evaluate(async()=>{
  state.sidebarFolders=[{root:'로컬',path:'빈 폴더'}];renderList();
  const empty=els.list.textContent.includes('빈 폴더');
  const md=new File(['![sample](a.png)'],'test.md',{type:'text/markdown'});
  const img=new File([new Uint8Array([137,80,78,71])],'a.png',{type:'image/png'});
  await uploadIntoSidebar([md,img],'로컬/빈 폴더');
  const uploaded=state.files.some(f=>f.path==='빈 폴더/test.md'&&f.source==='local');
  const images=els.list.textContent.includes('이미지 (1)');
  const source=document.createElement('article');source.className='preview';
  source.innerHTML=Array.from({length:100},(_,i)=>`<p>Line ${i} test paragraph text</p>`).join('');
  const target=document.createElement('div');document.body.appendChild(target);
  await renderNupPrintSheets(source,100,4,target);
  const cells=target.querySelectorAll('.print-nup-cell').length,sheets=target.querySelectorAll('.print-nup-sheet').length;
  for(const n of [2,6,9]){
    const output=document.createElement('div');await renderNupPrintSheets(source,100,n,output);
    if(output.querySelectorAll('.print-nup-sheet').length!==Math.ceil(cells/n))throw Error('N-up grouping '+n);
  }
  state.printPagesPerSheet=4;await preparePrint(source,target.firstChild.cloneNode(true));target.remove();
  return {empty,uploaded,images,cells,sheets};
 });
 console.log(result);assert.ok(result.empty&&result.uploaded&&result.images);assert.ok(result.cells>1);assert.equal(result.sheets,Math.ceil(result.cells/4));
 await page.emulateMedia({media:'print'});
 console.log('print',await page.locator('.print-root .print-nup-sheet').first().evaluate(el=>({display:getComputedStyle(el).display,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
 await page.emulateMedia({media:'screen'});
 const formatting=await page.evaluate(()=>{
  cleanupPrint();setMode('edit',false);
  const results=[];
  for(const prop of ['color','background-color'])for(const wrapper of ['td','span']){
    els.preview.innerHTML=wrapper==='td'?'<table><tbody><tr><td style="color:rgb(0,0,0);background-color:rgb(255,255,255)">김밥천국돈까스먹고싶다</td></tr></tbody></table>':'<table><tbody><tr><td><span style="font-size:16px">김밥천국돈까스먹고싶다</span></td></tr></tbody></table>';
    const host=els.preview.querySelector(wrapper),text=host.firstChild,range=document.createRange();range.setStart(text,4);range.setEnd(text,7);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);state.savedPreviewRange=range.cloneRange();
    stylePreviewSelection(prop,'#ff0000');
    const styled=[...els.preview.querySelectorAll('span')].find(el=>el.style.getPropertyValue(prop)==='rgb(255, 0, 0)');
    results.push(styled?.textContent==='돈까스'&&els.preview.querySelector('td').style.getPropertyValue(prop)!=='rgb(255, 0, 0)');
  }
  return results;
 });
 assert.ok(formatting.every(Boolean),'partial cell text formatting');
 const codeColor=await page.evaluate(()=>{
   els.preview.innerHTML='<p><span style="color:rgb(255, 0, 0)"><code>돈까스</code></span></p>';
   const inherited=getComputedStyle(els.preview.querySelector('code')).color;
   els.editor.value='`김밥천국돈까스먹고싶다`';state.savedSelection={start:5,end:8};
   styleSpan('color','#ff0000');
   return {inherited,text:els.editor.value};
 });
 assert.equal(codeColor.inherited,'rgb(255, 0, 0)');
 assert.ok(codeColor.text.includes('<span style="color:#ff0000">돈까스</span>'));
 await page.evaluate(()=>{
   els.preview.innerHTML='<p><span style="color:red">바깥</span></p><table><tbody><tr><td>김밥</td><td>다른 칸</td></tr></tbody></table>';
   els.preview.contentEditable='true';els.preview.focus();
   const range=document.createRange();range.selectNodeContents(els.preview.querySelector('td'));range.collapse(false);
   const sel=getSelection();sel.removeAllRanges();sel.addRange(range);state.savedPreviewRange=range.cloneRange();
 });
 await page.keyboard.press('Enter');await page.keyboard.insertText('돈까스');
 const cellEdit=await page.evaluate(()=>({text:els.preview.querySelector('td').textContent,breaks:els.preview.querySelector('td').querySelectorAll('br').length,outside:els.preview.querySelector('p').textContent}));
 assert.ok(cellEdit.text.includes('돈까스')&&cellEdit.breaks>0);assert.equal(cellEdit.outside,'바깥');
 await page.evaluate(()=>{document.querySelectorAll('.modal-backdrop').forEach(el=>el.remove());els.editor.focus()});
 await page.keyboard.press('Control+F1');assert.equal(await page.evaluate(()=>state.mode),'convert');
 await page.locator('#convert-list').focus();await page.keyboard.press('Control+a');
 assert.equal(await page.locator('#convert-list input:not(:checked)').count(),0);
 await page.keyboard.press('Control+F3');assert.equal(await page.evaluate(()=>state.mode),'merge');
 await page.evaluate(()=>{window.shortcutCalls=[];mergeSelected=()=>window.shortcutCalls.push('merge');saveCurrent=()=>window.shortcutCalls.push('save');shortcutSaveAs=()=>window.shortcutCalls.push('save-as');runSelectedConvert=()=>window.shortcutCalls.push('convert')});
 await page.keyboard.press('Control+Enter');
 await page.keyboard.press('Control+F1');await page.keyboard.press('Control+Enter');
 await page.keyboard.press('Control+F2');await page.keyboard.press('Control+s');await page.keyboard.press('Control+Shift+s');
 assert.deepEqual(await page.evaluate(()=>window.shortcutCalls),['merge','convert','save','save-as']);
 await page.keyboard.press('Control+h');assert.equal(await page.locator('[data-replace-field]').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.find-replace-panel').count(),0);
 await page.evaluate(()=>{els.editor.focus();els.editor.value='돈까스';els.editor.setSelectionRange(0,3)});
 await page.keyboard.press('Control+b');assert.equal(await page.locator('#editor').inputValue(),'**돈까스**');
 assert.deepEqual(errors,[]);
 console.log('PASS sidebar, N-up, partial formatting, table input, shortcuts');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
