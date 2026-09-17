const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../md_dark_viewer_working_final.html'),'utf8');
for(const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new Function(script[1]);
const start=source.indexOf('function pdfMedian('),end=source.indexOf('let pdfConversionQueue=',start);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=new Function('htmlEsc',source.slice(start,end)+';return {pdfRuledTables,pdfPageEditableHtml,pdfFlowHtml,pdfPageRules,pdfTextRuns};')(escape);
const run=(text,x,y,size=12)=>({text,x,y,width:text.length*5,height:size,size});
const horizontal=[10,40,70].map(pos=>({pos,start:10,end:210}));
const vertical=[10,110,210].map(pos=>({pos,start:10,end:70}));
const runs=[run('A',20,18),run('B',120,18),run('C',20,48),run('D',120,48)];
let tables=api.pdfRuledTables({horizontal,vertical},runs);
assert.equal(tables.length,1);assert.equal(tables[0].cells.length,4);
let html=api.pdfPageEditableHtml([run('Title',10,0,24),...runs,run('A normal paragraph after the table',10,85)],tables);
assert.match(html,/<table/);assert.match(html,/<h1\b/);
assert.equal((html.match(/>A</g)||[]).length,1,'table text must not also appear as a paragraph');
tables=api.pdfRuledTables({horizontal,vertical:[vertical[0],{pos:110,start:40,end:70},vertical[2]]},runs);
assert.equal(tables[0].cells[0].colspan,2);
const splitHorizontal=[horizontal[0],{pos:40,start:110,end:210},horizontal[2]];
// A merged row still has two full outer rules plus a partial internal rule.
tables=api.pdfRuledTables({horizontal:splitHorizontal,vertical},runs);
assert.equal(tables.length,1,'a partial row border must not hide the entire table');
assert.equal(tables[0].cells[0].rowspan,2);
html=api.pdfFlowHtml([run('<script>',0,0),run('next',0,14)],12);
assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
const columns=[];for(let i=0;i<5;i++){columns.push(run('Left'+i,10,i*15));columns.push(run('Right'+i,300,i*15))}
html=api.pdfFlowHtml(columns,12);assert.ok(html.indexOf('Left4')<html.indexOf('Right0'));
const w=240,h=100,data=new Uint8ClampedArray(w*h*4).fill(255);
function pixel(x,y){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=0}
for(const y of [10,40,70])for(let x=10;x<=210;x++)pixel(x,y);
for(const x of [10,110,210])for(let y=10;y<=70;y++)pixel(x,y);
const rules=api.pdfPageRules({width:w,height:h,getContext:()=>({getImageData:()=>({data})})});
assert.equal(api.pdfRuledTables(rules,runs).length,1);
console.log('PASS: script syntax, grid, merged cells, no duplicate text, escaping, column order, raster rules');
for(const ascent of [NaN,Infinity,-Infinity]){
 const runs=api.pdfTextRuns({items:[{str:'한글',transform:[12,0,0,12,10,100],width:24,fontName:'f'}],styles:{f:{ascent}}},{transform:[1,0,0,1,0,0],scale:1},{Util:{transform:(_,t)=>t}});
 assert.ok(Number.isFinite(runs[0].y),'invalid font ascent must not corrupt positions');
}
for(let i=0;i<data.length;i+=4){const line=data[i]===0;data[i]=line?62:34;data[i+1]=line?62:39;data[i+2]=line?72:55}
const darkRules=api.pdfPageRules({width:w,height:h,getContext:()=>({getImageData:()=>({data})})});
const darkTables=api.pdfRuledTables(darkRules,runs);
assert.equal(darkTables.length,1);assert.equal(darkTables[0].cells.length,4);
console.log('PASS: invalid font ascent and dark-background table regression');
const colorApi=new Function('htmlEsc',source.slice(start,end)+';return pdfApplyTextColors;')(escape);
(async()=>{
 const OPS={setFillRGBColor:1,showText:2};
 for(const rgb of [[255,0,128],'#ff0080']){
  const items=[{text:'색상'}];
  await colorApi(items,{getOperatorList:async()=>({fnArray:[1,2],argsArray:[Array.isArray(rgb)?rgb:[rgb],[[{unicode:'색상'}]]]})},{OPS});
  assert.equal(items[0].color,'#ff0080');
 }
 const paragraphHtml=api.pdfFlowHtml([run('first line',0,0),run('next',0,14),run('paragraph',0,50)],12);
 assert.equal((paragraphHtml.match(/<p\b/g)||[]).length,2);
 console.log('PASS: PDF.js byte/string RGB and paragraph separation');
})().catch(e=>{console.error(e);process.exitCode=1});
