const {chromium}=require('C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage();
  await page.goto(pathToFileURL(path.resolve('md_dark_viewer_working_final.html')).href,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1000);
  await page.evaluate(()=>{setMode('edit',false);setEditView('preview')});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
   previewMarkdownEnabled=true;
   els.preview.innerHTML='<p>앞 문단</p><table><tbody><tr><td><strong>김밥천국</strong></td><td>다른 칸</td></tr></tbody></table><span style="color:red">표 밖 문장</span>';
   addTableResize(els.preview);addMovableElements(els.preview);
  });
  await page.locator('#preview td strong').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('돈');
  await page.waitForTimeout(250);
  const first=await page.evaluate(()=>{const node=getSelection().anchorNode;return {cell:!!(node?.parentElement?.closest('td')),html:els.preview.innerHTML}});
  console.log(JSON.stringify(first));assert.ok(first.cell,'caret left table after first input');
  await page.keyboard.insertText('까스');await page.keyboard.press('Enter');await page.keyboard.insertText('추가');
  await page.waitForTimeout(250);
  assert.match(await page.locator('#preview td').first().innerText(),/돈까스[\s\u200b]*추가/);
  assert.equal(await page.locator('#preview').evaluate(el=>el.lastElementChild.textContent),'표 밖 문장');
  console.log('PASS actual table click, typing with trailing inline sibling, Enter and continued typing');
  const formatting=await page.evaluate(()=>{
    els.preview.innerHTML='<table><tbody><tr><td rowspan="2">첫째칸</td><td>둘째칸</td></tr><tr><td>셋째칸</td></tr></tbody></table>';
    els.preview.focus();
    const cells=[...els.preview.querySelectorAll('td')];
    cells[0].classList.add('table-cell-selected');cells[1].classList.add('table-cell-selected');
    getSelection().removeAllRanges();state.savedPreviewRange=null;
    applyPreviewCommand('bold');applyPreviewCommand('italic');applyPreviewCommand('underline');
    applyPickedColor('text','#ff0000');applyPickedColor('bg','#ffff00');stylePreviewSelection('font-size','22px');
    const selected=cells.slice(0,2).every(cell=>{
      const span=[...cell.querySelectorAll('span')].at(-1),style=getComputedStyle(span);
      return Number(style.fontWeight)>=600&&style.fontStyle==='italic'&&style.color==='rgb(255, 0, 0)'&&style.fontSize==='22px'&&!!cell.querySelector('[style*="background-color"]');
    });
    const untouched=cells[2].innerHTML==='셋째칸'&&cells.every(cell=>!cell.style.backgroundColor);
    applyPreviewCommand('justifyCenter');applyPreviewCommand('formatBlock','h3');
    const blocks=cells.slice(0,2).every(cell=>cell.style.textAlign==='center'&&cell.querySelector('h3'));
    cells.forEach(cell=>cell.classList.remove('table-cell-selected'));
    // Selection starts part-way through one cell and ends part-way through another.
    const first=cells[0].querySelector('span:last-child');
    const walker=document.createTreeWalker(cells[0],NodeFilter.SHOW_TEXT);let start;while((start=walker.nextNode())&&!start.length){}
    const range=document.createRange();range.setStart(start,1);range.setEnd(cells[2].firstChild,2);
    getSelection().removeAllRanges();getSelection().addRange(range);state.savedPreviewRange=range.cloneRange();
    stylePreviewSelection('background-color','#00ff00');applyPreviewCommand('bold');
    const before=els.preview.querySelectorAll('tr').length===2&&els.preview.querySelectorAll('td').length===3&&cells[0].rowSpan===2;
    const html=els.editor.value;els.preview.innerHTML=html;
    const after=els.preview.querySelectorAll('tr').length===2&&els.preview.querySelectorAll('td').length===3&&!els.preview.querySelector('span table,span tr,span td');
    return {selected,untouched,blocks,before,after};
  });
  assert.ok(Object.values(formatting).every(Boolean),JSON.stringify(formatting));
  console.log('PASS selected-cell formats, partial cross-cell range, merged-cell structure and round-trip');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
