const fs=require('fs'),path=require('path');
const runtime='C:/Users/xxinz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
(async()=>{
 const pdf=await import('file:///'+runtime+'/pdfjs-dist/legacy/build/pdf.mjs');
 const source=fs.readFileSync(path.join(__dirname,'../md_dark_viewer_working_final.html'),'utf8');
 const start=source.indexOf('function pdfMedian('),end=source.indexOf('let pdfConversionQueue=',start);
 const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const api=new Function('htmlEsc',source.slice(start,end)+';return {pdfMedian,pdfPreserveComplexRegions,pdfTextRuns,pdfApplyUnderlines,pdfPageRules,pdfRuledTables,pdfPageEditableHtml,pdfLines};')(esc);
 const doc=await pdf.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2])),useSystemFonts:true}).promise;
 const out=path.join(__dirname,'../tmp/pdf-check');fs.mkdirSync(out,{recursive:true});
 const pages=[];let documentBodySize=null;
 for(let p=1;p<=doc.numPages;p++){
  const page=await doc.getPage(p),viewport=page.getViewport({scale:1.5});
  const holder=doc.canvasFactory.create(Math.ceil(viewport.width),Math.ceil(viewport.height));
  await page.render({canvasContext:holder.context,viewport,background:'rgb(255,255,255)'}).promise;
  const content=await page.getTextContent(),runs=api.pdfTextRuns(content,viewport,pdf,page);
  if(!documentBodySize){const sizes=[];for(const r of runs)for(let i=0;i<Math.min(r.text.length,80);i++)sizes.push(r.fontPx);documentBodySize=api.pdfMedian(sizes)}
  runs.forEach(r=>r.fontPx=r.fontPx*16/documentBodySize);
  const rules=api.pdfPageRules(holder.canvas),tables=api.pdfRuledTables(rules,runs);
  api.pdfApplyUnderlines(runs,rules,tables);
  const inTable=new Set(tables.flatMap(t=>t.runs));
  const preserved=api.pdfPreserveComplexRegions(runs.filter(r=>!inTable.has(r)),holder.canvas,api.pdfMedian(runs.map(r=>r.size)),()=>doc.canvasFactory.create(1,1).canvas);
  const html=api.pdfPageEditableHtml([...runs.filter(r=>inTable.has(r)),...preserved.runs],tables);pages.push(html);
  require('node:assert/strict').ok(!/;color:/.test(html),'editable text must inherit theme color');
  require('node:assert/strict').ok(runs.every(r=>Number.isFinite(r.y)));
  require('node:assert/strict').ok(tables.every(t=>t.cells.length>0));
  const plain=html.replace(/<img[^>]+alt="([^"]*)"[^>]*>/g,'$1').replace(/<[^>]+>/g,'').replace(/\s/g,'');
  require('node:assert/strict').ok(runs.every(r=>plain.includes(esc(r.text.replace(/^#{1,6}\s+/, '')).replace(/\s/g,''))),`missing text on page ${p}`);
  console.log(JSON.stringify({p,runs:runs.length,lines:api.pdfLines(runs).length,tables:tables.length}));
  fs.writeFileSync(path.join(out,`original-${p}.png`),holder.canvas.toBuffer('image/png'));
  doc.canvasFactory.destroy(holder);page.cleanup();
 }
 fs.writeFileSync(path.join(out,'converted.html'),'<!doctype html><meta charset="utf-8"><style>body{font:16px Arial;margin:32px}table{border-collapse:collapse}td{border:1px solid #aaa;padding:8px}section{margin-bottom:40px}</style>'+pages.map(p=>'<section>'+p+'</section>').join(''));
 await doc.destroy();
 const {chromium}=require(runtime+'/playwright');
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1260,height:1000}});
 await page.goto(require('url').pathToFileURL(path.join(out,'converted.html')).href);
 await page.screenshot({path:path.join(out,'converted.png')});
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
