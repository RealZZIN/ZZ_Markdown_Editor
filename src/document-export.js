function safeFontFamily(value=''){
  return String(value).replace(/[\u0000-\u001f\u007f"'\\;]/g,'').trim().slice(0,120);
}

function pageCss(fontFamily=''){
  const preferred=safeFontFamily(fontFamily);
  return `
  @page { size: A4; margin: 18mm 17mm; }
  html, body { background:#fff; color:#111; }
  body { font-family:${preferred?`"${preferred}",`:''}"Malgun Gothic","맑은 고딕",Arial,sans-serif; font-size:11pt; line-height:1.55; }
  h1,h2,h3,h4,h5,h6 { page-break-after:avoid; margin:1.1em 0 .45em; }
  p { margin:.35em 0; }
  blockquote { margin:.7em 0; padding:.25em .85em; border-left:3px solid #999; }
  table { width:100%; border-collapse:collapse; margin:.8em 0; }
  th,td { border:1px solid #888; padding:5px 7px; vertical-align:top; }
  th { background:#eee; font-weight:700; }
  pre { white-space:pre-wrap; background:#f4f4f4; padding:10px; }
  code { font-family:Consolas,"D2Coding",monospace; }
  img { max-width:100%; height:auto; }
  hr { border:0; border-top:1px solid #aaa; }
`;
}

function escapeHtml(value=''){
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

async function sourceToDataUri(source){
  if(!source||/^data:/i.test(source))return source;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(source,{signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const blob=await response.blob();
    if(blob.size>32*1024*1024)throw new Error('Image is too large to embed safely.');
    return await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }catch{return ''}
  finally{clearTimeout(timer)}
}

async function mapWithConcurrency(items,limit,worker){
  let cursor=0;
  const runners=Array.from({length:Math.min(Math.max(1,limit),items.length)},async()=>{
    while(cursor<items.length){const index=cursor++;await worker(items[index],index)}
  });
  await Promise.all(runners);
}

async function rasterizeEquations(root){
  const equations=[...root.querySelectorAll('.katex-display,.katex')].filter(node=>
    node.classList.contains('katex-display')||!node.closest('.katex-display')
  );
  if(!equations.length)return;
  const {toPng}=await import('html-to-image');
  for(const equation of equations){
    try{
      const rect=equation.getBoundingClientRect();
      if(!rect.width||!rect.height)continue;
      const data=await toPng(equation,{pixelRatio:2.5,backgroundColor:'transparent',cacheBust:false,
        width:Math.ceil(rect.width),height:Math.ceil(rect.height)});
      const image=document.createElement('img');
      image.src=data;
      image.alt=equation.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()||equation.textContent?.trim()||'수식';
      image.style.width=`${Math.ceil(rect.width)}px`;
      image.style.height=`${Math.ceil(rect.height)}px`;
      image.style.maxWidth='100%';
      if(equation.classList.contains('katex-display')){
        image.style.display='block';image.style.margin='0.6em auto';
      }else image.style.verticalAlign='middle';
      equation.replaceWith(image);
    }catch(error){console.warn('Equation image export failed',error)}
  }
}

function normalizeHwpxSemantics(root){
  const makeSpacer=()=>{
    const spacer=document.createElement('p');
    // U+3164(Hangul filler)는 화면에는 비어 보이지만 HWPX 변환기가 실제
    // 글자 한 줄로 보존한다. 0폭 문자는 한글에서 행 높이가 거의 0이 된다.
    spacer.dataset.exportSpacer='1';spacer.textContent='\u3164';
    spacer.style.cssText='font-size:10pt;line-height:1.15;color:#ffffff;margin:0';
    return spacer;
  };
  const makeQuoteTable=source=>{
    const table=document.createElement('table');
    table.dataset.exportQuote='1';
    table.style.cssText='width:100%;border-collapse:collapse;border:0 none;margin:0';
    const body=document.createElement('tbody');
    const row=document.createElement('tr');
    const cell=document.createElement('td');
    cell.style.cssText='border:0 none;padding:8px 12px;background-color:#f6f1f1;vertical-align:top';
    while(source.firstChild)cell.appendChild(source.firstChild);
    row.appendChild(cell);body.appendChild(row);table.appendChild(body);
    return table;
  };
  root.querySelectorAll('p').forEach(paragraph=>{
    if(!(paragraph.textContent||'').trim()&&paragraph.querySelector('br')){
      paragraph.dataset.exportSpacer='1';paragraph.textContent='\u3164';
      paragraph.style.cssText='font-size:10pt;line-height:1.15;color:#ffffff;margin:0';
    }
  });
  [...root.querySelectorAll('ul,ol')].reverse().forEach(list=>{
    const ordered=list.tagName==='OL',start=Number(list.getAttribute('start'))||1;
    const container=document.createElement('div');container.dataset.exportList='1';
    [...list.children].filter(item=>item.tagName==='LI').forEach((item,index)=>{
      const paragraph=document.createElement('p');
      paragraph.style.cssText='margin:0.28em 0 0.28em 1.2em;text-indent:-1.05em';
      const marker=document.createElement('span');
      marker.style.cssText='font-weight:700;color:#555';
      marker.textContent=ordered?`${start+index}. `:'• ';
      paragraph.appendChild(marker);
      const nested=[...item.children].filter(child=>child.dataset.exportList==='1');
      [...item.childNodes].filter(child=>!nested.includes(child)).forEach(child=>paragraph.appendChild(child));
      container.appendChild(paragraph);
      nested.forEach(child=>container.appendChild(child));
    });
    list.replaceWith(container);
  });
  root.querySelectorAll('blockquote').forEach(quote=>{
    quote.replaceWith(makeQuoteTable(quote));
  });
  root.querySelectorAll('p').forEach(paragraph=>{
    const text=paragraph.textContent||'';
    if(!/^\s*>/.test(text))return;
    const first=paragraph.firstChild;
    if(first?.nodeType===Node.TEXT_NODE)first.nodeValue=first.nodeValue.replace(/^\s*>\s?/, '');
    if(!(paragraph.textContent||'').trim()){paragraph.remove();return}
    const table=makeQuoteTable(paragraph);
    paragraph.replaceWith(table);
  });
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    if(node.parentElement?.closest('pre,code'))continue;
    if(node.nodeValue.includes('->'))node.nodeValue=node.nodeValue.replace(/\s*->\s*/g,' → ');
  }
  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(heading=>{
    let previous=heading.previousElementSibling;
    if(!previous||previous.dataset.exportSpacer==='1')return;
    heading.before(makeSpacer());
  });
  root.querySelectorAll('[data-export-list],[data-export-quote],table').forEach(block=>{
    const next=block.nextElementSibling;
    if(!next||next.dataset.exportSpacer==='1'||/^H[1-6]$/.test(next.tagName))return;
    block.after(makeSpacer());
  });
  root.querySelectorAll('[data-export-quote]').forEach(quote=>quote.removeAttribute('data-export-quote'));
  root.querySelectorAll('[data-export-list]').forEach(list=>list.removeAttribute('data-export-list'));
  root.querySelectorAll('[data-export-spacer]').forEach(spacer=>spacer.removeAttribute('data-export-spacer'));
}

export async function prepareDocumentHtml(root,title='document',{format='docx',fontFamily=''}={}){
  if(!(root instanceof Element))throw new TypeError('A document preview element is required.');
  if(document.fonts?.ready)await Promise.race([
    document.fonts.ready.catch(()=>{}),
    new Promise(resolve=>setTimeout(resolve,3000))
  ]);
  const clone=root.cloneNode(true);
  clone.querySelectorAll('script,button,input,select,textarea,.block-move-handle,.unique-block-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle').forEach(node=>node.remove());
  if(format==='hwpx')normalizeHwpxSemantics(clone);
  const stage=document.createElement('div');
  stage.style.cssText='position:fixed;left:-100000px;top:0;width:900px;padding:24px;background:#fff;color:#111;z-index:-1;pointer-events:none';
  stage.appendChild(clone);document.body.appendChild(stage);
  try{await rasterizeEquations(clone)}finally{stage.remove()}
  const images=[...clone.querySelectorAll('img')];
  await mapWithConcurrency(images,3,async image=>{
    const data=await sourceToDataUri(image.getAttribute('src')||image.src);
    if(data)image.setAttribute('src',data);
    else image.replaceWith(document.createTextNode(image.alt?`[${image.alt}]`:''));
  });
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${pageCss(fontFamily)}</style></head><body>${clone.innerHTML}</body></html>`;
}

async function validateOfficeZip(blob,label){
  if(!(blob instanceof Blob)||blob.size<4)throw new Error(`${label} conversion returned an empty document.`);
  const signature=new Uint8Array(await blob.slice(0,4).arrayBuffer());
  if(signature[0]!==0x50||signature[1]!==0x4b||signature[2]!==0x03||signature[3]!==0x04){
    throw new Error(`${label} conversion returned an invalid package.`);
  }
  return blob;
}

export async function createDocxBlob(html){
  const {asBlob:htmlToDocxBlob}=await import('html-docx-js-typescript');
  const result=await htmlToDocxBlob(html,{orientation:'portrait',margins:{top:1020,right:964,bottom:1020,left:964}});
  const blob=result instanceof Blob?result:new Blob([result],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  return validateOfficeZip(blob,'DOCX');
}

export async function createHwpxBlob(html,{title='document'}={}){
  const {htmlToHwpx}=await import('hwp-convert/browser');
  const bytes=await htmlToHwpx(html,{title,creator:'ZZ Markdown Editor',page:{size:'A4',orientation:'portrait'}});
  const blob=new Blob([bytes],{type:'application/hwp+zip'});
  return validateOfficeZip(blob,'HWPX');
}
