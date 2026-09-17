const {chromium}=require('C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('md_dark_viewer_working_final.html')).href,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1000);
 await page.locator('#file-list').click({button:'right',position:{x:10,y:400}});await page.locator('.sidebar-context-menu').getByText('새 폴더',{exact:true}).click();
 await page.locator('.file-dialog-input').fill('대상');await page.locator('[data-folder-dialog="ok"]').click();
 assert.equal(await page.locator('#file-list > [data-sidebar-key="로컬"] [data-sidebar-key="로컬/대상"]').count(),1);
 await page.evaluate(async()=>{await uploadIntoSidebar([new File(['![image](pic.png)'],'a.md'),new File(['image'],'pic.png')],'업로드된 파일/기존');});
 await page.locator('[data-sidebar-key="업로드된 파일/기존/a.md"]').dragTo(page.locator('[data-sidebar-key="로컬/대상"] > .folder-title'));
 assert.equal(await page.evaluate(()=>state.files[0].path),'대상/a.md');
 assert.equal(await page.evaluate(()=>decodeURI(state.files[0].text)),'![image](../기존/pic.png)');
 const moved=await page.evaluate(()=>{
  const ok=moveSidebarItem({kind:'folder',key:'업로드된 파일/기존'},{parent:'로컬',position:'inside'});
  const nested=moveSidebarItem({kind:'folder',key:'로컬/기존'},{parent:'로컬/대상',position:'inside'});
  const reject=moveSidebarItem({kind:'folder',key:'로컬/대상'},{parent:'로컬/대상/기존',position:'inside'});
  const out=moveSidebarItem({kind:'folder',key:'로컬/대상/기존'},{parent:'로컬',reference:'로컬/대상',position:'before'});
  return {ok,nested,reject,out,order:[...els.list.querySelector('[data-sidebar-key="로컬"] > .folder-files').children].map(el=>el.dataset.sidebarKey),assets:[...state.assets.keys()]};
 });
 assert.ok(moved.ok&&moved.nested&&!moved.reject&&moved.out);assert.deepEqual(moved.order.slice(0,2),['로컬/기존','로컬/대상']);assert.ok(moved.assets.includes('기존/pic.png'));assert.deepEqual(errors,[]);
 console.log('PASS top-level folder creation, actual file drag, folder nesting/outdent/reorder, cycle prevention, image path repair');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
