const $=id=>document.getElementById(id);
const state={files:[],images:{},assets:new Map(),active:-1,mode:'convert',theme:localStorage.getItem('md-theme')||'light',lastInput:null,history:[],future:[],restoring:false,editingPreview:false,insertingImage:false,savedSelection:null,lastEditorSelection:{start:0,end:0},lastInsertionSurface:'editor',savedPreviewRange:null,pendingInsertionContext:null,historyTimer:null,dirty:false,savedText:'',collapsedSidebarGroups:{},collapsedMergeGroups:{},stayHomeAfterConvert:false,homeMergeNotice:'',printScale:100,sidebarView:'files'};
let customTheme={
  background:localStorage.getItem('md-custom-theme-bg')||'#f7f7f5',
  text:localStorage.getItem('md-custom-theme-text')||'#111110'
};
let customThemeChannel='background';
const savedOption=(key,fallback=false)=>{
  const value=localStorage.getItem(key);
  return value===null?fallback:value==='1';
};
let hashtagNavigatorEnabled=savedOption('md-option-hashtag-navigator',false);
const collapsedOutlineSections={structure:false,tags:false};
const collapsedOutlineHeadings=new Set();
const imageExt=/\.(png|jpe?g|gif|webp|svg|bmp)$/i,mdExt=/\.(md|markdown)$/i;
const codeLanguageByExt={
  py:'python',pyw:'python',c:'c',h:'c',cc:'cpp',cpp:'cpp',cxx:'cpp',hpp:'cpp',
  java:'java',js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'jsx',
  ts:'typescript',tsx:'tsx',html:'html',htm:'html',css:'css',scss:'scss',sass:'scss',less:'less',
  json:'json',jsonc:'json',xml:'xml',yaml:'yaml',yml:'yaml',toml:'toml',
  ini:'ini',cfg:'ini',conf:'ini',sh:'bash',bash:'bash',zsh:'bash',ps1:'powershell',
  bat:'dos',cmd:'dos',sql:'sql',db:'sql',sqlite:'sql',sqlite3:'sql',
  txt:'plaintext',log:'plaintext',csv:'csv',tsv:'plaintext',
  go:'go',rs:'rust',rb:'ruby',php:'php',swift:'swift',kt:'kotlin',kts:'kotlin',
  dart:'dart',lua:'lua',r:'r',scala:'scala',cs:'csharp',vb:'vbnet',fs:'fsharp',fsx:'fsharp',
  vue:'vue',svelte:'svelte',gradle:'gradle',properties:'properties',env:'bash'
};
const codeLanguageByName={dockerfile:'dockerfile',makefile:'makefile'};
const els={app:$('app'),sidebar:$('sidebar'),list:$('file-list'),outline:$('outline-list'),count:$('file-count'),status:$('status'),editor:$('editor'),markdownHighlight:$('markdown-highlight'),preview:$('preview'),convertPreview:$('convert-preview'),convertList:$('convert-list'),home:$('home'),homeMergeList:$('home-merge-list'),homeImageSummary:$('home-image-summary'),mergeList:$('merge-list'),mergeResult:$('merge-result'),editSplit:$('edit-split'),hoverPreview:$('hover-preview'),lineGutter:$('line-gutter'),previewLineGutter:$('preview-line-gutter'),folderInput:$('folder-input'),fileInput:$('file-input'),imageInput:$('image-input'),pdfInput:$('pdf-input'),homeSource:$('home-source-name'),homeOutput:$('home-output-name'),homeOutputExt:$('home-output-ext')};
// ── Mermaid + marked setup ──
if(window.mermaid){
  mermaid.initialize({startOnLoad:false,theme:'neutral',securityLevel:'loose'});
  const mermaidRenderer={code({text,lang}){
    if(lang==='mermaid')return `<div class="mermaid">${text}</div>`;
    return false;
  }};
  if(window.marked&&marked.use)marked.use({renderer:mermaidRenderer});
}
const parser=window.marked||{parse:s=>s.replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])).replace(/\n/g,'<br>')};
function setStatus(t){els.status.textContent=t}
function setSidebarWidth(px,save=false){const next=Math.max(240,Math.min(520,Math.round(px)));document.documentElement.style.setProperty('--sw',next+'px');if(save)localStorage.setItem('md-sidebar-width',String(next))}
const sidebarUploadPaths=new WeakMap();
state.sidebarFolders=[];
state.sidebarOrder={};
state.assetRoots={};
function pathOf(f){return(sidebarUploadPaths.get(f)||f.webkitRelativePath||f.name).replace(/\\/g,'/')}
function dirOf(p){const a=p.split('/');return a.length>1?a.slice(0,-1).join('/'):''}
function readText(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.onerror=rej;r.readAsText(f)})}
function codeLanguageFor(name){
  const base=String(name||'').split(/[\\/]/).pop().toLowerCase();
  if(codeLanguageByName[base])return codeLanguageByName[base];
  const dot=base.lastIndexOf('.');
  return dot>=0?codeLanguageByExt[base.slice(dot+1)]||'': '';
}
async function isLikelyBinary(file){
  const bytes=new Uint8Array(await file.slice(0,8192).arrayBuffer());
  if(bytes.length>=2&&((bytes[0]===0xff&&bytes[1]===0xfe)||(bytes[0]===0xfe&&bytes[1]===0xff)))return false;
  let controls=0;
  for(const byte of bytes){
    if(byte===0)return true;
    if(byte<7||(byte>13&&byte<32))controls++;
  }
  return bytes.length>0&&controls/bytes.length>.08;
}
function fencedCodeMarkdown(source,language){
  const runs=String(source).match(/`+/g)||[];
  const fence='`'.repeat(Math.max(3,...runs.map(run=>run.length+1)));
  const content=String(source).replace(/^\uFEFF/,'');
  return `${fence}${language||''}\n${content}${content.endsWith('\n')?'':'\n'}${fence}\n`;
}
async function addCodeFile(file){
  const sourcePath=pathOf(file);
  const payload=await codeFilePayload(file);
  if(!payload)return null;
  const {text,language}=payload;
  const path=`${sourcePath}.md`;
  const item={
    name:`${file.name}.md`,
    displayName:`${file.name} → 코드블록`,
    path,
    dir:dirOf(path),
    text,
    savedText:'',
    source:'uploaded',
    convertedFromCode:true,
    originalName:file.name,
    codeLanguage:language
  };
  const old=state.files.findIndex(entry=>entry.path===path);
  old>=0?state.files[old]=item:state.files.push(item);
  state.lastInput={type:'md',name:item.name};
  return item;
}
async function codeFilePayload(file){
  const detectedLanguage=codeLanguageFor(file.name);
  if(!detectedLanguage)return null;
  const binary=await isLikelyBinary(file);
  const source=binary
    ? `바이너리 데이터베이스 파일은 텍스트 코드로 펼칠 수 없습니다.\n파일명: ${file.name}\n크기: ${file.size.toLocaleString()} bytes`
    : await readText(file);
  const language=binary?'plaintext':detectedLanguage;
  return{text:fencedCodeMarkdown(source,language),language};
}
async function insertCodeFilesIntoActiveDocument(files){
  const payloads=(await Promise.all(files.map(codeFilePayload))).filter(Boolean);
  if(!payloads.length)return false;
  const markdown=payloads.map(payload=>payload.text.trimEnd()).join('\n\n')+'\n';
  if(insertPreviewHtml(markdownHtml(markdown)))return true;
  replaceSelection(markdown);
  return true;
}
function canInsertCodeIntoActiveDocument(){
  return state.mode==='edit'&&state.active>=0&&document.querySelector('#panel-edit.active')&&els.home.classList.contains('hidden');
}
const CUSTOM_THEME_VARS=['--bg','--white','--s1','--s2','--s3','--b1','--b2','--t1','--t2','--t3','--ink','--ink-soft','--check-off','--check-mark','--accent','--code-bg','--code-head','--code-text','--code-head-text','--code-border','--sb','--sb2','--sb3','--sbb','--sbt','--sbt2','--sbt3'];
function mixThemeColor(from,to,amount){
  const a=hexToRgb(from),b=hexToRgb(to),ratio=Math.max(0,Math.min(1,amount));
  if(!a||!b)return from;
  return rgbToHex(
    Math.round(a.r+(b.r-a.r)*ratio),
    Math.round(a.g+(b.g-a.g)*ratio),
    Math.round(a.b+(b.b-a.b)*ratio)
  );
}
function themeColorLuminance(color){
  const rgb=hexToRgb(color)||{r:255,g:255,b:255};
  const channel=value=>{const next=value/255;return next<=.03928?next/12.92:Math.pow((next+.055)/1.055,2.4)};
  return .2126*channel(rgb.r)+.7152*channel(rgb.g)+.0722*channel(rgb.b);
}
function themeContrastRatio(foreground,background){
  const light=Math.max(themeColorLuminance(foreground),themeColorLuminance(background));
  const dark=Math.min(themeColorLuminance(foreground),themeColorLuminance(background));
  return (light+.05)/(dark+.05);
}
function ensureThemeTextContrast(color,background,minRatio=4.6){
  if(themeContrastRatio(color,background)>=minRatio)return color;
  const darkTarget='#111110',lightTarget='#ffffff';
  const target=themeContrastRatio(darkTarget,background)>=themeContrastRatio(lightTarget,background)?darkTarget:lightTarget;
  for(let amount=.08;amount<=1.001;amount+=.04){
    const adjusted=mixThemeColor(color,target,Math.min(1,amount));
    if(themeContrastRatio(adjusted,background)>=minRatio)return adjusted;
  }
  return target;
}
function themeColorRgba(color,alpha){
  const rgb=hexToRgb(color)||{r:0,g:0,b:0};
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}
function desaturateThemeColor(color,amount=.88){
  const rgb=hexToRgb(color);
  if(!rgb)return color;
  const gray=Math.round(.299*rgb.r+.587*rgb.g+.114*rgb.b);
  return mixThemeColor(color,rgbToHex(gray,gray,gray),amount);
}
function multiplyThemeColor(base,overlay,opacity=.9){
  const a=hexToRgb(base),b=hexToRgb(overlay);
  if(!a||!b)return base;
  const multiplied=rgbToHex(
    Math.round(a.r*b.r/255),
    Math.round(a.g*b.g/255),
    Math.round(a.b*b.b/255)
  );
  return mixThemeColor(base,multiplied,Math.max(0,Math.min(1,opacity)));
}
function clearCustomThemeVars(){
  CUSTOM_THEME_VARS.forEach(name=>document.body.style.removeProperty(name));
}
function applyCustomThemeVars(){
  const background=normalizeColorValue(customTheme.background)||'#f7f7f5';
  const text=normalizeColorValue(customTheme.text)||'#111110';
  customTheme={background,text};
  const dark=themeColorLuminance(background)<.34;
  const surface=(neutral,opacity=.9)=>multiplyThemeColor(background,neutral,opacity);
  const panelBackground=surface(dark?'#bababa':'#e2e2e2');
  const toolbarBackground=surface(dark?'#a8a8a8':'#d8d8d8');
  const raisedBackground=surface(dark?'#cecece':'#eeeeee');
  const hoverBackground=surface(dark?'#dedede':'#f7f7f7');
  const checkboxOff=dark
    ?mixThemeColor(background,'#b8b8b8',.28)
    :multiplyThemeColor(background,'#8e8e8e',.72);
  const neutralCodeBase=desaturateThemeColor(background,.68);
  const codeBackground=dark
    ?mixThemeColor(neutralCodeBase,'#111318',.28)
    :mixThemeColor(neutralCodeBase,'#ffffff',.58);
  const codeHead=dark
    ?mixThemeColor(codeBackground,'#000000',.15)
    :mixThemeColor(codeBackground,'#111110',.12);
  const codeHeadText=themeColorLuminance(codeHead)<.42?'#ffffff':'#111110';
  const effectiveText=ensureThemeTextContrast(text,panelBackground,5.6);
  const effectiveCodeText=ensureThemeTextContrast(text,codeBackground,5.8);
  const values={
    '--bg':background,
    '--white':panelBackground,
    '--s1':toolbarBackground,
    '--s2':raisedBackground,
    '--s3':hoverBackground,
    '--b1':themeColorRgba(effectiveText,.17),
    '--b2':themeColorRgba(effectiveText,.09),
    '--t1':effectiveText,
    '--t2':mixThemeColor(effectiveText,background,.2),
    '--t3':mixThemeColor(effectiveText,background,.35),
    '--ink':effectiveText,
    '--ink-soft':mixThemeColor(effectiveText,background,.18),
    '--check-off':checkboxOff,
    '--check-mark':background,
    '--accent':dark?mixThemeColor(background,'#ffffff',.38):mixThemeColor(background,'#000000',.3),
    '--code-bg':codeBackground,
    '--code-head':codeHead,
    '--code-text':effectiveCodeText,
    '--code-head-text':codeHeadText,
    '--code-border':themeColorRgba(effectiveCodeText,.2),
    '--sb':surface(dark?'#999999':'#d0d0d0'),
    '--sb2':surface(dark?'#adadad':'#dddddd'),
    '--sb3':surface(dark?'#c2c2c2':'#e9e9e9'),
    '--sbb':themeColorRgba(effectiveText,.12),
    '--sbt':effectiveText,
    '--sbt2':mixThemeColor(effectiveText,background,.2),
    '--sbt3':mixThemeColor(effectiveText,background,.35)
  };
  Object.entries(values).forEach(([name,value])=>document.body.style.setProperty(name,value));
  document.body.classList.toggle('dark',dark);
  document.body.classList.add('custom-theme');
}
function rerenderForTheme(){
  const tableFilters=state.mode==='edit'?snapshotTableFilterView(els.preview):null;
  convertPreviewTheme='';
  mergePreviewTheme='';
  if(state.mode==='convert')updateConvertPreview();
  else if(state.mode==='merge')updateMergePreview();
  else{
    renderMarkdown(els.editor.value);
    restoreTableFilterView(els.preview,tableFilters);
  }
}
function updateThemeFavicon(){
  const themeStyles=getComputedStyle(document.body);
  const background=themeStyles.getPropertyValue('--bg').trim()||(state.theme==='dark'?'#212120':'#f7f7f5');
  const foreground=themeStyles.getPropertyValue('--t1').trim()||(state.theme==='dark'?'#d4d2ce':'#111110');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${background}"/><path d="M11 5 8.5 27M22.5 5 20 27M5 12.5h22M4 20h22" fill="none" stroke="${foreground}" stroke-width="3" stroke-linecap="round"/></svg>`;
  $('app-favicon').href=`data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function applyTheme(theme){
  if(!['light','dark','custom'].includes(theme))theme='light';
  state.theme=theme;
  document.body.classList.remove('custom-theme');
  clearCustomThemeVars();
  if(theme==='custom')applyCustomThemeVars();
  else document.body.classList.toggle('dark',theme==='dark');
  ['light','dark','custom'].forEach(name=>$(`theme-${name}`).classList.toggle('active',theme===name));
  localStorage.setItem('md-theme',theme);
  updateThemeFavicon();
  rerenderForTheme();
}
function imageKeyVariants(value){
  const raw=String(value||'').trim().replace(/^<|>$/g,'').split(/[?#]/)[0];
  const decoded=(()=>{try{return decodeURIComponent(raw)}catch{return raw}})();
  const encoded=encodeURI(decoded);
  const base=decoded.split('/').pop();
  return [...new Set([raw,decoded,encoded,base,encodeURI(base||''),decoded.toLowerCase(),(base||'').toLowerCase()].filter(Boolean))];
}
function addImage(f){const path=pathOf(f),url=URL.createObjectURL(f),parts=path.split('/');[path,f.name,...parts.map((_,i)=>parts.slice(i).join('/'))].flatMap(imageKeyVariants).forEach(k=>{if(k&&!state.images[k])state.images[k]=url})}
async function addMd(f){const path=pathOf(f),text=await readText(f),item={name:f.name,path,dir:dirOf(path),text,savedText:text,source:'uploaded'};const old=state.files.findIndex(x=>x.path===path);old>=0?state.files[old]=item:state.files.push(item);state.lastInput={type:'md',name:f.name};return item}
function imageKeysFor(src,file){
  const clean=(()=>{try{return decodeURIComponent(src)}catch{return src}})().trim().replace(/^<|>$/g,'').replace(/^\.?\//,'').split(/[?#]/)[0];
  const local=normalizeSidebarPath(file&&file.dir?`${file.dir}/${clean}`:clean);
  return [src,clean,local,clean.split('/').pop()].flatMap(imageKeyVariants);
}
function missingImageRefs(file){
  const refs=[...file.text.matchAll(/!\[[^\]]*]\(([^)]+)\)|!\[\[([^\]|]+)(?:\|\d+)?]]/g)]
    .map(m=>(m[1]||m[2]||'').trim())
    .filter(src=>src&&!/^(https?:|data:|blob:|#)/i.test(src));
  return [...new Set(refs.filter(src=>!imageKeysFor(src,file).some(k=>state.images[k])))];
}
function notifyMissingImages(files){
  const missing=[...new Set(files.flatMap(missingImageRefs))];
  if(!missing.length)return;
  const sample=missing.slice(0,3).join(', ');
  alert(`이 문서에는 함께 필요한 이미지가 있어요.\n\nMD 파일만 업로드하면 이미지가 보이지 않을 수 있습니다.\n이미지 파일도 같이 업로드하거나, 폴더 업로드로 MD와 이미지를 한 번에 올려주세요.\n\n확인된 이미지: ${sample}${missing.length>3?' 외 '+(missing.length-3)+'개':''}`);
}
async function addFiles(files){
  const arr=[...files],jobs=[];
  const inlineCodeFiles=canInsertCodeIntoActiveDocument()?arr.filter(file=>codeLanguageFor(file.name)):[];
  if(inlineCodeFiles.length)await insertCodeFilesIntoActiveDocument(inlineCodeFiles);
  const inlineSet=new Set(inlineCodeFiles);
  arr.forEach(f=>{
    const path=pathOf(f);
    if(path)state.assets.set(path,f);
    if(inlineSet.has(f))return;
    if(imageExt.test(f.name))addImage(f);
    else if(mdExt.test(f.name))jobs.push(addMd(f));
    else if(/\.pdf$/i.test(f.name))extractPdf(f);
    else if(codeLanguageFor(f.name))jobs.push(addCodeFile(f));
  });
  if(!jobs.length&&inlineCodeFiles.length===arr.length)return;
  const addedDocs=(await Promise.all(jobs)).filter(Boolean);
  state.files.sort((a,b)=>a.path.localeCompare(b.path,'ko'));
  if(state.active<0&&state.files.length){
    if(state.mode==='convert'){
      state.active=0;
      els.editor.value=state.files[0]?.text||'';
      state.history=[els.editor.value];
      state.savedText=els.editor.value;
    }else openFile(0);
  }
  renderAll();
  notifyMissingImages(addedDocs.filter(file=>!file.convertedFromCode));
  if(typeof scheduleWorkspaceSave==='function')scheduleWorkspaceSave();
}
function resolveImage(src){if(/^(https?:|data:|blob:|#)/i.test(src))return src;const active=state.files[state.active];for(const k of imageKeysFor(src,active)){if(state.images[k])return state.images[k]}return src}
function markdownImageSrc(src){const resolved=resolveImage(src.trim());return /^(https?:|data:|blob:|#)/i.test(resolved)?resolved:encodeURI(resolved)}
let enhancedMarkdownToken=0;
function markdownToken(prefix,block=false){
  const id=`ZZ${prefix}${enhancedMarkdownToken++}TOKEN`;
  return block?`<!--${id}-->`:id;
}
function zzEncodePayload(value){
  const bytes=new TextEncoder().encode(String(value??''));
  let binary='';
  bytes.forEach(byte=>binary+=String.fromCharCode(byte));
  return btoa(binary);
}
function zzDecodePayload(value){
  try{
    const binary=atob(String(value||'').replace(/\s+/g,''));
    const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }catch(_){return''}
}
function extractReferenceSyntax(source,replacements){
  let text=String(source||'');
  const footnotes=new Map(),citations=new Map(),footnoteRaw=[],citationRaw=[];
  const footnotePosition='\uE100ZZ_FOOTNOTE_POSITION\uE101';
  const citationPosition='\uE100ZZ_CITATION_POSITION\uE101';
  let footnotePositionAdded=false,citationPositionAdded=false;
  const kept=[];
  const lines=text.split(/\r?\n/);
  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    const match=line.match(/^\[(\^|@)([^\]]+)\]:[ \t]*(.*)$/);
    if(!match){kept.push(line);continue}
    const body=[match[3]];
    const sourceLines=[line];
    while(index+1<lines.length&&/^(?: {2,}|\t)\S/.test(lines[index+1])){
      index++;
      sourceLines.push(lines[index]);
      body.push(lines[index].replace(/^(?: {2,}|\t)/,''));
    }
    const id=match[2].trim();
    const content=body.join('\n').trim()||'내용을 입력하세요.';
    if(match[1]==='^'){
      footnotes.set(id,content);
      footnoteRaw.push(...sourceLines);
      if(!footnotePositionAdded){kept.push(footnotePosition);footnotePositionAdded=true}
    }else{
      citations.set(id,content);
      citationRaw.push(...sourceLines);
      if(!citationPositionAdded){kept.push(citationPosition);citationPositionAdded=true}
    }
  }
  text=kept.join('\n');
  text=text.replace(/\[\^([^\]]+)\]/g,(_,id)=>{
    const key=id.trim();
    const body=footnotes.get(key);
    return body!==undefined?`<sup class="zz-footnote-ref"><a href="#zz-footnote-${htmlEsc(key)}" title="${htmlEsc(body.replace(/\s+/g,' '))}">[${htmlEsc(key)}]</a></sup>`:_;
  });
  text=text.replace(/\[@([^\]]+)\]/g,(_,id)=>{
    const key=id.trim();
    const body=citations.get(key);
    return body!==undefined?`<a class="zz-citation-ref" href="#zz-citation-${htmlEsc(key)}" title="${htmlEsc(body.replace(/\s+/g,' '))}">[${htmlEsc(key)}]</a>`:_;
  });
  if(footnotes.size){
    const token=markdownToken('FOOTNOTES',true);
    const list=[...footnotes].map(([id,body])=>`<li id="zz-footnote-${htmlEsc(id)}">${parser.parseInline?parser.parseInline(body):htmlEsc(body)}</li>`).join('');
    replacements.set(token,`<section class="reference-list" data-reference-source="${htmlEsc(encodeURIComponent(footnoteRaw.join('\n')))}"><h3>각주</h3><ol>${list}</ol></section>`);
    text=text.replace(footnotePosition,`\n\n${token}\n\n`);
  }
  if(citations.size){
    const token=markdownToken('CITATIONS',true);
    const list=[...citations].map(([id,body])=>`<li id="zz-citation-${htmlEsc(id)}"><strong>${htmlEsc(id)}</strong> ${parser.parseInline?parser.parseInline(body):htmlEsc(body)}</li>`).join('');
    replacements.set(token,`<section class="reference-list" data-reference-source="${htmlEsc(encodeURIComponent(citationRaw.join('\n')))}"><h3>참고문헌</h3><ol>${list}</ol></section>`);
    text=text.replace(citationPosition,`\n\n${token}\n\n`);
  }
  return text;
}
function renderEmbeddedSheet(attrsRaw,payload){
  const attrs=parseZzAttributes(attrsRaw);
  let data={rows:[]};
  try{data=JSON.parse(zzDecodePayload(payload))}catch(_){}
  const rows=Array.isArray(data.rows)?data.rows:[];
  const headers=attrs.headers!=='false';
  const scroll=attrs.scroll!=='false';
  const zoom=Math.max(50,Math.min(200,Number(attrs.zoom)||100))/100;
  const columnName=index=>{let value=index+1,name='';while(value){value--;name=String.fromCharCode(65+value%26)+name;value=Math.floor(value/26)}return name};
  const width=Math.max(280,Number(attrs.width)||720),height=Math.max(150,Number(attrs.height)||360);
  const maxCols=Math.max(0,...rows.map(row=>Array.isArray(row)?row.length:0));
  const visibleCols=Math.min(maxCols,60);
  const visibleRowCount=Math.min(rows.length,Math.max(40,Math.floor(5000/Math.max(1,visibleCols))));
  const visibleRows=rows.slice(0,visibleRowCount);
  const truncated=visibleCols<maxCols||visibleRowCount<rows.length;
  let table='<table class="zz-sheet-table">';
  if(headers)table+=`<thead><tr><th class="zz-row-head"></th>${Array.from({length:visibleCols},(_,i)=>`<th>${columnName(i)}</th>`).join('')}</tr></thead>`;
  table+='<tbody>'+visibleRows.map((row,rowIndex)=>`<tr>${headers?`<th class="zz-row-head">${rowIndex+1}</th>`:''}${Array.from({length:visibleCols},(_,col)=>`<td>${htmlEsc(row?.[col]??'')}</td>`).join('')}</tr>`).join('')+'</tbody></table>';
  const source=`<!-- zz:sheet${attrsRaw} -->\n${payload}\n<!-- /zz:sheet -->`;
  const limit=truncated?`<div class="zz-sheet-limit">큰 시트라 화면에는 ${visibleRowCount}행 × ${visibleCols}열만 표시합니다. 저장 데이터는 유지됩니다.</div>`:'';
  return `<div class="zz-sheet" tabindex="0" aria-label="스프레드시트" data-embed-source="${htmlEsc(encodeURIComponent(source))}" style="width:${width}px;height:${height}px;${scroll?'':'overflow:hidden;'}--sheet-zoom:${zoom}"><div class="zz-embed-head"><span>${htmlEsc(attrs.name||'스프레드시트')}</span><span>${htmlEsc(attrs.sheet||'Sheet1')} · ${htmlEsc(attrs.range||'전체')}</span></div>${table}${limit}</div>`;
}
function renderEmbeddedHtml(attrsRaw,payload){
  const attrs=parseZzAttributes(attrsRaw),source=`<!-- zz:html${attrsRaw} -->\n${payload}\n<!-- /zz:html -->`;
  const html=zzDecodePayload(payload).replace(/<\/script/gi,'<\\/script');
  const width=Math.max(280,Number(attrs.width)||720),height=Math.max(180,Number(attrs.height)||420);
  return `<div class="zz-html-embed" data-embed-source="${htmlEsc(encodeURIComponent(source))}" style="width:${width}px;height:${height}px"><div class="zz-embed-head"><span>${htmlEsc(attrs.name||'HTML 미리보기')}</span><span>읽기 전용</span></div><iframe class="zz-html-frame" sandbox="allow-forms" srcdoc="${htmlEsc(html)}" title="${htmlEsc(attrs.name||'HTML 미리보기')}"></iframe></div>`;
}
function renderEmbeddedDocument(name,mode,start=1,end=20){
  const file=state.files.find(item=>item.name===name||item.path===name||item.name.replace(/\.md$/i,'')===name.replace(/\.md$/i,''));
  const syntax=`[[${name}!${mode}${mode==='MINI'?`:${start}-${end}`:''}]]`;
  if(!file)return `<div class="zz-doc-embed" contenteditable="false" aria-readonly="true" tabindex="0" role="group" data-embed-source="${htmlEsc(encodeURIComponent(syntax))}"><div class="zz-embed-head"><span>${htmlEsc(name)}</span><span>문서를 찾을 수 없음</span></div></div>`;
  const lines=String(file.text||'').split(/\r?\n/);
  const excerpt=mode==='MINI'?lines.slice(Math.max(0,start-1),Math.max(start,end)).join('\n'):lines.join('\n');
  const safe=excerpt.replace(/\[\[([^\]\n!]+)!(?:ALL|MINI)(?::\d+-\d+)?\]\]/gi,'`[중첩 문서]`');
  const content=String(parser.parse(safe)||'');
  return `<div class="zz-doc-embed" contenteditable="false" aria-readonly="true" tabindex="0" role="group" aria-label="${htmlEsc(file.name)} 미니 문서" data-embed-source="${htmlEsc(encodeURIComponent(syntax))}"><div class="zz-embed-head"><span>${htmlEsc(file.name)}</span></div><div class="zz-doc-body">${content}</div></div>`;
}
function parseZzAttributes(raw){
  const attrs={};
  const decode=value=>{
    const textarea=document.createElement('textarea');
    textarea.innerHTML=value;
    return textarea.value;
  };
  String(raw||'').replace(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g,(_,key,a,b,c)=>{attrs[key.toLowerCase()]=decode(a??b??c??'');return''});
  return attrs;
}
function zzHeadingText(value){
  const template=document.createElement('template');
  template.innerHTML=String(value||'');
  return (template.content.textContent||'')
    .replace(/!\[([^\]]*)]\([^)]+\)/g,'$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g,'$1')
    .replace(/^[ \t]*#+[ \t]*/,'')
    .replace(/[*_~`]+/g,'')
    .replace(/&(?:amp|lt|gt|quot|#39);/g,entity=>({
      '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"
    }[entity]||entity))
    .replace(/\s+/g,' ')
    .trim();
}
function zzHeadingSlug(value){
  return zzHeadingText(value)
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s_-]/gu,'')
    .trim()
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')||'section';
}
function zzTocDepth(raw){
  const match=String(raw||'2-4').match(/([1-6])(?:\s*-\s*([1-6]))?/);
  const first=Number(match?.[1]||2),second=Number(match?.[2]||first);
  return[Math.min(first,second),Math.max(first,second)];
}
function zzDocumentHeadings(source,depth='1-6'){
  const[min,max]=zzTocDepth(depth);
  const decoded=String(source||'')
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&amp;/gi,'&');
  const clean=decoded
    .replace(/<!--\s*zz:toc\b[\s\S]*?<!--\s*\/zz:toc\s*-->/gi,'')
    .replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g,'');
  const matches=[];
  for(const match of clean.matchAll(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)){
    matches.push({index:match.index,level:match[1].length,text:zzHeadingText(match[2])});
  }
  for(const match of clean.matchAll(/^[ \t]{0,3}([^\n]+)\n[ \t]{0,3}(=+|-+)[ \t]*$/gm)){
    matches.push({index:match.index,level:match[2][0]==='='?1:2,text:zzHeadingText(match[1])});
  }
  for(const match of clean.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)){
    matches.push({index:match.index,level:Number(match[1]),text:zzHeadingText(match[2])});
  }
  // Preview editing can serialize a Markdown-looking heading as an HTML
  // paragraph (for example <p><span># Title</span></p>). Treat that visible
  // form as a heading too, matching what the document outline shows.
  for(const match of clean.matchAll(/<(p|div)\b[^>]*>([\s\S]*?)<\/\1>/gi)){
    const template=document.createElement('template');template.innerHTML=match[2];
    const visible=(template.content.textContent||'').trim();
    const heading=visible.match(/^(#{1,6})[ \t]+(.+)$/);
    if(heading)matches.push({index:match.index,level:heading[1].length,text:zzHeadingText(heading[2])});
  }
  const used=new Map();
  return matches
    .filter(item=>item.text&&item.level>=min&&item.level<=max)
    .sort((a,b)=>a.index-b.index)
    .map(item=>{
      const base=zzHeadingSlug(item.text),count=used.get(base)||0;
      used.set(base,count+1);
      return{...item,slug:count?`${base}-${count}`:base};
    });
}
function zzLiveDocumentHeadings(depth='1-6'){
  const[min,max]=zzTocDepth(depth),used=new Map(),matches=[];
  if(!els?.preview)return matches;
  els.preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading,index)=>{
    if(heading.closest('.zz-toc,.zz-doc-embed,.zz-html-embed'))return;
    const level=Number(heading.tagName.slice(1));
    const text=zzHeadingText(heading.textContent);
    if(!text||level<min||level>max)return;
    const base=zzHeadingSlug(text),count=used.get(base)||0;
    used.set(base,count+1);
    matches.push({index,level,text,slug:count?`${base}-${count}`:base});
  });
  return matches;
}
function zzCurrentDocumentHeadings(depth='1-6'){
  const source=zzDocumentHeadings(els?.editor?.value||'',depth);
  return source.length?source:zzLiveDocumentHeadings(depth);
}
function zzTocEntries(headings,numbered=true){
  if(!headings.length)return[];
  const baseLevel=Math.min(...headings.map(item=>item.level));
  const counters=Array(7).fill(0);
  return headings.map(item=>{
    counters[item.level]++;
    for(let level=item.level+1;level<counters.length;level++)counters[level]=0;
    for(let level=baseLevel;level<item.level;level++){
      if(!counters[level])counters[level]=1;
    }
    const number=numbered
      ?counters.slice(baseLevel,item.level+1).join('.')
      :'';
    return{...item,depth:Math.max(0,item.level-baseLevel),number};
  });
}
function zzTocOrderedHeadings(headings,rawOrder=''){
  let order=[];
  try{order=decodeURIComponent(String(rawOrder||'')).split('|').filter(Boolean)}catch{}
  if(!order.length)return headings;
  const rank=new Map(order.map((slug,index)=>[slug,index]));
  return [...headings].sort((a,b)=>{
    const ar=rank.has(a.slug)?rank.get(a.slug):Number.MAX_SAFE_INTEGER;
    const br=rank.has(b.slug)?rank.get(b.slug):Number.MAX_SAFE_INTEGER;
    return ar-br||a.index-b.index;
  });
}
function zzTocMarkdown(headings,numbered=true){
  const entries=zzTocEntries(headings,numbered);
  return entries.map(item=>{
    const label=`${item.number?item.number+'. ':''}${item.text}`;
    return`${'  '.repeat(item.depth)}- [${label.replace(/[\[\]]/g,'\\$&')}](#${item.slug})`;
  }).join('\n');
}
function normalizeZzTocMarkers(source){
  return String(source||'')
    .replace(/&lt;!--\s*zz:toc\b([\s\S]*?)--&gt;/gi,(_,attrs)=>`<!-- zz:toc${attrs} -->`)
    .replace(/&lt;!--\s*\/zz:toc\s*--&gt;/gi,'<!-- /zz:toc -->');
}
function refreshZzTocSource(source){
  const raw=String(source||''),original=normalizeZzTocMarkers(raw),edits=[];
  const pattern=/<!--\s*zz:toc\b([^>]*)-->\s*([\s\S]*?)<!--\s*\/zz:toc\s*-->/gi;
  for(const match of original.matchAll(pattern)){
    const attrsRaw=match[1]||'',attrs=parseZzAttributes(attrsRaw);
    const parsed=zzDocumentHeadings(original,attrs.depth||'2-4');
    const headings=zzTocOrderedHeadings(parsed.length?parsed:zzLiveDocumentHeadings(attrs.depth||'2-4'),attrs.order);
    const numbered=/\bnumbered\b/i.test(attrsRaw)&&!/\bnumbered\s*=\s*(?:"?false"?|"?0"?)/i.test(attrsRaw);
    const body=zzTocMarkdown(headings,numbered)||'- 문서에 표시할 제목이 없습니다.';
    const replacement=`<!-- zz:toc${attrsRaw} -->\n${body}\n<!-- /zz:toc -->`;
    if(replacement!==match[0])edits.push({start:match.index,end:match.index+match[0].length,replacement});
  }
  if(!edits.length)return{
    text:original,
    edits:raw===original?edits:[{start:0,end:raw.length,replacement:original}]
  };
  let text=original;
  [...edits].reverse().forEach(edit=>{text=text.slice(0,edit.start)+edit.replacement+text.slice(edit.end)});
  return{
    text,
    edits:raw===original?edits:[{start:0,end:raw.length,replacement:text}]
  };
}
function refreshEditorTocBlocks(){
  if(!/(?:<!--|&lt;!--)\s*zz:toc\b/i.test(els.editor.value))return false;
  const start=els.editor.selectionStart,end=els.editor.selectionEnd;
  const refreshed=refreshZzTocSource(els.editor.value);
  if(refreshed.text===els.editor.value)return false;
  const mapOffset=offset=>{
    let next=offset;
    for(const edit of refreshed.edits){
      if(offset>=edit.end)next+=edit.replacement.length-(edit.end-edit.start);
      else if(offset>edit.start)next=edit.start+Math.min(offset-edit.start,edit.replacement.length);
    }
    return Math.max(0,next);
  };
  els.editor.value=refreshed.text;
  els.editor.setSelectionRange(mapOffset(start),mapOffset(end));
  return true;
}
function renderZzToc(attrsRaw,source){
  const attrs=parseZzAttributes(attrsRaw);
  const style=['default','compact','index'].includes((attrs.style||'').toLowerCase())?attrs.style.toLowerCase():'default';
  const layout=(attrs.layout||'vertical').toLowerCase()==='horizontal'?'horizontal':'vertical';
  const numbered=/\bnumbered\b/i.test(attrsRaw)&&!/\bnumbered\s*=\s*(?:"?false"?|"?0"?)/i.test(attrsRaw);
  const parsed=zzDocumentHeadings(source,attrs.depth||'2-4');
  const headings=zzTocOrderedHeadings(parsed.length?parsed:zzLiveDocumentHeadings(attrs.depth||'2-4'),attrs.order);
  const entries=zzTocEntries(headings,numbered);
  const body=zzTocMarkdown(headings,numbered)||'- 문서에 표시할 제목이 없습니다.';
  const raw=`<!-- zz:toc${attrsRaw||''} -->\n${body}\n<!-- /zz:toc -->`;
  const items=entries.length
    ?entries.map(item=>`<li class="zz-toc-item" data-zz-toc-item="${htmlEsc(item.slug)}" style="--toc-depth:${item.depth};--toc-indent:${item.depth*1.25}em;--toc-compact-indent:${item.depth*.72}em"><a class="zz-toc-link" href="#${htmlEsc(item.slug)}" data-zz-toc-target="${htmlEsc(item.slug)}" title="클릭: 이동 · Ctrl+드래그: 목차 순서 변경">${numbered?`<span class="zz-toc-number">${htmlEsc(item.number)}</span>`:''}<span class="zz-toc-text">${htmlEsc(item.text)}</span></a></li>`).join('')
    :'<li class="zz-toc-item"><span class="zz-toc-link muted">문서에 표시할 제목이 없습니다.</span></li>';
  return `<nav class="zz-toc" data-toc-style="${htmlEsc(style)}" data-toc-layout="${htmlEsc(layout)}" data-toc-numbered="${numbered}" data-toc-source="${htmlEsc(encodeURIComponent(raw))}" aria-label="문서 목차" contenteditable="false"><div class="zz-toc-title">목차</div><ol class="zz-toc-list">${items}</ol></nav>`;
}
function renderMathHtml(latex,displayMode=false){
  const clean=String(latex||'').trim();
  let rendered;
  try{
    rendered=window.katex
      ?katex.renderToString(clean,{displayMode,throwOnError:false,trust:false,strict:'warn',output:'html'})
      :`<code class="zz-math-fallback">${htmlEsc(clean)}</code>`;
  }catch{
    rendered=`<code class="zz-math-fallback">${htmlEsc(clean)}</code>`;
  }
  return `<span class="zz-math${displayMode?' zz-math-block':''}" data-latex="${htmlEsc(clean)}" data-display="${displayMode?'block':'inline'}">${rendered}</span>`;
}
function zzLensSummary(content){
  return String(content||'').split(/\r?\n/)
    .map(line=>line.replace(/^\s*(?:#{1,6}|[-+*]|\d+\.)\s*/,'').replace(/<!--.*?-->/g,'').trim())
    .filter(line=>line&&!/^```|^~~~/.test(line))
    .slice(0,6);
}
function zzLensModeView(type,content,summary){
  if(type==='quiz'){
    const pairs=[];
    const lines=String(content||'').split(/\r?\n/);
    let question='',answer=[];
    const commit=()=>{if(question)pairs.push({question,answer:answer.join(' ').trim()||'내용을 다시 확인해 보세요.'});question='';answer=[]};
    lines.forEach(line=>{
      const q=line.match(/^\s*(?:Q(?:uestion)?[:.]|#{1,6}\s+)(.+)$/i);
      const a=line.match(/^\s*A(?:nswer)?[:.]\s*(.+)$/i);
      if(q){commit();question=q[1].trim()}
      else if(a)answer.push(a[1].trim());
      else if(question&&line.trim())answer.push(line.replace(/^\s*[-+*]\s*/,'').trim());
    });
    commit();
    if(!pairs.length&&summary.length>1)pairs.push({question:summary[0],answer:summary.slice(1).join(' · ')});
    return pairs.length
      ?pairs.map(pair=>`<details class="obsidian-callout" data-callout="question"><summary class="obsidian-callout-title">${htmlEsc(pair.question)}</summary><div class="obsidian-callout-body">${htmlEsc(pair.answer)}</div></details>`).join('')
      :'<span class="muted">Q: 질문 / A: 답 형식으로 내용을 작성해 주세요.</span>';
  }
  if(type==='timeline'){
    return summary.length?`<div class="zz-lens-summary">${summary.map((line,index)=>`<span><b>${index+1}</b> ${htmlEsc(line)}</span>`).join('')}</div>`:'<span class="muted">시간 순서의 항목을 작성해 주세요.</span>';
  }
  return summary.length
    ?`<div class="zz-lens-summary">${summary.map(line=>`<span>${htmlEsc(line)}</span>`).join('')}</div>`
    :'<span class="muted">요약할 문장이 없습니다.</span>';
}
function renderZzLens(attrsRaw,content){
  const attrs=parseZzAttributes(attrsRaw);
  const type=(attrs.type||'note').toLowerCase();
  const title=attrs.title||'핵심 정리';
  const summary=zzLensSummary(content);
  const relations=[...new Set([
    ...[...String(content).matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(match=>match[1].trim()),
    ...[...String(content).matchAll(/(?:^|\s)#([A-Za-z가-힣][\w가-힣/-]*)/g)].map(match=>match[1])
  ])].slice(0,16);
  const note=markdownHtml(content);
  const modeLabel=type==='quiz'?'문답':type==='timeline'?'시간순':type==='compare'?'비교':'핵심 요약';
  const summaryHtml=zzLensModeView(type,content,summary);
  const relationHtml=relations.length
    ?`<div class="zz-lens-relations">${relations.map(item=>`<button type="button" data-zz-target="${htmlEsc(item)}">${htmlEsc(item)}</button>`).join('')}</div>`
    :'<span class="muted">연결된 위키 링크나 해시태그가 없습니다.</span>';
  return `<section class="zz-lens" data-lens-type="${htmlEsc(type)}" data-lens-source="${htmlEsc(encodeURIComponent(`<!-- zz:lens${attrsRaw||''} -->\n${content}\n<!-- /zz:lens -->`))}">
    <header class="zz-lens-head" contenteditable="false"><span class="zz-lens-badge">${htmlEsc(modeLabel)} 보기</span><span class="unique-block-title" data-unique-title contenteditable="true" tabindex="0" spellcheck="true">${htmlEsc(title)}</span><nav class="zz-lens-tabs"><button class="zz-lens-tab active" type="button" data-lens-panel="note">원문</button><button class="zz-lens-tab" type="button" data-lens-panel="summary">${modeLabel}</button><button class="zz-lens-tab" type="button" data-lens-panel="relations">관련 항목</button></nav></header>
    <div class="zz-lens-panel" data-panel="note">${note}</div>
    <div class="zz-lens-panel" data-panel="summary" hidden>${summaryHtml}</div>
    <div class="zz-lens-panel" data-panel="relations" hidden>${relationHtml}</div>
  </section>`;
}
function renderZzSync(id,content){
  const cleanId=String(id||'sync').trim()||'sync';
  const source=`<!-- zz:sync id="${cleanId.replace(/"/g,'&quot;')}" -->\n${content}\n<!-- /zz:sync -->`;
  return `<section class="zz-sync-block" data-sync-id="${htmlEsc(cleanId)}" data-sync-source="${htmlEsc(encodeURIComponent(source))}">
    <header class="zz-sync-head" contenteditable="false"><svg class="zz-sync-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h9a4 4 0 0 1 4 4v1M17 17H8a4 4 0 0 1-4-4v-1M17 4l3 3-3 3M7 20l-3-3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>동기화</span><span class="zz-sync-id">${htmlEsc(cleanId)}</span></header>
    <div class="zz-sync-body">${markdownHtml(content)}</div>
  </section>`;
}
function extractObsidianCallouts(source,replacements){
  const lines=String(source).split('\n'),output=[];
  for(let i=0;i<lines.length;i++){
    const first=lines[i].match(/^>\s*\[!([A-Za-z][\w-]*)\]([+-])?\s*(.*)$/);
    if(!first){output.push(lines[i]);continue}
    const firstLine=lines[i];
    const body=[];
    while(i+1<lines.length&&/^>/.test(lines[i+1]))body.push(lines[++i].replace(/^>\s?/,''));
    const type=first[1].toLowerCase();
    const defaults={note:'노트',abstract:'요약',info:'정보',todo:'할 일',tip:'팁',success:'성공',question:'질문',warning:'주의',caution:'주의',failure:'실패',danger:'위험',bug:'버그',example:'예시',quote:'인용',important:'중요'};
    const title=first[3]||defaults[type]||first[1];
    const token=markdownToken('CALLOUT',true);
    const open=first[2]==='-'?'':' open';
    const sourceText=[firstLine,...body.map(line=>`> ${line}`)].join('\n');
    replacements.set(token,`<details class="obsidian-callout" data-callout="${htmlEsc(type)}" data-callout-source="${htmlEsc(encodeURIComponent(sourceText))}"${open}><summary class="obsidian-callout-title" contenteditable="false"><button class="structured-collapse-toggle" type="button" aria-label="접기 또는 펼치기"></button><span class="unique-block-title" data-unique-title contenteditable="true" tabindex="0" spellcheck="true">${htmlEsc(title)}</span></summary><div class="obsidian-callout-body">${markdownHtml(body.join('\n'))}</div></details>`);
    output.push(token);
  }
  return output.join('\n');
}
function restoreEscapedFormControls(source){
  const text=String(source||'');
  if(!/&lt;(?:label|button)\s+class=(?:&quot;|")zz-form-control/i.test(text))return text;
  const decode=value=>{
    const field=document.createElement('textarea');
    field.innerHTML=value;
    return field.value;
  };
  return text.replace(/<p>\s*(&lt;(label|button)\s+class=(?:&quot;|")zz-form-control(?:&quot;|")[\s\S]*?&lt;\/\2&gt;)\s*<\/p>/gi,(whole,encoded)=>{
    const template=document.createElement('template');
    template.innerHTML=decode(encoded).trim();
    const control=template.content.firstElementChild;
    if(!control||template.content.children.length!==1||!control.classList.contains('zz-form-control'))return whole;
    if(control.tagName==='BUTTON'){
      return `<button class="zz-form-control" type="button">${htmlEsc(control.textContent.trim()||'명령')}</button>`;
    }
    if(control.tagName!=='LABEL')return whole;
    const input=control.querySelector(':scope > input');
    const select=control.querySelector(':scope > select');
    const labelCopy=control.cloneNode(true);
    labelCopy.querySelector(':scope > input,:scope > select')?.remove();
    const label=htmlEsc(labelCopy.textContent.trim()||'항목');
    if(select){
      const options=[...select.options].map(option=>`<option value="${htmlEsc(option.value)}"${option.selected||option.hasAttribute('selected')?' selected':''}>${htmlEsc(option.textContent)}</option>`).join('');
      return `<label class="zz-form-control">${label} <select>${options||'<option>선택 1</option>'}</select></label>`;
    }
    if(!input)return whole;
    const type=(input.getAttribute('type')||'text').toLowerCase();
    if(type==='checkbox'||type==='radio')return `<label class="zz-form-control"><input type="${type}"${input.checked||input.hasAttribute('checked')?' checked':''}> ${label}</label>`;
    return `<label class="zz-form-control">${label} <input type="text" value="${htmlEsc(input.value||input.getAttribute('value')||'')}" placeholder="${htmlEsc(input.getAttribute('placeholder')||'입력')}"></label>`;
  });
}
function normalizeFormControlHtml(source){
  const template=document.createElement('template');
  template.innerHTML=String(source||'').trim();
  const control=template.content.firstElementChild;
  if(!control||template.content.children.length!==1||!control.classList.contains('zz-form-control'))return'';
  const labelText=control.querySelector(':scope > .zz-form-label')?.textContent
    ||[...control.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ')
    ||'항목';
  const label=`<span class="zz-form-label">${htmlEsc(labelText.trim()||'항목')}</span>`;
  if(control.tagName==='BUTTON')return `<button class="zz-form-control" type="button">${label}</button>`;
  if(control.tagName!=='LABEL')return'';
  const select=control.querySelector(':scope > select');
  if(select){
    const options=[...select.options].map(option=>`<option value="${htmlEsc(option.value)}"${option.selected||option.hasAttribute('selected')?' selected':''}>${htmlEsc(option.textContent)}</option>`).join('');
    return `<label class="zz-form-control">${label}<select>${options||'<option value="option-1">선택 1</option>'}</select></label>`;
  }
  const input=control.querySelector(':scope > input');
  if(!input)return'';
  const type=(input.getAttribute('type')||'text').toLowerCase();
  if(type==='checkbox'||type==='radio'){
    return `<label class="zz-form-control"><input type="${type}"${input.checked||input.hasAttribute('checked')?' checked':''}>${label}</label>`;
  }
  return `<label class="zz-form-control">${label}<input type="text" value="${htmlEsc(input.value||input.getAttribute('value')||'')}" placeholder="${htmlEsc(input.getAttribute('placeholder')||'입력')}"></label>`;
}
function extractFormControls(source,replacements){
  return String(source||'').replace(/<label\b[^>]*class=(?:"[^"]*\bzz-form-control\b[^"]*"|'[^']*\bzz-form-control\b[^']*')[^>]*>[\s\S]*?<\/label>|<button\b[^>]*class=(?:"[^"]*\bzz-form-control\b[^"]*"|'[^']*\bzz-form-control\b[^']*')[^>]*>[\s\S]*?<\/button>/gi,match=>{
    const normalized=normalizeFormControlHtml(match);
    if(!normalized)return match;
    const token=markdownToken('FORM');
    replacements.set(token,normalized);
    return token;
  });
}
function preprocessEnhancedMarkdown(source){
  const replacements=new Map();
  let text=restoreEscapedFormControls(source);
  text=text.replace(/<!--\s*(?:StartFragment|EndFragment)\s*-->/gi,'').replace(/\b(?:StartFragment|EndFragment)\b/gi,'');
  text=extractFormControls(text,replacements);
  text=extractReferenceSyntax(text,replacements);
  text=text.replace(/&lt;!--\s*(\/?zz:(?:lens|sync|toc)\b[\s\S]*?)--&gt;/gi,(_,body)=>{
    const decoded=body
      .replace(/&quot;/gi,'"')
      .replace(/&#0*39;|&apos;/gi,"'")
      .replace(/&gt;/gi,'>')
      .replace(/&lt;/gi,'<')
      .replace(/&amp;/gi,'&');
    return `<!-- ${decoded.trim()} -->`;
  });
  const tocSource=text;
  text=text.replace(/<!--\s*zz:toc\b([^>]*)-->\s*([\s\S]*?)<!--\s*\/zz:toc\s*-->/gi,(_,attrs)=>{
    const token=markdownToken('TOC',true);
    replacements.set(token,renderZzToc(attrs,tocSource));
    return token;
  });
  const syncContents=new Map();
  text=text.replace(/<!--\s*zz:sync\s+id\s*=\s*"([^"]+)"\s*-->\s*([\s\S]*?)<!--\s*\/zz:sync\s*-->/gi,(_,id,content)=>{
    const key=id.trim().toLowerCase();
    if(!syncContents.has(key))syncContents.set(key,content.trim());
    const canonical=syncContents.get(key);
    const token=markdownToken('SYNC',true);
    replacements.set(token,renderZzSync(id.trim(),canonical));
    return token;
  });
  text=text.replace(/<!--\s*zz:lens\b([^>]*)-->\s*([\s\S]*?)<!--\s*\/zz:lens\s*-->/gi,(_,attrs,content)=>{
    const token=markdownToken('LENS',true);
    replacements.set(token,renderZzLens(attrs,content.trim()));
    return token;
  });
  text=text.replace(/<!--\s*zz:sheet\b([^>]*)-->\s*([A-Za-z0-9+/=]+)\s*<!--\s*\/zz:sheet\s*-->/gi,(_,attrs,payload)=>{
    const token=markdownToken('SHEET',true);
    replacements.set(token,renderEmbeddedSheet(attrs,payload));
    return token;
  });
  text=text.replace(/<!--\s*zz:html\b([^>]*)-->\s*([A-Za-z0-9+/=]+)\s*<!--\s*\/zz:html\s*-->/gi,(_,attrs,payload)=>{
    const token=markdownToken('HTML',true);
    replacements.set(token,renderEmbeddedHtml(attrs,payload));
    return token;
  });
  text=text.replace(/\[\[([^\]\n!]+)!((?:ALL)|(?:MINI))(?:\s*:\s*(\d+)\s*-\s*(\d+))?\]\]/gi,(_,name,mode,start,end)=>{
    const token=markdownToken('DOCEMBED',true);
    replacements.set(token,renderEmbeddedDocument(name.trim(),mode.toUpperCase(),Number(start)||1,Number(end)||20));
    return token;
  });
  text=extractObsidianCallouts(text,replacements);
  // ChatGPT-style source chips: ``[label](url) or ``https://example.com
  text=text.replace(/``\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi,(_,label,url)=>{
    const token=markdownToken('SOURCECHIP');
    replacements.set(token,`<a class="zz-source-chip" href="${htmlEsc(url)}" title="${htmlEsc(url)}"><span class="zz-source-chip-label">${htmlEsc(label.trim())}</span></a>`);
    return token;
  });
  text=text.replace(/``(https?:\/\/[^\s<]+)/gi,(_,rawUrl)=>{
    const trailing=(rawUrl.match(/[.,!?;:]+$/)||[''])[0];
    const url=trailing?rawUrl.slice(0,-trailing.length):rawUrl;
    let label=url;
    try{label=new URL(url).hostname.replace(/^www\./,'')}catch{}
    const token=markdownToken('SOURCECHIP');
    replacements.set(token,`<a class="zz-source-chip" href="${htmlEsc(url)}" title="${htmlEsc(url)}"><span class="zz-source-chip-label">${htmlEsc(label)}</span></a>`);
    return token+trailing;
  });
  const protectedSegments=[];
  text=text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`+[^`\n]*`+/g,segment=>{
    const token=markdownToken('PROTECTED');
    protectedSegments.push([token,segment]);
    return token;
  });
  text=text.replace(/\$\$([\s\S]+?)\$\$/g,(_,latex)=>{
    const token=markdownToken('MATHBLOCK',true);
    replacements.set(token,renderMathHtml(latex,true));
    return token;
  });
  text=text.replace(/(^|[^\\$])\$([^$\n]+?)\$/g,(_,prefix,latex)=>{
    const token=markdownToken('MATHINLINE');
    replacements.set(token,renderMathHtml(latex,false));
    return prefix+token;
  });
  text=text.replace(/(?<!!)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,(_,file,heading,alias)=>{
    const label=(alias||heading||file).trim();
    return `<a class="zz-wikilink" href="#" data-wiki-file="${htmlEsc(file.trim())}" data-wiki-heading="${htmlEsc((heading||'').trim())}">${htmlEsc(label)}</a>`;
  });
  text=text.replace(/==([^=\n]+)==/g,'<mark class="obsidian-highlight">$1</mark>');
  protectedSegments.forEach(([token,segment])=>{text=text.replace(token,()=>segment)});
  return{text,replacements};
}
function markdownHtml(text){
  const src=String(text??'');
  const enhanced=preprocessEnhancedMarkdown(src);
  const w=enhanced.text
    .replace(/!\[\[([^\]|]+)(?:\|\d+)?\]\]/g,(_,s)=>`![](${markdownImageSrc(s)})`)
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g,(_,alt,s)=>`![${alt}](${markdownImageSrc(s)})`);
  let html=String(parser.parse(w)||'').replace(/<img src="([^"]+)"/g,(_,s)=>`<img src="${markdownImageSrc(s)}"`);
  enhanced.replacements.forEach((value,token)=>{
    html=html.replace(`<p>${token}</p>`,value).replace(token,value);
  });
  return html;
}
function standardMarkdownHtml(text){
  const source=String(text??'')
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g,(_,alt,src)=>`![${alt}](${markdownImageSrc(src)})`);
  return String(parser.parse(source)||'')
    .replace(/<img src="([^"]+)"/g,(_,src)=>`<img src="${markdownImageSrc(src)}"`);
}
function installColorEyedroppers(){
  document.querySelectorAll('.cp-picker-top,.custom-theme-head').forEach(header=>{
    if(header.querySelector('.cp-eyedropper'))return;
    const scope=header.parentElement;
    const input=scope.querySelector('input.cp-hex')||scope.parentElement?.querySelector('input.cp-hex');
    if(!input)return;
    const button=document.createElement('button');button.type='button';button.className='cp-eyedropper';
    button.title='스포이드 · 화면에서 색 선택 (Esc로 취소)';button.setAttribute('aria-label','스포이드로 화면 색 선택');
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14 5 5 5M16 3a3 3 0 0 1 4 4l-3 3-3-3 2-4ZM14 7 4 17l-1 4 4-1L17 10M7 14l3 3"/></svg>';
    button.addEventListener('mousedown',event=>{event.preventDefault();rememberPreviewRange()});
    button.addEventListener('click',async event=>{
      event.preventDefault();event.stopPropagation();
      if(!window.EyeDropper){showInfoNotice('스포이드 사용 불가','현재 브라우저에서는 화면 색 선택을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 사용해 주세요.');return}
      button.disabled=true;
      try{
        const result=await new window.EyeDropper().open();
        if(!input.isConnected)return;
        setHexInputValue(input,result.sRGBHex);
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }catch(error){if(error.name!=='AbortError')showInfoNotice('스포이드 오류','색을 선택하지 못했습니다. 브라우저에서 화면 색 선택이 허용되는지 확인해 주세요.')}
      finally{button.disabled=false}
    });
    header.firstElementChild?.after(button);
  });
}
function updateInlineCodeInk(){
  const parse=value=>{const n=value.match(/[\d.]+/g)?.map(Number)||[];return n.length>=3?[n[0],n[1],n[2],n[3]??1]:[0,0,0,0]};
  const blend=(front,back)=>front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3]));
  const lum=rgb=>rgb.reduce((sum,v,i)=>{v/=255;return sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i]},0);
  const contrast=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  document.querySelectorAll('[data-inline-code-ink]').forEach(el=>el.removeAttribute('data-inline-code-ink'));
  document.querySelectorAll('[data-code-surface]').forEach(el=>{el.removeAttribute('data-code-surface');el.style.removeProperty('--code-surface-fix')});
  const corrections=[];
  document.querySelectorAll('.preview code:not(pre code),.preview code:not(pre code) *').forEach(el=>{
    if(![...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim()))return;
    const layers=[];for(let node=el;node;node=node.parentElement)layers.push(parse(getComputedStyle(node).backgroundColor));
    const background=layers.reverse().reduce((back,front)=>blend(front,back),[255,255,255]);
    const ink=blend(parse(getComputedStyle(el).color),background),bg=lum(background);
    if(contrast(lum(ink),bg)<4.5){
      const target=contrast(lum(ink),1)>contrast(lum(ink),0)?255:0;
      let adjusted=background;
      for(let amount=.05;amount<=1.001;amount+=.05){adjusted=background.map(v=>Math.round(v*(1-amount)+target*amount));if(contrast(lum(ink),lum(adjusted))>=4.5)break}
      corrections.push([el,`rgb(${adjusted.join(',')})`]);
    }
  });
  corrections.forEach(([el,color])=>{el.dataset.codeSurface='1';el.style.setProperty('--code-surface-fix',color)});
}
let chipContrastFrame=0;
const chipContrastObserver=new MutationObserver(()=>{
  if(chipContrastFrame)return;
  chipContrastFrame=requestAnimationFrame(()=>{
    chipContrastFrame=0;chipContrastObserver.disconnect();
    try{installColorEyedroppers();updateInlineCodeInk();installTableFilters()}finally{chipContrastObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class']})}
  });
});
chipContrastObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class']});
installColorEyedroppers();
function fixSpanColors(container){
  if(!colorCorrectEnabled)return;
  const isDark=document.body.classList.contains('dark');
  const isCustom=document.body.classList.contains('custom-theme');
  const hasCustomBackground=el=>{
    for(let node=el;node&&node!==container;node=node.parentElement){
      const style=node.getAttribute?.('style')||'';
      if(/(?:^|;)\s*background(?:-color)?\s*:\s*(?!transparent|initial|inherit|unset|none)(#[0-9a-fA-F]{3,8}|rgb|hsl|[a-z])/i.test(style))return true;
    }
    return false;
  };
  container.querySelectorAll('[style*="color"]').forEach(el=>{
    if(hasCustomBackground(el))return;
    const m=(el.getAttribute('style')||'').match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8})/i);
    if(!m)return;
    let hex=m[1];
    if(hex.length===4)hex='#'+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    const lum=(0.299*r+0.587*g+0.114*b)/255;
    const neutral=Math.max(r,g,b)-Math.min(r,g,b)<22;
    if(isCustom&&neutral&&(lum>0.82||lum<0.18))el.style.color='var(--t1)';
    else if(!isDark&&lum>0.82)el.style.color='#111111';
    else if(isDark&&lum<0.18)el.style.color='#d4d2ce';
  });
}
function runMermaid(container){
  if(!window.mermaid)return;
  const els2=container.querySelectorAll('.mermaid:not([data-processed])');
  if(els2.length)mermaid.run({nodes:els2});
}
function runHighlight(container){
  if(!window.hljs)return;
  container.querySelectorAll('pre code').forEach(block=>{
    const explicitNone=block.hasAttribute('data-code-language')&&!block.dataset.codeLanguage;
    if(explicitNone){
      block.className='hljs';
      block.dataset.highlighted='yes';
    }else if(!block.dataset.highlighted){
      hljs.highlightElement(block);
    }
    block.style.background='transparent';
    const pre=block.closest('pre');
    if(pre){
      pre.style.removeProperty('background');
      if(!pre.getAttribute('style'))pre.removeAttribute('style');
    }
  });
}
let editableCodeHighlightTimer=null,pendingEditableCode=null;
function scheduleEditableCodeHighlight(code){
  if(!code||code.closest('.code-head'))return;
  pendingEditableCode=code;
  clearTimeout(editableCodeHighlightTimer);
  editableCodeHighlightTimer=setTimeout(()=>{
    editableCodeHighlightTimer=null;
    const target=pendingEditableCode;
    pendingEditableCode=null;
    if(!target?.isConnected||!els.preview.contains(target)||!window.hljs)return;
    const language=codeLanguage(target);
    if(!language||!hljs.getLanguage(language))return;
    const selection=window.getSelection();
    const live=selection?.rangeCount?selection.getRangeAt(0):null;
    let caretOffset=null;
    if(live&&target.contains(live.endContainer)){
      const before=document.createRange();
      before.selectNodeContents(target);
      before.setEnd(live.endContainer,live.endOffset);
      caretOffset=before.toString().replace(/\u200b/g,'').length;
    }
    const text=target.textContent.replace(/\u200b/g,'');
    target.replaceChildren(document.createTextNode(text));
    target.className=`language-${language}`;
    target.removeAttribute('data-highlighted');
    hljs.highlightElement(target);
    target.style.background='transparent';
    if(caretOffset!==null)placeCaretAtPreviewTextOffset(target,caretOffset);
  },110);
}
/* ── Table resize ── */
const CODE_LANGUAGES=[
  ['', '없음'],['python','Python'],['java','Java'],['c','C'],['cpp','C++'],['csharp','C#'],
  ['javascript','JavaScript'],['typescript','TypeScript'],['html','HTML'],['css','CSS'],['json','JSON'],
  ['bash','Bash / Shell'],['sql','SQL'],['markdown','Markdown'],['yaml','YAML'],['go','Go'],
  ['rust','Rust'],['kotlin','Kotlin'],['swift','Swift'],['php','PHP'],['ruby','Ruby'],['r','R']
];
let codeLangMenu=null,activeLanguageCode=null;
function codeLanguage(code){
  if(code.hasAttribute('data-code-language'))return code.dataset.codeLanguage||'';
  const cls=[...code.classList].find(name=>name.startsWith('language-'));
  return cls?cls.slice(9):'';
}
function codeLanguageLabel(value){return CODE_LANGUAGES.find(([key])=>key===value)?.[1]||value}
function closeCodeLanguageMenu(){if(codeLangMenu)codeLangMenu.remove();codeLangMenu=null;activeLanguageCode=null}
function applyCodeLanguage(code,value,label){
  const text=code.textContent;
  code.replaceChildren(document.createTextNode(text));
  code.className=value?`language-${value}`:'';
  if(value)code.removeAttribute('data-code-language');
  else code.setAttribute('data-code-language','');
  code.removeAttribute('data-highlighted');
  const button=code.closest('.code-block')?.querySelector('.code-lang');
  if(button){button.textContent=value?(label||codeLanguageLabel(value)):'\u00a0';button.title=value?`언어: ${label||value}`:'언어 없음'}
  runHighlight(els.preview);
  syncFromPreview();
  pushHistory(true);
}
function openCodeLanguageMenu(button,code){
  closeCodeLanguageMenu();
  activeLanguageCode=code;
  const current=codeLanguage(code);
  const menu=document.createElement('div');
  menu.className='code-lang-menu';
  menu.contentEditable='false';
  const list=document.createElement('div');
  list.className='code-lang-list';
  CODE_LANGUAGES.forEach(([value,label])=>{
    const item=document.createElement('button');
    item.type='button';
    item.textContent=label;
    item.classList.toggle('active',value===current);
    item.onclick=e=>{e.stopPropagation();applyCodeLanguage(code,value,label);closeCodeLanguageMenu()};
    list.appendChild(item);
  });
  const custom=document.createElement('div');
  custom.className='code-lang-custom';
  const customInput=document.createElement('input');
  customInput.type='text';
  customInput.placeholder='직접 입력';
  customInput.autocomplete='off';
  customInput.spellcheck=false;
  if(current&&!CODE_LANGUAGES.some(([value])=>value===current))customInput.value=current;
  const customApply=document.createElement('button');
  customApply.type='button';
  customApply.textContent='✓';
  customApply.title='언어 적용';
  customApply.setAttribute('aria-label','언어 적용');
  const applyCustom=()=>{
    const label=customInput.value.trim();
    if(!label){customInput.focus();return}
    const value=label.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9_+#.-]/g,'');
    if(!value){customInput.focus();return}
    applyCodeLanguage(code,value,label);
    closeCodeLanguageMenu();
  };
  customInput.onclick=e=>e.stopPropagation();
  customInput.onkeydown=e=>{
    e.stopPropagation();
    if(e.key==='Enter'){e.preventDefault();applyCustom()}
    else if(e.key==='Escape'){e.preventDefault();closeCodeLanguageMenu()}
  };
  customApply.onclick=e=>{e.stopPropagation();applyCustom()};
  custom.append(customInput,customApply);
  menu.append(list,custom);
  document.body.appendChild(menu);
  codeLangMenu=menu;
  const r=button.getBoundingClientRect();
  menu.style.top=(r.bottom+5)+'px';
  menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';
}
function makeMoveHandle(title='드래그해서 위치 이동'){
  const handle=document.createElement('span');
  handle.className='block-move-handle';
  handle.textContent='⋮⋮';
  handle.title=title;
  handle.draggable=false;
  handle.tabIndex=0;
  handle.setAttribute('role','button');
  handle.contentEditable='false';
  handle.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handle.click()}};
  return handle;
}
function decorateCodeBlocks(container){
  container.querySelectorAll('pre').forEach(pre=>{
    if(pre.closest('.code-block'))return;
    const code=pre.querySelector('code');
    if(!code)return;
    const wrap=document.createElement('div');
    wrap.className='code-block';
    const head=document.createElement('div');
    head.className='code-head';
    head.contentEditable='false';
    const language=codeLanguage(code);
    const main=document.createElement('span');main.className='code-head-main';
    const collapse=document.createElement('button');collapse.type='button';collapse.className='code-collapse';collapse.title='코드블록 접기';collapse.setAttribute('aria-label','코드블록 접기');collapse.setAttribute('aria-expanded','true');collapse.innerHTML='<span class="code-collapse-icon" aria-hidden="true">▾</span>';
    collapse.onclick=e=>{e.preventDefault();e.stopPropagation();const collapsed=wrap.classList.toggle('collapsed');collapse.setAttribute('aria-expanded',String(!collapsed));collapse.setAttribute('aria-label',collapsed?'코드블록 펼치기':'코드블록 접기');collapse.title=collapsed?'코드블록 펼치기':'코드블록 접기'};
    if(container===els.preview){
      const langButton=document.createElement('button');
      langButton.type='button';
      langButton.className='code-lang';
      langButton.textContent=language?codeLanguageLabel(language):'\u00a0';
      langButton.title=language?`언어: ${codeLanguageLabel(language)}`:'언어 없음';
      langButton.onclick=e=>{e.preventDefault();e.stopPropagation();openCodeLanguageMenu(langButton,code)};
      main.append(collapse,langButton);head.append(main,makeMoveHandle('코드 블록 위치 이동'));
    }else{
      const label=document.createElement('span');
      label.className='code-lang';
      label.textContent=language?codeLanguageLabel(language):'\u00a0';
      main.append(collapse,label);head.appendChild(main);
    }
    pre.before(wrap);
    wrap.append(head,pre);
  });
}
function addMovableElements(root){
  if(root!==els.preview)return;
  root.querySelectorAll('table').forEach(table=>{
    if(table.querySelector('.table-move-handle'))return;
    const host=table.querySelector('tr:first-child > :last-child');
    if(!host)return;
    const handle=makeMoveHandle('표 위치 이동');
    handle.classList.add('table-move-handle');
    host.appendChild(handle);
  });
  root.querySelectorAll('blockquote').forEach(blockquote=>{
    if(!blockquote.querySelector(':scope > .block-move-handle'))blockquote.appendChild(makeMoveHandle('인용 위치 이동'));
  });
  root.querySelectorAll('.zz-lens,.obsidian-callout,.zz-sync-block,.zz-toc,.zz-sheet,.zz-html-embed,.zz-doc-embed,.reference-list').forEach(block=>{
    if(block.querySelector(':scope > .unique-block-move-handle'))return;
    const label=block.matches('.zz-lens')?'다중 보기':block.matches('.zz-sync-block')?'동기화 블록':block.matches('.zz-toc')?'문서 목차':block.matches('.obsidian-callout')?'콜아웃':block.matches('.reference-list')?'각주·참고문헌':'임베드';
    const handle=makeMoveHandle(`${label} 위치 이동`);
    handle.classList.add('unique-block-move-handle');
    block.appendChild(handle);
  });
  root.querySelectorAll('img,a,code:not(pre code),hr,.zz-math,.zz-form-control,mark.obsidian-highlight').forEach(el=>{
    if(el.matches('a.zz-toc-link')||el.closest('.zz-toc')){
      el.removeAttribute('data-movable');
      el.draggable=el.matches('a.zz-toc-link');
      return;
    }
    if(el.matches('code')&&el.closest('.zz-math'))return;
    el.dataset.movable='1';
    el.draggable=!el.matches('img,.zz-form-control');
    if(el.matches('a.zz-source-chip')&&!el.querySelector(':scope > .zz-source-chip-edit')){
      const edit=document.createElement('button');
      edit.type='button';
      edit.className='zz-source-chip-edit';
      edit.textContent='✎';
      edit.title='출처 문구 수정';
      edit.setAttribute('aria-label','출처 문구 수정');
      edit.contentEditable='false';
      el.appendChild(edit);
    }
    if(el.matches('.zz-form-control')){
      el.contentEditable='false';
      el.removeAttribute('disabled');
      ensureEditableFormLabel(el);
      if(!el.querySelector(':scope > .form-move-handle')){
        const handle=document.createElement('span');
        handle.className='form-move-handle';
        handle.textContent='⠿';
        handle.title='이 양식만 드래그해서 이동';
        handle.tabIndex=0;
        handle.setAttribute('role','button');
        handle.setAttribute('aria-label','양식 위치 이동');
        handle.contentEditable='false';
        handle.onkeydown=event=>{
          if(event.key==='Enter'||event.key===' '){
            event.preventDefault();
            handle.click();
          }
        };
        el.prepend(handle);
      }
      el.querySelectorAll('input,select,button').forEach(field=>{
        field.removeAttribute('disabled');
        field.removeAttribute('readonly');
        field.disabled=false;
        if('readOnly' in field)field.readOnly=false;
      });
    }
    if(el.matches('a.zz-source-chip'))el.removeAttribute('title');
    else el.title=el.title||(el.matches('.zz-math')?'클릭해서 선택 · 드래그해서 위치 이동 · 우클릭해서 변경':el.matches('.zz-form-control')?'왼쪽 손잡이로 이 양식만 이동':'드래그해서 위치 이동');
  });
}
function ensureEditableFormLabel(control){
  let label=control.querySelector(':scope > .zz-form-label');
  if(!label){
    const textNodes=[...control.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE);
    const text=textNodes.map(node=>node.textContent).join(' ').replace(/\s+/g,' ').trim()||'항목';
    textNodes.forEach(node=>node.remove());
    label=document.createElement('span');
    label.className='zz-form-label';
    label.textContent=text;
    const field=control.querySelector(':scope > input,:scope > select');
    const type=field?.matches('input')?(field.type||'text').toLowerCase():'';
    if(type==='checkbox'||type==='radio')field.after(label);
    else if(field)control.insertBefore(label,field);
    else control.appendChild(label);
  }
  label.contentEditable='true';
  label.spellcheck=true;
  label.setAttribute('role','textbox');
  label.setAttribute('aria-label','양식 표시 문구');
  label.oninput=event=>{
    event.stopImmediatePropagation();
  };
  label.onblur=()=>{
    label.textContent=label.textContent.trim()||'항목';
    scheduleSyncFromPreview();
  };
  label.onkeydown=event=>{
    if(event.key!=='Enter')return;
    event.preventDefault();
    event.stopPropagation();
    label.blur();
  };
  return label;
}
function formMoveCandidate(event){
  const form=event.target.closest?.('.zz-form-control[data-movable]');
  if(!form||!event.target.closest?.('.form-move-handle'))return null;
  return form;
}
function isInteractiveFormTarget(target){
  if(target.closest?.('.form-move-handle'))return false;
  return !!target.closest?.('.zz-form-control input,.zz-form-control select,.zz-form-control button');
}
function persistFormControlState(control){
  if(!control)return;
  const input=control.matches('input')?control:control.querySelector('input');
  const select=control.matches('select')?control:control.querySelector('select');
  if(input){
    const type=(input.type||'text').toLowerCase();
    if(type==='checkbox'||type==='radio'){
      if(input.checked)input.setAttribute('checked','');
      else input.removeAttribute('checked');
    }else{
      input.setAttribute('value',input.value);
    }
  }
  if(select){
    [...select.options].forEach(option=>{
      if(option.selected)option.setAttribute('selected','');
      else option.removeAttribute('selected');
    });
  }
}
let movingElement=null,moveMarker=null,moveGuide=null,moveDropTarget=null,selectedPreviewImage=null;
function selectPreviewImage(image){
  if(selectedPreviewImage&&selectedPreviewImage!==image){
    selectedPreviewImage.classList.remove('img-selected');
    selectedPreviewImage.removeAttribute('aria-selected');
  }
  selectedPreviewImage=image&&els.preview.contains(image)?image:null;
  if(selectedPreviewImage){
    clearClickMove();
    selectedPreviewImage.classList.add('img-selected');
    selectedPreviewImage.setAttribute('aria-selected','true');
    els.preview.focus({preventScroll:true});
    window.getSelection()?.removeAllRanges();
  }
}
function deleteSelectedPreviewImage(){
  if(!selectedPreviewImage||!els.preview.contains(selectedPreviewImage))return false;
  pushHistory(true);
  const image=selectedPreviewImage;
  selectedPreviewImage=null;
  image.remove();
  syncFromPreview();
  pushHistory(true);
  return true;
}
let imageContextMenu=null,imageContextTarget=null,imageReplacementInput=null;
function hideImageContextMenu(){
  if(imageContextMenu)imageContextMenu.hidden=true;
  imageContextTarget=null;
}
let mathContextMenu=null,mathContextTarget=null,copiedMathSyntax='';
function hideMathContextMenu(){
  if(mathContextMenu)mathContextMenu.hidden=true;
  mathContextTarget=null;
}
function previewMathSyntax(math){
  const marker=math?.dataset.display==='block'?'$$':'$';
  return `${marker}${math?.dataset.latex||''}${marker}`;
}
async function copyPreviewMath(math){
  const syntax=previewMathSyntax(math);
  copiedMathSyntax=syntax;
  try{
    await navigator.clipboard.writeText(syntax);
    return true;
  }catch{
    return false;
  }
}
function replacePreviewMath(math,text=''){
  if(!math||!els.preview.contains(math))return false;
  pushHistory(true);
  math.replaceWith(document.createTextNode(text));
  syncFromPreview();
  renderMarkdown(els.editor.value);
  pushHistory(true);
  return true;
}
async function pastePreviewMath(math){
  let text='';
  try{text=await navigator.clipboard?.readText?.()}catch{}
  if(!text)text=copiedMathSyntax;
  if(!text){
    showInfoNotice('붙여넣기 실패','클립보드의 텍스트를 읽을 수 없습니다.');
    return false;
  }
  return replacePreviewMath(math,text);
}
function ensureMathContextMenu(){
  if(mathContextMenu)return mathContextMenu;
  mathContextMenu=document.createElement('div');
  mathContextMenu.className='file-context-menu';
  mathContextMenu.hidden=true;
  mathContextMenu.innerHTML=`
    <button type="button" data-math-context-action="cut">잘라내기</button>
    <button type="button" data-math-context-action="copy">복사</button>
    <button type="button" data-math-context-action="paste">붙여넣기</button>
    <hr>
    <button type="button" data-math-context-action="edit">변경</button>
    <button type="button" class="danger" data-math-context-action="remove">제거</button>`;
  mathContextMenu.addEventListener('mousedown',e=>e.preventDefault());
  mathContextMenu.addEventListener('click',async e=>{
    const action=e.target.closest('[data-math-context-action]')?.dataset.mathContextAction;
    const math=mathContextTarget;
    if(!action||!math||!els.preview.contains(math))return;
    hideMathContextMenu();
    if(action==='copy')await copyPreviewMath(math);
    else if(action==='cut'){
      await copyPreviewMath(math);
      if(math.isConnected)replacePreviewMath(math);
    }else if(action==='paste')await pastePreviewMath(math);
    else if(action==='edit')editPreviewMath(math);
    else if(action==='remove')replacePreviewMath(math);
  });
  document.addEventListener('mousedown',e=>{
    if(!mathContextMenu.hidden&&!mathContextMenu.contains(e.target))hideMathContextMenu();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideMathContextMenu()});
  window.addEventListener('resize',hideMathContextMenu);
  document.addEventListener('scroll',hideMathContextMenu,true);
  document.body.appendChild(mathContextMenu);
  return mathContextMenu;
}
function showMathContextMenu(e,math){
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  hideImageContextMenu();
  hideTextContextMenu();
  const menu=ensureMathContextMenu();
  mathContextTarget=math;
  menu.hidden=false;
  menu.style.left=e.clientX+'px';
  menu.style.top=e.clientY+'px';
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.max(6,Math.min(e.clientX,window.innerWidth-rect.width-6))+'px';
  menu.style.top=Math.max(6,Math.min(e.clientY,window.innerHeight-rect.height-6))+'px';
}
let uniqueBlockContextMenu=null,uniqueBlockContextTarget=null,copiedUniqueBlockSource='';
function hideUniqueBlockContextMenu(){
  if(uniqueBlockContextMenu)uniqueBlockContextMenu.hidden=true;
  uniqueBlockContextTarget=null;
}
function uniqueBlockSource(block){
  const encoded=block?.dataset.lensSource||block?.dataset.calloutSource||block?.dataset.syncSource||block?.dataset.tocSource||block?.dataset.embedSource||'';
  if(!encoded)return'';
  try{return decodeURIComponent(encoded)}catch{return''}
}
function encodeUniqueTitleAttribute(value){
  return String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}
function updateUniqueBlockTitleSource(titleElement){
  const block=titleElement?.closest?.('.zz-lens[data-lens-source],.obsidian-callout[data-callout-source]');
  if(!block)return false;
  const title=(titleElement.textContent||'').replace(/\s+/g,' ').trim()||'제목 없음';
  let source=uniqueBlockSource(block);
  if(!source)return false;
  if(block.matches('.obsidian-callout')){
    source=source.replace(/^(\s*>\s*\[![^\]]+\][+-]?\s*).*$/m,(_,prefix)=>prefix+title);
    block.dataset.calloutSource=encodeURIComponent(source);
  }else{
    const encodedTitle=encodeUniqueTitleAttribute(title);
    source=source.replace(/(<!--\s*zz:lens\b)([^>]*)(-->)/i,(_,start,rawAttrs,end)=>{
      const attrs=/\btitle\s*=/i.test(rawAttrs)
        ?rawAttrs.replace(/\btitle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,`title="${encodedTitle}"`)
        :`${rawAttrs.replace(/\s*$/,'')} title="${encodedTitle}" `;
      return start+attrs+end;
    });
    block.dataset.lensSource=encodeURIComponent(source);
  }
  return true;
}
function placeCaretAtTextEnd(element){
  if(!element)return;
  const selection=window.getSelection();
  const range=document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
function enterUniqueBlockBody(titleElement){
  const block=titleElement.closest('.zz-lens,.obsidian-callout');
  if(!block)return;
  let target;
  if(block.matches('.obsidian-callout')){
    block.open=true;
    target=block.querySelector('.obsidian-callout-body');
  }else{
    target=block.querySelector('.zz-lens-panel:not([hidden])');
  }
  const editable=target?.querySelector('p,li,h1,h2,h3,h4,h5,h6,blockquote')||target;
  if(editable){
    editable.focus?.({preventScroll:true});
    placeCaretAtTextEnd(editable);
    rememberPreviewRange();
  }
}
async function copyUniqueBlock(block){
  const source=uniqueBlockSource(block);
  if(!source)return false;
  copiedUniqueBlockSource=source;
  try{await navigator.clipboard.writeText(source)}catch{}
  return true;
}
function replaceUniqueBlock(block,text=''){
  if(!block||!els.preview.contains(block))return false;
  pushHistory(true);
  block.replaceWith(document.createTextNode(text));
  syncFromPreview();
  renderMarkdown(els.editor.value);
  pushHistory(true);
  return true;
}
async function pasteUniqueBlock(block){
  let text='';
  try{text=await navigator.clipboard?.readText?.()}catch{}
  if(!text)text=copiedUniqueBlockSource;
  if(!text){
    showInfoNotice('붙여넣기 실패','클립보드의 텍스트를 읽을 수 없습니다.');
    return false;
  }
  return replaceUniqueBlock(block,text);
}
function ensureUniqueBlockContextMenu(){
  if(uniqueBlockContextMenu)return uniqueBlockContextMenu;
  uniqueBlockContextMenu=document.createElement('div');
  uniqueBlockContextMenu.className='file-context-menu';
  uniqueBlockContextMenu.hidden=true;
  uniqueBlockContextMenu.innerHTML=`
    <button type="button" data-unique-block-action="order">순서…</button>
    <hr data-unique-toc-only>
    <button type="button" data-unique-block-action="cut">잘라내기</button>
    <button type="button" data-unique-block-action="copy">복사</button>
    <button type="button" data-unique-block-action="paste">붙여넣기</button>
    <hr>
    <button type="button" class="danger" data-unique-block-action="remove">제거</button>`;
  uniqueBlockContextMenu.addEventListener('mousedown',e=>e.preventDefault());
  uniqueBlockContextMenu.addEventListener('click',async e=>{
    const action=e.target.closest('[data-unique-block-action]')?.dataset.uniqueBlockAction;
    const block=uniqueBlockContextTarget;
    if(!action||!block||!els.preview.contains(block))return;
    hideUniqueBlockContextMenu();
    if(action==='order')await editZzTocBlock(block);
    else if(action==='copy')await copyUniqueBlock(block);
    else if(action==='cut'){
      if(await copyUniqueBlock(block))replaceUniqueBlock(block);
    }else if(action==='paste')await pasteUniqueBlock(block);
    else if(action==='remove')replaceUniqueBlock(block);
  });
  document.addEventListener('mousedown',e=>{
    if(!uniqueBlockContextMenu.hidden&&!uniqueBlockContextMenu.contains(e.target))hideUniqueBlockContextMenu();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideUniqueBlockContextMenu()});
  window.addEventListener('resize',hideUniqueBlockContextMenu);
  document.addEventListener('scroll',hideUniqueBlockContextMenu,true);
  document.body.appendChild(uniqueBlockContextMenu);
  return uniqueBlockContextMenu;
}
function showUniqueBlockContextMenu(e,block){
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  clearClickMove();
  hideImageContextMenu();
  hideMathContextMenu();
  const menu=ensureUniqueBlockContextMenu();
  uniqueBlockContextTarget=block;
  const tocOnly=block.matches('.zz-toc[data-toc-source]');
  menu.querySelector('[data-unique-block-action="order"]').hidden=!tocOnly;
  menu.querySelector('[data-unique-toc-only]').hidden=!tocOnly;
  menu.hidden=false;
  menu.style.left=e.clientX+'px';
  menu.style.top=e.clientY+'px';
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.max(6,Math.min(e.clientX,window.innerWidth-rect.width-6))+'px';
  menu.style.top=Math.max(6,Math.min(e.clientY,window.innerHeight-rect.height-6))+'px';
}
function replacePreviewImage(image,file){
  if(!image||!els.preview.contains(image)||!file||!imageExt.test(file.name))return false;
  pushHistory(true);
  const path=pathOf(file);
  const url=URL.createObjectURL(file);
  const parts=path.split('/');
  [path,file.name,...parts.map((_,i)=>parts.slice(i).join('/'))]
    .flatMap(imageKeyVariants)
    .forEach(key=>{if(key)state.images[key]=url});
  image.src=url;
  image.alt=file.name;
  image.removeAttribute('srcset');
  selectPreviewImage(image);
  syncFromPreview();
  pushHistory(true);
  return true;
}
function choosePreviewImageReplacement(image){
  if(!imageReplacementInput){
    imageReplacementInput=document.createElement('input');
    imageReplacementInput.type='file';
    imageReplacementInput.accept='.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp';
    imageReplacementInput.hidden=true;
    document.body.appendChild(imageReplacementInput);
  }
  imageReplacementInput.value='';
  imageReplacementInput.onchange=()=>{
    const file=imageReplacementInput.files?.[0];
    if(file)replacePreviewImage(image,file);
    imageReplacementInput.value='';
  };
  imageReplacementInput.click();
}
function ensureImageContextMenu(){
  if(imageContextMenu)return imageContextMenu;
  imageContextMenu=document.createElement('div');
  imageContextMenu.className='file-context-menu';
  imageContextMenu.hidden=true;
  imageContextMenu.innerHTML=`
    <button type="button" data-image-action="replace">이미지 대체</button>
    <hr>
    <button type="button" class="danger" data-image-action="remove">이미지 삭제</button>`;
  imageContextMenu.addEventListener('click',e=>{
    const action=e.target.closest('[data-image-action]')?.dataset.imageAction;
    const image=imageContextTarget;
    if(!action||!image||!els.preview.contains(image))return;
    hideImageContextMenu();
    if(action==='replace')choosePreviewImageReplacement(image);
    else if(action==='remove'){
      selectPreviewImage(image);
      deleteSelectedPreviewImage();
    }
  });
  document.addEventListener('mousedown',e=>{
    if(!imageContextMenu.hidden&&!imageContextMenu.contains(e.target))hideImageContextMenu();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideImageContextMenu()});
  window.addEventListener('resize',hideImageContextMenu);
  document.addEventListener('scroll',hideImageContextMenu,true);
  document.body.appendChild(imageContextMenu);
  return imageContextMenu;
}
function showImageContextMenu(e,image){
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  selectPreviewImage(image);
  const menu=ensureImageContextMenu();
  imageContextTarget=image;
  menu.hidden=false;
  menu.style.left=e.clientX+'px';
  menu.style.top=e.clientY+'px';
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.max(6,Math.min(e.clientX,window.innerWidth-rect.width-6))+'px';
  menu.style.top=Math.max(6,Math.min(e.clientY,window.innerHeight-rect.height-6))+'px';
}
document.addEventListener('contextmenu',e=>{
  const math=e.target.closest('#preview .zz-math');
  if(math){
    showMathContextMenu(e,math);
    return;
  }
  const embeddedDocument=e.target.closest('#preview .zz-doc-embed[data-embed-source]');
  if(embeddedDocument){
    showUniqueBlockContextMenu(e,embeddedDocument);
    return;
  }
  if(showTextContextMenu(e))return;
  const uniqueBlock=e.target.closest('#preview .zz-lens[data-lens-source],#preview .obsidian-callout[data-callout-source],#preview .zz-sync-block[data-sync-source],#preview .zz-toc[data-toc-source]');
  if(uniqueBlock){
    showUniqueBlockContextMenu(e,uniqueBlock);
    return;
  }
  const image=e.target.closest('#preview img');
  if(image){
    showImageContextMenu(e,image);
    return;
  }
  const link=e.target.closest('#preview a');
  if(link&&!link.classList.contains('zz-wikilink')){
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    hideImageContextMenu();
    editPreviewLink(link);
  }
},true);
function clearMoveMarker(){
  if(moveMarker){
    moveMarker.classList.remove('move-drop-before','move-drop-after');
    if(!moveMarker.className)moveMarker.removeAttribute('class');
  }
  if(moveGuide)moveGuide.remove();
  moveMarker=null;
  moveGuide=null;
  moveDropTarget=null;
}
function isBlockMoveElement(element){
  return Boolean(element?.matches('.code-block,table,blockquote,hr,img,.zz-lens,.obsidian-callout,.zz-sync-block,.zz-toc,.zz-sheet,.zz-html-embed,.zz-doc-embed,.reference-list,.zz-math-block')
    ||element?.querySelector?.('.zz-math-block'));
}
function quoteMoveCandidate(event){
  const quote=event.target.closest?.('blockquote');
  if(!quote||!els.preview.contains(quote))return null;
  const rect=quote.getBoundingClientRect();
  return Math.abs(event.clientX-rect.left)<=8?quote:null;
}
function previewTopLevelBlocks(){return [...els.preview.children].filter(element=>element!==movingElement)}
function resolveBlockDrop(y){
  const blocks=previewTopLevelBlocks();
  if(!blocks.length)return{kind:'block',anchor:null,before:false,label:'문서 맨 아래에 배치'};
  const anchor=blocks.find(block=>y<block.getBoundingClientRect().top+block.getBoundingClientRect().height/2);
  if(anchor)return{kind:'block',anchor,before:true,label:anchor===blocks[0]?'문서 맨 위에 배치':'이 블록 위에 배치'};
  return{kind:'block',anchor:blocks[blocks.length-1],before:false,label:'문서 맨 아래에 배치'};
}
function showMoveGuide(block,before,label){
  const blockRect=block.getBoundingClientRect();
  const previewRect=els.preview.getBoundingClientRect();
  const left=Math.max(blockRect.left,previewRect.left+8);
  const right=Math.min(blockRect.right,previewRect.right-8);
  moveGuide=document.createElement('div');
  moveGuide.className='move-insertion-guide';
  moveGuide.dataset.label=label;
  moveGuide.style.left=Math.round(left)+'px';
  moveGuide.style.top=Math.round(before?blockRect.top-2:blockRect.bottom-2)+'px';
  moveGuide.style.width=Math.max(80,Math.round(right-left))+'px';
  document.body.appendChild(moveGuide);
}
function showEmptyMoveGuide(label){
  const previewRect=els.preview.getBoundingClientRect();
  moveGuide=document.createElement('div');
  moveGuide.className='move-insertion-guide';
  moveGuide.dataset.label=label;
  moveGuide.style.left=Math.round(previewRect.left+8)+'px';
  moveGuide.style.top=Math.round(previewRect.top+12)+'px';
  moveGuide.style.width=Math.max(80,Math.round(previewRect.width-16))+'px';
  document.body.appendChild(moveGuide);
}
function showInlineMoveGuide(x,y){
  const range=document.caretRangeFromPoint?.(x,y);
  if(!range||movingElement?.contains(range.startContainer))return;
  const host=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  if(!host||!els.preview.contains(host))return;
  const rect=range.getBoundingClientRect();
  const lineHeight=parseFloat(getComputedStyle(host).lineHeight)||20;
  moveDropTarget={kind:'inline',range:range.cloneRange()};
  moveGuide=document.createElement('div');
  moveGuide.className='move-insertion-guide inline';
  moveGuide.dataset.label='이 글자 위치에 삽입';
  moveGuide.style.left=Math.round(rect.left||x)+'px';
  moveGuide.style.top=Math.round(rect.top||y-lineHeight/2)+'px';
  moveGuide.style.height=Math.round(rect.height||lineHeight)+'px';
  document.body.appendChild(moveGuide);
}
let draggedTocItem=null;
let suppressTocNavigation=false;
function saveDraggedTocOrder(toc){
  const source=uniqueBlockSource(toc);
  if(!source)return;
  const order=[...toc.querySelectorAll(':scope > .zz-toc-list > .zz-toc-item[data-zz-toc-item]')]
    .map(item=>item.dataset.zzTocItem).filter(Boolean);
  const encoded=encodeURIComponent(order.join('|'));
  const next=source.replace(/<!--\s*zz:toc\b([^>]*)-->/i,(_,rawAttrs)=>{
    const cleaned=rawAttrs.replace(/\s+order\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,'').trimEnd();
    return `<!-- zz:toc${cleaned?` ${cleaned.trim()}`:''} order="${encoded}" -->`;
  });
  toc.dataset.tocSource=encodeURIComponent(next);
}
els.preview.addEventListener('dragstart',e=>{
  const link=e.target.closest('.zz-toc-link');
  if(!link)return;
  if(!e.ctrlKey){e.preventDefault();return}
  draggedTocItem=link.closest('.zz-toc-item');
  if(!draggedTocItem){e.preventDefault();return}
  e.stopImmediatePropagation();
  draggedTocItem.classList.add('moving-element');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','move-toc-item');
});
els.preview.addEventListener('dragover',e=>{
  if(!draggedTocItem)return;
  const target=e.target.closest('.zz-toc-item');
  if(!target||target===draggedTocItem||target.closest('.zz-toc')!==draggedTocItem.closest('.zz-toc'))return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const rect=target.getBoundingClientRect();
  target.parentNode.insertBefore(draggedTocItem,e.clientY<rect.top+rect.height/2?target:target.nextSibling);
});
els.preview.addEventListener('drop',e=>{
  if(!draggedTocItem)return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const toc=draggedTocItem.closest('.zz-toc');
  draggedTocItem.classList.remove('moving-element');
  draggedTocItem=null;
  if(toc){pushHistory(true);saveDraggedTocOrder(toc);syncFromPreview();renderMarkdown(els.editor.value);pushHistory(true)}
});
els.preview.addEventListener('dragend',()=>{
  if(draggedTocItem)draggedTocItem.classList.remove('moving-element');
  draggedTocItem=null;
});
els.preview.addEventListener('mousedown',e=>{
  const link=e.target.closest('.zz-toc-link');
  if(e.button!==0||!e.ctrlKey||!link)return;
  const item=link.closest('.zz-toc-item'),toc=item?.closest('.zz-toc');
  if(!item||!toc)return;
  e.preventDefault();
  e.stopPropagation();
  const startX=e.clientX,startY=e.clientY;
  let active=false,dropTarget=null,dropBefore=true;
  const clearDrop=()=>{
    dropTarget?.classList.remove('toc-drop-before','toc-drop-after');
    dropTarget=null;
  };
  function move(event){
    if(!active&&Math.hypot(event.clientX-startX,event.clientY-startY)<4)return;
    if(!active){active=true;item.classList.add('toc-dragging');window.getSelection()?.removeAllRanges()}
    event.preventDefault();
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('.zz-toc-item');
    if(!target||target===item||target.closest('.zz-toc')!==toc){clearDrop();return}
    const rect=target.getBoundingClientRect();
    const horizontal=toc.dataset.tocLayout==='horizontal';
    const before=horizontal&&Math.abs(event.clientY-(rect.top+rect.height/2))<rect.height
      ?event.clientX<rect.left+rect.width/2
      :event.clientY<rect.top+rect.height/2;
    if(dropTarget===target&&dropBefore===before)return;
    clearDrop();
    dropTarget=target;
    dropBefore=before;
    target.classList.add(before?'toc-drop-before':'toc-drop-after');
  }
  function up(event){
    document.removeEventListener('mousemove',move,true);
    document.removeEventListener('mouseup',up,true);
    item.classList.remove('toc-dragging');
    const target=dropTarget,before=dropBefore;
    clearDrop();
    if(!active||!target)return;
    event.preventDefault();
    target.parentNode.insertBefore(item,before?target:target.nextSibling);
    suppressTocNavigation=true;
    pushHistory(true);
    saveDraggedTocOrder(toc);
    syncFromPreview();
    renderMarkdown(els.editor.value);
    pushHistory(true);
    setTimeout(()=>{suppressTocNavigation=false},0);
  }
  document.addEventListener('mousemove',move,true);
  document.addEventListener('mouseup',up,true);
},true);
els.preview.addEventListener('dragstart',e=>{
  if(e.target.closest('.zz-source-chip-editing')){e.preventDefault();return}
  if(e.target.closest('.zz-toc-link')){e.preventDefault();return}
  const handle=e.target.closest('.block-move-handle');
  if(!handle&&!e.altKey){e.preventDefault();return}
  const direct=e.target.closest('img[data-movable],a[data-movable],code[data-movable],hr[data-movable],.zz-math[data-movable],mark[data-movable]')||formMoveCandidate(e);
  movingElement=mathMovementElement(handle?handle.closest('.code-block,table,blockquote,.zz-lens,.obsidian-callout,.zz-sync-block,.zz-toc,.zz-sheet,.zz-html-embed,.zz-doc-embed,.reference-list'):direct);
  if(movingElement?.matches('img')&&movingElement!==selectedPreviewImage){movingElement=null;e.preventDefault();return}
  if(!movingElement){e.preventDefault();return}
  movingElement.classList.add('moving-element');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','move-preview-element');
});
els.preview.addEventListener('dragover',e=>{
  if(!movingElement)return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  showPointerMoveTarget(e.target,e.clientY,e.clientX);
});
els.preview.addEventListener('drop',e=>{
  if(!movingElement)return;
  e.preventDefault();
  pushHistory(true);
  const moved=commitPointerMove(e.target,e.clientX,e.clientY);
  clearMoveMarker();
  movingElement.classList.remove('moving-element');
  if(!movingElement.className)movingElement.removeAttribute('class');
  movingElement=null;
  if(moved){syncFromPreview();pushHistory(true)}
});
els.preview.addEventListener('dragend',()=>{
  clearMoveMarker();
  if(movingElement){movingElement.classList.remove('moving-element');if(!movingElement.className)movingElement.removeAttribute('class')}
  movingElement=null;
});
function showPointerMoveTarget(target,y,x=0){
  clearMoveMarker();
  if(!movingElement)return;
  if(!isBlockMoveElement(movingElement)){showInlineMoveGuide(x,y);return}
  const drop=resolveBlockDrop(y);
  moveDropTarget=drop;
  if(!drop.anchor){showEmptyMoveGuide(drop.label);return}
  drop.anchor.classList.add(drop.before?'move-drop-before':'move-drop-after');
  moveMarker=drop.anchor;
  showMoveGuide(drop.anchor,drop.before,drop.label);
}
function commitPointerMove(target,x,y){
  if(!movingElement)return false;
  let moved=false;
  const sourceParent=movingElement.parentElement;
  if(isBlockMoveElement(movingElement)){
    const drop=moveDropTarget?.kind==='block'?moveDropTarget:resolveBlockDrop(y);
    if(drop.anchor){
      drop.anchor.insertAdjacentElement(drop.before?'beforebegin':'afterend',movingElement);
      moved=true;
    }else{
      els.preview.appendChild(movingElement);
      moved=true;
    }
    if(moved&&movingElement.matches('img')&&sourceParent!==els.preview&&sourceParent?.matches('p,div')&&!sourceParent.textContent.trim()&&!sourceParent.querySelector('img,table,blockquote,pre,hr'))sourceParent.remove();
  }else{
    const range=moveDropTarget?.kind==='inline'?moveDropTarget.range:document.caretRangeFromPoint?.(x,y);
    if(range&&!movingElement.contains(range.startContainer)){
      const marker=document.createTextNode('\u200b');
      range.insertNode(marker);
      movingElement.remove();
      marker.replaceWith(movingElement);
      moved=true;
    }
  }
  return moved;
}
els.preview.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  if(e.target.closest('.zz-source-chip-editing'))return;
  const handle=e.target.closest('.block-move-handle');
  const formHandle=e.target.closest('.form-move-handle');
  const direct=e.target.closest('img[data-movable],a[data-movable],code[data-movable],hr[data-movable],.zz-math[data-movable],mark[data-movable]')||formMoveCandidate(e);
  const candidate=handle
    ?handle.closest('.code-block,table,blockquote,.zz-lens,.obsidian-callout,.zz-sync-block,.zz-toc,.zz-sheet,.zz-html-embed,.zz-doc-embed,.reference-list')
    :formHandle?formHandle.closest('.zz-form-control')
    :e.altKey?direct:null;
  if(!candidate)return;
  if(candidate.matches('img')){
    if(candidate!==selectedPreviewImage)return;
    const r=candidate.getBoundingClientRect();
    if(r.right-e.clientX<14&&r.bottom-e.clientY<14)return;
  }
  if(handle||formHandle||e.altKey)e.preventDefault();
  const startX=e.clientX,startY=e.clientY;
  let active=false;
  function move(ev){
    if(!active&&Math.hypot(ev.clientX-startX,ev.clientY-startY)<5)return;
    if(!active){
      active=true;
      movingElement=mathMovementElement(candidate);
      movingElement.classList.add('moving-element');
      window.getSelection()?.removeAllRanges();
    }
    ev.preventDefault();
    showPointerMoveTarget(document.elementFromPoint(ev.clientX,ev.clientY),ev.clientY,ev.clientX);
  }
  function up(ev){
    document.removeEventListener('mousemove',move);
    document.removeEventListener('mouseup',up);
    if(!active)return;
    ev.preventDefault();
    pushHistory(true);
    const moved=commitPointerMove(document.elementFromPoint(ev.clientX,ev.clientY),ev.clientX,ev.clientY);
    clearMoveMarker();
    candidate.classList.remove('moving-element');
    if(!candidate.className)candidate.removeAttribute('class');
    movingElement=null;
    if(moved){syncFromPreview();pushHistory(true)}
  }
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',up);
});
let clickMoveElement=null;
let activeSourceChipEdit=null;
function finishSourceChipInlineEdit(save=true){
  const edit=activeSourceChipEdit;if(!edit)return false;
  activeSourceChipEdit=null;
  const{chip,label,original}=edit;
  if(!chip.isConnected)return false;
  const next=(label.textContent||'').replace(/\s+/g,' ').trim();
  label.textContent=save?(next||original):original;
  label.removeAttribute('contenteditable');
  label.removeAttribute('spellcheck');
  chip.removeAttribute('contenteditable');
  chip.classList.remove('zz-source-chip-editing');
  chip.draggable=true;
  if(save&&label.textContent!==original)pushHistory(true);
  syncFromPreview();
  if(save&&label.textContent!==original)pushHistory(true);
  return true;
}
function startSourceChipInlineEdit(chip){
  if(!chip||!els.preview.contains(chip))return false;
  if(activeSourceChipEdit?.chip===chip)return true;
  finishSourceChipInlineEdit(true);
  let label=chip.querySelector(':scope > .zz-source-chip-label');
  if(!label){label=document.createElement('span');label.className='zz-source-chip-label';label.textContent=(chip.textContent||'').trim();chip.prepend(label)}
  activeSourceChipEdit={chip,label,original:(label.textContent||'').trim()};
  chip.classList.add('zz-source-chip-editing','move-selected');
  chip.setAttribute('aria-selected','true');
  chip.draggable=false;
  // Isolate the chip editor from the preview root. Chromium may otherwise
  // normalize the caret after the anchor and put typed text below the chip.
  chip.contentEditable='false';
  label.contentEditable='true';
  label.spellcheck=true;
  label.focus({preventScroll:true});
  const selection=window.getSelection(),range=document.createRange();
  range.selectNodeContents(label);selection?.removeAllRanges();selection?.addRange(range);
  label.onkeydown=event=>{
    if(event.isComposing||event.keyCode===229)return;
    if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();finishSourceChipInlineEdit(true)}
    else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finishSourceChipInlineEdit(false)}
  };
  label.onblur=event=>setTimeout(()=>{
    if(event.relatedTarget?.closest?.('#format-tools'))return;
    if(activeSourceChipEdit?.label===label)finishSourceChipInlineEdit(true);
  },0);
  return true;
}
function keepSourceChipCaretInside(){
  const edit=activeSourceChipEdit;
  if(!edit?.label?.isConnected)return false;
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(range&&edit.label.contains(range.commonAncestorContainer))return true;
  const next=document.createRange();
  next.selectNodeContents(edit.label);
  next.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(next);
  state.savedPreviewRange=next.cloneRange();
  return true;
}
let sourceSyntaxHoverTimer=0,sourceSyntaxHideTimer=0,sourceSyntaxPopover=null,sourceSyntaxTarget=null,sourceSyntaxRange=null,sourceSyntaxHoverCandidate=null,sourceSyntaxPinned=false,sourceSyntaxResizeObserver=null;
function loadSourceSyntaxPopoverSize(){
  try{
    const value=JSON.parse(localStorage.getItem('md-source-syntax-popover-size')||'null');
    return value&&Number(value.width)>=340&&Number(value.height)>=230?value:null;
  }catch{return null}
}
function saveSourceSyntaxPopoverSize(){
  if(!sourceSyntaxPinned||!sourceSyntaxPopover)return;
  const rect=sourceSyntaxPopover.getBoundingClientRect();
  localStorage.setItem('md-source-syntax-popover-size',JSON.stringify({width:Math.round(rect.width),height:Math.round(rect.height)}));
}
function pinSourceSyntaxPopover(){
  if(!sourceSyntaxPopover||sourceSyntaxPinned)return;
  sourceSyntaxPinned=true;sourceSyntaxPopover.classList.add('pinned');
  const saved=loadSourceSyntaxPopoverSize();
  if(saved){sourceSyntaxPopover.style.width=Math.min(saved.width,window.innerWidth-8)+'px';sourceSyntaxPopover.style.height=Math.min(saved.height,window.innerHeight-8)+'px'}
  else{
    const rect=sourceSyntaxPopover.getBoundingClientRect();
    sourceSyntaxPopover.style.width=Math.round(rect.width)+'px';sourceSyntaxPopover.style.height=Math.max(250,Math.round(rect.height))+'px';
  }
  sourceSyntaxPopover.querySelector('.source-syntax-popover-pin').textContent='고정됨';
  sourceSyntaxResizeObserver?.disconnect();
  if(window.ResizeObserver){sourceSyntaxResizeObserver=new ResizeObserver(saveSourceSyntaxPopoverSize);sourceSyntaxResizeObserver.observe(sourceSyntaxPopover)}
}
function previewHoverSyntaxTarget(node){
  const element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  if(!element||!els.preview.contains(element)||element.closest('.block-move-handle,.form-move-handle,.tbl-resize-handle,.zz-source-chip-edit'))return null;
  return element.closest('a.zz-source-chip,a:not(.zz-wikilink):not(.zz-toc-link),code:not(pre code),mark,strong,b,em,i,u,span:not(.zz-source-chip-edit),p,li,th,td,h1,h2,h3,h4,h5,h6,blockquote');
}
function previewSelectionSyntax(range){
  const holder=document.createElement('div');holder.appendChild(range.cloneContents());cleanPreviewHtml(holder);
  const start=range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer:range.startContainer.parentElement;
  const end=range.endContainer.nodeType===Node.ELEMENT_NODE?range.endContainer:range.endContainer.parentElement;
  const wrappers=[];
  for(let node=start;node&&node!==els.preview;node=node.parentElement){
    if(!node.contains(end)||node.matches('p,li,th,td,h1,h2,h3,h4,h5,h6,blockquote'))break;
    if(node.matches('a.zz-source-chip,code:not(pre code),mark,strong,b,em,i,u,a:not(.zz-wikilink):not(.zz-toc-link),span[style]'))wrappers.push(node);
  }
  let html=holder.innerHTML;
  wrappers.forEach(node=>{
    if(node.matches('a.zz-source-chip')){
      const label=html.replace(/<[^>]+>/g,'').trim().replace(/]/g,'\\]');
      html=`\`\`[${label}](${(node.getAttribute('href')||'').replace(/\)/g,'\\)')})`;
      return;
    }
    const clone=node.cloneNode(false);cleanPreviewHtml(clone);clone.innerHTML=html;
    html=clone.outerHTML;
  });
  return html;
}
function previewTargetSyntax(target,range=sourceSyntaxRange){
  if(range&&!range.collapsed){
    return previewSelectionSyntax(range);
  }
  if(target.matches('a.zz-source-chip')){
    const label=(target.querySelector('.zz-source-chip-label')?.textContent||target.textContent||'출처').trim().replace(/]/g,'\\]');
    const url=(target.getAttribute('href')||'').replace(/\)/g,'\\)');
    return `\`\`[${label}](${url})`;
  }
  const clone=target.cloneNode(true);cleanPreviewHtml(clone);
  return clone.innerHTML;
}
function closeSourceSyntaxPopover(){
  clearTimeout(sourceSyntaxHoverTimer);clearTimeout(sourceSyntaxHideTimer);
  sourceSyntaxHoverTimer=sourceSyntaxHideTimer=0;
  sourceSyntaxResizeObserver?.disconnect();sourceSyntaxResizeObserver=null;
  sourceSyntaxPopover?.remove();sourceSyntaxPopover=null;sourceSyntaxTarget=null;sourceSyntaxRange=null;sourceSyntaxHoverCandidate=null;sourceSyntaxPinned=false;
}
function positionSourceSyntaxPopover(chip){
  if(!sourceSyntaxPopover||!chip?.isConnected)return;
  const rect=chip.getBoundingClientRect(),popup=sourceSyntaxPopover.getBoundingClientRect(),gap=8;
  const left=Math.max(8,Math.min(rect.left,window.innerWidth-popup.width-8));
  const above=rect.top-popup.height-gap;
  sourceSyntaxPopover.style.left=Math.round(left)+'px';
  sourceSyntaxPopover.style.top=Math.round(above>=8?above:Math.min(window.innerHeight-popup.height-8,rect.bottom+gap))+'px';
}
function applySourceSyntaxPopover(){
  if(!sourceSyntaxPopover||!sourceSyntaxTarget?.isConnected)return false;
  const value=sourceSyntaxPopover.querySelector('textarea').value.trim();
  const error=sourceSyntaxPopover.querySelector('[data-source-syntax-error]');
  pushHistory(true);
  if(sourceSyntaxRange&&!sourceSyntaxRange.collapsed&&sourceSyntaxRange.commonAncestorContainer.isConnected){
    const template=document.createElement('template');template.innerHTML=value;
    sourceSyntaxRange.deleteContents();sourceSyntaxRange.insertNode(template.content);
  }else if(sourceSyntaxTarget.matches('a.zz-source-chip')){
    const match=value.match(/^``\[([^\]\n]+)\]\((.+)\)$/);
    if(!match){error.textContent='``[표시 문구](링크) 형식으로 입력해 주세요.';return false}
    const url=normalizedLinkUrl(match[2].replace(/\\\)/g,')'));
    if(!url){error.textContent='올바른 링크 주소를 입력해 주세요.';return false}
    const label=sourceSyntaxTarget.querySelector('.zz-source-chip-label');
    if(label)label.textContent=match[1].replace(/\\]/g,']').trim();
    sourceSyntaxTarget.setAttribute('href',url);
  }else sourceSyntaxTarget.innerHTML=value;
  syncFromPreview();pushHistory(true);closeSourceSyntaxPopover();return true;
}
function showSourceSyntaxPopover(chip,range){
  if(!sourceSyntaxHoverEnabled||!chip?.isConnected||!range||range.collapsed||activeSourceChipEdit)return;
  closeSourceSyntaxPopover();sourceSyntaxTarget=chip;sourceSyntaxRange=range.cloneRange();
  const popup=document.createElement('div');popup.className='source-syntax-popover';
  popup.innerHTML=`<div class="source-syntax-popover-head"><span>선택 문법 편집</span><span class="source-syntax-popover-pin">Ctrl로 고정</span></div><textarea spellcheck="false"></textarea><div class="file-dialog-error" data-source-syntax-error></div><div class="source-syntax-popover-actions"><button class="tool" type="button" data-source-syntax-close>닫기</button><button class="tool primary" type="button" data-source-syntax-apply>적용</button></div>`;
  popup.querySelector('textarea').value=previewTargetSyntax(chip,sourceSyntaxRange);
  popup.querySelector('[data-source-syntax-close]').onclick=closeSourceSyntaxPopover;
  popup.querySelector('[data-source-syntax-apply]').onclick=applySourceSyntaxPopover;
  popup.addEventListener('mouseenter',()=>clearTimeout(sourceSyntaxHideTimer));
  popup.addEventListener('mouseleave',()=>{if(!sourceSyntaxPinned)sourceSyntaxHideTimer=setTimeout(closeSourceSyntaxPopover,180)});
  popup.querySelector('textarea').addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeSourceSyntaxPopover()}
    else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();applySourceSyntaxPopover()}
  });
  document.body.appendChild(popup);sourceSyntaxPopover=popup;positionSourceSyntaxPopover(chip);
  const head=popup.querySelector('.source-syntax-popover-head');
  head.addEventListener('pointerdown',event=>{
    if(!sourceSyntaxPinned||event.button!==0)return;
    event.preventDefault();
    const rect=popup.getBoundingClientRect(),dx=event.clientX-rect.left,dy=event.clientY-rect.top;
    const move=moveEvent=>{
      popup.style.left=Math.max(4,Math.min(window.innerWidth-popup.offsetWidth-4,moveEvent.clientX-dx))+'px';
      popup.style.top=Math.max(4,Math.min(window.innerHeight-popup.offsetHeight-4,moveEvent.clientY-dy))+'px';
    };
    const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up)};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);
  });
}
function scheduleSourceSyntaxPopover(chip,range){
  if(!sourceSyntaxHoverEnabled||sourceSyntaxPinned||sourceSyntaxTarget===chip)return;
  clearTimeout(sourceSyntaxHoverTimer);clearTimeout(sourceSyntaxHideTimer);
  sourceSyntaxHoverCandidate=chip;
  const saved=range.cloneRange();
  sourceSyntaxHoverTimer=setTimeout(()=>showSourceSyntaxPopover(chip,saved),sourceSyntaxHoverDelaySeconds*1000);
}
els.preview.addEventListener('mousemove',event=>{
  const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(!range||range.collapsed||!range.toString().trim()||!els.preview.contains(range.commonAncestorContainer)){
    clearTimeout(sourceSyntaxHoverTimer);sourceSyntaxHoverCandidate=null;
    if(sourceSyntaxPopover&&!sourceSyntaxPinned)closeSourceSyntaxPopover();
    return;
  }
  const target=previewHoverSyntaxTarget(event.target);
  const overSelection=[...range.getClientRects()].some(rect=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom);
  if(!target||!overSelection){clearTimeout(sourceSyntaxHoverTimer);sourceSyntaxHoverCandidate=null;if(sourceSyntaxPopover&&!sourceSyntaxPinned)closeSourceSyntaxPopover();return}
  if(target===sourceSyntaxHoverCandidate||target===sourceSyntaxTarget)return;
  scheduleSourceSyntaxPopover(target,range);
});
els.preview.addEventListener('mouseup',event=>setTimeout(()=>{
  if(!sourceSyntaxHoverEnabled||sourceSyntaxPinned)return;
  const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(!range||range.collapsed||!range.toString().trim()||!els.preview.contains(range.commonAncestorContainer))return;
  const target=previewHoverSyntaxTarget(event.target);
  const overSelection=[...range.getClientRects()].some(rect=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom);
  if(target&&overSelection)scheduleSourceSyntaxPopover(target,range);
},0));
els.preview.addEventListener('mouseleave',event=>{
  clearTimeout(sourceSyntaxHoverTimer);
  sourceSyntaxHoverCandidate=null;
  if(!sourceSyntaxPinned&&sourceSyntaxPopover&&!sourceSyntaxPopover.contains(event.relatedTarget))sourceSyntaxHideTimer=setTimeout(closeSourceSyntaxPopover,240);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Control'&&sourceSyntaxPopover){
    pinSourceSyntaxPopover();
  }else if(event.key==='Escape'&&sourceSyntaxPopover){
    event.preventDefault();closeSourceSyntaxPopover();
  }
},true);
document.addEventListener('mousedown',event=>{
  if(sourceSyntaxPopover&&!sourceSyntaxPinned&&!sourceSyntaxPopover.contains(event.target))closeSourceSyntaxPopover();
},true);
window.addEventListener('resize',()=>{if(sourceSyntaxPopover&&sourceSyntaxTarget)positionSourceSyntaxPopover(sourceSyntaxTarget)});
document.addEventListener('scroll',()=>{if(sourceSyntaxPopover&&sourceSyntaxTarget)positionSourceSyntaxPopover(sourceSyntaxTarget)},true);
function clearClickMove(){
  if(clickMoveElement){
    clickMoveElement.classList.remove('move-selected');
    clickMoveElement.removeAttribute('aria-selected');
    if(!clickMoveElement.className)clickMoveElement.removeAttribute('class');
  }
  clickMoveElement=null;
  clearMoveMarker();
}
let copiedPreviewElementHtml='';
function selectedPreviewElementHtml(element){
  const host=document.createElement('div');
  const source=uniqueBlockSource(element);
  host.appendChild(element.cloneNode(true));
  cleanPreviewHtml(host);
  return{html:serializePreviewHtml(host),plain:source||host.textContent||''};
}
function deleteSelectedPreviewElement(){
  if(!clickMoveElement||!els.preview.contains(clickMoveElement)||clickMoveElement.matches('table,img'))return false;
  pushHistory(true);
  const target=clickMoveElement;
  clickMoveElement=null;
  target.remove();
  clearMoveMarker();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function pasteSelectedPreviewElement(){
  if(!clickMoveElement||!els.preview.contains(clickMoveElement)||!copiedPreviewElementHtml)return false;
  const host=document.createElement('div');
  host.innerHTML=copiedPreviewElementHtml;
  const inserted=[...host.childNodes].filter(node=>node.nodeType===Node.ELEMENT_NODE);
  if(!inserted.length)return false;
  pushHistory(true);
  let anchor=clickMoveElement;
  inserted.forEach(node=>{anchor.after(node);anchor=node});
  clearClickMove();
  fixSpanColors(els.preview);
  runHighlight(els.preview);
  decorateCodeBlocks(els.preview);
  addTableResize(els.preview);
  addImageResize(els.preview);
  addMovableElements(els.preview);
  clickMoveElement=anchor.closest?.('.code-block,blockquote,.zz-lens,.obsidian-callout,.zz-sync-block,.zz-toc,.zz-sheet,.zz-html-embed,.zz-doc-embed,.reference-list')||anchor;
  clickMoveElement.classList.add('move-selected');
  clickMoveElement.setAttribute('aria-selected','true');
  syncFromPreview();
  pushHistory(true);
  return true;
}
function clearPreviewTransientState(){
  clearClickMove();
  selectPreviewImage(null);
  clearMoveMarker();
  if(movingElement){
    movingElement.classList.remove('moving-element');
    if(!movingElement.className)movingElement.removeAttribute('class');
  }
  movingElement=null;
}
function wikiFileIndex(name){
  const wanted=String(name||'').trim().replace(/\\/g,'/').replace(/\.(md|markdown)$/i,'').toLowerCase();
  if(!wanted)return-1;
  return state.files.findIndex(file=>{
    const path=String(file.path||file.name||'').replace(/\\/g,'/').replace(/\.(md|markdown)$/i,'').toLowerCase();
    const base=path.split('/').pop();
    return path===wanted||base===wanted;
  });
}
function navigateWikiTarget(fileName,heading=''){
  const index=wikiFileIndex(fileName);
  if(index>=0&&index!==state.active)openFile(index);
  else if(index<0&&fileName)showInfoNotice('연결 문서 없음',`"${fileName}" 문서를 파일 목록에서 찾지 못했습니다.`);
  requestAnimationFrame(()=>{
    if(heading)scrollPreviewToText(heading);
    else if(index>=0)els.preview.scrollTo({top:0,behavior:'smooth'});
  });
}
els.preview.addEventListener('mousedown',e=>{
  const title=e.target.closest('[data-unique-title]');
  if(!title)return;
  e.preventDefault();
  e.stopPropagation();
  title.focus({preventScroll:true});
  const caret=document.caretPositionFromPoint?.(e.clientX,e.clientY);
  const range=caret&&title.contains(caret.offsetNode)?document.createRange():document.caretRangeFromPoint?.(e.clientX,e.clientY);
  if(caret&&range){
    range.setStart(caret.offsetNode,caret.offset);
    range.collapse(true);
  }
  if(range&&title.contains(range.startContainer)){
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }else{
    placeCaretAtTextEnd(title);
  }
  rememberPreviewRange();
},true);
els.preview.addEventListener('click',e=>{
  const collapseToggle=e.target.closest('.structured-collapse-toggle');
  if(collapseToggle){
    e.preventDefault();
    e.stopPropagation();
    const callout=collapseToggle.closest('.obsidian-callout');
    if(callout)callout.open=!callout.open;
    return;
  }
  const uniqueTitle=e.target.closest('[data-unique-title]');
  if(uniqueTitle){
    e.preventDefault();
    e.stopPropagation();
    uniqueTitle.focus({preventScroll:true});
    return;
  }
  const tab=e.target.closest('.zz-lens-tab');
  if(tab){
    e.preventDefault();
    e.stopPropagation();
    const lens=tab.closest('.zz-lens');
    const panel=tab.dataset.lensPanel;
    lens.querySelectorAll('.zz-lens-tab').forEach(item=>item.classList.toggle('active',item===tab));
    lens.querySelectorAll('.zz-lens-panel').forEach(item=>item.hidden=item.dataset.panel!==panel);
    return;
  }
  const relation=e.target.closest('[data-zz-target]');
  if(relation){
    e.preventDefault();
    e.stopPropagation();
    scrollPreviewToText(relation.dataset.zzTarget);
    return;
  }
  const tocLink=e.target.closest('[data-zz-toc-target]');
  if(tocLink){
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if(suppressTocNavigation)return;
    clearClickMove();
    const heading=els.preview.querySelector(`#${CSS.escape(tocLink.dataset.zzTocTarget)}`);
    if(heading){
      const headingText=heading.textContent.trim();
      const sourceOffset=els.editor.value.indexOf(headingText);
      heading.scrollIntoView({block:'center',behavior:'smooth'});
      schedulePreviewArrival(heading,headingText,sourceOffset);
    }
    return;
  }
  const wiki=e.target.closest('.zz-wikilink');
  if(wiki){
    e.preventDefault();
    e.stopPropagation();
    navigateWikiTarget(wiki.dataset.wikiFile,wiki.dataset.wikiHeading);
    return;
  }
  const math=e.target.closest('.zz-math');
  if(math){
    e.preventDefault();
    e.stopPropagation();
    return;
  }
},true);
els.preview.addEventListener('input',e=>{
  const form=e.target.closest?.('.zz-form-control');
  if(form){
    persistFormControlState(form);
    scheduleSyncFromPreview();
  }
  const title=e.target.closest?.('[data-unique-title]');
  if(title)updateUniqueBlockTitleSource(title);
  const sync=e.target.closest?.('.zz-sync-block[data-sync-id]');
  if(sync){
    const id=sync.dataset.syncId;
    const body=sync.querySelector('.zz-sync-body');
    if(!body)return;
    const content=body.innerHTML.trim();
    els.preview.querySelectorAll('.zz-sync-block[data-sync-id]').forEach(peer=>{
      if(peer.dataset.syncId!==id)return;
      const peerBody=peer.querySelector('.zz-sync-body');
      if(peer!==sync&&peerBody)peerBody.innerHTML=content;
      peer.dataset.syncSource=encodeURIComponent(`<!-- zz:sync id="${id.replace(/"/g,'&quot;')}" -->\n${content}\n<!-- /zz:sync -->`);
    });
  }
});
els.preview.addEventListener('change',e=>{
  const form=e.target.closest?.('.zz-form-control');
  if(!form)return;
  persistFormControlState(form);
  scheduleSyncFromPreview();
});
let pressedFormRadio=null;
els.preview.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('.block-move-handle,.form-move-handle,.zz-form-control input,.zz-form-control select,.zz-form-control button'))return;
  const range=document.caretRangeFromPoint?.(e.clientX,e.clientY);
  if(range&&els.preview.contains(range.commonAncestorContainer)){
    state.savedPreviewRange=range.cloneRange();
    state.savedSelection=null;
  }
},true);
els.preview.addEventListener('pointerdown',e=>{
  const radio=e.target.closest?.('.zz-form-control input[type="radio"]');
  pressedFormRadio=radio?{radio,wasChecked:radio.checked}:null;
  if(!radio?.checked)return;
  e.preventDefault();
  radio.dataset.zzRadioReleased='1';
},true);
els.preview.addEventListener('click',e=>{
  const radio=e.target.closest?.('.zz-form-control input[type="radio"]');
  if(!radio||pressedFormRadio?.radio!==radio){
    pressedFormRadio=null;
    return;
  }
  if(radio.dataset.zzRadioReleased==='1'){
    e.preventDefault();
    if(radio.dataset.zzRadioReleasePending!=='1'){
      radio.dataset.zzRadioReleasePending='1';
      setTimeout(()=>{
        if(!radio.isConnected)return;
        radio.checked=false;
        delete radio.dataset.zzRadioReleased;
        delete radio.dataset.zzRadioReleasePending;
        persistFormControlState(radio.closest('.zz-form-control'));
        scheduleSyncFromPreview();
      },30);
    }
  }
  pressedFormRadio=null;
});
els.preview.addEventListener('keydown',e=>{
  const title=e.target.closest?.('[data-unique-title]');
  if(!title)return;
  if(e.key==='Enter'){
    e.preventDefault();
    e.stopPropagation();
    updateUniqueBlockTitleSource(title);
    enterUniqueBlockBody(title);
  }
});
els.preview.addEventListener('mousemove',e=>{
  if(!clickMoveElement||movingElement||activeSourceChipEdit)return;
    movingElement=mathMovementElement(clickMoveElement);
  showPointerMoveTarget(e.target,e.clientY,e.clientX);
  movingElement=null;
});
els.preview.addEventListener('click',e=>{
  if(e.target.closest('.code-lang,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle'))return;
  const sourceChipEdit=e.target.closest('.zz-source-chip-edit');
  if(sourceChipEdit){
    e.preventDefault();
    e.stopPropagation();
    startSourceChipInlineEdit(sourceChipEdit.closest('.zz-source-chip'));
    return;
  }
  if(e.target.closest('.zz-source-chip-editing'))return;
  if(isInteractiveFormTarget(e.target))return;
  const image=e.target.closest('img[data-movable]');
  if(image){
    e.preventDefault();
    e.stopPropagation();
    selectPreviewImage(image);
    return;
  }
  if(selectedPreviewImage)selectPreviewImage(null);
  const handle=e.target.closest('.block-move-handle');
  if(handle){
    e.preventDefault();
    e.stopPropagation();
    clearClickMove();
    return;
  }
  const direct=e.target.closest('a[data-movable],code[data-movable],hr[data-movable],.zz-math[data-movable],mark[data-movable]')||formMoveCandidate(e);
  const candidate=e.altKey?direct:null;
  if(!clickMoveElement&&candidate){
    e.preventDefault();
    e.stopPropagation();
    clickMoveElement=candidate;
    clickMoveElement.classList.add('move-selected');
    clickMoveElement.setAttribute('aria-selected','true');
    els.preview.focus({preventScroll:true});
    const selection=window.getSelection();
    selection?.removeAllRanges();
    if(candidate.matches('.zz-math')){
      selectMathNode(candidate);
    }
    return;
  }
  if(!clickMoveElement)return;
  e.preventDefault();
  e.stopPropagation();
  if(candidate===clickMoveElement||clickMoveElement.contains(e.target)){clearClickMove();return}
  movingElement=mathMovementElement(clickMoveElement);
  pushHistory(true);
  const moved=commitPointerMove(e.target,e.clientX,e.clientY);
  clearClickMove();
  movingElement=null;
  if(moved){syncFromPreview();pushHistory(true)}
},true);
document.addEventListener('mousedown',e=>{
  if(selectedPreviewImage&&!e.target.closest('#preview img'))selectPreviewImage(null);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){clearClickMove();selectPreviewImage(null);return}
  if((e.key==='Delete'||e.key==='Backspace')&&clickMoveElement&&els.preview.contains(clickMoveElement)&&!clickMoveElement.matches('table,img')){
    const selection=window.getSelection();
    const range=selection?.rangeCount?selection.getRangeAt(0):null;
    const selectedObject=clickMoveElement.matches('.zz-doc-embed[data-embed-source]');
    if(!selectedObject&&e.target===els.preview&&range&&els.preview.contains(range.commonAncestorContainer)){
      clearClickMove();
      return;
    }
    e.preventDefault();
    deleteSelectedPreviewElement();
    return;
  }
  if((e.key==='Delete'||e.key==='Backspace')&&selectedPreviewImage&&els.preview.contains(selectedPreviewImage)){
    e.preventDefault();
    deleteSelectedPreviewImage();
  }
});
document.addEventListener('copy',e=>{
  if(!clickMoveElement||!els.preview.contains(clickMoveElement)||clickMoveElement.matches('table,img'))return;
  const copied=selectedPreviewElementHtml(clickMoveElement);
  copiedPreviewElementHtml=copied.html;
  e.preventDefault();
  if(e.clipboardData){
    e.clipboardData.setData('text/html',copied.html);
    e.clipboardData.setData('text/plain',copied.plain);
  }
});
document.addEventListener('paste',e=>{
  if(!clickMoveElement||!els.preview.contains(clickMoveElement)||clickMoveElement.matches('table,img')||!copiedPreviewElementHtml)return;
  e.preventDefault();
  pasteSelectedPreviewElement();
});
document.addEventListener('click',e=>{if(codeLangMenu&&!e.target.closest('.code-lang-menu')&&!e.target.closest('.code-lang'))closeCodeLanguageMenu()});
let tblResizeDrag=null;
function updateTableCellOverflow(table){
  if(!table?.isConnected)return;
  table.querySelectorAll('th,td').forEach(cell=>cell.classList.remove('cell-overflowing'));
}
const tableFilterStates=new WeakMap();
function snapshotTableFilterView(root){
  return [...root.querySelectorAll('table')].map(table=>{
    const current=tableFilterStates.get(table);
    if(!current)return null;
    return {
      filters:[...current.filters].map(([column,values])=>[column,[...values]]),
      formatFilters:[...(current.formatFilters||new Map())].map(([column,values])=>[column,[...values]]),
      sort:current.sort?{...current.sort}:null
    };
  });
}
function restoreTableFilterView(root,snapshots){
  if(!snapshots?.some(Boolean))return;
  installTableFilters();
  [...root.querySelectorAll('table')].forEach((table,index)=>{
    const saved=snapshots[index],current=tableFilterStates.get(table);
    if(!saved||!current)return;
    current.filters=new Map(saved.filters.map(([column,values])=>[column,new Set(values)]));
    current.formatFilters=new Map(saved.formatFilters.map(([column,values])=>[column,new Set(values)]));
    current.sort=saved.sort?{...saved.sort}:null;
    applyTableFilterView(table);
  });
}
function resetTableFilterView(root){
  root.querySelectorAll('.table-filter-button').forEach(button=>button.remove());
  root.querySelectorAll('table').forEach(table=>{
    for(const section of [table,...table.querySelectorAll(':scope > thead,:scope > tbody,:scope > tfoot')]){
      const rows=[...section.children].filter(row=>row.matches('tr[data-filter-order]'));
      rows.sort((a,b)=>Number(a.dataset.filterOrder)-Number(b.dataset.filterOrder)).forEach(row=>{section.appendChild(row);row.removeAttribute('data-filter-order');if(row.hasAttribute('data-filter-hidden')){row.hidden=false;row.removeAttribute('data-filter-hidden')}});
    }
  });
}
function tableFilterModel(table){
  const rows=[...table.rows].sort((a,b)=>Number(a.dataset.filterOrder??a.rowIndex)-Number(b.dataset.filterOrder??b.rowIndex)),grid=[];
  rows.forEach((row,r)=>{
    grid[r]||=[];let col=0;
    [...row.cells].forEach(cell=>{
      while(grid[r][col])col++;
      for(let y=r;y<Math.min(rows.length,r+cell.rowSpan);y++){grid[y]||=[];for(let x=col;x<col+cell.colSpan;x++)grid[y][x]=cell}
      col+=cell.colSpan;
    });
  });
  const headerCount=table.tHead?.rows.length||1,groups=[];
  for(let i=headerCount;i<rows.length;){
    const start=i;let end=i+1;
    for(let j=i;j<end;j++)for(const cell of rows[j].cells)end=Math.min(rows.length,Math.max(end,j+cell.rowSpan));
    const groupGrid=grid.slice(start,end);
    groups.push({rows:rows.slice(start,end),values:groupGrid.map(cells=>cells.map(cell=>{const clone=cell.cloneNode(true);clone.querySelectorAll('button,.block-move-handle,.tbl-resize-handle,.tbl-table-resize-handle').forEach(el=>el.remove());return clone.textContent.trim()})),formats:groupGrid.map(cells=>cells.map(tableCellFormatTraits))});i=end;
  }
  return {rows,grid,groups};
}
function tableCellFormatTraits(cell){
  const nodes=[cell,...cell.querySelectorAll('*')].filter(node=>!node.closest('.table-filter-button,.block-move-handle')),
    traits=new Set(),hasStyle=predicate=>nodes.some(predicate);
  if(hasStyle(node=>node.matches('strong,b')||Number(node.style?.fontWeight)>=600))traits.add('bold');
  if(hasStyle(node=>node.matches('em,i')||node.style?.fontStyle==='italic'))traits.add('italic');
  if(hasStyle(node=>node.matches('u')||String(node.style?.textDecoration||node.style?.textDecorationLine).includes('underline')))traits.add('underline');
  if(hasStyle(node=>node.matches('font[color]')||!!node.style?.color))traits.add('color');
  if(hasStyle(node=>node.matches('mark')||!!node.style?.backgroundColor||!!node.style?.background))traits.add('background');
  return traits;
}
function installTableFilters(){
  if(localStorage.getItem('md-option-table-filter')!=='1')return;
  els.preview.querySelectorAll('table').forEach(table=>{
    if(table.querySelector('.table-filter-button'))return;
    const model=tableFilterModel(table);if(!model.rows.length)return;
    const state={...model,filters:new Map(),formatFilters:new Map(),sort:null};tableFilterStates.set(table,state);
    model.rows.forEach((row,i)=>row.dataset.filterOrder=String(i));
    let column=0;
    for(const cell of model.rows[0].cells){
      const index=column;column+=cell.colSpan;
      const button=document.createElement('button');button.type='button';button.className='table-filter-button';button.dataset.filterColumn=String(index);button.textContent='▾';button.title='이 열 필터 및 정렬';button.contentEditable='false';button.setAttribute('aria-pressed','false');
      button.onmousedown=event=>{event.preventDefault();event.stopPropagation()};
      button.onclick=event=>{event.preventDefault();event.stopPropagation();showTableFilterMenu(table,index,button)};cell.appendChild(button);
    }
  });
}
function applyTableFilterView(table){
  const state=tableFilterStates.get(table);if(!state)return;
  const groups=[...state.groups];
  if(state.sort)groups.sort((a,b)=>String(a.values[0]?.[state.sort.column]||'').localeCompare(String(b.values[0]?.[state.sort.column]||''),'ko',{numeric:true,sensitivity:'base'})*state.sort.direction);
  groups.forEach(group=>{
    const visible=group.values.some((values,rowIndex)=>[...state.filters].every(([column,allowed])=>allowed.has(values[column]||''))&&[...state.formatFilters].every(([column,required])=>[...required].every(trait=>group.formats[rowIndex]?.[column]?.has(trait))));
    group.rows.forEach(row=>{row.hidden=!visible;if(!visible)row.dataset.filterHidden='1';else row.removeAttribute('data-filter-hidden');row.parentElement.appendChild(row)});
  });
  updateTableFilterIndicators(table);
}
function updateTableFilterIndicators(table){
  const state=tableFilterStates.get(table);if(!state)return;
  table.querySelectorAll('.table-filter-button').forEach(button=>{
    const column=Number(button.dataset.filterColumn),allowed=state.filters.get(column),formats=state.formatFilters.get(column);
    const total=new Set(state.groups.flatMap(group=>group.values.map(row=>row[column]||''))).size;
    const active=!!allowed&&allowed.size<total||!!formats?.size;
    button.classList.toggle('filter-active',active);button.setAttribute('aria-pressed',String(active));
    button.title=active?`필터 적용됨${allowed?` · ${allowed.size}/${total}개 값 표시`:''}${formats?.size?` · 서식 ${formats.size}개`:''}`:'이 열 필터 및 정렬';
  });
}
function showTableFilterMenu(table,column,button){
  document.querySelector('.table-filter-popup')?.remove();
  Object.assign(tableFilterStates.get(table),tableFilterModel(table));
  const state=tableFilterStates.get(table),values=[...new Set(state.groups.flatMap(group=>group.values.map(row=>row[column]||'')))].sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));
  state.formatFilters||=new Map();
  const selected=new Set(state.filters.get(column)||values),selectedFormats=new Set(state.formatFilters.get(column)||[]),menu=document.createElement('div');menu.className='file-context-menu table-filter-popup';menu.contentEditable='false';
  const close=()=>{menu.remove();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)};
  const outside=event=>{if(!menu.contains(event.target)&&event.target!==button)close()},key=event=>{if(event.key==='Escape')close()};
  const actions=document.createElement('div');actions.className='table-filter-actions';menu.appendChild(actions);
  const action=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{fn();close()};actions.appendChild(b)};
  action('오름차순 정렬',()=>{state.sort={column,direction:1};applyTableFilterView(table)});
  action('내림차순 정렬',()=>{state.sort={column,direction:-1};applyTableFilterView(table)});
  action('이 표 필터·정렬 초기화',()=>{state.filters.clear();state.formatFilters.clear();state.sort=null;applyTableFilterView(table)});
  const valueSection=document.createElement('details');valueSection.className='table-filter-section';valueSection.open=true;valueSection.innerHTML='<summary>값 필터</summary>';
  const valueBody=document.createElement('div');valueBody.className='table-filter-section-body';valueSection.appendChild(valueBody);menu.appendChild(valueSection);
  const search=document.createElement('input');search.type='search';search.placeholder='값 검색';valueBody.appendChild(search);
  const box=document.createElement('div');box.className='table-filter-values';
  const applySelection=()=>{if(selected.size===values.length)state.filters.delete(column);else state.filters.set(column,new Set(selected));applyTableFilterView(table)};
  const all=document.createElement('button');all.textContent='전체 선택 / 해제';all.onclick=()=>{const checked=selected.size!==values.length;selected.clear();if(checked)values.forEach(value=>selected.add(value));paint();applySelection()};valueBody.append(all,box);
  const paint=()=>{box.replaceChildren();values.filter(value=>value.toLowerCase().includes(search.value.toLowerCase())).forEach(value=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(value);input.onchange=()=>{input.checked?selected.add(value):selected.delete(value);applySelection()};label.append(input,document.createTextNode(value||'(빈 값)'));box.appendChild(label)})};search.oninput=paint;paint();
  const formatSection=document.createElement('details');formatSection.className='table-filter-section';formatSection.innerHTML='<summary>서식 필터</summary>';
  const formatBody=document.createElement('div');formatBody.className='table-filter-section-body table-filter-format-options';formatSection.appendChild(formatBody);menu.appendChild(formatSection);
  const available=new Set(state.groups.flatMap(group=>group.formats.flatMap(row=>[...(row[column]||[])])));
  [['bold','굵게'],['italic','기울임'],['underline','밑줄'],['color','글자색'],['background','배경색']].forEach(([trait,labelText])=>{
    const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=selectedFormats.has(trait);input.disabled=!available.has(trait);input.onchange=()=>{input.checked?selectedFormats.add(trait):selectedFormats.delete(trait);if(selectedFormats.size)state.formatFilters.set(column,new Set(selectedFormats));else state.formatFilters.delete(column);applyTableFilterView(table)};label.append(input,document.createTextNode(labelText));formatBody.appendChild(label);
  });
  document.body.appendChild(menu);const rect=button.getBoundingClientRect();positionContextMenu(menu,rect.left,rect.bottom+4);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
}
function addTableResize(container){
  container.querySelectorAll('table').forEach(table=>{
    if(table.dataset.resizeReady)return;
    table.dataset.resizeReady='1';
    if(!table.style.tableLayout)table.style.tableLayout='auto';
    if(!table.style.width)table.style.width='100%';
    if(!table.style.minWidth)table.style.minWidth='520px';
    const updateOuterHandles=()=>table.querySelectorAll('.tbl-row-resize-handle').forEach(handle=>{handle.style.width=table.offsetWidth+'px'});
    const MIN_COLUMN_WIDTH=120;
    function lockTableColumns(){
      const firstRow=table.querySelector('tr');
      if(!firstRow)return[];
      table.style.width=table.offsetWidth+'px';
      table.style.minWidth='0';
      table.style.tableLayout='fixed';
      const widths=Array.from(firstRow.children).filter(c=>c.matches&&c.matches('th,td')).map(c=>Math.max(MIN_COLUMN_WIDTH,c.offsetWidth));
      Array.from(table.querySelectorAll('tr')).forEach(row=>{
        Array.from(row.children).filter(c=>c.matches&&c.matches('th,td')).forEach((cell,i)=>{
          if(widths[i]){
            cell.style.width=widths[i]+'px';
            cell.style.minWidth=MIN_COLUMN_WIDTH+'px';
          }
        });
      });
      return widths;
    }
    function lockTableRows(){
      const rows=Array.from(table.querySelectorAll('tr'));
      const heights=rows.map(row=>Math.max(28,row.offsetHeight));
      const tableHeight=table.offsetHeight;
      const savedTableHeight=table.style.height;
      const savedRowHeights=rows.map(row=>row.style.height);
      const rowCells=rows.map(row=>Array.from(row.children).filter(cell=>cell.matches&&cell.matches('th,td')));
      const savedCellHeights=rowCells.map(cells=>cells.map(cell=>cell.style.height));
      table.style.height='auto';
      rows.forEach((row,rowIndex)=>{
        row.style.height='auto';
        rowCells[rowIndex].forEach(cell=>{cell.style.height='auto'});
      });
      const minHeights=rows.map(row=>Math.max(28,Math.ceil(row.getBoundingClientRect().height)));
      table.style.height=savedTableHeight;
      rows.forEach((row,rowIndex)=>{
        row.style.height=savedRowHeights[rowIndex];
        rowCells[rowIndex].forEach((cell,cellIndex)=>{cell.style.height=savedCellHeights[rowIndex][cellIndex]});
      });
      rows.forEach((row,index)=>{row.style.height=heights[index]+'px'});
      table.style.height=tableHeight+'px';
      return{heights,minHeights,tableHeight};
    }
    const cells=Array.from(table.querySelectorAll('th,td'));
    cells.forEach(cell=>{ if(cell.style.width&&parseFloat(cell.style.width)<80)cell.style.width=''; });
    const firstRowCells=Array.from(table.querySelector('tr')?.children||[]).filter(cell=>cell.matches&&cell.matches('th,td'));
    const columnCount=firstRowCells.length;
    const highlightColumn=(column,active)=>table.querySelectorAll(`.tbl-resize-handle[data-resize-col="${column}"]`).forEach(handle=>handle.classList.toggle('column-highlight',active));
    cells.forEach(cell=>{
      cell.style.position='relative';
      const row=cell.parentElement;
      const colIdx=Array.from(row.children).filter(c=>c.matches&&c.matches('th,td')).indexOf(cell);
      if(colIdx<0||colIdx>=columnCount-1)return;
      const h=document.createElement('span');
      h.className='tbl-resize-handle';
      h.dataset.resizeCol=String(colIdx);
      h.addEventListener('mouseenter',()=>highlightColumn(colIdx,true));
      h.addEventListener('mouseleave',()=>{if(tblResizeDrag?.h!==h)highlightColumn(colIdx,false)});
      h.addEventListener('mousedown',e=>{
        e.preventDefault();e.stopPropagation();
        highlightColumn(colIdx,true);h.classList.add('dragging');
        tblResizeDrag={type:'col',th:cell,h,startX:e.clientX,startW:cell.offsetWidth,startTableW:table.offsetWidth,colIdx,table,lockTableColumns,updateOuterHandles,highlightColumn,started:false};
      });
      cell.appendChild(h);
    });
    const resizeRows=Array.from(table.querySelectorAll('tr'));
    resizeRows.forEach((row,rowIdx)=>{
      row.style.position='relative';
      const rowCells=Array.from(row.children).filter(cell=>cell.matches&&cell.matches('th,td'));
      const host=rowCells[rowCells.length-1];
      if(!host||rowIdx>=resizeRows.length-1)return;
      const h=document.createElement('span');
      h.className='tbl-row-resize-handle';
      h.addEventListener('mousedown',e=>{
        e.preventDefault();e.stopPropagation();
        h.classList.add('dragging');
        tblResizeDrag={type:'row',row,rowIdx,h,startY:e.clientY,startH:row.offsetHeight,startTableH:table.offsetHeight,table,lockTableRows,updateOuterHandles,started:false};
      });
      host.appendChild(h);
    });
    const corner=document.createElement('span');
    corner.className='tbl-table-resize-handle';
    corner.addEventListener('mousedown',e=>{
      e.preventDefault();e.stopPropagation();
      corner.classList.add('dragging');
      tblResizeDrag={type:'table',h:corner,startX:e.clientX,startY:e.clientY,startW:table.offsetWidth,startH:table.offsetHeight,table,updateOuterHandles,started:false};
    });
    const tableRows=Array.from(table.querySelectorAll('tr'));
    const lastRow=tableRows[tableRows.length-1];
    const lastCells=lastRow?Array.from(lastRow.children).filter(cell=>cell.matches&&cell.matches('th,td')):[];
    const cornerHost=lastCells[lastCells.length-1];
    if(cornerHost)cornerHost.appendChild(corner);
    updateOuterHandles();
    requestAnimationFrame(()=>updateTableCellOverflow(table));
  });
}
function stripReadOnlyTableResizeArtifacts(container){
  if(!container)return;
  container.querySelectorAll('.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle').forEach(handle=>handle.remove());
  container.querySelectorAll('table').forEach(table=>{
    table.removeAttribute('data-resize-ready');
    table.classList.remove('table-selected','table-cell-range-active');
    table.querySelectorAll('tr,th,td').forEach(part=>{
      if(part.style.position==='relative')part.style.removeProperty('position');
      part.classList.remove('table-cell-selected');
      if(!part.getAttribute('style'))part.removeAttribute('style');
      if(!part.className)part.removeAttribute('class');
    });
  });
}
document.addEventListener('mousemove',e=>{
  if(!tblResizeDrag)return;
  if(tblResizeDrag.type==='col'){
    const dx=e.clientX-tblResizeDrag.startX;
    if(!tblResizeDrag.started){
      if(Math.abs(dx)<3)return;
      pushHistory(true);
      const widths=tblResizeDrag.lockTableColumns();
      tblResizeDrag.startW=widths[tblResizeDrag.colIdx]||tblResizeDrag.startW;
      tblResizeDrag.startNextW=widths[tblResizeDrag.colIdx+1]||0;
      tblResizeDrag.startTableW=tblResizeDrag.table.offsetWidth;
      tblResizeDrag.started=true;
    }
    const{startW,startNextW,startTableW,colIdx,table}=tblResizeDrag;
    const minWidth=120;
    const appliedDx=Math.max(minWidth-startW,Math.min(startNextW-minWidth,dx));
    const newW=startW+appliedDx;
    table.style.width=startTableW+'px';
    table.style.minWidth='0';
    table.style.tableLayout='fixed';
    Array.from(tblResizeDrag.table.querySelectorAll('tr')).forEach(row=>{
      const cells=Array.from(row.children).filter(c=>c.matches&&c.matches('th,td'));
      if(cells[colIdx])cells[colIdx].style.width=newW+'px';
      if(cells[colIdx+1])cells[colIdx+1].style.width=(startNextW-appliedDx)+'px';
    });
    tblResizeDrag.updateOuterHandles?.();
    updateTableCellOverflow(table);
  }else if(tblResizeDrag.type==='row'){
    const dy=e.clientY-tblResizeDrag.startY;
    if(!tblResizeDrag.started){
      if(Math.abs(dy)<3)return;
      pushHistory(true);
      const{heights,minHeights,tableHeight}=tblResizeDrag.lockTableRows();
      tblResizeDrag.startH=heights[tblResizeDrag.rowIdx]||tblResizeDrag.startH;
      tblResizeDrag.minH=minHeights[tblResizeDrag.rowIdx]||28;
      tblResizeDrag.followingHeights=heights.slice(tblResizeDrag.rowIdx+1);
      tblResizeDrag.followingMinHeights=minHeights.slice(tblResizeDrag.rowIdx+1);
      tblResizeDrag.startTableH=tableHeight||tblResizeDrag.table.offsetHeight;
      tblResizeDrag.started=true;
    }
    const availableBelow=tblResizeDrag.followingHeights.reduce((total,height,index)=>
      total+Math.max(0,height-tblResizeDrag.followingMinHeights[index]),0);
    const appliedDy=Math.max(tblResizeDrag.minH-tblResizeDrag.startH,Math.min(availableBelow,dy));
    const rows=Array.from(tblResizeDrag.table.querySelectorAll('tr'));
    tblResizeDrag.table.style.height=tblResizeDrag.startTableH+'px';
    tblResizeDrag.row.style.height=(tblResizeDrag.startH+appliedDy)+'px';
    let remaining=appliedDy;
    tblResizeDrag.followingHeights.forEach((height,index)=>{
      let nextHeight=height;
      if(remaining>0){
        const shrink=Math.min(remaining,Math.max(0,height-tblResizeDrag.followingMinHeights[index]));
        nextHeight-=shrink;
        remaining-=shrink;
      }else if(remaining<0&&index===0){
        nextHeight-=remaining;
        remaining=0;
      }
      rows[tblResizeDrag.rowIdx+1+index].style.height=nextHeight+'px';
    });
    updateTableCellOverflow(tblResizeDrag.table);
  }else if(tblResizeDrag.type==='table'){
    const dx=e.clientX-tblResizeDrag.startX;
    const dy=e.clientY-tblResizeDrag.startY;
    if(!tblResizeDrag.started){
      if(Math.max(Math.abs(dx),Math.abs(dy))<3)return;
      pushHistory(true);
      tblResizeDrag.table.style.width=tblResizeDrag.startW+'px';
      tblResizeDrag.table.style.tableLayout='fixed';
      tblResizeDrag.started=true;
    }
    tblResizeDrag.table.style.width=Math.max(260,tblResizeDrag.startW+dx)+'px';
    tblResizeDrag.table.style.minWidth='0';
    tblResizeDrag.updateOuterHandles?.();
    const scale=Math.max(.5,(tblResizeDrag.startH+dy)/Math.max(1,tblResizeDrag.startH));
    tblResizeDrag.table.style.height=Math.max(56,tblResizeDrag.startH+dy)+'px';
    Array.from(tblResizeDrag.table.querySelectorAll('tr')).forEach(row=>{
      if(!row.dataset.baseH)row.dataset.baseH=row.offsetHeight;
      row.style.height=Math.max(28,Number(row.dataset.baseH)*scale)+'px';
    });
    updateTableCellOverflow(tblResizeDrag.table);
  }
});
document.addEventListener('mouseup',()=>{
  if(tblResizeDrag){
    if(tblResizeDrag.type==='col'){
      const{h,colIdx,highlightColumn}=tblResizeDrag;
      highlightColumn?.(colIdx,false);
      requestAnimationFrame(()=>{if(h.isConnected&&h.matches(':hover'))highlightColumn?.(colIdx,true)});
    }
    tblResizeDrag.h.classList.remove('dragging');
    if(tblResizeDrag.started){syncFromPreview();pushHistory(true)}
    tblResizeDrag=null;
  }
});
/* ── Table context menu ── */
(function(){
  let ctx=null,ctxTarget=null,selectedTable=null,copiedTableHtml='',cellAnchor=null,cellFocus=null,cellDragging=false;
  function getMenu(){
    if(!ctx){
      ctx=document.createElement('div');ctx.id='tbl-ctx';
      document.body.appendChild(ctx);
      document.addEventListener('mousedown',e=>{if(!ctx.contains(e.target))hideMenu();});
      document.addEventListener('keydown',e=>{if(e.key==='Escape')hideMenu();});
    }
    return ctx;
  }
  function hideMenu(){if(ctx)ctx.style.display='none';ctxTarget=null;}
  function selectTable(table){
    clearCellSelection();
    if(selectedTable&&selectedTable!==table){
      selectedTable.classList.remove('table-selected');
      selectedTable.removeAttribute('aria-selected');
    }
    selectedTable=table||null;
    if(selectedTable){
      selectedTable.classList.add('table-selected');
      selectedTable.setAttribute('aria-selected','true');
      els.preview.focus({preventScroll:true});
      window.getSelection()?.removeAllRanges();
      state.savedPreviewRange=null;
    }else{
      window.getSelection()?.removeAllRanges();
    }
  }
  function tableCells(table){return Array.from(table?.querySelectorAll('tr')||[]).map(tr=>Array.from(tr.children).filter(cell=>cell.matches('th,td')))}
  function cellPoint(cell){
    const table=cell?.closest('table'),rows=tableCells(table),r=rows.findIndex(row=>row.includes(cell));
    return table&&r>=0?{table,r,c:rows[r].indexOf(cell)}:null;
  }
  function selectedCells(){
    if(!cellAnchor||!cellFocus||cellAnchor.table!==cellFocus.table)return[];
    const rows=tableCells(cellAnchor.table),r0=Math.min(cellAnchor.r,cellFocus.r),r1=Math.max(cellAnchor.r,cellFocus.r),c0=Math.min(cellAnchor.c,cellFocus.c),c1=Math.max(cellAnchor.c,cellFocus.c);
    return rows.slice(r0,r1+1).flatMap(row=>row.slice(c0,c1+1));
  }
  function paintCellSelection(){
    els.preview.querySelectorAll('.table-cell-selected').forEach(cell=>cell.classList.remove('table-cell-selected'));
    els.preview.querySelectorAll('.table-cell-range-active').forEach(table=>table.classList.remove('table-cell-range-active'));
    const cells=selectedCells();
    cells.forEach(cell=>cell.classList.add('table-cell-selected'));
    if(cells.length)cellAnchor.table.classList.add('table-cell-range-active');
  }
  function clearCellSelection(){
    cellAnchor=null;cellFocus=null;cellDragging=false;
    els.preview.querySelectorAll('.table-cell-selected').forEach(cell=>cell.classList.remove('table-cell-selected'));
    els.preview.querySelectorAll('.table-cell-range-active').forEach(table=>table.classList.remove('table-cell-range-active'));
  }
  function setCellSelection(anchor,focus=anchor){cellAnchor=cellPoint(anchor);cellFocus=cellPoint(focus);selectedTable=null;els.preview.querySelectorAll('.table-selected').forEach(t=>t.classList.remove('table-selected'));paintCellSelection()}
  function selectAllTableCells(table){
    const rows=tableCells(table),columnCount=Math.max(0,...rows.map(row=>row.length));
    if(!rows.length||!columnCount)return false;
    if(selectedTable){selectedTable.classList.remove('table-selected');selectedTable.removeAttribute('aria-selected')}
    selectedTable=null;
    cellAnchor={table,r:0,c:0};
    cellFocus={table,r:rows.length-1,c:columnCount-1};
    window.getSelection()?.removeAllRanges();
    state.savedPreviewRange=null;
    paintCellSelection();
    els.preview.focus({preventScroll:true});
    return true;
  }
  function caretTableCell(){
    const selection=window.getSelection();
    if(!selection?.rangeCount)return null;
    const node=selection.focusNode||selection.getRangeAt(0).startContainer;
    const element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
    const cell=element?.closest?.('td,th');
    return cell&&els.preview.contains(cell)?cell:null;
  }
  function selectFromCaretToTableEdge(key){
    const caretCell=caretTableCell();
    let anchor,focus,table;
    if(caretCell){
      anchor=cellPoint(caretCell);focus={...anchor};table=anchor?.table;
    }else if(cellAnchor?.table?.isConnected&&cellFocus?.table===cellAnchor.table){
      anchor={...cellAnchor};focus={...cellFocus};table=cellAnchor.table;
    }
    if(!anchor||!focus||!table)return false;
    const rows=tableCells(table);if(!rows.length)return false;
    if(key==='ArrowLeft')focus.c=0;
    else if(key==='ArrowRight')focus.c=Math.max(0,(rows[focus.r]||[]).length-1);
    else if(key==='ArrowUp')focus.r=0;
    else if(key==='ArrowDown')focus.r=rows.length-1;
    else return false;
    focus.c=Math.min(focus.c,Math.max(0,(rows[focus.r]||[]).length-1));
    cellAnchor={table,r:anchor.r,c:anchor.c};
    cellFocus={table,r:focus.r,c:focus.c};
    if(selectedTable){selectedTable.classList.remove('table-selected');selectedTable.removeAttribute('aria-selected');selectedTable=null}
    paintCellSelection();
    window.getSelection()?.removeAllRanges();
    state.savedPreviewRange=null;
    els.preview.focus({preventScroll:true});
    return true;
  }
  function cellRangeData(){
    if(!cellAnchor||!cellFocus)return[];
    const rows=tableCells(cellAnchor.table),r0=Math.min(cellAnchor.r,cellFocus.r),r1=Math.max(cellAnchor.r,cellFocus.r),c0=Math.min(cellAnchor.c,cellFocus.c),c1=Math.max(cellAnchor.c,cellFocus.c);
    return rows.slice(r0,r1+1).map(row=>row.slice(c0,c1+1).map(cell=>cell.innerText.trim()));
  }
  function copyCellRange(e){
    const data=cellRangeData();if(!data.length)return false;
    const text=data.map(row=>row.join('\t')).join('\n');
    const html='<table>'+data.map(row=>'<tr>'+row.map(value=>`<td>${htmlEsc(value)}</td>`).join('')+'</tr>').join('')+'</table>';
    if(e?.clipboardData){e.clipboardData.setData('text/plain',text);e.clipboardData.setData('text/html',html)}
    else navigator.clipboard?.writeText?.(text);
    return true;
  }
  function clearCellRange(){const cells=selectedCells();if(!cells.length)return false;pushHistory(true);cells.forEach(cell=>cell.replaceChildren(document.createElement('br')));syncFromPreview();pushHistory(true);paintCellSelection();return true}
  function mergeCellRange(){
    if(!cellAnchor||!cellFocus)return false;
    const rows=tableCells(cellAnchor.table),r0=Math.min(cellAnchor.r,cellFocus.r),r1=Math.max(cellAnchor.r,cellFocus.r),c0=Math.min(cellAnchor.c,cellFocus.c),c1=Math.max(cellAnchor.c,cellFocus.c);
    if(r0===r1&&c0===c1)return false;
    const rangeRows=rows.slice(r0,r1+1).map(row=>row.slice(c0,c1+1));
    if(rangeRows.some(row=>row.length!==c1-c0+1)||rangeRows.flat().some(cell=>cell.rowSpan>1||cell.colSpan>1)){showInfoNotice('셀 합치기','이미 합쳐진 셀이 포함된 범위는 먼저 셀 나누기를 해주세요.');return false}
    const contents=rangeRows.map(cells=>cells.map(cell=>cell.innerText.trim()));
    const keeper=rangeRows[0][0];pushHistory(true);keeper.replaceChildren();
    contents.forEach((values,rowIndex)=>{
      values.forEach((value,colIndex)=>{
        keeper.appendChild(document.createTextNode(value));
        if(colIndex<values.length-1)keeper.appendChild(document.createTextNode('\t'));
      });
      if(rowIndex<rangeRows.length-1)keeper.appendChild(document.createElement('br'));
    });
    keeper.colSpan=c1-c0+1;keeper.rowSpan=r1-r0+1;
    rangeRows.flat().forEach(cell=>{if(cell!==keeper)cell.remove()});
    syncFromPreview();renderMarkdown(els.editor.value);pushHistory(true);return true;
  }
  function unmergeCell(cell){
    const point=cellPoint(cell);if(!point)return[cell];const rs=cell.rowSpan||1,cs=cell.colSpan||1;
    if(rs===1&&cs===1)return[cell];
    cell.rowSpan=1;cell.colSpan=1;const created=[cell];
    for(let r=0;r<rs;r++){
      const row=point.table.querySelectorAll('tr')[point.r+r];if(!row)continue;
      const count=r===0?cs-1:cs;let before=row.children[point.c+(r===0?1:0)]||null;
      for(let c=0;c<count;c++){const next=document.createElement(cell.tagName.toLowerCase());next.appendChild(document.createElement('br'));row.insertBefore(next,before);created.push(next)}
    }
    return created;
  }
  function splitCellRange(rowParts=1,colParts=2){
    let targets=selectedCells();if(!targets.length)return false;rowParts=Math.max(1,Math.min(20,Number(rowParts)||1));colParts=Math.max(1,Math.min(20,Number(colParts)||1));pushHistory(true);
    targets=targets.flatMap(unmergeCell);
    const byRow=new Map();targets.filter(cell=>cell.isConnected).forEach(cell=>{const row=cell.parentElement;if(!byRow.has(row))byRow.set(row,[]);byRow.get(row).push(cell)});
    byRow.forEach((rowTargets,row)=>{
      const targetSet=new Set(rowTargets),original=Array.from(row.children),newRows=[];
      for(let r=1;r<rowParts;r++){const newRow=document.createElement('tr');row.parentElement.insertBefore(newRow,row.nextSibling);newRows.push(newRow)}
      original.forEach(cell=>{
        if(targetSet.has(cell)){
          let cursor=cell;for(let c=1;c<colParts;c++){const next=document.createElement(cell.tagName.toLowerCase());next.appendChild(document.createElement('br'));cursor.after(next);cursor=next}
          newRows.forEach(newRow=>{for(let c=0;c<colParts;c++){const next=document.createElement(cell.tagName.toLowerCase());next.appendChild(document.createElement('br'));newRow.appendChild(next)}});
        }else if(rowParts>1)cell.rowSpan=(cell.rowSpan||1)*rowParts;
      });
    });
    syncFromPreview();renderMarkdown(els.editor.value);pushHistory(true);return true;
  }
  function requestCellSplit(){
    const selected=selectedCells(),merged=selected.length===1&&(selected[0].rowSpan>1||selected[0].colSpan>1);
    return new Promise(resolve=>{const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>셀 나누기</h3><p>${merged?'합쳐진 셀을 풀고 다시 나눕니다.':'선택한 셀을 지정한 행과 열로 나눕니다.'}</p><div class="insert-config-grid"><label>행 수<input type="number" min="1" max="20" value="1" data-split-rows></label><label>열 수<input type="number" min="1" max="20" value="2" data-split-cols></label></div><div class="modal-actions"><button class="tool" data-split-action="cancel">취소</button><button class="tool primary" data-split-action="apply">나누기</button></div></div>`;wrap.onclick=event=>{const action=event.target.closest('[data-split-action]')?.dataset.splitAction;if(!action)return;if(action==='apply')resolve({rows:wrap.querySelector('[data-split-rows]').value,cols:wrap.querySelector('[data-split-cols]').value});else resolve(null);wrap.remove()};document.body.appendChild(wrap);wrap.querySelector('[data-split-rows]').focus()});
  }
  function parseClipboardGrid(e){
    const html=e?.clipboardData?.getData('text/html')||'',wrap=document.createElement('div');wrap.innerHTML=html;
    const table=wrap.querySelector('table');
    if(table)return Array.from(table.rows).map(row=>Array.from(row.cells).map(cell=>cell.innerText));
    const text=e?.clipboardData?.getData('text/plain')||'';
    return text?text.replace(/\r/g,'').split('\n').filter((row,i,a)=>row||i<a.length-1).map(row=>row.split('\t')):[];
  }
  function overwriteCellRange(data){
    if(!cellAnchor||!data.length)return false;const rows=tableCells(cellAnchor.table);pushHistory(true);
    data.forEach((values,ri)=>values.forEach((value,ci)=>{const cell=rows[cellAnchor.r+ri]?.[cellAnchor.c+ci];if(cell)cell.textContent=value}));
    syncFromPreview();pushHistory(true);paintCellSelection();els.preview.focus({preventScroll:true});return true;
  }
  function nestTableInCell(data){
    const cell=selectedCells()[0];if(!cell||!data.length)return false;pushHistory(true);
    const nested=document.createElement('table');const body=nested.createTBody();data.forEach(row=>{const tr=body.insertRow();row.forEach(value=>{const td=tr.insertCell();td.textContent=value})});cell.replaceChildren(nested);syncFromPreview();pushHistory(true);return true;
  }
  function insertTableAfterSelection(data){
    if(!cellAnchor||!data.length)return false;pushHistory(true);const table=document.createElement('table'),body=table.createTBody();
    data.forEach((row,ri)=>{const tr=body.insertRow();row.forEach(value=>{const cell=document.createElement(ri===0?'th':'td');cell.textContent=value;tr.appendChild(cell)})});
    cellAnchor.table.insertAdjacentElement('afterend',table);syncFromPreview();renderMarkdown(els.editor.value);pushHistory(true);return true;
  }
  function chooseTablePasteMode(){
    return new Promise(resolve=>{const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>표 붙여넣기</h3><p>선택한 셀에 표를 어떤 방식으로 넣을까요?</p><div class="modal-actions"><button class="tool" data-mode="cancel">취소</button><button class="tool" data-mode="after">아래에 새 표</button><button class="tool" data-mode="nested">셀 안에 표</button><button class="tool primary" data-mode="overwrite">셀 덮어쓰기</button></div></div>`;wrap.onclick=event=>{const mode=event.target.closest('[data-mode]')?.dataset.mode;if(mode){wrap.remove();resolve(mode)}};document.body.appendChild(wrap)});
  }
  function cleanTableClone(table){
    const clone=table.cloneNode(true);
    clone.classList.remove('table-selected');
    clone.removeAttribute('aria-selected');
    clone.removeAttribute('data-resize-ready');
    clone.querySelectorAll('.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.block-move-handle,.form-move-handle').forEach(el=>el.remove());
    clone.querySelectorAll('[data-base-h]').forEach(el=>el.removeAttribute('data-base-h'));
    return clone;
  }
  function deleteSelectedTable(table=selectedTable){
    if(!table||!els.preview.contains(table))return false;
    pushHistory(true);
    table.remove();
    selectedTable=null;
    syncFromPreview();
    renderMarkdown(els.editor.value);
    pushHistory(true);
    return true;
  }
  function findCell(el){return el.closest('td,th');}
  function getCellPos(cell){
    const row=cell.parentElement;
    const table=cell.closest('table');
    const rows=Array.from(table.querySelectorAll('tr'));
    const r=rows.indexOf(row);
    const c=Array.from(row.children).indexOf(cell);
    return{table,rows,r,c};
  }
  function tableToMd(table){
    const rows=Array.from(table.querySelectorAll('tr'));
    return rows.map((tr,ri)=>{
      const cells=Array.from(tr.children).map(td=>td.innerText.trim().replace(/\|/g,'\\|'));
      const line='| '+cells.join(' | ')+' |';
      if(ri===0){const sep='| '+cells.map(()=>'---').join(' | ')+' |';return line+'\n'+sep;}
      return line;
    }).join('\n');
  }
  function replaceMdTable(table,newMd){
    const ed=document.getElementById('editor');
    const val=ed.value;
    const oldMd=tableToMd(table).split('\n')[0];
    const lines=val.split('\n');
    let start=-1;
    for(let i=0;i<lines.length;i++){
      if(lines[i].trim().startsWith('|')&&lines[i].includes(oldMd.split('|')[1]?.trim())){start=i;break;}
    }
    if(start<0){ed.value=val+'\n\n'+newMd;return;}
    let end=start;
    while(end<lines.length&&lines[end].trim().startsWith('|'))end++;
    lines.splice(start,end-start,...newMd.split('\n'));
    ed.value=lines.join('\n');
    if(window.state&&state.active>=0)state.files[state.active].text=ed.value;
    renderMarkdown(ed.value);
  }
  function doOp(op){
    if(!ctxTarget)return;
    const table=ctxTarget.closest('table');
    if(!table)return;
    if(op==='select-all'){selectAllTableCells(table);hideMenu();return}
    if(op==='clear-selection'){selectTable(null);hideMenu();return}
    if(op==='copy-cells'){copyCellRange();hideMenu();return}
    if(op==='cut-cells'){copyCellRange();clearCellRange();hideMenu();return}
    if(op==='clear-cells'){clearCellRange();hideMenu();return}
    if(op==='merge-cells'){hideMenu();mergeCellRange();return}
    if(op==='split-cells'){hideMenu();requestCellSplit().then(value=>{if(value)splitCellRange(value.rows,value.cols)});return}
    if(op==='paste-cells'){
      hideMenu();
      navigator.clipboard?.readText?.().then(text=>overwriteCellRange(text.replace(/\r/g,'').split('\n').map(row=>row.split('\t'))));
      return;
    }
    if(op==='del-table'){
      hideMenu();
      deleteSelectedTable(table);
      return;
    }
    if(op==='reset-shape'){
      pushHistory(true);
      table.style.width='';
      table.style.minWidth='';
      table.style.tableLayout='';
      table.querySelectorAll('tr,th,td').forEach(el=>{
        el.style.width='';
        el.style.height='';
        el.style.minWidth='';
        delete el.dataset.baseH;
      });
      syncFromPreview();
      pushHistory(true);
      hideMenu();
      return;
    }
    const matrix=tableCells(table),fallback=findCell(ctxTarget)||selectedCells()[0]||matrix[0]?.[0];if(!fallback)return;
    const point=cellPoint(fallback);if(!point)return;
    const selectedHere=cellAnchor?.table===table&&cellFocus?.table===table;
    const rStart=selectedHere?Math.min(cellAnchor.r,cellFocus.r):point.r,rEnd=selectedHere?Math.max(cellAnchor.r,cellFocus.r):point.r;
    const cStart=selectedHere?Math.min(cellAnchor.c,cellFocus.c):point.c,cEnd=selectedHere?Math.max(cellAnchor.c,cellFocus.c):point.c;
    const makeEmptyCell=tag=>{const next=document.createElement(tag);next.appendChild(document.createElement('br'));return next};
    pushHistory(true);
    if(op==='row-above'||op==='row-below'){
      const ref=matrix[op==='row-above'?rStart:rEnd],refRow=ref?.[0]?.parentElement;
      if(refRow){
        const newRow=document.createElement('tr'),count=Math.max(1,...matrix.map(row=>row.reduce((sum,item)=>sum+(item.colSpan||1),0))),tag=refRow.parentElement?.tagName==='THEAD'?'th':'td';
        for(let index=0;index<count;index++)newRow.appendChild(makeEmptyCell(tag));
        op==='row-above'?refRow.before(newRow):refRow.after(newRow);
      }
    }else if(op==='col-left'||op==='col-right'){
      const targetColumn=op==='col-left'?cStart:cEnd+1;
      matrix.forEach(row=>{const rowElement=row[0]?.parentElement;if(!rowElement)return;const before=row[targetColumn]||null,tag=rowElement.parentElement?.tagName==='THEAD'?'th':'td';rowElement.insertBefore(makeEmptyCell(tag),before)});
    }else if(op==='del-row'){
      if(matrix.length>1)for(let index=rEnd;index>=rStart;index--)if(table.querySelectorAll('tr').length>1)matrix[index]?.[0]?.parentElement?.remove();
    }else if(op==='del-col'){
      const widest=Math.max(0,...matrix.map(row=>row.length));
      if(widest>1)matrix.forEach(row=>{
        const last=Math.min(cEnd,row.length-1),removeCount=Math.min(Math.max(0,last-cStart+1),Math.max(0,row.length-1));
        for(let removed=0;removed<removeCount;removed++)row[last-removed]?.remove();
      });
    }else{hideMenu();return}
    clearCellSelection();
    syncFromPreview();
    renderMarkdown(els.editor.value);
    pushHistory(true);
    hideMenu();
  }
  function showMenu(e,target){
    e.preventDefault();
    const menu=getMenu();ctxTarget=target;
    const hasCells=selectedCells().length>0;
    menu.innerHTML=`
      <div class="tbl-ctx-selection-actions"><button data-op="select-all">전체 선택</button><button data-op="clear-selection">선택 해제</button></div><hr>
      ${hasCells?'<button data-op="cut-cells">선택 셀 잘라내기</button><button data-op="copy-cells">선택 셀 복사</button><button data-op="paste-cells">선택 셀에 붙여넣기</button><button data-op="clear-cells">선택 셀 내용 지우기</button><hr><button data-op="merge-cells">선택 셀 합치기</button><button data-op="split-cells">선택 셀 나누기…</button><hr>':''}
      <button data-op="row-above">위에 행 추가</button>
      <button data-op="row-below">아래에 행 추가</button>
      <button data-op="col-left">왼쪽에 열 추가</button>
      <button data-op="col-right">오른쪽에 열 추가</button>
      <hr>
      <button data-op="del-row">현재 행 삭제</button>
      <button data-op="del-col">현재 열 삭제</button>
      <button data-op="del-table">표 삭제</button>
      <hr>
      <button data-op="reset-shape">표 형태 초기화</button>
    `;
    menu.querySelectorAll('button').forEach(btn=>btn.onclick=()=>doOp(btn.dataset.op));
    menu.style.display='block';
    let x=e.clientX,y=e.clientY;
    menu.style.left=x+'px';menu.style.top=y+'px';
    requestAnimationFrame(()=>{
      const r=menu.getBoundingClientRect();
      if(r.right>innerWidth)menu.style.left=Math.max(0,x-r.width)+'px';
      if(r.bottom>innerHeight)menu.style.top=Math.max(0,y-r.height)+'px';
    });
  }
  document.addEventListener('contextmenu',e=>{
    const table=e.target.closest('table');
    const inPreview=e.target.closest('#preview,#convert-preview');
    if(table&&inPreview){
      if(els.preview.contains(table)){
        const cell=e.target.closest('td,th'),current=selectedCells();
        if(cell&&!(cellAnchor?.table===table&&current.includes(cell)))setCellSelection(cell);
        else if(!cell)selectTable(table);
      }
      showMenu(e,e.target);
    }
  });
  els.preview.addEventListener('mousedown',e=>{
    const table=e.target.closest('table');
    if(!table){selectTable(null);return;}
    if(e.target.closest('.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle')){
      selectTable(table);
      return;
    }
    if(e.target.closest('.block-move-handle'))return;
    // 우클릭은 contextmenu 단계에서 처리한다. 여기서 기존 다중 셀 선택을 해제하지 않는다.
    if(e.button===2)return;
    const cell=e.target.closest('td,th');
    if(cell&&e.button===0){
      if(e.ctrlKey||e.metaKey){
        if(e.shiftKey&&cellAnchor?.table===table)setCellSelection(tableCells(table)[cellAnchor.r][cellAnchor.c],cell);
        else setCellSelection(cell);
        cellDragging=true;
        e.preventDefault();
        return;
      }
      selectTable(null);
      return;
    }
    const r=table.getBoundingClientRect();
    const onOuterBorder=Math.min(Math.abs(e.clientX-r.left),Math.abs(e.clientX-r.right),Math.abs(e.clientY-r.top),Math.abs(e.clientY-r.bottom))<=7;
    if(onOuterBorder){
      e.preventDefault();
      e.stopPropagation();
      selectTable(table);
    }else if(selectedTable!==table){
      selectTable(null);
    }
  },true);
  els.preview.addEventListener('mouseover',e=>{
    if(!cellDragging||!(e.buttons&1)||!(e.ctrlKey||e.metaKey))return;const cell=e.target.closest('td,th');
    if(cell&&cellAnchor?.table===cell.closest('table')){cellFocus=cellPoint(cell);paintCellSelection()}
  });
  document.addEventListener('mouseup',()=>{cellDragging=false});
  document.addEventListener('copy',e=>{
    if(selectedCells().length){e.preventDefault();copyCellRange(e);return}
    if(!selectedTable||!els.preview.contains(selectedTable))return;
    const clone=cleanTableClone(selectedTable);
    copiedTableHtml=clone.outerHTML;
    e.preventDefault();
    if(e.clipboardData){
      e.clipboardData.setData('text/html',copiedTableHtml);
      e.clipboardData.setData('text/plain',tableToMd(clone));
    }
  });
  document.addEventListener('cut',e=>{
    if(!selectedCells().length)return;e.preventDefault();copyCellRange(e);clearCellRange();
  });
  document.addEventListener('paste',async e=>{
    if(selectedCells().length){
      const data=parseClipboardGrid(e);if(!data.length)return;e.preventDefault();
      const hasTable=!!e.clipboardData?.getData('text/html')?.match(/<table[\s>]/i);
      const mode=hasTable?await chooseTablePasteMode():'overwrite';
      if(mode==='overwrite')overwriteCellRange(data);else if(mode==='nested')nestTableInCell(data);else if(mode==='after')insertTableAfterSelection(data);
      return;
    }
    if(!selectedTable||!els.preview.contains(selectedTable))return;
    const html=e.clipboardData?.getData('text/html')||copiedTableHtml;
    const wrap=document.createElement('div');
    wrap.innerHTML=html;
    const pasted=wrap.querySelector('table');
    if(!pasted)return;
    e.preventDefault();
    const clone=cleanTableClone(pasted);
    const sourceIndex=Array.from(els.preview.querySelectorAll('table')).indexOf(selectedTable);
    selectedTable.insertAdjacentElement('afterend',clone);
    syncFromPreview();
    renderMarkdown(els.editor.value);
    const insertedTable=els.preview.querySelectorAll('table')[sourceIndex+1];
    if(insertedTable)selectTable(insertedTable);
    pushHistory(true);
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      if(selectFromCaretToTableEdge(e.key)){
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    if(selectedCells().length){
      if((e.key==='Delete'||e.key==='Backspace')){e.preventDefault();clearCellRange();return}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&cellAnchor){e.preventDefault();const rows=tableCells(cellAnchor.table);cellAnchor={table:cellAnchor.table,r:0,c:0};cellFocus={table:cellAnchor.table,r:rows.length-1,c:Math.max(...rows.map(row=>row.length))-1};paintCellSelection();return}
    }
    if(!selectedTable||!els.preview.contains(selectedTable))return;
    if(e.key==='Delete'||e.key==='Backspace'){
      e.preventDefault();
      deleteSelectedTable();
    }
  });
})();
function addImageResize(root){
  if(!root||root!==els.preview)return;
  root.querySelectorAll('img').forEach(img=>{
    if(img.dataset.resizeReady)return;
    img.dataset.resizeReady='1';
    img.classList.add('img-resizable');
    img.draggable=false;
    let canResize=false;
    img.addEventListener('mousemove',e=>{
      const r=img.getBoundingClientRect();
      canResize=(r.right-e.clientX<14)&&(r.bottom-e.clientY<14);
      img.style.cursor=canResize?'nwse-resize':'default';
    });
    img.addEventListener('mouseleave',()=>{img.style.cursor=''});
    img.addEventListener('mousedown',e=>{
      const r=img.getBoundingClientRect();
      const nearEdge=(r.right-e.clientX<14)&&(r.bottom-e.clientY<14);
      if(!nearEdge)return;
      e.preventDefault();
      e.stopPropagation();
      const startX=e.clientX,startY=e.clientY,startW=r.width,startH=r.height;
      const maxW=img.parentElement?img.parentElement.clientWidth:root.clientWidth;
      img.classList.add('img-resizing');
      function move(ev){
        const dx=ev.clientX-startX;
        const dy=(ev.clientY-startY)*(startW/(startH||startW));
        const delta=Math.abs(dx)>=Math.abs(dy)?dx:dy;
        const next=Math.max(40,Math.min(maxW,startW+delta));
        img.style.width=Math.round(next)+'px';
        img.style.height='auto';
      }
      function up(){
        img.classList.remove('img-resizing');
        img.style.cursor='';
        document.removeEventListener('mousemove',move);
        document.removeEventListener('mouseup',up);
        syncFromPreview();
      }
      document.addEventListener('mousemove',move);
      document.addEventListener('mouseup',up);
    });
  });
}
let lastRenderedMarkdownText=null;
function assignPreviewHeadingAnchors(root){
  const used=new Map();
  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(heading=>{
    const base=zzHeadingSlug(heading.textContent),count=used.get(base)||0;
    used.set(base,count+1);
    heading.id=count?`${base}-${count}`:base;
  });
}
function renderMarkdown(text){
  if(state.editingPreview)return;
  lastRenderedMarkdownText=text;
  selectedPreviewImage=null;
  const html=markdownHtml(text);
  els.preview.innerHTML=html;
  assignPreviewHeadingAnchors(els.preview);
  fixSpanColors(els.preview);
  runMermaid(els.preview);
  runHighlight(els.preview);
  decorateCodeBlocks(els.preview);
  addTableResize(els.preview);
  addImageResize(els.preview);
  addMovableElements(els.preview);
  renderDocumentOutline();
  schedulePreviewLineNumbers();
}
function htmlEsc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function groupName(file){if(file.source==='local')return'루트';return file.dir||'단일문서'}
function groupedFiles(){const groups=new Map();state.files.forEach(f=>{const key=groupName(f);groups.set(key,[...(groups.get(key)||[]),f])});return [...groups.entries()].sort(([a],[b])=>{const rank=x=>x==='단일문서'?0:x==='루트'?1:2;return rank(a)-rank(b)||a.localeCompare(b,'ko')})}
function renderFileGroup(parent,dir,files,renderFile,collapsedState){
  const collapsed=!!collapsedState[dir],wrap=document.createElement('div');
  wrap.className='folder-group'+(collapsed?' collapsed':'');
  wrap.innerHTML=`<button class="folder-title" type="button"><span class="folder-label">${htmlEsc(dir)} <span class="folder-count">[${files.length}]</span></span></button><div class="folder-files"></div>`;
  const box=wrap.querySelector('.folder-files');
  let populated=false;
  const populate=()=>{if(populated)return;files.forEach(file=>renderFile(box,file));populated=true};
  if(!collapsed)populate();
  wrap.querySelector('.folder-title').onclick=()=>{
    const next=!wrap.classList.contains('collapsed');
    collapsedState[dir]=next;
    if(!next)populate();
    wrap.classList.toggle('collapsed',next);
  };
  parent.appendChild(wrap);
}
function fileTreeCount(node){return node.files.length+[...node.children.values()].reduce((sum,child)=>sum+fileTreeCount(child),0)}
function addTreeFile(root,parts,file){let node=root;parts.filter(Boolean).forEach(part=>{if(!node.children.has(part))node.children.set(part,{name:part,children:new Map(),files:[]});node=node.children.get(part)});node.files.push(file)}
function buildSidebarTrees(){
  const local={name:'로컬',children:new Map(),files:[]},uploaded={name:'업로드된 파일',children:new Map(),files:[]};
  state.files.forEach(file=>addTreeFile(file.source==='local'?local:uploaded,(file.path||file.name).replace(/\\/g,'/').split('/').slice(0,-1),file));
  state.assets.forEach((file,path)=>{
    let node=state.assetRoots[path]==='로컬'?local:uploaded;path.split('/').slice(0,-1).forEach(name=>{if(!node.children.has(name))node.children.set(name,{name,children:new Map(),files:[]});node=node.children.get(name)});
  });
  (state.sidebarFolders||[]).forEach(folder=>{
    let node=folder.root==='로컬'?local:uploaded;
    folder.path.split('/').filter(Boolean).forEach(name=>{if(!node.children.has(name))node.children.set(name,{name,children:new Map(),files:[]});node=node.children.get(name)});
  });
  return[local,uploaded];
}
function sidebarFolderFiles(node){return[...node.files,...[...node.children.values()].flatMap(sidebarFolderFiles)]}
function sidebarFolderPath(pathKey){return String(pathKey||'').split('/').slice(1).join('/')}
function uniqueSidebarPath(dir,name){
  const extension=name.match(/\.[^.]+$/)?.[0]||'',stem=extension?name.slice(0,-extension.length):name;
  const exists=value=>state.files.some(file=>String(file.path||file.name).replace(/\\/g,'/').toLowerCase()===value.toLowerCase());
  const pathFor=value=>dir?`${dir}/${value}`:value;
  let candidate=name,count=2;
  while(exists(pathFor(candidate)))candidate=`${stem} (${count++})${extension}`;
  return pathFor(candidate);
}
function askSidebarFolderName(title,value=''){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>${htmlEsc(title)}</h3><input class="file-dialog-input" value="${htmlEsc(value)}" aria-label="폴더 이름"><div class="file-dialog-error"></div><div class="modal-actions"><button class="tool" data-folder-dialog="cancel">취소</button><button class="tool primary" data-folder-dialog="ok">확인</button></div></div>`;
    const input=wrap.querySelector('input'),error=wrap.querySelector('.file-dialog-error');
    const done=result=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(result)};
    const submit=()=>{const name=input.value.trim().replace(/[\\/:*?"<>|]+/g,' ');if(!name){error.textContent='폴더 이름을 입력해 주세요.';return}done(name)};
    const onKey=e=>{if(e.key==='Escape')done(null);else if(e.key==='Enter'){e.preventDefault();submit()}};
    wrap.querySelector('[data-folder-dialog="cancel"]').onclick=()=>done(null);
    wrap.querySelector('[data-folder-dialog="ok"]').onclick=submit;
    document.addEventListener('keydown',onKey);document.body.appendChild(wrap);input.focus();input.select();
  });
}
async function addSidebarSubfolder(node,pathKey){
  const name=await askSidebarFolderName('새 폴더','새 폴더');if(!name)return;
  const parent=sidebarFolderPath(pathKey),dir=[parent,name].filter(Boolean).join('/');
  const root=pathKey.split('/')[0];
  if(state.sidebarFolders.some(f=>f.root===root&&f.path===dir)){showInfoNotice('폴더 추가','같은 이름의 폴더가 있습니다.');return}
  state.sidebarFolders.push({root,path:dir});
  renderAll();scheduleWorkspaceSave();
}
async function duplicateSidebarFolder(node,pathKey,isRoot){
  const files=sidebarFolderFiles(node);if(!files.length)return;
  const base=sidebarFolderPath(pathKey),copyName=await askSidebarFolderName('폴더 복제',`${node.name} 복사본`);if(!copyName)return;
  const parent=base.split('/').slice(0,-1).join('/'),copyBase=[parent,copyName].filter(Boolean).join('/');
  files.forEach(file=>{
    const full=String(file.path||file.name).replace(/\\/g,'/');
    const relative=base&&full.startsWith(base+'/')?full.slice(base.length+1):full.split('/').pop();
    const path=uniqueSidebarPath(copyBase,relative),name=path.split('/').pop(),dir=path.split('/').slice(0,-1).join('/');
    state.files.push({...file,name,displayName:name,path,dir,source:'local',text:String(file.text||''),savedText:String(file.savedText||'')});
  });
  renderAll();scheduleWorkspaceSave();setStatus(`${files.length}개 문서를 복제했습니다.`);
}
async function renameSidebarFolder(node,pathKey){
  const base=sidebarFolderPath(pathKey);if(!base)return;
  const name=await askSidebarFolderName('폴더 이름 변경',node.name);if(!name||name===node.name)return;
  const parent=base.split('/').slice(0,-1).join('/'),nextBase=[parent,name].filter(Boolean).join('/');
  const root=pathKey.split('/')[0];
  if(state.sidebarFolders.some(f=>f.root===root&&f.path===nextBase)||state.files.some(f=>f.path.startsWith(nextBase+'/'))){showInfoNotice('이름 변경','같은 이름의 폴더가 있습니다.');return}
  state.sidebarFolders.filter(f=>f.root===root&&(f.path===base||f.path.startsWith(base+'/'))).forEach(f=>f.path=nextBase+f.path.slice(base.length));
  moveSidebarAssets(base,nextBase,root);
  sidebarFolderFiles(node).forEach(file=>{
    const full=String(file.path||file.name).replace(/\\/g,'/'),relative=full.startsWith(base+'/')?full.slice(base.length+1):file.name;
    file.path=`${nextBase}/${relative}`;file.dir=file.path.split('/').slice(0,-1).join('/');
  });
  renderAll();scheduleWorkspaceSave();
}
async function removeSidebarFolder(node,pathKey){
  const files=sidebarFolderFiles(node);
  if(state.active>=0)syncFileBeforeAction(state.active);
  if(!await confirmFileRemoval(files,`이 폴더의 문서 ${files.length}개`))return;
  const base=sidebarFolderPath(pathKey),root=pathKey.split('/')[0];
  state.sidebarFolders=state.sidebarFolders.filter(f=>!(f.root===root&&(!base||f.path===base||f.path.startsWith(base+'/'))));
  for(const path of [...state.assets.keys()])if((state.assetRoots[path]||'업로드된 파일')===root&&(!base||path.startsWith(base+'/'))){state.assets.delete(path);delete state.assetRoots[path]}
  rebuildSidebarImageIndex();
  const targets=new Set(files),activeFile=state.files[state.active];state.files=state.files.filter(file=>!targets.has(file));
  if(!state.files.length)clearOpenDocument();
  else{state.active=Math.max(0,state.files.indexOf(activeFile));if(state.active<0)state.active=0;openFile(state.active)}
  renderAll();scheduleWorkspaceSave();
}
function showSidebarFolderMenu(event,node,pathKey,isRoot){
  event.preventDefault();event.stopPropagation();closeSidebarContextMenus();
  const menu=document.createElement('div');menu.className='file-context-menu sidebar-context-menu';
  const item=(label,action,danger=false)=>{const button=document.createElement('button');button.type='button';button.textContent=label;if(danger)button.className='danger';button.onclick=()=>{menu.remove();action()};menu.appendChild(button)};
  item('새 폴더 추가',()=>addSidebarSubfolder(node,pathKey));
  item('폴더에 파일 업로드',()=>pickSidebarUpload(pathKey,false));
  item('폴더에 폴더 업로드',()=>pickSidebarUpload(pathKey,true));
  item('복제',()=>duplicateSidebarFolder(node,pathKey,isRoot));
  if(!isRoot)item('이름 변경',()=>renameSidebarFolder(node,pathKey));
  item('저장',()=>exportMarkdownZip(sidebarFolderFiles(node),`${node.name}.zip`,true));
  item('제거',()=>removeSidebarFolder(node,pathKey),true);
  document.body.appendChild(menu);positionContextMenu(menu,event.clientX,event.clientY);
  const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('pointerdown',close)}};
  document.addEventListener('pointerdown',close);
}
function renderSidebarNode(parent,node,pathKey,isRoot=false){
  const count=fileTreeCount(node),collapsed=!!state.collapsedSidebarGroups[pathKey],wrap=document.createElement('div');
  wrap.className='folder-group'+(isRoot?' sidebar-root-group':'')+(collapsed?' collapsed':'');
  wrap.dataset.uploadFolder=pathKey;
  wrap.dataset.sidebarKey=pathKey;
  wrap.innerHTML=`<button class="folder-title" type="button" title="${htmlEsc(node.name)}"><span class="sidebar-root-chevron" aria-hidden="true"></span><span class="folder-label">${htmlEsc(node.name)} <span class="folder-count">[${count}]</span></span></button><div class="folder-files"></div>`;
  const box=wrap.querySelector('.folder-files');
  let populated=false;
  const populate=()=>{
    if(populated)return;
    renderSidebarContents(box,node,pathKey);
    populated=true;
  };
  if(!collapsed)populate();
  const folderTitle=wrap.querySelector('.folder-title');
  folderTitle.onclick=()=>{
    const next=!wrap.classList.contains('collapsed');
    state.collapsedSidebarGroups[pathKey]=next;
    if(!next)populate();
    wrap.classList.toggle('collapsed',next);
  };
  folderTitle.oncontextmenu=e=>showSidebarFolderMenu(e,node,pathKey,isRoot);
  if(!isRoot)enableSidebarDrag(folderTitle,{kind:'folder',key:pathKey});
  parent.appendChild(wrap);
}
let sidebarDragItem=null;
function enableSidebarDrag(element,item){
  element.draggable=true;
  element.addEventListener('dragstart',event=>{sidebarDragItem=item;event.stopPropagation();event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-zz-sidebar',item.key)});
  element.addEventListener('dragend',()=>{sidebarDragItem=null;clearSidebarDropMark()});
}
function clearSidebarDropMark(){els.list.querySelectorAll('[data-sidebar-drop]').forEach(el=>el.removeAttribute('data-sidebar-drop'));els.list.removeAttribute('data-sidebar-drop')}
function sidebarDropDestination(event){
  const row=event.target.closest('.folder-title,.file-item');
  const owner=row?.closest('[data-sidebar-key]');
  if(!owner||!els.list.contains(owner))return {parent:'로컬',mark:els.list,position:'inside'};
  const key=owner.dataset.sidebarKey,rect=row.getBoundingClientRect(),fraction=(event.clientY-rect.top)/Math.max(1,rect.height);
  if(row.matches('.folder-title')&&(key.split('/').length===1||(fraction>.25&&fraction<.75)))return {parent:key,mark:row,position:'inside'};
  return {parent:key.split('/').slice(0,-1).join('/'),reference:key,position:fraction<.5?'before':'after',mark:row};
}
function normalizeSidebarPath(path){const parts=[];String(path).split('/').forEach(part=>{if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part)});return parts.join('/')}
function repairMovedImageReferences(oldDirs,assetMoves){
  state.files.forEach(file=>{
    const oldDir=oldDirs.get(file)||'',newDir=file.dir||'';
    const rewrite=src=>{
      if(/^(?:[a-z]+:|\/|#)/i.test(src))return src;
      let decoded;try{decoded=decodeURIComponent(src)}catch{return src}
      const path=normalizeSidebarPath([oldDir,decoded].filter(Boolean).join('/')),target=assetMoves.get(path)||path;
      if(!state.assets.has(target)||oldDir===newDir&&target===path)return src;
      const from=newDir.split('/').filter(Boolean),to=target.split('/');while(from.length&&to.length&&from[0]===to[0]){from.shift();to.shift()}
      return encodeURI([...from.map(()=>'..'),...to].join('/'));
    };
    file.text=String(file.text||'').replace(/(!\[[^\]]*\]\(<?)([^\s)>]+)(>?)/g,(_,a,src,b)=>a+rewrite(src)+b).replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,(_,a,src,b)=>a+rewrite(src)+b);
  });
}
function moveSidebarItem(item,destination){
  const oldKey=item.key,oldRoot=oldKey.split('/')[0],oldPath=sidebarFolderPath(oldKey),newRoot=destination.parent.split('/')[0],parent=sidebarFolderPath(destination.parent);
  if(destination.reference===oldKey)return false;
  const inside=path=>item.kind==='folder'?(path===oldPath||path.startsWith(oldPath+'/')):path===oldPath;
  if(item.kind==='folder'&&(destination.parent===oldKey||destination.parent.startsWith(oldKey+'/')))return false;
  const nextPath=[parent,oldPath.split('/').pop()].filter(Boolean).join('/'),nextKey=newRoot+'/'+nextPath;
  if(nextKey!==oldKey&&(state.files.some(f=>!((f.source==='local'?'로컬':'업로드된 파일')===oldRoot&&inside(f.path))&&(f.path===nextPath||f.path.startsWith(nextPath+'/')))||state.sidebarFolders.some(f=>f.root===newRoot&&f.path===nextPath)||[...state.assets.keys()].some(p=>!((state.assetRoots[p]||'업로드된 파일')===oldRoot&&inside(p))&&(p===nextPath||p.startsWith(nextPath+'/'))))){
    showInfoNotice('이동할 수 없음','대상 위치에 같은 이름의 파일 또는 폴더가 있습니다.');return false;
  }
  if(state.active>=0)syncFileBeforeAction(state.active);
  const oldDirs=new Map(state.files.map(f=>[f,f.dir||''])),assetMoves=new Map();
  state.files.forEach(file=>{if((file.source==='local'?'로컬':'업로드된 파일')===oldRoot&&inside(file.path)){
    file.path=nextPath+file.path.slice(oldPath.length);file.dir=file.path.split('/').slice(0,-1).join('/');file.source=newRoot==='로컬'?'local':'uploaded';
  }});
  if(item.kind==='folder'){
    state.sidebarFolders.filter(f=>f.root===oldRoot&&inside(f.path)).forEach(f=>{f.path=nextPath+f.path.slice(oldPath.length);f.root=newRoot});
    if(!state.sidebarFolders.some(f=>f.root===newRoot&&f.path===nextPath))state.sidebarFolders.push({root:newRoot,path:nextPath});
  }
  for(const [path,file] of [...state.assets])if((state.assetRoots[path]||'업로드된 파일')===oldRoot&&inside(path)){
    const next=nextPath+path.slice(oldPath.length);state.assets.delete(path);delete state.assetRoots[path];state.assets.set(next,file);state.assetRoots[next]=newRoot;sidebarUploadPaths.set(file,next);assetMoves.set(path,next);
  }
  const oldParent=oldPath.split('/').slice(0,-1).join('/');
  if(oldParent&&!state.sidebarFolders.some(f=>f.root===oldRoot&&f.path===oldParent))state.sidebarFolders.push({root:oldRoot,path:oldParent});
  Object.keys(state.sidebarOrder).filter(key=>key===oldKey||key.startsWith(oldKey+'/')).forEach(key=>{const rank=state.sidebarOrder[key];delete state.sidebarOrder[key];state.sidebarOrder[nextKey+key.slice(oldKey.length)]=rank});
  const siblings=[...els.list.querySelectorAll('[data-sidebar-key]')].map(el=>el.dataset.sidebarKey).filter(key=>key!==oldKey&&key.split('/').slice(0,-1).join('/')===destination.parent);
  let index=siblings.indexOf(destination.reference);if(index<0)index=siblings.length;else if(destination.position==='after')index++;
  siblings.splice(index,0,nextKey);siblings.forEach((key,i)=>state.sidebarOrder[key]=i);
  repairMovedImageReferences(oldDirs,assetMoves);rebuildSidebarImageIndex();
  if(state.active>=0)els.editor.value=state.files[state.active].text;
  state.collapsedSidebarGroups[destination.parent]=false;renderAll();scheduleWorkspaceSave();return true;
}
function renderSidebarContents(parent,node,pathKey){
  const entries=[...[...node.children.values()].map(child=>({child,name:child.name})),...node.files.map(file=>({file,name:file.name}))];
  entries.sort((a,b)=>(state.sidebarOrder[pathKey+'/'+a.name]??1e9)-(state.sidebarOrder[pathKey+'/'+b.name]??1e9)||Number(!!a.file)-Number(!!b.file)||a.name.localeCompare(b.name,'ko'));
  entries.forEach(({child,file,name})=>{
    if(child){renderSidebarNode(parent,child,pathKey+'/'+name);return}
    const index=state.files.indexOf(file),btn=document.createElement('button');btn.className='file-item'+(index===state.active?' active':'');
    btn.title=file.path;btn.innerHTML=`<div class="file-name">${htmlEsc(file.displayName||name)}</div>`;btn.dataset.sidebarKey=pathKey+'/'+name;
    btn.onclick=()=>openFile(index);btn.oncontextmenu=e=>showFileContextMenu(e,index);
    enableSidebarDrag(btn,{kind:'file',key:pathKey+'/'+name,file});parent.appendChild(btn);
  });
}
function renderList(){const n=state.files.length;$('sidebar-files-tab').textContent=`파일 [${n}]`;els.count.textContent='';els.count.style.display='none';els.list.innerHTML='';buildSidebarTrees().forEach(node=>renderSidebarNode(els.list,node,node.name,true));renderSidebarImages()}
function rebuildSidebarImageIndex(){
  const oldUrls=new Set(Object.values(state.images));state.images={};
  state.assets.forEach((file,path)=>{sidebarUploadPaths.set(file,path);if(imageExt.test(path))addImage(file)});
  oldUrls.forEach(url=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url)});
}
function moveSidebarAssets(base,nextBase,root){
  for(const [path,file] of [...state.assets])if((state.assetRoots[path]||'업로드된 파일')===root&&path.startsWith(base+'/')){state.assets.delete(path);const next=nextBase+path.slice(base.length);sidebarUploadPaths.set(file,next);state.assets.set(next,file);delete state.assetRoots[path];state.assetRoots[next]=root}
  rebuildSidebarImageIndex();
}
function pickSidebarUpload(pathKey='업로드된 파일',folder=false){
  const input=document.createElement('input');input.type='file';input.multiple=true;
  if(folder)input.webkitdirectory=true;else input.accept=els.fileInput.accept;
  input.onchange=()=>uploadIntoSidebar(input.files,pathKey);input.click();
}
async function uploadIntoSidebar(files,pathKey='업로드된 파일'){
  const arr=[...files],base=sidebarFolderPath(pathKey);
  arr.forEach(file=>{sidebarUploadPaths.set(file,[base,pathOf(file)].filter(Boolean).join('/'));state.assetRoots[pathOf(file)]='업로드된 파일'});
  await addFiles(arr);
  const paths=new Set(arr.map(pathOf));state.files.filter(file=>paths.has(file.path)).forEach(file=>file.source='uploaded');
  renderAll();scheduleWorkspaceSave();
}
function positionContextMenu(menu,x,y){
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.max(6,Math.min(x,innerWidth-rect.width-6))+'px';
  menu.style.top=Math.max(6,Math.min(y,innerHeight-rect.height-6))+'px';
}
function closeSidebarContextMenus(){
  document.querySelectorAll('.sidebar-context-menu').forEach(menu=>menu.remove());
  document.querySelectorAll('.file-context-menu:not(.sidebar-context-menu)').forEach(menu=>menu.hidden=true);
}
function showSidebarBlankMenu(event){
  if(event.target.closest('.file-item,.folder-title'))return;
  event.preventDefault();event.stopPropagation();
  closeSidebarContextMenus();
  const menu=document.createElement('div');menu.className='file-context-menu sidebar-context-menu';
  for(const [label,action] of [['새 폴더',()=>addSidebarSubfolder(null,'로컬')],['새 문서',()=>{newDocument();const file=state.files[state.active];file.path=uniqueSidebarPath('',file.name);file.dir='';file.source='local';renderAll();scheduleWorkspaceSave()}],['파일 업로드',()=>pickSidebarUpload('업로드된 파일')],['폴더 업로드',()=>pickSidebarUpload('업로드된 파일',true)]]){
    const button=document.createElement('button');button.textContent=label;button.onclick=()=>{menu.remove();action()};menu.appendChild(button);
  }
  document.body.appendChild(menu);positionContextMenu(menu,event.clientX,event.clientY);
  const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('pointerdown',close)}};
  document.addEventListener('pointerdown',close);
}
function renderSidebarImages(){
  const assets=[...state.assets].filter(([path])=>imageExt.test(path));if(!assets.length)return;
  const group=document.createElement('div');group.className='folder-group';
  const heading=document.createElement('button');heading.className='folder-title';heading.textContent=`이미지 (${assets.length})`;
  const box=document.createElement('div');box.className='folder-files';heading.onclick=()=>box.hidden=!box.hidden;
  assets.forEach(([path,file])=>{
    const button=document.createElement('button');button.className='file-item';button.textContent=path.split('/').pop();button.title=path;
    button.onclick=()=>{
      const url=state.images[path]||URL.createObjectURL(file);
      const used=state.files.filter(doc=>{
        const refs=[...String(doc.text||'').matchAll(/!\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)|<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>m[1]||m[2]);
        return refs.some(ref=>imageKeysFor(ref,doc).some(key=>key===path||state.images[key]===url));
      });
      const wrap=document.createElement('div');wrap.className='modal-backdrop';
      wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>이미지 정보</h3><img src="${htmlEsc(url)}" alt="${htmlEsc(file.name)}" style="max-width:100%;max-height:40vh;object-fit:contain"><p>파일명: ${htmlEsc(file.name)}<br>확장자: ${htmlEsc(path.split('.').pop())}<br>업로드 경로: ${htmlEsc(path)}</p><p>사용 문서: ${used.length?used.map(doc=>htmlEsc(doc.path)).join('<br>'):'업로드된 MD에서 참조를 찾지 못했습니다.'}</p><div class="modal-actions"><button class="tool">닫기</button></div></div>`;
      const close=()=>{wrap.remove();document.removeEventListener('keydown',key);if(!state.images[path])URL.revokeObjectURL(url)};
      const key=e=>{if(e.key==='Escape')close()};wrap.querySelector('button').onclick=close;document.addEventListener('keydown',key);document.body.appendChild(wrap);
    };box.appendChild(button);
  });group.append(heading,box);els.list.appendChild(group);
}
async function droppedSidebarFiles(transfer,pathKey='업로드된 파일'){
  // Snapshot native File objects while the drop event still grants access.
  // Prefer them for ordinary files; entry.file() is not reliable for every
  // Explorer/virtual-file provider. Only directories need entry traversal.
  const fallback=[...(transfer.files||[])];
  const sources=[...(transfer.items||[])].filter(item=>!item.kind||item.kind==='file').map(item=>{
    let entry=null,file=null;
    try{entry=item.webkitGetAsEntry?.()}catch{}
    try{file=item.getAsFile?.()}catch{}
    return {entry,file};
  });
  if(!sources.length)return fallback;
  const files=[];
  async function walk(entry,parent=''){
    const path=parent+entry.name;
    if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));sidebarUploadPaths.set(file,path);files.push(file)}
    else if(entry.isDirectory){
      const dir=[sidebarFolderPath(pathKey),path].filter(Boolean).join('/'),root='업로드된 파일';
      if(!state.sidebarFolders.some(f=>f.root===root&&f.path===dir))state.sidebarFolders.push({root,path:dir});
      const reader=entry.createReader();for(;;){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)await walk(child,path+'/')}
    }
  }
  for(const {entry,file} of sources){
    if(entry?.isDirectory){await walk(entry);continue}
    const direct=file||fallback.find(candidate=>candidate.name===entry?.name);
    if(direct){files.push(direct);continue}
    if(entry)await walk(entry);
  }
  if(!files.length&&!sources.some(source=>source.entry?.isDirectory))return fallback;
  return files;
}
function decodeHashtagEntities(value){
  const textarea=document.createElement('textarea');
  return String(value||'').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,entity=>{
    textarea.innerHTML=entity;
    return textarea.value;
  });
}
function documentHashtags(text){
  const clean=String(text||'').replace(/(`{3,}|~{3,})[\s\S]*?\1/g,'').replace(/`[^`\n]*`/g,'');
  const tags=[];
  clean.split(/\r?\n/).forEach(line=>{
    const withoutHeading=line.replace(/^\s*#{1,6}\s+/,'');
    const plain=decodeHashtagEntities(withoutHeading
      .replace(/<!--[\s\S]*?-->/g,'')
      .replace(/<[^>]*>/g,'')
      .replace(/&nbsp;|&#160;/gi,' ')
      .trim())
      .replace(/^[*_~]+(?=#)/u,'');
    const spaced=plain.match(/^#\s+(.+)$/u);
    if(spaced){
      const phrase=spaced[1].trim().replace(/[*_~]+$/u,'').replace(/[.,!?;:]+$/u,'').trim();
      if(phrase&&!tags.includes(phrase))tags.push(phrase);
      return;
    }
    for(const match of plain.matchAll(/(?:^|[\s([{*_~])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)){
      if(!tags.includes(match[1]))tags.push(match[1]);
    }
  });
  return tags;
}
let previewArrivalTimer=0,previewArrivalDelay=0,previewArrivalRequest=0,previewArrivalMarkers=[];
function clearPreviewArrival(){
  clearTimeout(previewArrivalTimer);
  CSS.highlights?.delete('preview-arrival');
  CSS.highlights?.delete('markdown-arrival');
  previewArrivalMarkers.forEach(marker=>marker.remove());
  previewArrivalMarkers=[];
}
function previewArrivalRanges(element,matchText=''){
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      if(!node.nodeValue.trim())return NodeFilter.FILTER_REJECT;
      const parent=node.parentElement;
      if(parent?.closest('[contenteditable="false"],.block-move-handle,.unique-block-move-handle'))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes=[];
  let node;
  while((node=walker.nextNode()))textNodes.push(node);
  const needle=String(matchText||'').trim();
  if(needle){
    for(const textNode of textNodes){
      const start=textNode.nodeValue.indexOf(needle);
      if(start<0)continue;
      const range=document.createRange();
      range.setStart(textNode,start);
      range.setEnd(textNode,start+needle.length);
      return[range];
    }
  }
  return textNodes.map(textNode=>{
    const range=document.createRange();
    range.selectNodeContents(textNode);
    return range;
  });
}
function rangeFromTextOffsets(root,start,end){
  if(!root||start<0||end<=start)return null;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let offset=0,startNode=null,endNode=null,startOffset=0,endOffset=0,node;
  while((node=walker.nextNode())){
    const next=offset+node.nodeValue.length;
    if(!startNode&&start>=offset&&start<=next){
      startNode=node;
      startOffset=Math.min(node.nodeValue.length,start-offset);
    }
    if(end>=offset&&end<=next){
      endNode=node;
      endOffset=Math.min(node.nodeValue.length,end-offset);
      break;
    }
    offset=next;
  }
  if(!startNode||!endNode)return null;
  const range=document.createRange();
  range.setStart(startNode,startOffset);
  range.setEnd(endNode,endOffset);
  return range;
}
function markdownArrivalInfo(matchText='',sourceOffset=-1){
  const source=els.editor.value;
  const needle=String(matchText||'').trim();
  let start=Number.isFinite(sourceOffset)&&sourceOffset>=0?sourceOffset:-1;
  if(needle){
    const located=source.indexOf(needle,Math.max(0,start));
    if(located>=0)start=located;
    else if(start<0)start=source.indexOf(needle);
  }
  if(start<0)return null;
  let end=needle&&source.slice(start,start+needle.length)===needle
    ?start+needle.length
    :source.indexOf('\n',start);
  if(end<0)end=source.length;
  if(end<=start)end=Math.min(source.length,start+1);
  renderMarkdownHighlight(source);
  const range=rangeFromTextOffsets(els.markdownHighlight,start,end);
  return range?{range,start}:null;
}
function addArrivalMarkers(ranges,className=''){
  ranges.forEach(range=>{
    [...range.getClientRects()].forEach(rect=>{
      if(rect.width<1||rect.height<1)return;
      const marker=document.createElement('span');
      marker.className=`preview-arrival-marker ${className}`.trim();
      Object.assign(marker.style,{
        left:`${rect.left-1}px`,
        top:`${rect.top-1}px`,
        width:`${rect.width+2}px`,
        height:`${rect.height+2}px`
      });
      document.body.appendChild(marker);
      previewArrivalMarkers.push(marker);
    });
  });
}
function scrollMarkdownToSource(sourceOffset){
  if(!Number.isFinite(sourceOffset)||sourceOffset<0)return;
  const line=(els.editor.value.slice(0,sourceOffset).match(/\n/g)||[]).length;
  const lineHeight=parseFloat(getComputedStyle(els.editor).lineHeight)||24;
  const top=Math.max(0,line*lineHeight-(els.editor.clientHeight-lineHeight)/2);
  els.editor.scrollTo({top,behavior:'smooth'});
}
function flashPreviewArrival(element,matchText='',sourceOffset=-1){
  const previewRoot=element?.closest?.('.preview');
  if(!element||!previewRoot)return;
  clearPreviewArrival();
  const ranges=previewArrivalRanges(element,matchText);
  const markdownInfo=markdownArrivalInfo(matchText,sourceOffset);
  if(window.Highlight&&CSS.highlights){
    CSS.highlights.set('preview-arrival',new Highlight(...ranges));
    if(markdownInfo)CSS.highlights.set('markdown-arrival',new Highlight(markdownInfo.range));
  }
  addArrivalMarkers(ranges);
  if(markdownInfo)addArrivalMarkers([markdownInfo.range],'markdown-arrival-marker');
  previewArrivalTimer=setTimeout(clearPreviewArrival,1450);
}
function waitForArrivalScrollSettle(elements,callback){
  const targets=elements.filter(Boolean);
  const started=performance.now();
  let previous=targets.map(target=>[target.scrollLeft,target.scrollTop]);
  let stableFrames=0,moved=false;
  const check=()=>{
    const current=targets.map(target=>[target.scrollLeft,target.scrollTop]);
    const still=current.every((position,index)=>
      Math.abs(position[0]-previous[index][0])<.5&&
      Math.abs(position[1]-previous[index][1])<.5
    );
    const elapsed=performance.now()-started;
    if(!still)moved=true;
    stableFrames=still&&(moved||elapsed>420)?stableFrames+1:0;
    previous=current;
    if(stableFrames>=10||elapsed>2200){
      callback();
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
function schedulePreviewArrival(element,matchText='',sourceOffset=-1){
  clearTimeout(previewArrivalDelay);
  const request=++previewArrivalRequest;
  const previewRoot=element?.closest?.('.preview')||els.preview;
  clearPreviewArrival();
  scrollMarkdownToSource(sourceOffset);
  waitForArrivalScrollSettle([previewRoot,els.editor],()=>{
    if(request!==previewArrivalRequest)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(request===previewArrivalRequest)flashPreviewArrival(element,matchText,sourceOffset);
    }));
  });
}
function scrollPreviewToText(text){
  const target=String(text||'').trim();
  if(!target)return false;
  const walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    if(!node.nodeValue.includes(target))continue;
    const element=node.parentElement;
    const sourceOffset=els.editor.value.indexOf(target);
    element?.scrollIntoView({block:'center',behavior:'smooth'});
    schedulePreviewArrival(element,target,sourceOffset);
    return true;
  }
  return false;
}
function renderDocumentOutline(){
  if(!els.outline)return;
  const headings=[...els.preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  headings.forEach((heading,index)=>{if(!heading.id)heading.id=`zz-heading-${index}`});
  if(state.active<0&&!els.editor.value.trim()){
    els.outline.innerHTML='<div class="empty">문서를 열면 제목과 문단 탐색이 표시됩니다.</div>';
    return;
  }
  const headingTree=[],stack=[];
  headings.forEach((heading,index)=>{
    const node={heading,index,level:Number(heading.tagName.slice(1)),children:[]};
    while(stack.length&&stack[stack.length-1].level>=node.level)stack.pop();
    if(stack.length)stack[stack.length-1].children.push(node);
    else headingTree.push(node);
    stack.push(node);
  });
  const renderHeadingNode=(node,depth=0)=>{
    const hasChildren=node.children.length>0;
    const collapsed=hasChildren&&collapsedOutlineHeadings.has(node.index);
    const control=hasChildren
      ?`<button class="outline-branch-toggle" type="button" data-outline-toggle="${node.index}" aria-label="하위 서식 ${collapsed?'펼치기':'접기'}" aria-expanded="${!collapsed}"></button>`
      :'<span class="outline-branch-spacer" aria-hidden="true"></span>';
    return `<div class="outline-node${collapsed?' collapsed':''}" data-outline-node="${node.index}">
      <div class="outline-row" style="--outline-depth:${depth}">${control}<button class="outline-item" type="button" data-outline-index="${node.index}" data-level="${node.level}"><span class="outline-level">H${node.level}</span><span class="outline-text">${htmlEsc(node.heading.textContent.trim()||`제목 ${node.index+1}`)}</span></button></div>
      ${hasChildren?`<div class="outline-children">${node.children.map(child=>renderHeadingNode(child,depth+1)).join('')}</div>`:''}
    </div>`;
  };
  const headingRows=headingTree.map(node=>renderHeadingNode(node)).join('');
  const tags=hashtagNavigatorEnabled?documentHashtags(els.editor.value):[];
  const structureCollapsed=collapsedOutlineSections.structure;
  const tagsCollapsed=collapsedOutlineSections.tags;
  const structureSection=`<section class="outline-section${structureCollapsed?' collapsed':''}" data-outline-section-panel="structure">
    <button class="outline-section-toggle" type="button" data-outline-section="structure" aria-expanded="${!structureCollapsed}"><span class="outline-section-chevron" aria-hidden="true"></span><span>서식</span><span class="outline-section-count">${headings.length}</span></button>
    <div class="outline-section-body">${headingRows||'<div class="muted" style="padding:8px 10px">제목 서식이 없습니다.</div>'}</div>
  </section>`;
  const tagSection=hashtagNavigatorEnabled?`<section class="outline-section${tagsCollapsed?' collapsed':''}" data-outline-section-panel="tags">
    <button class="outline-section-toggle" type="button" data-outline-section="tags" aria-expanded="${!tagsCollapsed}"><span class="outline-section-chevron" aria-hidden="true"></span><span>해시태그</span><span class="outline-section-count">${tags.length}</span></button>
    <div class="outline-section-body">${tags.length?tags.map(tag=>`<button class="tag-item" type="button" data-outline-tag="${htmlEsc(tag)}">${htmlEsc(tag)}</button>`).join(''):'<div class="muted" style="padding:8px 10px">사용된 해시태그가 없습니다.</div>'}</div>
  </section>`:'';
  els.outline.innerHTML=structureSection+tagSection;
}
let hashtagContextMenu=null,hashtagContextTag='';
function hideHashtagContextMenu(){
  if(hashtagContextMenu)hashtagContextMenu.hidden=true;
  hashtagContextTag='';
}
function removeDocumentHashtag(tag){
  const escaped=String(tag||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(!escaped)return false;
  const gap=String(tag).includes(' ')?'\\s+':'';
  const pattern=new RegExp(`(^|[\\s([{])#${gap}${escaped}(?=$|[\\s)\\]},.!?:;])`,'gu');
  const walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      return node.parentElement?.closest('pre,code,.zz-math')
        ?NodeFilter.FILTER_REJECT
        :NodeFilter.FILTER_ACCEPT;
    }
  });
  const changes=[];
  let node;
  while((node=walker.nextNode())){
    const value=node.nodeValue.replace(pattern,'$1');
    if(value!==node.nodeValue)changes.push([node,value]);
  }
  if(!changes.length)return false;
  pushHistory(true);
  changes.forEach(([textNode,value])=>{textNode.nodeValue=value});
  syncFromPreview();
  pushHistory(true);
  renderDocumentOutline();
  return true;
}
function ensureHashtagContextMenu(){
  if(hashtagContextMenu)return hashtagContextMenu;
  hashtagContextMenu=document.createElement('div');
  hashtagContextMenu.className='file-context-menu';
  hashtagContextMenu.hidden=true;
  hashtagContextMenu.innerHTML='<button type="button" class="danger" data-hashtag-action="remove">해시태그 제거</button>';
  hashtagContextMenu.addEventListener('mousedown',e=>e.preventDefault());
  hashtagContextMenu.addEventListener('click',e=>{
    if(!e.target.closest('[data-hashtag-action="remove"]'))return;
    const tag=hashtagContextTag;
    hideHashtagContextMenu();
    removeDocumentHashtag(tag);
  });
  document.addEventListener('mousedown',e=>{
    if(!hashtagContextMenu.hidden&&!hashtagContextMenu.contains(e.target))hideHashtagContextMenu();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideHashtagContextMenu()});
  window.addEventListener('resize',hideHashtagContextMenu);
  document.addEventListener('scroll',hideHashtagContextMenu,true);
  document.body.appendChild(hashtagContextMenu);
  return hashtagContextMenu;
}
function showHashtagContextMenu(e,tag){
  e.preventDefault();
  e.stopPropagation();
  const menu=ensureHashtagContextMenu();
  hashtagContextTag=tag;
  menu.hidden=false;
  menu.style.left=e.clientX+'px';
  menu.style.top=e.clientY+'px';
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.max(6,Math.min(e.clientX,window.innerWidth-rect.width-6))+'px';
  menu.style.top=Math.max(6,Math.min(e.clientY,window.innerHeight-rect.height-6))+'px';
}
function setSidebarView(view){
  state.sidebarView=view==='outline'?'outline':'files';
  const outline=state.sidebarView==='outline';
  $('sidebar-files-tab').classList.toggle('active',!outline);
  $('sidebar-outline-tab').classList.toggle('active',outline);
  $('sidebar-files-tab').setAttribute('aria-selected',String(!outline));
  $('sidebar-outline-tab').setAttribute('aria-selected',String(outline));
  els.list.hidden=outline;
  els.outline.hidden=!outline;
  if(outline)renderDocumentOutline();
}
let fileContextMenu=null,fileContextIndex=-1;
function hideFileContextMenu(){
  if(fileContextMenu)fileContextMenu.hidden=true;
  fileContextIndex=-1;
}
function ensureFileContextMenu(){
  if(fileContextMenu){if(!fileContextMenu.isConnected)document.body.appendChild(fileContextMenu);return fileContextMenu}
  fileContextMenu=document.createElement('div');
  fileContextMenu.className='file-context-menu';
  fileContextMenu.hidden=true;
  fileContextMenu.innerHTML=`
    <button type="button" data-file-action="add">추가</button>
    <button type="button" data-file-action="duplicate">복제</button>
    <button type="button" data-file-action="rename">이름 변경</button>
    <button type="button" data-file-action="save">저장</button>
    <hr>
    <button type="button" class="danger" data-file-action="remove">제거</button>`;
  fileContextMenu.addEventListener('click',e=>{
    const action=e.target.closest('[data-file-action]')?.dataset.fileAction;
    const index=fileContextIndex;
    if(!action||!state.files[index])return;
    hideFileContextMenu();
    if(action==='add')showAddFileChoiceDialog();
    else if(action==='rename')showRenameFileDialog(index);
    else if(action==='duplicate')duplicateSidebarFile(index);
    else if(action==='save')showFileSaveDialog(index);
    else if(action==='remove')removeSidebarFile(index);
  });
  document.addEventListener('mousedown',e=>{if(!fileContextMenu.hidden&&!fileContextMenu.contains(e.target))hideFileContextMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideFileContextMenu()});
  window.addEventListener('resize',hideFileContextMenu);
  document.addEventListener('scroll',hideFileContextMenu,true);
  document.body.appendChild(fileContextMenu);
  return fileContextMenu;
}
function showFileContextMenu(e,index){
  e.preventDefault();
  e.stopPropagation();
  if(!state.files[index])return;
  closeSidebarContextMenus();
  const menu=ensureFileContextMenu();
  fileContextIndex=index;
  menu.hidden=false;
  menu.style.left=e.clientX+'px';
  menu.style.top=e.clientY+'px';
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.max(6,Math.min(e.clientX,window.innerWidth-rect.width-6))+'px';
  menu.style.top=Math.max(6,Math.min(e.clientY,window.innerHeight-rect.height-6))+'px';
}
function showAddFileChoiceDialog(){
  document.querySelector('.file-add-choice-dialog')?.remove();
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop file-add-choice-dialog';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="file-add-choice-title">
    <h3 id="file-add-choice-title">문서 추가</h3>
    <p>새 문서를 만들거나 기존 파일을 불러올 수 있습니다.</p>
    <div class="file-add-choice-list">
      <button class="file-add-choice" type="button" data-add-choice="new">
        <span class="file-add-choice-icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 1.5h5l3 3v9h-8a1 1 0 01-1-1v-10a1 1 0 011-1z"/><path d="M8.5 1.5v3h3"/><path d="M7 7v4M5 9h4"/></svg>
        </span>
        <span class="file-add-choice-copy"><strong>새 문서</strong><span>빈 Markdown 문서를 새로 만듭니다.</span></span>
      </button>
      <button class="file-add-choice" type="button" data-add-choice="upload">
        <span class="file-add-choice-icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5h11v7H2z"/><path d="M2 5.5l1.7-3h3.5l1.2 1.4H13"/><path d="M7.5 7v4M5.8 8.7l1.7-1.7 1.7 1.7"/></svg>
        </span>
        <span class="file-add-choice-copy"><strong>파일 업로드</strong><span>MD, 코드, 이미지 등의 파일을 불러옵니다.</span></span>
      </button>
    </div>
    <div class="modal-actions"><button class="tool" type="button" data-action="cancel">취소</button></div>
  </div>`;
  const close=()=>{document.removeEventListener('keydown',onKey);wrap.remove()};
  const onKey=e=>{if(e.key==='Escape')close()};
  wrap.querySelector('[data-action="cancel"]').onclick=close;
  wrap.querySelector('[data-add-choice="new"]').onclick=()=>{
    close();
    $('new-doc').click();
  };
  wrap.querySelector('[data-add-choice="upload"]').onclick=()=>{
    close();
    els.fileInput.value='';
    els.fileInput.click();
  };
  wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
  document.addEventListener('keydown',onKey);
  document.body.appendChild(wrap);
  requestAnimationFrame(()=>wrap.querySelector('[data-add-choice="new"]')?.focus());
}
function syncFileBeforeAction(index){
  if(index===state.active)state.files[index].text=els.editor.value;
}
function normalizedSidebarFileName(value){
  let name=String(value||'').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'');
  if(name&&!mdExt.test(name))name+='.md';
  return name;
}
function duplicateSidebarFile(index){
  const file=state.files[index];
  if(!file)return;
  syncFileBeforeAction(index);
  const originalName=normalizedSidebarFileName(file.name||'새 문서.md')||'새 문서.md';
  const extension=originalName.match(/\.(?:md|markdown)$/i)?.[0]||'.md';
  const stem=originalName.slice(0,-extension.length).replace(/\s+\uBCF5\uC0AC\uBCF8(?:\s+\(\d+\))?$/,'')||'새 문서';
  const dir=file.dir||'';
  const pathFor=name=>dir?`${dir}/${name}`:name;
  const pathExists=path=>{
    const normalized=String(path).replace(/\\/g,'/').toLowerCase();
    return state.files.some(entry=>String(entry.path||entry.name||'').replace(/\\/g,'/').toLowerCase()===normalized);
  };
  let name=`${stem} 복사본${extension}`;
  let copyNumber=2;
  while(pathExists(pathFor(name)))name=`${stem} 복사본 (${copyNumber++})${extension}`;
  const copy={
    ...file,
    name,
    displayName:name,
    path:pathFor(name),
    dir,
    text:String(file.text||''),
    savedText:''
  };
  state.files.push(copy);
  openFile(state.files.length-1);
  scheduleWorkspaceSave();
  setStatus(`${name} 문서를 복제했습니다.`);
}
let fileRenameRefreshVersion=0;
function refreshAfterFileRename(){
  renderList();
  const version=++fileRenameRefreshVersion;
  const refreshSecondaryLists=()=>{
    if(version!==fileRenameRefreshVersion)return;
    renderMergeList(true);
    renderConvertList(true);
    renderHomeMergeList();
    updateHomeConvert();
  };
  if('requestIdleCallback' in window){
    window.requestIdleCallback(refreshSecondaryLists,{timeout:500});
  }else{
    setTimeout(refreshSecondaryLists,0);
  }
}
function showRenameFileDialog(index){
  const file=state.files[index];
  if(!file)return;
  syncFileBeforeAction(index);
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop file-rename-dialog';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="file-rename-title">
    <h3 id="file-rename-title">파일 이름 변경</h3>
    <p>${htmlEsc(file.path||file.name)}</p>
    <input class="file-dialog-input" type="text" value="${htmlEsc(file.name||'document.md')}" aria-label="새 파일 이름">
    <div class="file-dialog-error" aria-live="polite"></div>
    <div class="modal-actions"><button class="tool" type="button" data-action="cancel">취소</button><button class="tool primary" type="button" data-action="rename">변경</button></div>
  </div>`;
  const input=wrap.querySelector('input'),error=wrap.querySelector('.file-dialog-error');
  const close=()=>{document.removeEventListener('keydown',onKey);wrap.remove()};
  const rename=()=>{
    const name=normalizedSidebarFileName(input.value);
    if(!name){error.textContent='파일 이름을 입력해 주세요.';input.focus();return}
    const path=file.dir?`${file.dir}/${name}`:name;
    const duplicate=state.files.some((entry,i)=>i!==index&&String(entry.path||entry.name).toLowerCase()===path.toLowerCase());
    if(duplicate){error.textContent='같은 위치에 동일한 이름의 파일이 있습니다.';input.focus();return}
    file.name=name;
    file.displayName=name;
    file.path=path;
    if(index===state.active)state.lastInput={type:'md',name};
    close();
    scheduleWorkspaceSave();
    setStatus(`파일 이름을 ${name}(으)로 변경했습니다.`);
    requestAnimationFrame(refreshAfterFileRename);
  };
  const onKey=e=>{if(e.key==='Escape')close();else if(e.key==='Enter')rename()};
  input.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Escape')close();
    else if(e.key==='Enter')rename();
  });
  wrap.querySelector('[data-action="cancel"]').onclick=close;
  wrap.querySelector('[data-action="rename"]').onclick=rename;
  wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
  document.addEventListener('keydown',onKey);
  document.body.appendChild(wrap);
  input.focus();
  const dot=input.value.lastIndexOf('.');
  input.setSelectionRange(0,dot>0?dot:input.value.length);
}
function confirmFileRemoval(files,label){
  const changed=files.filter(file=>markdownFileChanged(file));
  return new Promise(resolve=>{
    const wrap=document.createElement('div');wrap.className='modal-backdrop file-remove-dialog';
    const unsaved=changed.length>0;
    wrap.innerHTML=`<div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="file-remove-title">
      <h3 id="file-remove-title">${unsaved?'저장되지 않은 변경사항':'파일 제거'}</h3>
      <p>${unsaved?`${htmlEsc(changed.length===1?(changed[0].displayName||changed[0].name):`${changed.length}개 문서`)}의 변경사항이 저장되지 않았습니다. 제거하면 변경사항을 복구할 수 없습니다.`:`${htmlEsc(label)}을(를) 목록에서 제거할까요?`}</p>
      <div class="modal-actions"><button class="tool" type="button" data-remove-choice="cancel">취소</button><button class="tool danger" type="button" data-remove-choice="remove">${unsaved?'저장하지 않고 제거':'제거'}</button></div>
    </div>`;
    const done=value=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(value)};
    const onKey=event=>{if(event.key==='Escape')done(false)};
    wrap.addEventListener('click',event=>{const choice=event.target.closest('[data-remove-choice]')?.dataset.removeChoice;if(choice)done(choice==='remove');else if(event.target===wrap)done(false)});
    document.addEventListener('keydown',onKey);document.body.appendChild(wrap);wrap.querySelector('[data-remove-choice="cancel"]').focus();
  });
}
async function removeSidebarFile(index){
  if(!state.files[index])return;
  syncFileBeforeAction(index);
  const target=state.files[index];
  if(!await confirmFileRemoval([target],target.displayName||target.name||'파일'))return;
  const removedActive=index===state.active;
  state.files.splice(index,1);
  if(!state.files.length){
    clearOpenDocument();
    renderAll();
    scheduleWorkspaceSave();
    setStatus('파일을 제거했습니다.');
    return;
  }
  if(state.active>index)state.active--;
  if(removedActive){
    state.active=Math.min(index,state.files.length-1);
    const file=state.files[state.active];
    els.editor.value=file.text||'';
    state.history=[els.editor.value];
    state.future=[];
    state.savedText=Object.hasOwn(file,'savedText')?file.savedText:els.editor.value;
    state.dirty=els.editor.value!==state.savedText;
    state.lastInput={type:'md',name:file.name||'document.md'};
  }
  renderAll();
  scheduleWorkspaceSave();
  setStatus('파일을 제거했습니다.');
}
function standaloneFilePreview(file,index){
  const previousActive=state.active;
  const article=document.createElement('article');
  article.className='preview';
  try{
    state.active=index;
    article.innerHTML=markdownHtml(file.text||'');
  }finally{
    state.active=previousActive;
  }
  fixSpanColors(article);
  runHighlight(article);
  decorateCodeBlocks(article);
  return article;
}
function showFileSaveDialog(index){
  const file=state.files[index];
  if(!file)return;
  syncFileBeforeAction(index);
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop file-save-dialog';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="file-save-title">
    <h3 id="file-save-title">개별 파일 저장</h3>
    <p>${htmlEsc(file.displayName||file.name)}</p>
    <div class="file-save-actions"><button class="tool" type="button" data-format="md">MD 저장</button><button class="tool primary" type="button" data-format="pdf">PDF 저장</button></div>
    <div class="modal-actions"><button class="tool" type="button" data-action="cancel">취소</button></div>
  </div>`;
  const close=()=>{document.removeEventListener('keydown',onKey);wrap.remove()};
  const onKey=e=>{if(e.key==='Escape')close()};
  wrap.querySelector('[data-action="cancel"]').onclick=close;
  wrap.querySelector('[data-format="md"]').onclick=()=>{
    const name=mdExt.test(file.name||'')?file.name:`${file.name||'document'}.md`;
    download(name,file.text||'');
    file.savedText=file.text||'';
    if(index===state.active){state.savedText=file.savedText;state.dirty=false}
    close();
    setStatus(`${name} 파일을 저장했습니다.`);
  };
  wrap.querySelector('[data-format="pdf"]').onclick=()=>{
    const title=(file.name||'document.md').replace(/\.(md|markdown)$/i,'')+'.pdf';
    const source=standaloneFilePreview(file,index);
    close();
    printDocument(title,source);
  };
  wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
  document.addEventListener('keydown',onKey);
  document.body.appendChild(wrap);
  wrap.querySelector('[data-format="md"]').focus();
}
function renderMergeList(skipPreview=false){if(!state.files.length){els.mergeList.innerHTML='<div class="muted">병합할 MD 파일이 없습니다.</div>';updateMergeToggleAll();if(!skipPreview)updateMergePreview();return}const checkedBefore=new Set([...els.mergeList.querySelectorAll('input:checked')].map(i=>i.value));const hadChecks=els.mergeList.querySelectorAll('input').length>0;els.mergeList.innerHTML='';groupedFiles().forEach(([dir,files])=>renderFileGroup(els.mergeList,dir,files,(box,file)=>{const i=state.files.indexOf(file),row=document.createElement('label');row.className='check-row';row.dataset.index=i;row.innerHTML=`<input type="checkbox" ${!hadChecks||checkedBefore.has(String(i))?'checked':''} value="${i}"><span><span class="merge-name">${htmlEsc(file.displayName||file.name)}</span><span class="merge-path">${htmlEsc(file.path)}</span></span>`;row.querySelector('input').addEventListener('change',()=>{updateMergeToggleAll();updateMergePreview()});row.addEventListener('mouseenter',showMergePreview);row.addEventListener('mouseleave',scheduleHideMergePreview);box.appendChild(row)},state.collapsedMergeGroups,()=>renderMergeList(true)));updateMergeToggleAll();if(!skipPreview)updateMergePreview()}
const selectionRequiredMessage='문서를 하나 이상 선택해 주세요.';
function showSelectionNotice(){
  document.querySelector('.selection-notice')?.remove();
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop selection-notice';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="selection-notice-title">
    <h3 id="selection-notice-title">선택한 문서 없음</h3>
    <p>${selectionRequiredMessage}</p>
    <div class="modal-actions"><button class="tool primary" type="button">확인</button></div>
  </div>`;
  const close=()=>{document.removeEventListener('keydown',onKey);wrap.remove()};
  const onKey=e=>{if(e.key==='Escape'||e.key==='Enter')close()};
  wrap.querySelector('button').onclick=close;
  wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
  document.addEventListener('keydown',onKey);
  document.body.appendChild(wrap);
  wrap.querySelector('button').focus();
}
function requireSelection(items){if(items.length)return true;showSelectionNotice();return false}
let convertPreviewSnapshot=[],convertPreviewTheme='',convertPreviewJob=0;
function sameConvertPreview(files){
  return convertPreviewTheme===state.theme&&files.length===convertPreviewSnapshot.length&&files.every((file,i)=>{
    const previous=convertPreviewSnapshot[i];
    return previous?.file===file&&previous.text===file.text&&previous.name===(file.displayName||file.name);
  });
}
const lazyPreviewObservers=new WeakMap();
function disconnectLazyPreview(container){
  lazyPreviewObservers.get(container)?.disconnect();
  lazyPreviewObservers.delete(container);
}
function lazyPreviewMarkdown(file,kind){
  if(kind==='merge')return `<!-- ${file.path} -->\n\n# ${file.name.replace(mdExt,'')}\n\n${(file.text||'').trim()}`;
  return `# ${file.displayName||file.name||'문서'}\n\n${file.text||''}`;
}
function enhanceLazyPreviewSection(section,jobIsCurrent){
  setTimeout(()=>{
    if(!jobIsCurrent()||!section.isConnected)return;
    runMermaid(section);
    section.querySelectorAll('pre').forEach(pre=>{
      const code=pre.querySelector('code');
      if(!code)return;
      if(code.textContent.length>80000){
        code.classList.add('hljs');
        code.dataset.highlighted='yes';
        code.style.background='transparent';
      }else runHighlight(pre);
    });
  },0);
}
function renderLazyPreviewSection(section){
  if(section.dataset.rendered==='1')return;
  const meta=section._lazyPreview;
  if(!meta)return;
  section.dataset.rendered='1';
  section.classList.add('rendered');
  section.style.minHeight='';
  section.innerHTML=markdownHtml(lazyPreviewMarkdown(meta.file,meta.kind));
  if(!meta.last)section.insertAdjacentHTML('beforeend','<hr>');
  fixSpanColors(section);
  decorateCodeBlocks(section);
  stripReadOnlyTableResizeArtifacts(section);
  enhanceLazyPreviewSection(section,meta.jobIsCurrent);
}
function setupLazyDocumentPreview(container,files,kind,jobIsCurrent){
  disconnectLazyPreview(container);
  const fragment=document.createDocumentFragment();
  files.forEach((file,index)=>{
    const section=document.createElement('section');
    section.className='lazy-doc-section';
    section.style.minHeight=Math.min(1400,Math.max(320,160+Math.ceil((file.text||'').length/120)*18))+'px';
    section.innerHTML=`<div class="lazy-doc-loading">${htmlEsc(file.displayName||file.name||'문서')}</div>`;
    section._lazyPreview={file,kind,last:index===files.length-1,jobIsCurrent};
    fragment.appendChild(section);
  });
  container.replaceChildren(fragment);
  const sections=[...container.querySelectorAll('.lazy-doc-section')];
  if(!('IntersectionObserver' in window)){
    sections.forEach(renderLazyPreviewSection);
    return;
  }
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      renderLazyPreviewSection(entry.target);
      observer.unobserve(entry.target);
    });
  },{root:container,rootMargin:'700px 0px'});
  lazyPreviewObservers.set(container,observer);
  sections.forEach(section=>observer.observe(section));
}
function materializeLazyPreview(container){
  if(!container)return;
  disconnectLazyPreview(container);
  container.querySelectorAll('.lazy-doc-section').forEach(renderLazyPreviewSection);
  runHighlight(container);
  runMermaid(container);
}
function updateConvertPreview(){
  if(!els.convertPreview)return;
  const files=els.convertList?[...els.convertList.querySelectorAll('input:checked')].map(i=>state.files[Number(i.value)]).filter(Boolean):[];
  if(!files.length){
    convertPreviewJob++;
    disconnectLazyPreview(els.convertPreview);
    convertPreviewSnapshot=[];
    convertPreviewTheme=state.theme;
    if(!els.convertPreview.querySelector('.convert-empty'))els.convertPreview.innerHTML=`<div class="convert-empty">${selectionRequiredMessage}</div>`;
    return;
  }
  if(sameConvertPreview(files))return;
  convertPreviewSnapshot=files.map(file=>({file,text:file.text,name:file.displayName||file.name}));
  convertPreviewTheme=state.theme;
  const job=++convertPreviewJob;
  setupLazyDocumentPreview(els.convertPreview,files,'convert',()=>job===convertPreviewJob);
}
function renderConvertList(skipPreview=false){if(!els.convertList)return;if(!state.files.length){els.convertList.innerHTML='';if(!skipPreview)updateConvertPreview();return}els.convertList.innerHTML='';state.files.forEach((file,i)=>{const row=document.createElement('label');row.className='convert-item';row.dataset.index=i;const status=file.convertedFromPdf?'PDF → MD 준비됨':file.convertedFromCode?`${file.codeLanguage||'text'} 코드블록 → MD 준비됨`:'MD → PDF 가능';row.innerHTML=`<input type="checkbox" value="${i}" checked><span><span class="convert-name">${htmlEsc(file.displayName||file.name)}</span><div class="convert-meta">${status} · ${htmlEsc(file.path)}</div></span>`;row.querySelector('input').addEventListener('change',updateConvertPreview);row.addEventListener('mouseenter',showMergePreview);row.addEventListener('mouseleave',scheduleHideMergePreview);row.ondblclick=()=>openFile(i);els.convertList.appendChild(row)});if(!skipPreview)updateConvertPreview()}
function renderHomeMergeList(){if(!els.homeMergeList)return;const checkedBefore=new Set([...els.homeMergeList.querySelectorAll('input:checked')].map(i=>i.value));const hadChecks=els.homeMergeList.querySelectorAll('input').length>0;els.homeMergeList.innerHTML='';if(state.homeMergeNotice){const note=document.createElement('div');note.className='muted';note.textContent=state.homeMergeNotice;els.homeMergeList.appendChild(note)}if(!state.files.length){const empty=document.createElement('div');empty.className='muted home-merge-empty';empty.textContent='왼쪽에서 MD 파일을 추가하면 여기에 표시됩니다.';els.homeMergeList.appendChild(empty);return}state.files.forEach((file,i)=>{const row=document.createElement('label');row.className='home-merge-item';row.innerHTML=`<input type="checkbox" ${!hadChecks||checkedBefore.has(String(i))?'checked':''} value="${i}"><span>${htmlEsc(file.displayName||file.name)}</span>`;els.homeMergeList.appendChild(row)})}
function renderAll(){const activeText=state.active>=0?(state.files[state.active]?.text||''):els.editor.value;if(state.active>=0&&els.editor.value!==activeText)els.editor.value=activeText;renderList();renderMergeList(true);renderConvertList(true);renderHomeMergeList();if(state.mode==='edit')renderMarkdown(activeText);updateHomeConvert();updateLineNumbers();const activePanel=document.querySelector('.panel.active');if(activePanel?.id==='panel-convert')scheduleModePreview('convert');else if(activePanel?.id==='panel-merge')scheduleModePreview('merge')}
function updateHomeImageSummary(file){
  if(!els.homeImageSummary)return;
  const target=file||state.files[state.active];
  const refs=target&&target.text?[...target.text.matchAll(/!\[[^\]]*]\(([^)]+)\)|!\[\[([^\]|]+)(?:\|\d+)?]]/g)].map(m=>(m[1]||m[2]||'').trim()).filter(Boolean):[];
  if(!refs.length){els.homeImageSummary.classList.add('hidden');els.homeImageSummary.innerHTML='';return}
  const missing=missingImageRefs(target);
  const linked=refs.filter(src=>!missing.includes(src));
  els.homeImageSummary.classList.remove('hidden');
  els.homeImageSummary.innerHTML=`<b>이미지 확인</b><span>연결됨 ${linked.length}개 · 누락 ${missing.length}개</span>${missing.length?`<span>함께 업로드 필요: ${htmlEsc(missing.slice(0,6).join(', '))}${missing.length>6?' 외 '+(missing.length-6)+'개':''}</span>`:''}`;
}
function updateHomeConvert(){const active=state.files[state.active];const files=state.files.filter(Boolean);const input=files.length>1?{type:'batch',name:`${files.length}개 문서`}:state.lastInput||active&&{type:active.convertedFromPdf?'pdf':'md',name:active.name};const outExt=input?.type==='pdf'?'.md':input?.type==='md'?'.pdf':'';els.homeSource.textContent=input?input.name:'업로드된 문서 없음';if(els.homeOutputExt){els.homeOutputExt.textContent=outExt;els.homeOutputExt.classList.toggle('pending',!outExt)}if(input&&!els.homeOutput.dataset.touched)els.homeOutput.value=input.type==='batch'?'converted-documents':input.name.replace(/\.(pdf|md|markdown)$/i,'')||'converted-document';updateHomeImageSummary(active)}
function updateUndoRedoButtons(){const undo=$('fmt-undo'),redo=$('fmt-redo');if(!undo||!redo)return;undo.disabled=state.history.length<2;redo.disabled=!state.future.length}
function mdHighlightToken(className,value){return `<span class="${className}">${htmlEsc(value)}</span>`}
function highlightMarkdownHtmlTag(raw){
  if(raw.startsWith('<!--'))return mdHighlightToken('md-quote',raw);
  const match=raw.match(/^(<\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?>)$/);
  if(!match)return mdHighlightToken('md-tag',raw);
  const [,open,name,attributes,close]=match;
  let output=mdHighlightToken('md-syntax',open)+mdHighlightToken('md-tag',name);
  const attrRe=/(\s+)([\w:-]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let cursor=0,attrMatch;
  while((attrMatch=attrRe.exec(attributes))){
    output+=htmlEsc(attributes.slice(cursor,attrMatch.index));
    output+=htmlEsc(attrMatch[1])+mdHighlightToken('md-attr',attrMatch[2]);
    if(attrMatch[3])output+=mdHighlightToken('md-syntax',attrMatch[3]);
    if(attrMatch[4])output+=mdHighlightToken('md-string',attrMatch[4]);
    cursor=attrRe.lastIndex;
  }
  output+=htmlEsc(attributes.slice(cursor))+mdHighlightToken('md-syntax',close);
  return output;
}
function formatMarkdownInlineToken(type,raw){
  if(type==='html')return highlightMarkdownHtmlTag(raw);
  if(type==='link'){
    const match=raw.match(/^(!?)\[([^\]]*)\]\(([^)]*)\)$/);
    if(!match)return mdHighlightToken('md-link',raw);
    return mdHighlightToken('md-syntax',`${match[1]}[`)+mdHighlightToken('md-link',match[2])+mdHighlightToken('md-syntax','](')+mdHighlightToken('md-url',match[3])+mdHighlightToken('md-syntax',')');
  }
  if(type==='code'){
    const match=raw.match(/^(`+)([\s\S]*?)\1$/);
    return match?mdHighlightToken('md-syntax',match[1])+mdHighlightToken('md-code',match[2])+mdHighlightToken('md-syntax',match[1]):mdHighlightToken('md-code',raw);
  }
  if(type==='strong'){
    const marker=raw.startsWith('**')?'**':'__';
    return mdHighlightToken('md-syntax',marker)+mdHighlightToken('md-strong',raw.slice(2,-2))+mdHighlightToken('md-syntax',marker);
  }
  if(type==='strike')return mdHighlightToken('md-syntax','~~')+mdHighlightToken('md-strong',raw.slice(2,-2))+mdHighlightToken('md-syntax','~~');
  const marker=raw[0];
  return mdHighlightToken('md-syntax',marker)+mdHighlightToken('md-em',raw.slice(1,-1))+mdHighlightToken('md-syntax',marker);
}
const markdownInlinePatterns=[
  ['html',/<!--.*?-->|<\/?[A-Za-z][^>]*>/g],
  ['link',/!?\[[^\]\n]*\]\([^)\n]*\)/g],
  ['code',/`+[^`\n]+`+/g],
  ['strong',/\*\*[^*\n]+\*\*|__[^_\n]+__/g],
  ['strike',/~~[^~\n]+~~/g],
  ['em',/(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/g]
];
function highlightMarkdownInline(text){
  let output='',cursor=0;
  while(cursor<text.length){
    let next=null,nextType='';
    markdownInlinePatterns.forEach(([type,pattern])=>{
      pattern.lastIndex=cursor;
      const match=pattern.exec(text);
      if(match&&(!next||match.index<next.index)){next=match;nextType=type}
    });
    if(!next){output+=htmlEsc(text.slice(cursor));break}
    output+=htmlEsc(text.slice(cursor,next.index))+formatMarkdownInlineToken(nextType,next[0]);
    cursor=next.index+next[0].length;
  }
  return output;
}
function highlightMarkdownSource(text){
  let fence='',fenceLength=0;
  return String(text||'').split('\n').map(line=>{
    const closing=line.match(/^\s*(`{3,}|~{3,})\s*$/);
    if(fence){
      if(closing&&closing[1][0]===fence&&closing[1].length>=fenceLength){fence='';fenceLength=0;return mdHighlightToken('md-fence',line)}
      return mdHighlightToken('md-code-content',line);
    }
    const opening=line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if(opening){
      fence=opening[2][0];
      fenceLength=opening[2].length;
      return htmlEsc(opening[1])+mdHighlightToken('md-fence',opening[2])+mdHighlightToken('md-tag',opening[3]);
    }
    if(/^\s*(?:[-*_]\s*){3,}$/.test(line))return mdHighlightToken('md-syntax',line);
    let match=line.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
    if(match)return htmlEsc(match[1])+mdHighlightToken('md-syntax',match[2])+htmlEsc(match[3])+`<span class="md-heading">${highlightMarkdownInline(match[4])}</span>`;
    match=line.match(/^(\s*)(>+)(\s?)(.*)$/);
    if(match)return htmlEsc(match[1])+mdHighlightToken('md-quote',match[2])+htmlEsc(match[3])+highlightMarkdownInline(match[4]);
    match=line.match(/^(\s*)([-+*]|\d+\.)(\s+)(.*)$/);
    if(match)return htmlEsc(match[1])+mdHighlightToken('md-list',match[2])+htmlEsc(match[3])+highlightMarkdownInline(match[4]);
    return highlightMarkdownInline(line);
  }).join('\n');
}
let markdownHighlightTimer=0,pendingMarkdownHighlight='',lastMarkdownHighlightText=null;
function deferredEditorDelay(text,base,max){
  return Math.min(max,base+Math.floor(String(text||'').length/12000)*12);
}
function renderMarkdownHighlight(text=els.editor.value){
  if(!els.markdownHighlight)return;
  const source=String(text||'');
  if(source===lastMarkdownHighlightText){
    syncMarkdownHighlightScroll();
    return;
  }
  lastMarkdownHighlightText=source;
  els.markdownHighlight.innerHTML=highlightMarkdownSource(source)+(source.endsWith('\n')?'\n':'')||'\u200b';
  syncMarkdownHighlightScroll();
}
function scheduleMarkdownHighlight(text=els.editor.value){
  pendingMarkdownHighlight=text;
  clearTimeout(markdownHighlightTimer);
  markdownHighlightTimer=setTimeout(()=>{
    markdownHighlightTimer=0;
    if(pendingMarkdownHighlight===els.editor.value)renderMarkdownHighlight(pendingMarkdownHighlight);
  },deferredEditorDelay(text,70,180));
}
function syncMarkdownHighlightScroll(){
  if(!els.markdownHighlight)return;
  els.markdownHighlight.scrollTop=els.editor.scrollTop;
  els.markdownHighlight.scrollLeft=els.editor.scrollLeft;
}
let previewLineNumberFrame=0;
function previewVisualLineTops(){
  if(!els.preview)return[];
  const previewRect=els.preview.getBoundingClientRect();
  const scrollTop=els.preview.scrollTop;
  const tops=[];
  const walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT);
  const range=document.createRange();
  let node;
  while((node=walker.nextNode())){
    if(!node.nodeValue||!node.nodeValue.trim())continue;
    if(node.parentElement?.closest('.block-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle'))continue;
    range.selectNodeContents(node);
    for(const rect of range.getClientRects()){
      if(rect.width<.5||rect.height<1)continue;
      tops.push(rect.top-previewRect.top+scrollTop);
    }
  }
  range.detach();
  tops.sort((a,b)=>a-b);
  return tops.filter((top,index)=>!index||top-tops[index-1]>6);
}
function renderPreviewLineNumbers(){
  previewLineNumberFrame=0;
  if(!els.previewLineGutter||!document.querySelector('.preview-box')?.classList.contains('show-lines'))return;
  const tops=previewVisualLineTops();
  const track=document.createElement('div');
  track.className='preview-line-track';
  track.style.height=Math.max(els.preview.clientHeight,els.preview.scrollHeight)+'px';
  const fragment=document.createDocumentFragment();
  tops.forEach((top,index)=>{
    const number=document.createElement('span');
    number.className='preview-line-number';
    number.textContent=String(index+1);
    number.style.top=Math.max(0,top-1)+'px';
    fragment.appendChild(number);
  });
  track.appendChild(fragment);
  els.previewLineGutter.replaceChildren(track);
  els.previewLineGutter.scrollTop=els.preview.scrollTop;
}
function schedulePreviewLineNumbers(){
  if(previewLineNumberFrame)return;
  previewLineNumberFrame=requestAnimationFrame(renderPreviewLineNumbers);
}
function updateLineNumbers(){
  if(!els.lineGutter)return;
  const count=Math.max(1,els.editor.value.split('\n').length);
  const nums=Array.from({length:count},(_,i)=>i+1).join('\n');
  els.lineGutter.textContent=nums;
  els.lineGutter.scrollTop=els.editor.scrollTop;
  schedulePreviewLineNumbers();
  scheduleMarkdownHighlight();
}
function setLineNumbers(on){
  document.querySelector('.editor-box')?.classList.toggle('show-lines',on);
  document.querySelector('.preview-box')?.classList.remove('show-lines');
  if(els.previewLineGutter)els.previewLineGutter.replaceChildren();
  updateLineNumbers();
}
function setSwapPanes(on){
  els.editSplit.classList.toggle('edit-swapped',!on);
}
function nextUntitledName(){
  let n=1,name='새 문서.md';
  while(state.files.some(f=>f.path===name)){n++;name=`새 문서 ${n}.md`}
  return name;
}
function createDraftFromEditor(){
  if(state.active>=0)return;
  const name=nextUntitledName();
  const item={name,path:name,dir:'',text:els.editor.value,savedText:'',source:'local'};
  state.files.push(item);
  state.active=state.files.length-1;
  state.lastInput={type:'md',name};
  state.savedText='';
  state.dirty=!!els.editor.value;
  renderList();
  renderMergeList();
  updateHomeConvert();
}
function openFile(index){state.active=index;collapsedOutlineHeadings.clear();const file=state.files[index];els.editor.value=file?.text||'';state.history=[els.editor.value];state.future=[];state.savedText=file&&Object.hasOwn(file,'savedText')?file.savedText:els.editor.value;state.dirty=els.editor.value!==state.savedText;state.lastInput={type:'md',name:file?.name||'document.md'};renderMarkdown(els.editor.value);renderList();updateHomeConvert();setMode('edit');updateUndoRedoButtons();updateLineNumbers()}
let modePreviewFrame=0,modePreviewTimer=0;
function scheduleModePreview(mode){
  cancelAnimationFrame(modePreviewFrame);
  clearTimeout(modePreviewTimer);
  modePreviewFrame=requestAnimationFrame(()=>{
    modePreviewFrame=0;
    modePreviewTimer=setTimeout(()=>{
      modePreviewTimer=0;
      const active=document.querySelector('.panel.active');
      if(active?.id!==`panel-${mode}`)return;
      if(mode==='merge')updateMergePreview();
      else if(mode==='convert')updateConvertPreview();
      else if(lastRenderedMarkdownText!==els.editor.value)renderMarkdown(els.editor.value);
    },0);
  });
}
function setMode(mode,showHome=false){
  const previousMode=state.mode;
  state.mode=mode;
  const findReplaceButton=$('find-replace-toggle');
  if(findReplaceButton){
    findReplaceButton.classList.toggle('hidden',showHome);
    findReplaceButton.hidden=showHome;
    const findOnly=mode!=='edit';
    findReplaceButton.title=findOnly?'찾기':'찾기 및 바꾸기';
    findReplaceButton.setAttribute('aria-label',findReplaceButton.title);
  }
  if(showHome||previousMode!==mode){
    document.querySelector('.find-replace-panel [data-find-action="close"]')?.click();
    clearPreviewFindHighlights();
    closeSourceSyntaxPopover();
    hideMergePreview(true);
  }
  els.app.classList.toggle('mode-merge',!showHome&&mode==='merge');
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',!showHome&&b.dataset.mode===mode));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',!showHome&&p.id===`panel-${mode}`));
  document.querySelectorAll('.mode-tools').forEach(g=>g.hidden=showHome||g.dataset.tools!==mode);
  $('format-tools').hidden=showHome||mode!=='edit';
  els.home.classList.toggle('hidden',!showHome);
  if(!showHome){
    if(mode==='convert'&&els.convertList.querySelectorAll('.convert-item').length!==state.files.length)renderConvertList(true);
    if(mode==='merge'&&els.mergeList.querySelectorAll('input[type="checkbox"]').length!==state.files.length)renderMergeList(true);
    if(mode==='merge'||mode==='convert'||mode==='edit')scheduleModePreview(mode);
  }
}
function pushHistory(force=false){if(state.restoring)return;clearTimeout(state.historyTimer);const commit=()=>{const v=els.editor.value;if(state.history[state.history.length-1]!==v){state.history.push(v);if(state.history.length>80)state.history.shift();state.future=[]}updateUndoRedoButtons()};force?commit():state.historyTimer=setTimeout(commit,650)}
function markDirty(){state.dirty=els.editor.value!==state.savedText}
let editorRenderTimer=null,lineNumberFrame=0,pendingEditorRender='';
function scheduleEditorRender(text){
  pendingEditorRender=text;
  clearTimeout(editorRenderTimer);
  editorRenderTimer=setTimeout(()=>{
    editorRenderTimer=null;
    if(pendingEditorRender===els.editor.value)renderMarkdown(pendingEditorRender);
  },deferredEditorDelay(text,70,180));
}
function scheduleLineNumbers(){
  if(lineNumberFrame)return;
  lineNumberFrame=requestAnimationFrame(()=>{lineNumberFrame=0;updateLineNumbers()});
}
function syncActive(){
  refreshEditorTocBlocks();
  createDraftFromEditor();
  const text=els.editor.value;
  if(state.active>=0)state.files[state.active].text=text;
  markDirty();
  scheduleEditorRender(text);
  scheduleLineNumbers();
  if(typeof scheduleWorkspaceSave==='function')scheduleWorkspaceSave();
}
function cleanPreviewHtml(root){
  resetTableFilterView(root);
  root.querySelectorAll('[data-code-surface]').forEach(el=>{el.removeAttribute('data-code-surface');el.style.removeProperty('--code-surface-fix')});
  root.querySelectorAll('[data-inline-code-ink]').forEach(el=>el.removeAttribute('data-inline-code-ink'));
  root.querySelectorAll('[data-chip-contrast]').forEach(chip=>chip.removeAttribute('data-chip-contrast'));
  const fragmentWalker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const fragmentNodes=[];while(fragmentWalker.nextNode())fragmentNodes.push(fragmentWalker.currentNode);
  fragmentNodes.forEach(node=>{node.data=node.data.replace(/\b(?:StartFragment|EndFragment)\b/gi,'')});
  // Older builds allowed TOC links to be dragged out of their generated block.
  // They are generated navigation UI, never standalone document content.
  root.querySelectorAll('.zz-toc-link').forEach(link=>{
    if(!link.closest('.zz-toc'))(link.closest('li')||link).remove();
  });
  root.querySelectorAll('.zz-source-chip-edit').forEach(button=>button.remove());
  root.querySelectorAll('.zz-source-chip-editing').forEach(chip=>chip.classList.remove('zz-source-chip-editing'));
  root.querySelectorAll('.zz-source-chip-label[contenteditable]').forEach(label=>{
    label.removeAttribute('contenteditable');
    label.removeAttribute('spellcheck');
  });
  root.querySelectorAll('.zz-lens[data-lens-source]').forEach(lens=>{
    const raw=document.createElement('template');
    raw.dataset.previewRawSource=lens.dataset.lensSource;
    lens.replaceWith(raw);
  });
  root.querySelectorAll('.obsidian-callout[data-callout-source]').forEach(callout=>{
    const raw=document.createElement('template');
    raw.dataset.previewRawSource=callout.dataset.calloutSource;
    callout.replaceWith(raw);
  });
  root.querySelectorAll('.zz-sync-block[data-sync-source]').forEach(sync=>{
    const raw=document.createElement('template');
    raw.dataset.previewRawSource=sync.dataset.syncSource;
    sync.replaceWith(raw);
  });
  root.querySelectorAll('.zz-toc[data-toc-source]').forEach(toc=>{
    const raw=document.createElement('template');
    raw.dataset.previewRawSource=toc.dataset.tocSource;
    toc.replaceWith(raw);
  });
  root.querySelectorAll('[data-embed-source]').forEach(embed=>{
    const raw=document.createElement('template');
    raw.dataset.previewRawSource=embed.dataset.embedSource;
    embed.replaceWith(raw);
  });
  root.querySelectorAll('.zz-footnote-ref').forEach(reference=>{
    const anchor=reference.querySelector('a[href^="#zz-footnote-"]');
    if(!anchor)return;
    const id=decodeURIComponent((anchor.getAttribute('href')||'').replace(/^#zz-footnote-/,''));
    const copy=reference.cloneNode(true);
    copy.querySelector('a[href^="#zz-footnote-"]')?.remove();
    const prefix=(copy.textContent||'').replace(/\u200b/g,'');
    reference.replaceWith(document.createTextNode(`${prefix}[^${id}]`));
  });
  root.querySelectorAll('a.zz-citation-ref[href^="#zz-citation-"]').forEach(reference=>{
    const id=decodeURIComponent((reference.getAttribute('href')||'').replace(/^#zz-citation-/,''));
    reference.replaceWith(document.createTextNode(`[@${id}]`));
  });
  root.querySelectorAll('[data-reference-source]').forEach(section=>{
    const definitions=[...section.querySelectorAll('ol > li')].map(item=>{
      const footnote=item.id.match(/^zz-footnote-(.+)$/);
      const citation=item.id.match(/^zz-citation-(.+)$/);
      if(!footnote&&!citation)return'';
      const id=decodeURIComponent((footnote||citation)[1]);
      const copy=item.cloneNode(true);
      if(citation){
        const key=copy.querySelector(':scope > strong');
        if(key)key.remove();
      }
      copy.querySelectorAll('.block-move-handle,.form-move-handle').forEach(handle=>handle.remove());
      const body=copy.innerHTML
        .replace(/\u200b/g,'')
        .replace(/\r?\n/g,' ')
        .trim();
      return `${footnote?'[^':'[@'}${id}]: ${body}`;
    }).filter(Boolean);
    const raw=document.createElement('template');
    raw.dataset.previewRawSource=encodeURIComponent(definitions.length?definitions.join('\n'):decodeURIComponent(section.dataset.referenceSource||''));
    section.replaceWith(raw);
  });
  root.querySelectorAll('.zz-math[data-latex]').forEach(math=>{
    const marker=math.dataset.display==='block'?'$$':'$';
    math.replaceWith(document.createTextNode(`${marker}${math.dataset.latex}${marker}`));
  });
  root.querySelectorAll('.zz-wikilink[data-wiki-file]').forEach(link=>{
    const file=link.dataset.wikiFile||'';
    const heading=link.dataset.wikiHeading?`#${link.dataset.wikiHeading}`:'';
    const target=file+heading;
    const label=(link.textContent||'').trim();
    link.replaceWith(document.createTextNode(`[[${target}${label&&label!==file&&label!==link.dataset.wikiHeading?`|${label}`:''}]]`));
  });
  root.querySelectorAll('mark.obsidian-highlight').forEach(mark=>mark.replaceWith(document.createTextNode(`==${mark.textContent||''}==`)));
  root.querySelectorAll('.block-move-handle,.form-move-handle,.code-head').forEach(el=>el.remove());
  root.querySelectorAll('.code-block').forEach(wrap=>{
    const pre=wrap.querySelector(':scope > pre');
    if(pre)wrap.replaceWith(pre);
  });
  root.querySelectorAll('pre code').forEach(code=>{
    const explicitNone=code.hasAttribute('data-code-language')&&!code.dataset.codeLanguage;
    const language=explicitNone?'':([...code.classList].find(name=>name.startsWith('language-'))||'');
    const text=code.textContent.replace(/\u200b/g,'');
    code.replaceChildren(document.createTextNode(text));
    if(language)code.className=language;
    else code.removeAttribute('class');
    if(explicitNone)code.setAttribute('data-code-language','');
    else code.removeAttribute('data-code-language');
    code.removeAttribute('data-highlighted');
    code.removeAttribute('style');
  });
  root.querySelectorAll('pre').forEach(pre=>{
    pre.style.background='';
    if(!pre.getAttribute('style'))pre.removeAttribute('style');
  });
  root.querySelectorAll('.zz-form-control').forEach(control=>{
    persistFormControlState(control);
    control.removeAttribute('contenteditable');
    control.removeAttribute('aria-selected');
    control.removeAttribute('title');
    control.removeAttribute('disabled');
    control.querySelectorAll('input,select,button').forEach(field=>{
      field.removeAttribute('disabled');
      field.removeAttribute('readonly');
    });
    control.querySelectorAll(':scope > .zz-form-label').forEach(label=>{
      label.replaceWith(document.createTextNode(label.textContent.trim()||'항목'));
    });
  });
  root.querySelectorAll('[data-movable]').forEach(el=>{
    el.removeAttribute('data-movable');
    el.removeAttribute('draggable');
    el.classList.remove('move-selected','moving-element','move-drop-before','move-drop-after');
    if(!el.className)el.removeAttribute('class');
    if(el.title==='드래그해서 위치 이동')el.removeAttribute('title');
  });
  root.querySelectorAll('[data-preview-exit-target]').forEach(el=>{
    el.removeAttribute('data-preview-exit-target');
    el.removeAttribute('contenteditable');
  });
  root.querySelectorAll('img').forEach(img=>{
    img.classList.remove('img-resizable','img-resizing','img-selected','moving-element');
    img.removeAttribute('aria-selected');
    img.removeAttribute('data-resize-ready');
    img.style.cursor='';
    if(!img.getAttribute('style'))img.removeAttribute('style');
    if(!img.className)img.removeAttribute('class');
  });
  root.querySelectorAll('table').forEach(table=>{
    table.classList.remove('table-selected','table-cell-range-active','moving-element','move-drop-before','move-drop-after');
    table.removeAttribute('aria-selected');
    table.removeAttribute('data-resize-ready');
    if(!table.className)table.removeAttribute('class');
  });
  root.querySelectorAll('.table-cell-selected').forEach(cell=>{
    cell.classList.remove('table-cell-selected','cell-overflowing');
    if(!cell.className)cell.removeAttribute('class');
  });
  root.querySelectorAll('.cell-overflowing').forEach(cell=>{
    cell.classList.remove('cell-overflowing');
    if(!cell.className)cell.removeAttribute('class');
  });
  root.querySelectorAll('span,font').forEach(el=>{
    const text=el.textContent.replace(/\u200b/g,'').trim();
    const hasMedia=el.querySelector('img,table,hr,br');
    if(!text&&!hasMedia)el.remove();
  });
  root.querySelectorAll('span').forEach(el=>{
    const only=el.children.length===1&&el.firstElementChild?.tagName==='SPAN'&&el.childNodes.length===1?el.firstElementChild:null;
    if(only&&el.getAttribute('style')===only.getAttribute('style'))el.replaceWith(only);
  });
}
function serializePreviewHtml(root){
  return [...root.childNodes]
    .filter(node=>node.nodeType!==Node.TEXT_NODE||node.textContent.trim())
    .map(node=>{
      if(node.nodeType===Node.ELEMENT_NODE&&node.matches('template[data-preview-raw-source]')){
        try{return decodeURIComponent(node.dataset.previewRawSource)}catch{return''}
      }
      return node.nodeType===Node.ELEMENT_NODE?node.outerHTML:htmlEsc(node.textContent);
    })
    .join('\n\n')
    .trim();
}
function previewHasMeaningfulContent(root){
  const text=(root.textContent||'').replace(/[\u200b\u00a0]/g,'').trim();
  if(text)return true;
  return !!root.querySelector([
    'img','video','audio','iframe','canvas','svg',
    'table','hr','pre','code','input','select','button',
    'template[data-preview-raw-source]'
  ].join(','));
}
let previewSyncTimer=null;
let lastPreviewEnterSplit=null;
function syncFromPreview(){
  clearTimeout(previewSyncTimer);
  previewSyncTimer=null;
  state.editingPreview=true;
  const clone=els.preview.cloneNode(true);
  cleanPreviewHtml(clone);
  const html=previewHasMeaningfulContent(clone)
    ?refreshZzTocSource(serializePreviewHtml(clone)).text
    :'';
  clearTimeout(editorRenderTimer);
  editorRenderTimer=null;
  pendingEditorRender=html;
  els.editor.value=html;
  createDraftFromEditor();
  if(state.active>=0)state.files[state.active].text=html;
  state.editingPreview=false;
  pushHistory();
  markDirty();
  scheduleLineNumbers();
  if(typeof scheduleWorkspaceSave==='function')scheduleWorkspaceSave();
}
function scheduleSyncFromPreview(){
  clearTimeout(previewSyncTimer);
  previewSyncTimer=setTimeout(syncFromPreview,deferredEditorDelay(els.preview?.textContent,110,240));
}
function restoreEditor(value){state.restoring=true;els.editor.value=value;if(state.active>=0)state.files[state.active].text=value;renderMarkdown(value);state.restoring=false;markDirty();updateUndoRedoButtons();updateLineNumbers()}
function undoEdit(){if(state.history.length<2)return;state.future.push(state.history.pop());restoreEditor(state.history[state.history.length-1])}
function redoEdit(){if(!state.future.length)return;const v=state.future.pop();state.history.push(v);restoreEditor(v)}
function download(name,text,type='text/markdown;charset=utf-8'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),800)}
// PDF layout reconstruction. Coordinates are normalized to the rendered page.
function pdfMedian(values){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  return sorted.length?sorted[Math.floor(sorted.length/2)]:12;
}
function pdfTextRuns(content,viewport,pdfjs,page=null){
  return content.items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>{
    const t=pdfjs.Util.transform(viewport.transform,item.transform);
    const font=content.styles[item.fontName]||{};
    let fontName=font.fontFamily||'';
    try{fontName+=' '+(page?.commonObjs.get(item.fontName)?.name||'')}catch{}
    const size=Math.hypot(t[2],t[3])||Math.abs(item.height)||12;
    // Subset fonts can report NaN/Infinity ascent. Group by the finite baseline
    // rather than allowing invalid font metrics to destroy reading order.
    const ascent=Number.isFinite(font.ascent)&&font.ascent>0&&font.ascent<2?font.ascent:.8;
    return {text:item.str,x:t[4],y:t[5]-size*ascent,baseline:t[5],fontPx:size/viewport.scale*4/3,
      width:Math.abs(item.width*viewport.scale),height:size,size,
      bold:/bold|black|heavy|demi/i.test(fontName),
      italic:/italic|oblique/i.test(fontName),mathFont:/katex|math|symbol|cmsy|cmex/i.test(fontName),dir:item.dir};
  });
}
function pdfLines(runs){
  const lines=[];
  for(const run of [...runs].sort((a,b)=>a.y-b.y||a.x-b.x)){
    let line=lines.slice(-4).find(row=>Math.abs((row.baseline??row.y)-(run.baseline??run.y))<=Math.max(2,Math.min(row.size,run.size)*.35));
    if(!line){line={y:run.y,baseline:run.baseline,size:run.size,runs:[]};lines.push(line)}
    line.runs.push(run);
    line.size=Math.max(line.size,run.size);
  }
  for(const line of lines){line.runs.sort((a,b)=>a.x-b.x);line.x=line.runs[0].x}
  return lines.sort((a,b)=>a.y-b.y);
}
async function pdfApplyTextColors(runs,page,pdfjs){
  const ops=await page.getOperatorList(),stack=[];
  let color='#000000',text='';const colors=[];
  const hex=values=>'#'+values.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
  for(let i=0;i<ops.fnArray.length;i++){
    const op=ops.fnArray[i],args=ops.argsArray[i]||[];
    if(op===pdfjs.OPS.save)stack.push(color);
    else if(op===pdfjs.OPS.restore)color=stack.pop()||'#000000';
    else if(op===pdfjs.OPS.setFillRGBColor){
      // PDF.js 4 uses byte RGB; newer versions may emit a CSS hex string.
      color=typeof args[0]==='string'?args[0]:hex(Array.from(args).map(v=>v/255));
    }
    else if(op===pdfjs.OPS.setFillGray)color=hex([args[0],args[0],args[0]]);
    else if(op===pdfjs.OPS.setFillCMYKColor){const [c,m,y,k]=args;color=hex([1-Math.min(1,c+k),1-Math.min(1,m+k),1-Math.min(1,y+k)])}
    else if(op===pdfjs.OPS.showText||op===pdfjs.OPS.showSpacedText||op===pdfjs.OPS.nextLineShowText||op===pdfjs.OPS.nextLineSetSpacingShowText){
      const glyphs=args.find(Array.isArray)||[];
      for(const glyph of glyphs){
        const value=typeof glyph==='object'?String(glyph.unicode||'').normalize('NFKC').replace(/\s/g,''):'';
        for(let j=0;j<value.length;j++){text+=value[j];colors.push(color)}
      }
    }
  }
  let cursor=0;
  for(const run of runs){
    delete run.color;
    const value=run.text.normalize('NFKC').replace(/\s/g,'');
    if(!value)continue;
    const index=text.indexOf(value,cursor);
    if(index<0||index-cursor>100)continue;
    const counts=new Map();for(const c of colors.slice(index,index+value.length))counts.set(c,(counts.get(c)||0)+1);
    const chosen=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];
    if(/^#[0-9a-f]{6}$/i.test(chosen||''))run.color=chosen;
    cursor=index+value.length;
  }
}
function pdfInline(runs,bodySize){
  let previous=null;
  return runs.map(run=>{
    const gap=previous?run.x-previous.x-previous.width:0;
    const space=previous&&gap>Math.min(previous.size,run.size)*.16&&!/\s$/.test(previous.text)&&!/^\s/.test(run.text)?' ':'';
    previous=run;
    let text=htmlEsc(run.text);
    if(run.bold)text=`<strong>${text}</strong>`;
    if(run.italic)text=`<em>${text}</em>`;
    if(run.underline)text=`<u>${text}</u>`;
    const size=Number.isFinite(run.fontPx)?`${run.fontPx.toFixed(2)}px`:`${Math.round(run.size/bodySize*100)}%`;
    text=`<span style="font-size:${size};font-weight:${run.bold?'700':'400'};font-style:${run.italic?'italic':'normal'}">${text}</span>`;
    return space+text;
  }).join('');
}
function pdfPreserveComplexRegions(runs,canvas,bodySize,makeCanvas=()=>document.createElement('canvas')){
  const lines=pdfLines(runs),groups=[];
  // Formula glyphs do not contain their original LaTeX. Preserve their pixels
  // instead of incorrectly reconstructing subscripts and fraction order.
  for(const line of lines){
    const text=line.runs.map(r=>r.text).join('');
    if(!line.runs.some(r=>r.mathFont)&&!/[∑∫√∏]/.test(text))continue;
    const last=groups.at(-1);
    if(last&&line.y-last.bottom<Math.max(line.size,bodySize)*1.5){last.runs.push(...line.runs);last.bottom=Math.max(last.bottom,...line.runs.map(r=>r.y+r.height))}
    else groups.push({runs:[...line.runs],bottom:Math.max(...line.runs.map(r=>r.y+r.height))});
  }
  // Multi-column PDF contents lists have no recoverable block IDs. Keep their
  // layout intact instead of interleaving titles from unrelated columns.
  const tocIndex=lines.findIndex(line=>line.runs.map(r=>r.text).join('').trim()==='목차');
  if(tocIndex>=0){
    const selected=[...lines[tocIndex].runs];let bottom=lines[tocIndex].y+lines[tocIndex].size;
    for(let i=tocIndex+1;i<lines.length;i++){
      const line=lines[i];
      if(line.y-bottom>bodySize*4||/^#/.test(line.runs[0].text))break;
      selected.push(...line.runs);bottom=line.y+line.size;
    }
    if(selected.length>lines[tocIndex].runs.length)groups.push({runs:selected,bottom});
  }
  const removed=new Set(),replacements=[];
  for(const group of groups){
    if(group.runs.some(r=>removed.has(r)))continue;
    const left=Math.max(0,Math.floor(Math.min(...group.runs.map(r=>r.x))-4));
    const top=Math.max(0,Math.floor(Math.min(...group.runs.map(r=>r.y))-bodySize*.4));
    const right=Math.min(canvas.width,Math.ceil(Math.max(...group.runs.map(r=>r.x+r.width))+4));
    const bottom=Math.min(canvas.height,Math.ceil(group.bottom+bodySize*.4));
    if(right<=left||bottom<=top)continue;
    const crop=makeCanvas();crop.width=right-left;crop.height=bottom-top;
    crop.getContext('2d').drawImage(canvas,left,top,crop.width,crop.height,0,0,crop.width,crop.height);
    const alt=group.runs.map(r=>r.text).join(' ');
    const image=crop.toDataURL('image/png');crop.width=crop.height=0;
    replacements.push({text:'',x:left,y:top,width:right-left,height:bottom-top,size:bodySize,
      preservedHtml:`<figure><img src="${image}" alt="${htmlEsc(alt)}" style="max-width:100%;height:auto;width:${Math.round((right-left)*16/bodySize)}px"></figure>`});
    group.runs.forEach(r=>removed.add(r));
  }
  return {runs:[...runs.filter(r=>!removed.has(r)),...replacements],count:replacements.length};
}
// Raster line detection uses the same page coordinates as the text layer and
// works for rotated pages and PDFs whose table rules are filled rectangles.
function pdfPageRules(canvas){
  const {width:w,height:h}=canvas;
  const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
  const rulePixel=(x,y,verticalScan)=>{
    const dx=verticalScan?3:0,dy=verticalScan?0:3;
    if(x-dx<0||x+dx>=w||y-dy<0||y+dy>=h)return false;
    const i=(y*w+x)*4,a=((y-dy)*w+x-dx)*4,b=((y+dy)*w+x+dx)*4;
    let da=0,db=0;
    for(let c=0;c<3;c++){da=Math.max(da,Math.abs(pixels[i+c]-pixels[a+c]));db=Math.max(db,Math.abs(pixels[i+c]-pixels[b+c]))}
    return pixels[i+3]>100&&Math.min(da,db)>=6;
  };
  const horizontal=[],vertical=[];
  function scan(verticalScan){
    const outer=verticalScan?w:h,inner=verticalScan?h:w,min=verticalScan?24:40;
    for(let a=0;a<outer;a++){
      let start=-1,last=-1;
      for(let b=0;b<=inner+2;b++){
        if(b<inner&&rulePixel(verticalScan?a:b,verticalScan?b:a,verticalScan)){if(start<0)start=b;last=b}
        else if(start>=0&&b-last>2){
          if(last-start>=min)(verticalScan?vertical:horizontal).push({pos:a,start,end:last});
          start=-1;
        }
      }
    }
  }
  scan(false);scan(true);
  function merge(lines){
    const result=[];
    for(const line of lines){
      const peer=result.slice(-20).find(v=>Math.abs(v.pos-line.pos)<=3&&Math.abs(v.start-line.start)<=4&&Math.abs(v.end-line.end)<=4);
      if(!peer)result.push(line);
    }
    return result;
  }
  return {horizontal:merge(horizontal),vertical:merge(vertical)};
}
function pdfRuledTables(rules,runs){
  const tables=[],groups=[];
  for(const line of rules.horizontal){
    let group=groups.find(g=>Math.abs(g[0].start-line.start)<5&&Math.abs(g[0].end-line.end)<5);
    if(!group){group=[];groups.push(group)}group.push(line);
  }
  for(const group of groups){
    if(group.length<2)continue;
    group.sort((a,b)=>a.pos-b.pos);
    const left=group[0].start,right=group[0].end;
    // Split tables with matching widths when their outer vertical borders stop.
    let start=0;
    for(let end=1;end<group.length;end++){
      const top=group[start].pos,bottom=group[end].pos;
      const spans=(x,a,b)=>rules.vertical.some(v=>Math.abs(v.pos-x)<5&&v.start<=a+5&&v.end>=b-5);
      if(!spans(left,top,bottom)||!spans(right,top,bottom)){
        if(end-start>=1)add(group.slice(start,end));
        start=end;
      }
      if(end===group.length-1&&end-start>=1)add(group.slice(start,end+1));
    }
    function add(rows){
      const top=rows[0].pos,bottom=rows.at(-1).pos;
      const unique=values=>{const result=[];for(const v of values.sort((a,b)=>a-b))if(!result.length||v-result.at(-1)>4)result.push(v);return result};
      const xs=unique([left,right,...rules.vertical.filter(v=>v.pos>left+4&&v.pos<right-4&&v.start<bottom-5&&v.end>top+5).map(v=>v.pos)]);
      const ys=unique([...rows.map(v=>v.pos),...rules.horizontal.filter(v=>v.start>=left-4&&v.end<=right+4&&v.pos>top&&v.pos<bottom).map(v=>v.pos)]);
      if(xs.length<3||xs.length>30||ys.length<2||ys.length>200)return;
      if(xs.slice(1).some((x,i)=>x-xs[i]<10)||ys.slice(1).some((y,i)=>y-ys[i]<6))return;
      const inside=runs.filter(r=>r.x+r.width/2>=left&&r.x+r.width/2<=right&&r.y+r.height/2>=top&&r.y+r.height/2<=bottom);
      if(!inside.length)return;
      const cells=[],occupied=new Set();
      const vEdge=(x,a,b)=>rules.vertical.some(v=>Math.abs(v.pos-x)<5&&v.start<=a+4&&v.end>=b-4);
      const hEdge=(y,a,b)=>rules.horizontal.some(v=>Math.abs(v.pos-y)<5&&v.start<=a+4&&v.end>=b-4);
      for(let r=0;r<ys.length-1;r++)for(let c=0;c<xs.length-1;c++){
        if(occupied.has(`${r},${c}`))continue;
        let ce=c+1,re=r+1;
        while(ce<xs.length-1&&!vEdge(xs[ce],ys[r],ys[r+1])&&!occupied.has(`${r},${ce}`))ce++;
        while(re<ys.length-1&&!hEdge(ys[re],xs[c],xs[ce])){
          if(Array.from({length:ce-c},(_,i)=>occupied.has(`${re},${c+i}`)).some(Boolean))break;
          re++;
        }
        for(let rr=r;rr<re;rr++)for(let cc=c;cc<ce;cc++)occupied.add(`${rr},${cc}`);
        cells.push({r,c,rowspan:re-r,colspan:ce-c,runs:inside.filter(t=>{
          const x=t.x+t.width/2,y=t.y+t.height/2;
          return x>=xs[c]&&x<xs[ce]&&y>=ys[r]&&y<ys[re];
        })});
      }
      if(tables.some(t=>Math.abs(t.top-top)<4&&Math.abs(t.left-left)<4))return;
      if(!cells.length)return;
      tables.push({top,bottom,left,right,xs,ys,cells,runs:cells.flatMap(cell=>cell.runs)});
    }
  }
  return tables.sort((a,b)=>a.top-b.top);
}
function pdfTableHtml(table,bodySize){
  const cols=table.xs.slice(1).map((x,i)=>`<col style="width:${((x-table.xs[i])/(table.right-table.left)*100).toFixed(2)}%">`).join('');
  const rows=table.ys.slice(1).map((_,r)=>'<tr>'+table.cells.filter(c=>c.r===r).map(cell=>{
    const body=pdfLines(cell.runs).map(line=>pdfInline(line.runs,bodySize)).join('<br>');
    return `<td${cell.rowspan>1?` rowspan="${cell.rowspan}"`:''}${cell.colspan>1?` colspan="${cell.colspan}"`:''}>${body}</td>`;
  }).join('')+'</tr>').join('');
  return `<table style="width:100%;table-layout:fixed"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}
function pdfApplyUnderlines(runs,rules,tables){
  for(const line of pdfLines(runs)){
    const left=Math.min(...line.runs.map(r=>r.x)),right=Math.max(...line.runs.map(r=>r.x+r.width));
    for(const run of line.runs){
      run.underline=rules.horizontal.some(rule=>{
        const baseline=run.baseline??run.y+run.height*.8;
        if(rule.pos<baseline||rule.pos>baseline+run.size*.3)return false;
        if(rule.start>run.x+2||rule.end<run.x+run.width-2)return false;
        if(rule.start<left-run.size||rule.end>right+run.size)return false;
        return !tables.some(table=>table.ys.some(y=>Math.abs(y-rule.pos)<4)&&rule.start>=table.left-4&&rule.end<=table.right+4);
      });
    }
  }
}
function pdfFlowHtml(runs,bodySize,depth=0){
  if(!runs.length)return '';
  // Split a wide empty gutter only when both sides contain substantial text.
  const intervals=runs.map(r=>[r.x,r.x+r.width]).sort((a,b)=>a[0]-b[0]);
  let edge=intervals[0][1],gutter=null;
  for(const [x,right] of intervals){
    if(x-edge>bodySize*3&&(!gutter||x-edge>gutter.width))gutter={x:(x+edge)/2,width:x-edge};
    edge=Math.max(edge,right);
  }
  if(gutter&&depth<2){
    const left=runs.filter(r=>r.x<gutter.x),right=runs.filter(r=>r.x>=gutter.x);
    if(pdfLines(left).length>=4&&pdfLines(right).length>=4)return pdfFlowHtml(left,bodySize,depth+1)+'\n'+pdfFlowHtml(right,bodySize,depth+1);
  }
  const lines=pdfLines(runs),blocks=[];
  const rightEdge=Math.max(...runs.map(r=>r.x+r.width));
  const distances=lines.slice(1).map((l,i)=>l.y-lines[i].y).filter(d=>d>bodySize*.8&&d<bodySize*2);
  // The lower half estimates normal line spacing without paragraph gaps
  // inflating the baseline when many paragraphs consist of a single line.
  distances.sort((a,b)=>a-b);
  const normalLeading=distances.length?pdfMedian(distances.slice(0,Math.ceil(distances.length*.6))):bodySize*1.4;
  const leftEdge=Math.min(...lines.map(l=>l.x));
  let paragraph=[],last=null,paragraphGap=.75;
  const flush=()=>{if(paragraph.length){blocks.push(`<p style="margin:0 0 ${paragraphGap.toFixed(2)}em;line-height:1.5">`+paragraph.join('')+'</p>');paragraph=[];paragraphGap=.75}};
  for(const line of lines){
    const preserved=line.runs.find(r=>r.preservedHtml);
    if(preserved){flush();blocks.push(preserved.preservedHtml);last=line;continue}
    const headingMatch=line.runs.map(r=>r.text).join('').match(/^(#{1,6})\s+/);
    let displayRuns=line.runs;
    if(headingMatch){
      let skip=headingMatch[0].length;
      displayRuns=line.runs.map(run=>{const remove=Math.min(skip,run.text.length);skip-=remove;return {...run,text:run.text.slice(remove)}}).filter(run=>run.text);
    }
    const text=pdfInline(displayRuns,bodySize);
    const ratio=line.size/bodySize;
    const boldHeading=line.runs.every(r=>r.bold)&&ratio>=1.08&&line.runs.map(r=>r.text).join('').length<100;
    if(headingMatch||ratio>=1.23||boldHeading){flush();const level=headingMatch?headingMatch[1].length:ratio>=1.8?1:ratio>=1.45?2:3;blocks.push(`<h${level} style="line-height:1.45">${text}</h${level}>`)}
    else{
      const distance=last?line.y-last.y:0;
      const indented=last&&line.x-leftEdge>bodySize*.7&&line.x-last.x>bodySize*.7;
      const listStart=/^(?:[•●▪]|[-*]\s|\d+[.)]\s)/.test(line.runs.map(r=>r.text).join(''));
      const previousText=last?.runs.map(r=>r.text).join('')||'';
      const previousRight=last?Math.max(...last.runs.map(r=>r.x+r.width)):0;
      const sentenceEnd=/[.!?。！？][”’"')\]]*$/.test(previousText.trim());
      const shortEnding=previousRight<rightEdge-bodySize*3;
      const newParagraph=last&&(distance>normalLeading*1.3||indented||listStart||(sentenceEnd&&shortEnding&&distance>normalLeading*1.08));
      if(newParagraph){paragraphGap=Math.max(.75,Math.min(4,(distance-normalLeading)/bodySize));flush()}
      if(paragraph.length&&last){
        const lastRight=Math.max(...last.runs.map(r=>r.x+r.width));
        const returnsFromIndent=last.x-leftEdge>bodySize*.7&&Math.abs(line.x-leftEdge)<bodySize*.5;
        const wraps=lastRight>=rightEdge-bodySize*2&&!listStart&&(Math.abs(line.x-last.x)<=bodySize*.7||returnsFromIndent);
        paragraph.push(wraps?' ':'<br>');
      }
      paragraph.push(text);
    }
    last=line;
  }
  flush();return blocks.join('\n');
}
function pdfPageEditableHtml(runs,tables){
  const sizes=[];for(const r of runs)for(let i=0;i<Math.min(r.text.length,80);i++)sizes.push(r.size);
  const bodySize=pdfMedian(sizes);
  const inTable=new Set(tables.flatMap(table=>table.runs));
  let remaining=runs.filter(r=>!inTable.has(r));
  const output=[];
  for(const table of tables){
    const above=remaining.filter(r=>r.y<table.top);
    remaining=remaining.filter(r=>r.y>=table.top);
    output.push(pdfFlowHtml(above,bodySize),pdfTableHtml(table,bodySize));
  }
  output.push(pdfFlowHtml(remaining,bodySize));
  return output.filter(Boolean).join('\n\n');
}
let pdfConversionQueue=Promise.resolve();
function extractPdf(file){
  pdfConversionQueue=pdfConversionQueue.then(()=>extractPdfWithLayout(file));
  return pdfConversionQueue;
}
async function extractPdfWithLayout(file){
  let doc=null,loading=null;
  try{
    state.lastInput={type:'pdf',name:file.name};updateHomeConvert();
    const base='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/';
    const pdfjs=await import(base+'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=base+'pdf.worker.min.mjs';
    const assets='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/';
    loading=pdfjs.getDocument({data:await file.arrayBuffer(),cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/'});
    doc=await loading.promise;
    const pages=[];let tableCount=0,imageOnly=0,preservedCount=0,documentBodySize=null;
    for(let p=1;p<=doc.numPages;p++){
      els.status.textContent=`PDF 서식 복원 ${p}/${doc.numPages}쪽`;
      const page=await doc.getPage(p),original=page.getViewport({scale:1});
      const scale=Math.min(1.5,1600/Math.max(original.width,original.height));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try{
        await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
        const content=await page.getTextContent(),runs=pdfTextRuns(content,viewport,pdfjs,page);
        if(!documentBodySize&&runs.length){
          const sizes=[];for(const r of runs)for(let i=0;i<Math.min(r.text.length,80);i++)sizes.push(r.fontPx);
          documentBodySize=pdfMedian(sizes);
        }
        // Undo unknown print shrinkage consistently across the document, keeping
        // relative sizes but presenting the common body size at readable 16px.
        if(documentBodySize)runs.forEach(r=>{r.fontPx=r.fontPx*16/documentBodySize});
        const rules=pdfPageRules(canvas);
        const tables=pdfRuledTables(rules,runs);
        pdfApplyUnderlines(runs,rules,tables);
        const tableRuns=new Set(tables.flatMap(t=>t.runs));
        const preserved=pdfPreserveComplexRegions(runs.filter(r=>!tableRuns.has(r)),canvas,pdfMedian(runs.map(r=>r.size)));
        preservedCount+=preserved.count;
        const editableRuns=[...runs.filter(r=>tableRuns.has(r)),...preserved.runs];
        tableCount+=tables.length;
        if(!runs.length){
          imageOnly++;
          const image=canvas.toDataURL('image/jpeg',.88);
          pages.push(`<!-- PDF page ${p}: image only -->\n\n<img src="${image}" alt="${htmlEsc(file.name)} ${p}쪽 원본" style="max-width:100%;height:auto">`);
        }else pages.push(`<!-- PDF page ${p} -->\n\n${pdfPageEditableHtml(editableRuns,tables).trim()}`);
      }finally{canvas.width=canvas.height=0;page.cleanup()}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const item={name:file.name.replace(/\.pdf$/i,'.md'),displayName:`${file.name} → MD`,path:file.name.replace(/\.pdf$/i,'.md'),dir:'PDF 변환',text:pages.join('\n\n<br><br>\n\n'),savedText:'',source:'uploaded',convertedFromPdf:true,originalName:file.name};
    state.files.push(item);state.active=state.files.length-1;els.editor.value=item.text;
    renderAll();updateHomeConvert();
    (state.stayHomeAfterConvert||state.mode==='convert')?setMode(state.mode,!els.home.classList.contains('hidden')):setMode('edit');
    syncActive();pushHistory(true);
    showInfoNotice('PDF 변환 완료',`${doc.numPages}쪽 변환 · 표 ${tableCount}개 복원 · 원본 영역 이미지 ${preservedCount}개${imageOnly?` · 이미지로 보존한 페이지 ${imageOnly}쪽`:''}. 글씨는 본문 16px 기준으로 크기 비율을 유지했습니다. 이미지로 보존한 부분은 글자처럼 편집할 수 없습니다.`);
  }catch(error){
    console.error('PDF conversion failed',error);
    const message=error?.name==='PasswordException'?'암호가 설정된 PDF입니다. 암호를 해제한 파일을 열어 주세요.':error?.name==='InvalidPDFException'?'PDF 파일이 손상되었거나 올바른 PDF 형식이 아닙니다.':`PDF 변환을 완료하지 못했습니다: ${error?.message||'파일과 네트워크 연결을 확인해 주세요.'}`;
    showInfoNotice('PDF 변환 실패',message);
  }finally{
    try{if(doc)await doc.destroy();else if(loading)await loading.destroy()}catch{}
    state.stayHomeAfterConvert=false;
  }
}
function buildMerged(files){return files.map(f=>`<!-- ${f.path} -->\n\n# ${f.name.replace(mdExt,'')}\n\n${f.text.trim()}`).join('\n\n---\n\n')+'\n'}
function addMerged(text){const existing=state.files.findIndex(f=>f.path==='merged-markdown.md'),previous=existing>=0?state.files[existing]:null,item={name:'merged-markdown.md',path:'merged-markdown.md',dir:'',text,savedText:previous?.savedText||'',source:'local'};existing>=0?state.files[existing]=item:state.files.push(item);renderAll()}
function selectedMergeFiles(){return[...els.mergeList.querySelectorAll('input:checked')].map(i=>state.files[Number(i.value)]).filter(Boolean)}
let mergePreviewSnapshot=[],mergePreviewTheme='',mergePreviewJob=0;
function sameMergePreview(files){
  return mergePreviewTheme===state.theme&&files.length===mergePreviewSnapshot.length&&files.every((file,i)=>{
    const previous=mergePreviewSnapshot[i];
    return previous?.file===file&&previous.text===file.text&&previous.path===file.path;
  });
}
function updateMergePreview(){
  if(!els.mergeResult)return;
  const selected=selectedMergeFiles();
  if(!selected.length){
    mergePreviewJob++;
    disconnectLazyPreview(els.mergeResult);
    mergePreviewSnapshot=[];
    mergePreviewTheme=state.theme;
    if(!els.mergeResult.querySelector('.convert-empty'))els.mergeResult.innerHTML=`<div class="convert-empty">${selectionRequiredMessage}</div>`;
    return;
  }
  if(sameMergePreview(selected))return;
  mergePreviewSnapshot=selected.map(file=>({file,text:file.text,path:file.path}));
  mergePreviewTheme=state.theme;
  const job=++mergePreviewJob;
  setupLazyDocumentPreview(els.mergeResult,selected,'merge',()=>job===mergePreviewJob);
}
function chooseMergeOutput(){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop choice-modal';
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="merge-output-title">
      <h3 id="merge-output-title">병합 결과 저장</h3>
      <p>병합한 문서를 저장할 위치를 선택하세요.</p>
      <fieldset class="merge-output-list">
        <label class="merge-output-option">
          <input type="radio" name="merge-output-choice" value="download">
          <span class="merge-output-copy"><strong>다운로드</strong><span>병합 파일을 기기에 저장합니다.</span></span>
        </label>
        <label class="merge-output-option">
          <input type="radio" name="merge-output-choice" value="add" checked>
          <span class="merge-output-copy"><strong>문서 목록에 추가</strong><span>현재 작업 목록에 새 문서로 추가합니다.</span></span>
        </label>
        <label class="merge-output-option">
          <input type="radio" name="merge-output-choice" value="both">
          <span class="merge-output-copy"><strong>둘 다</strong><span>다운로드하고 문서 목록에도 추가합니다.</span></span>
        </label>
      </fieldset>
      <div class="modal-actions">
        <button class="tool" type="button" data-merge-output-action="cancel">취소</button>
        <button class="tool primary" type="button" data-merge-output-action="confirm">병합</button>
      </div>
    </div>`;
    const finish=value=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(value)};
    const confirm=()=>finish(wrap.querySelector('input[name="merge-output-choice"]:checked')?.value||'add');
    const onKey=e=>{
      if(e.key==='Escape')finish(null);
      else if(e.key==='Enter'){e.preventDefault();confirm()}
    };
    wrap.addEventListener('click',e=>{
      const action=e.target.closest('[data-merge-output-action]')?.dataset.mergeOutputAction;
      if(action==='cancel')finish(null);
      else if(action==='confirm')confirm();
    });
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('input:checked').focus();
  });
}
async function mergeSelected(){
  const selected=selectedMergeFiles();
  if(!requireSelection(selected))return;
  const output=await chooseMergeOutput();
  if(!output)return;
  const text=buildMerged(selected);
  state.shortcutMergeResult=text;
  updateMergePreview();
  if(output==='download'||output==='both')download('merged-markdown.md',text);
  if(output==='add'||output==='both')addMerged(text);
}
function homeMergeFiles(onlyChecked=false){if(!state.files.length)return[];if(!onlyChecked||!els.homeMergeList)return state.files;return[...els.homeMergeList.querySelectorAll('input:checked')].map(i=>state.files[Number(i.value)]).filter(Boolean)}
function runHomeMerge(onlyChecked=false){const selected=homeMergeFiles(onlyChecked);if(!selected.length){state.homeMergeNotice=selectionRequiredMessage;renderHomeMergeList();showSelectionNotice();return}const text=buildMerged(selected);els.mergeResult.innerHTML=markdownHtml(text);fixSpanColors(els.mergeResult);runHighlight(els.mergeResult);decorateCodeBlocks(els.mergeResult);stripReadOnlyTableResizeArtifacts(els.mergeResult);state.homeMergeNotice=`${selected.length}개 문서를 병합해서 루트 목록에 추가했습니다.`;addMerged(text);setMode(state.mode,true)}
function mergeAllFromHome(){runHomeMerge(false)}
function mergeSelectedFromHome(){runHomeMerge(true)}
let hoverPreviewCache={file:null,text:null,theme:null},hoverPreviewPinned=false,hoverPreviewCtrlDown=false,hoverPreviewHideTimer=0;
function setHoverPreviewPinned(pinned){
  hoverPreviewPinned=!!pinned;
  els.hoverPreview.classList.toggle('pinned',hoverPreviewPinned);
  let close=els.hoverPreview.querySelector(':scope > .hover-preview-pin-close');
  if(hoverPreviewPinned&&!close){
    close=document.createElement('button');close.type='button';close.className='hover-preview-pin-close';close.textContent='×';close.setAttribute('aria-label','미니 프리뷰 닫기');close.title='닫기';
    close.onclick=()=>hideMergePreview(true);els.hoverPreview.prepend(close);
  }
  if(!hoverPreviewPinned)close?.remove();
}
function showMergePreview(e){
  clearTimeout(hoverPreviewHideTimer);
  if(hoverPreviewPinned)return;
  const context=e.currentTarget.closest('#convert-list')?'convert':'merge';
  const toggle=$(context==='convert'?'enable-convert-hover-preview':'enable-hover-preview');
  if(!toggle?.checked)return;
  const file=state.files[Number(e.currentTarget.dataset.index)];
  if(!file)return;
  els.hoverPreview.dataset.source='file';
  els.hoverPreview.dataset.context=context;
  els.hoverPreview.classList.add('preview');
  if(hoverPreviewCache.file!==file||hoverPreviewCache.text!==file.text||hoverPreviewCache.theme!==state.theme){
    els.hoverPreview.innerHTML=markdownHtml(file.text||'');
    fixSpanColors(els.hoverPreview);
    runHighlight(els.hoverPreview);
    decorateCodeBlocks(els.hoverPreview);
    stripReadOnlyTableResizeArtifacts(els.hoverPreview);
    addImageResize(els.hoverPreview);
    hoverPreviewCache={file,text:file.text,theme:state.theme};
  }
  els.hoverPreview.style.display='block';
  positionHoverPreview(e.currentTarget);
  if(e.ctrlKey||e.metaKey||e.getModifierState?.('Control')||hoverPreviewCtrlDown)setHoverPreviewPinned(true);
}
function positionHoverPreview(anchor){
  const anchorRect=anchor.getBoundingClientRect();
  const previewRect=els.hoverPreview.getBoundingClientRect();
  const gap=10;
  const right=anchorRect.right+gap;
  const left=anchorRect.left-previewRect.width-gap;
  const x=right+previewRect.width<=window.innerWidth-gap?right:Math.max(gap,left);
  const y=Math.max(gap,Math.min(window.innerHeight-previewRect.height-gap,anchorRect.top));
  els.hoverPreview.style.left=`${Math.round(x)}px`;
  els.hoverPreview.style.top=`${Math.round(y)}px`;
}
function hideMergePreview(force=false){
  if(hoverPreviewPinned&&!force)return;
  clearTimeout(hoverPreviewHideTimer);hoverPreviewHideTimer=0;
  setHoverPreviewPinned(false);delete els.hoverPreview.dataset.source;els.hoverPreview.style.display='none';
}
function scheduleHideMergePreview(){
  clearTimeout(hoverPreviewHideTimer);
  if(!hoverPreviewPinned){hideMergePreview(true);return}
  hoverPreviewHideTimer=setTimeout(()=>{
    if(!els.hoverPreview.matches(':hover'))hideMergePreview(true);
  },180);
}
document.addEventListener('keydown',event=>{
  if(event.key==='Control'||event.key==='Meta'){
    hoverPreviewCtrlDown=true;
    if(els.hoverPreview.style.display==='block')setHoverPreviewPinned(true);
  }
  if(event.key==='Escape')hideMergePreview(true);
},true);
document.addEventListener('keyup',event=>{if(event.key==='Control'||event.key==='Meta')hoverPreviewCtrlDown=false},true);
els.hoverPreview.addEventListener('mouseenter',()=>clearTimeout(hoverPreviewHideTimer));
els.hoverPreview.addEventListener('mouseleave',()=>hideMergePreview(true));
document.addEventListener('mousedown',event=>{
  if(els.hoverPreview.style.display==='block'&&!els.hoverPreview.contains(event.target))hideMergePreview(true);
},true);
$('enable-convert-hover-preview').checked=savedOption('md-option-convert-hover-preview',true);
$('enable-hover-preview').checked=savedOption('md-option-merge-hover-preview',true);
$('enable-convert-hover-preview').addEventListener('change',e=>{localStorage.setItem('md-option-convert-hover-preview',e.target.checked?'1':'0');if(!e.target.checked&&els.hoverPreview.dataset.context==='convert')hideMergePreview(true)});
$('enable-hover-preview').addEventListener('change',e=>{localStorage.setItem('md-option-merge-hover-preview',e.target.checked?'1':'0');if(!e.target.checked&&els.hoverPreview.dataset.context==='merge')hideMergePreview(true)});
async function saveCurrent(){
  refreshEditorTocBlocks();
  const file=state.files[state.active],name=file?.name||'document.md';
  const proceed=await confirmExportCompatibility(els.editor.value,'md');
  if(!proceed)return;
  if(file){file.text=els.editor.value;file.savedText=file.text}
  download(name,els.editor.value);
  state.savedText=els.editor.value;
  state.dirty=false;
  await saveVersionSnapshot('MD 저장');
}
function showInfoNotice(title,message){
  document.querySelector('.info-notice')?.remove();
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop info-notice';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>${htmlEsc(title)}</h3><p>${htmlEsc(message)}</p><div class="modal-actions"><button class="tool primary" type="button">확인</button></div></div>`;
  const close=()=>{document.removeEventListener('keydown',onKey);wrap.remove()};
  const onKey=e=>{if(e.key==='Escape'||e.key==='Enter')close()};
  wrap.querySelector('button').onclick=close;
  wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
  document.addEventListener('keydown',onKey);
  document.body.appendChild(wrap);
  wrap.querySelector('button').focus();
}
function findTextMatches(text,needle,matchCase,wholeWord){
  if(!needle)return[];
  const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const source=wholeWord?`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`:escaped;
  let regex;
  try{regex=new RegExp(source,`gu${matchCase?'':'i'}`)}catch(_){regex=new RegExp(escaped,`g${matchCase?'':'i'}`)}
  return[...text.matchAll(regex)].map(match=>({start:match.index,end:match.index+match[0].length,text:match[0]}));
}
function activeFindPreview(){
  if(state.mode==='convert')return els.convertPreview;
  if(state.mode==='merge')return els.mergeResult;
  return els.preview;
}
function previewSearchIndex(root=activeFindPreview()){
  const records=[];
  let text='';
  if(!root)return{text,toRange:()=>null};
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      if(!node.nodeValue)return NodeFilter.FILTER_REJECT;
      if(node.parentElement?.closest('.block-move-handle,.unique-block-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle'))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while((node=walker.nextNode())){
    const start=text.length;
    text+=node.nodeValue;
    records.push({node,start,end:text.length});
  }
  const toRange=(start,end)=>{
    const first=records.find(record=>start<record.end);
    const last=[...records].reverse().find(record=>end>record.start);
    if(!first||!last)return null;
    const range=document.createRange();
    range.setStart(first.node,Math.max(0,start-first.start));
    range.setEnd(last.node,Math.min(last.node.nodeValue.length,end-last.start));
    return range;
  };
  return{text,toRange};
}
function previewFindMatches(needle,matchCase,wholeWord,root=activeFindPreview()){
  const index=previewSearchIndex(root);
  return findTextMatches(index.text,needle,matchCase,wholeWord)
    .map(match=>({...match,range:index.toRange(match.start,match.end)}))
    .filter(match=>match.range);
}
function clearPreviewFindHighlights(){
  CSS.highlights?.delete('preview-find-all');
  CSS.highlights?.delete('preview-find-current');
}
function restoreFloatingPanelPosition(panel,storageKey){
  let saved=null;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{}
  if(!saved||!Number.isFinite(saved.left)||!Number.isFinite(saved.top))return false;
  panel.style.transform='none';panel.style.right='auto';
  panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,saved.left))}px`;
  panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,saved.top))}px`;
  return true;
}
function saveFloatingPanelPosition(panel,storageKey){
  const rect=panel.getBoundingClientRect();
  localStorage.setItem(storageKey,JSON.stringify({left:Math.round(rect.left),top:Math.round(rect.top)}));
}
function showFindReplaceDialog(){
  const existing=document.querySelector('.find-replace-panel');
  if(existing){existing.querySelector('[data-find-field]')?.focus();return}
  const findOnly=state.mode!=='edit';
  const searchRoot=()=>activeFindPreview();
  materializeLazyPreview(searchRoot());
  const panel=document.createElement('div');
  panel.className='find-replace-panel'+(findOnly?' find-only':'');
  panel.dataset.findMode=state.mode;
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-labelledby','find-replace-title');
  panel.innerHTML=`<div class="find-replace-head" data-find-drag>
      <strong id="find-replace-title">${findOnly?'찾기':'찾기 및 바꾸기'}</strong>
      <button class="find-replace-close" type="button" data-find-action="close" aria-label="닫기">×</button>
    </div>
    <div class="find-replace-body">
    <div class="find-replace-fields">
      <label>찾을 내용<input type="text" data-find-field autocomplete="off"></label>
      ${findOnly?'':'<label>바꿀 내용<input type="text" data-replace-field autocomplete="off" placeholder="비워두면 찾은 내용을 삭제합니다"></label>'}
    </div>
    <div class="find-replace-options">
      <label class="find-option-toggle"><input type="checkbox" data-find-case><span>대소문자 구분</span></label>
      <label class="find-option-toggle"><input type="checkbox" data-find-whole><span>단어 전체</span></label>
      <span class="find-replace-status"></span>
    </div>
    <div class="find-replace-actions">
      <button class="tool" type="button" data-find-action="previous">이전</button>
      <button class="tool primary" type="button" data-find-action="next">다음 찾기</button>
      ${findOnly?'':'<span class="find-action-spacer"></span><button class="tool" type="button" data-find-action="replace">바꾸기</button><button class="tool" type="button" data-find-action="all">모두 바꾸기</button>'}
    </div>
  </div>`;
  const find=panel.querySelector('[data-find-field]');
  const replacement=panel.querySelector('[data-replace-field]');
  const status=panel.querySelector('.find-replace-status');
  let cursor=-1;
  let previewMatches=[];
  const options=()=>({
    matchCase:panel.querySelector('[data-find-case]').checked,
    wholeWord:panel.querySelector('[data-find-whole]').checked
  });
  const refreshMatches=()=>{
    const {matchCase,wholeWord}=options();
    previewMatches=previewFindMatches(find.value,matchCase,wholeWord,searchRoot());
    clearPreviewFindHighlights();
    if(previewMatches.length&&window.Highlight&&CSS.highlights){
      CSS.highlights.set('preview-find-all',new Highlight(...previewMatches.map(item=>item.range)));
    }
    return previewMatches;
  };
  const showCurrent=(index)=>{
    const list=previewMatches.length?previewMatches:refreshMatches();
    if(!list.length){
      cursor=-1;
      status.textContent=find.value?'일치 항목 없음':'';
      return null;
    }
    cursor=(index+list.length)%list.length;
    const item=list[cursor];
    if(window.Highlight&&CSS.highlights)CSS.highlights.set('preview-find-current',new Highlight(item.range));
    const element=item.range.startContainer.parentElement;
    const root=searchRoot();
    if(element&&root){
      const rootRect=root.getBoundingClientRect();
      const elementRect=element.getBoundingClientRect();
      const targetTop=root.scrollTop+(elementRect.top-rootRect.top)-(root.clientHeight-elementRect.height)/2;
      root.scrollTo({top:Math.max(0,targetTop),behavior:'smooth'});
    }
    status.textContent=`${cursor+1} / ${list.length}`;
    return item;
  };
  const selectMatch=(direction=1)=>{
    if(!find.value){refreshMatches();status.textContent='';return null}
    if(!previewMatches.length)refreshMatches();
    return showCurrent(cursor<0?(direction>0?0:previewMatches.length-1):cursor+direction);
  };
  const sourceMatches=()=>{
    if(findOnly)return[];
    const {matchCase,wholeWord}=options();
    return findTextMatches(els.editor.value,find.value,matchCase,wholeWord);
  };
  const replaceCurrent=()=>{
    if(findOnly)return;
    const visible=cursor>=0?previewMatches[cursor]:selectMatch(1);
    if(!visible)return;
    const list=sourceMatches();
    const current=list[Math.min(cursor,list.length-1)];
    if(!current){status.textContent='원문에서 바꿀 위치를 찾지 못했습니다';return}
    replaceRange(replacement.value,current.start,current.end,false);
    requestAnimationFrame(()=>{refreshMatches();showCurrent(Math.min(cursor,previewMatches.length-1))});
  };
  const replaceAll=()=>{
    if(findOnly)return;
    const list=sourceMatches();
    if(!list.length){status.textContent='일치 항목 없음';return}
    pushHistory(true);
    let text=els.editor.value;
    for(let i=list.length-1;i>=0;i--)text=text.slice(0,list[i].start)+replacement.value+text.slice(list[i].end);
    els.editor.value=text;
    syncActive();
    pushHistory(true);
    requestAnimationFrame(()=>{refreshMatches();status.textContent=`${list.length}개 변경`});
  };
  let refreshTimer=0;
  const previewObserver=new MutationObserver(()=>{
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>{cursor=-1;refreshMatches();status.textContent=previewMatches.length?`${previewMatches.length}개 찾음`:find.value?'일치 항목 없음':''},90);
  });
  if(searchRoot())previewObserver.observe(searchRoot(),{subtree:true,childList:true,characterData:true});
  const close=()=>{
    document.removeEventListener('keydown',onKey);
    clearTimeout(refreshTimer);
    previewObserver.disconnect();
    clearPreviewFindHighlights();
    panel.remove();
  };
  const onKey=e=>{
    if(e.key==='Escape'){e.preventDefault();close()}
    else if(e.key==='Enter'&&document.activeElement===find){e.preventDefault();selectMatch(e.shiftKey?-1:1)}
  };
  panel.addEventListener('click',e=>{
    const action=e.target.closest('[data-find-action]')?.dataset.findAction;
    if(action==='next')selectMatch(1);
    else if(action==='previous')selectMatch(-1);
    else if(action==='replace')replaceCurrent();
    else if(action==='all')replaceAll();
    else if(action==='close')close();
  });
  const reset=()=>{cursor=-1;refreshMatches();status.textContent=previewMatches.length?`${previewMatches.length}개 찾음`:find.value?'일치 항목 없음':''};
  find.addEventListener('input',reset);
  panel.querySelectorAll('[data-find-case],[data-find-whole]').forEach(input=>input.addEventListener('change',reset));
  const drag=panel.querySelector('[data-find-drag]');
  drag.addEventListener('pointerdown',event=>{
    if(event.target.closest('button'))return;
    const rect=panel.getBoundingClientRect();
    const offsetX=event.clientX-rect.left,offsetY=event.clientY-rect.top;
    let moved=false;
    drag.setPointerCapture(event.pointerId);
    const move=moveEvent=>{
      moved=true;
      panel.style.transform='none';
      panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,moveEvent.clientX-offsetX))}px`;
      panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,moveEvent.clientY-offsetY))}px`;
      panel.style.right='auto';
    };
    const up=()=>{if(moved)saveFloatingPanelPosition(panel,'zz-find-replace-position-v1');drag.removeEventListener('pointermove',move);drag.removeEventListener('pointerup',up);drag.removeEventListener('pointercancel',up)};
    drag.addEventListener('pointermove',move);
    drag.addEventListener('pointerup',up);
    drag.addEventListener('pointercancel',up);
  });
  document.addEventListener('keydown',onKey);
  document.body.appendChild(panel);
  restoreFloatingPanelPosition(panel,'zz-find-replace-position-v1');
  find.focus();
}
function showFontEnvironmentNoticeLegacy(){
  const dismissedKey='zz-browser-font-notice-dismissed-v3';
  if(document.querySelector('.font-notice'))return;
  if(localStorage.getItem(dismissedKey)==='1')return;
  const locale=navigator.language||'ko-KR';
  let localeName=locale;
  try{localeName=new Intl.DisplayNames([locale],{type:'language'}).of(locale.split('-')[0])||locale}catch(_){}
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d');
  if(!context)return;
  const metrics=(font,samples)=>{
    context.font=`72px ${font}`;
    return samples.map(text=>context.measureText(text).width);
  };
  const distance=(left,right)=>left.reduce((sum,width,index)=>sum+Math.abs(width-right[index]),0);
  const fontAvailable=(name,samples)=>{
    const quoted=`"${name.replace(/"/g,'\\"')}"`;
    return['monospace','serif','sans-serif'].some(base=>
      distance(metrics(`${quoted},${base}`,samples),metrics(base,samples))>.35
    );
  };
  const closestFont=(target,samples,candidates)=>{
    let best=null;
    candidates.forEach(name=>{
      if(!fontAvailable(name,samples))return;
      const difference=distance(target,metrics(`"${name}",sans-serif`,samples));
      if(!best||difference<best.difference)best={name,difference};
    });
    return best&&best.difference<1.25?best.name:'사용자 지정 글꼴';
  };
  const platform=String(navigator.userAgentData?.platform||navigator.platform||'').toLowerCase();
  const language=locale.split('-')[0].toLowerCase();
  const expectedEnglish=platform.includes('mac')
    ?['Helvetica Neue','Helvetica']
    :platform.includes('android')
      ?['Roboto']
      :platform.includes('linux')
        ?['DejaVu Sans','Liberation Sans','Noto Sans','Arial']
        :['Arial'];
  const expectedRegional=language==='ko'
    ?(platform.includes('mac')?['Apple SD Gothic Neo']:platform.includes('android')?['Noto Sans CJK KR','Noto Sans KR','Roboto']:platform.includes('linux')?['Noto Sans CJK KR','Noto Sans KR','Nanum Gothic']:['Malgun Gothic','맑은 고딕'])
    :language==='ja'
      ?(platform.includes('mac')?['Hiragino Sans']:['Yu Gothic','Meiryo'])
      :language==='zh'
        ?(platform.includes('mac')?['PingFang SC','PingFang TC']:['Microsoft YaHei','SimSun'])
        :expectedEnglish;
  const latinSamples=['Hamburgefontsiv 012345','The quick brown fox jumps','MWil1 O0'];
  const regionalSamples=language==='ko'
    ?['현재 지역 글꼴 확인','가나다라마바사 012345','한글 Aa 09']
    :language==='ja'
      ?['現在の地域フォント','日本語 Aa 09']
      :language==='zh'
        ?['当前地区字体','中文 Aa 09']
        :latinSamples;
  const browserLatin=metrics('sans-serif',latinSamples);
  const browserRegional=metrics('sans-serif',regionalSamples);
  const installedExpectedEnglish=expectedEnglish.find(name=>fontAvailable(name,latinSamples));
  const installedExpectedRegional=expectedRegional.find(name=>fontAvailable(name,regionalSamples));
  const englishChanged=installedExpectedEnglish
    ?distance(browserLatin,metrics(`"${installedExpectedEnglish}",sans-serif`,latinSamples))>1.25
    :false;
  const regionalChanged=installedExpectedRegional
    ?distance(browserRegional,metrics(`"${installedExpectedRegional}",sans-serif`,regionalSamples))>1.25
    :false;
  if(!englishChanged&&!regionalChanged)return;
  const latinCandidates=[
    'Arial','Segoe UI','Helvetica Neue','Helvetica','Roboto','Pretendard','Inter','Noto Sans',
    'Open Sans','Calibri','Verdana','Tahoma','Times New Roman','Georgia','DejaVu Sans','Liberation Sans'
  ];
  const regionalCandidates=[...new Set([
    ...expectedRegional,'Pretendard','Noto Sans KR','Noto Sans CJK KR','Nanum Gothic','NanumGothic',
    'Spoqa Han Sans Neo','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Arial Unicode MS'
  ])];
  const englishFont=englishChanged?closestFont(browserLatin,latinSamples,latinCandidates):installedExpectedEnglish;
  const regionalFont=regionalChanged?closestFont(browserRegional,regionalSamples,regionalCandidates):installedExpectedRegional;
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop font-notice';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="font-notice-title">
    <h3 id="font-notice-title">브라우저 사용자 글꼴 감지</h3>
    <p>브라우저 기본 글꼴이 운영체제 기본값과 다르게 설정되어 있습니다.</p>
    <div class="font-notice-list">
      <div><b>영어</b><span title="${htmlEsc(englishFont)}">${htmlEsc(englishFont)}</span></div>
      <div><b>${htmlEsc(localeName)} (현재 지역)</b><span title="${htmlEsc(regionalFont)}">${htmlEsc(regionalFont)}</span></div>
    </div>
    <label class="font-notice-dismiss"><input type="checkbox"> 다시는 보지 않기</label>
    <div class="modal-actions"><button class="tool primary" type="button">확인</button></div>
  </div>`;
  const close=()=>{
    if(wrap.querySelector('input').checked)localStorage.setItem(dismissedKey,'1');
    wrap.remove();
  };
  wrap.querySelector('button').onclick=close;
  document.body.appendChild(wrap);
}
function showFontEnvironmentNotice(){
  const dismissedKey='zz-browser-font-notice-dismissed-v4';
  if(document.querySelector('.font-notice')||localStorage.getItem(dismissedKey)==='1')return;
  const locale=navigator.language||'ko-KR';
  const language=locale.split('-')[0].toLowerCase();
  const platform=String(navigator.userAgentData?.platform||navigator.platform||'').toLowerCase();
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d');
  if(!context)return;
  const samples={
    latin:['Hamburgefontsiv 012345','The quick brown fox jumps','MWil1 O0'],
    regional:language==='ko'
      ?['현재 지역 글꼴 확인','가나다라마바사 012345','한글 Aa 09']
      :language==='ja'
        ?['現在の地域フォント','日本語 Aa 09']
        :language==='zh'
          ?['当前地区字体','中文 Aa 09']
          :['Hamburgefontsiv 012345','The quick brown fox jumps','MWil1 O0']
  };
  const metrics=(font,texts)=>{
    context.font=`72px ${font}`;
    return texts.map(text=>context.measureText(text).width);
  };
  const distance=(left,right)=>left.reduce((sum,width,index)=>sum+Math.abs(width-right[index]),0);
  const available=(name,texts)=>{
    const quoted=`"${name.replace(/"/g,'\\"')}"`;
    return['monospace','serif','sans-serif'].some(base=>
      distance(metrics(`${quoted},${base}`,texts),metrics(base,texts))>.35
    );
  };
  const expectedStandard=platform.includes('mac')
    ?['Times','Times New Roman']
    :platform.includes('android')
      ?['Roboto']
      :platform.includes('linux')
        ?['Times New Roman','Liberation Serif','DejaVu Serif']
        :['Times New Roman'];
  const expectedSans=platform.includes('mac')
    ?['Arial','Helvetica']
    :platform.includes('android')
      ?['Roboto']
      :platform.includes('linux')
        ?['Arial','Liberation Sans','DejaVu Sans','Noto Sans']
        :['Arial'];
  const expectedRegional=language==='ko'
    ?(platform.includes('mac')?['Apple SD Gothic Neo']:platform.includes('android')?['Noto Sans CJK KR','Noto Sans KR','Roboto']:platform.includes('linux')?['Noto Sans CJK KR','Noto Sans KR','Nanum Gothic']:['Malgun Gothic','맑은 고딕'])
    :language==='ja'
      ?(platform.includes('mac')?['Hiragino Sans']:['Yu Gothic','Meiryo'])
      :language==='zh'
        ?(platform.includes('mac')?['PingFang SC','PingFang TC']:['Microsoft YaHei','SimSun'])
        :expectedSans;
  const differsFromAllDefaults=(generic,names,texts)=>{
    const target=metrics(generic,texts);
    const differences=names
      .filter(name=>available(name,texts))
      .map(name=>distance(target,metrics(`"${name}",${generic}`,texts)));
    return differences.length>0&&Math.min(...differences)>1.5;
  };
  const standardChanged=differsFromAllDefaults('serif',expectedStandard,samples.latin);
  const sansChanged=differsFromAllDefaults('sans-serif',expectedSans,samples.latin);
  const regionalChanged=differsFromAllDefaults('sans-serif',expectedRegional,samples.regional);
  if(!standardChanged&&!sansChanged&&!regionalChanged)return;
  const closest=(target,texts,candidates)=>{
    let best=null;
    candidates.forEach(name=>{
      if(!available(name,texts))return;
      const difference=distance(target,metrics(`"${name}",sans-serif`,texts));
      if(!best||difference<best.difference)best={name,difference};
    });
    return best&&best.difference<1.5?best.name:'사용자 지정 글꼴';
  };
  const latinCandidates=[
    'Times New Roman','Times','Arial','Segoe UI','Helvetica Neue','Helvetica','Roboto','Pretendard',
    'Inter','Noto Sans','Open Sans','Calibri','Verdana','Tahoma','Georgia','DejaVu Serif',
    'Liberation Serif','DejaVu Sans','Liberation Sans'
  ];
  const regionalCandidates=[...new Set([
    ...expectedRegional,'Pretendard','Noto Sans KR','Noto Sans CJK KR','Nanum Gothic','NanumGothic',
    'Spoqa Han Sans Neo','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Arial Unicode MS'
  ])];
  const englishTarget=standardChanged?metrics('serif',samples.latin):metrics('sans-serif',samples.latin);
  const regionalTarget=metrics('sans-serif',samples.regional);
  const englishFont=closest(englishTarget,samples.latin,latinCandidates);
  const regionalFont=closest(regionalTarget,samples.regional,regionalCandidates);
  let localeName=locale;
  try{localeName=new Intl.DisplayNames([locale],{type:'language'}).of(language)||locale}catch(_){}
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop font-notice';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="font-notice-title">
    <h3 id="font-notice-title">브라우저 사용자 글꼴 감지</h3>
    <p>브라우저 기본 글꼴이 운영체제의 기본 설정과 다릅니다.</p>
    <div class="font-notice-list">
      <div><b>영어</b><span title="${htmlEsc(englishFont)}">${htmlEsc(englishFont)}</span></div>
      <div><b>${htmlEsc(localeName)} (현재 지역)</b><span title="${htmlEsc(regionalFont)}">${htmlEsc(regionalFont)}</span></div>
    </div>
    <label class="font-notice-dismiss"><input type="checkbox"> 다시는 보지 않기</label>
    <div class="modal-actions"><button class="tool primary" type="button">확인</button></div>
  </div>`;
  const close=()=>{
    if(wrap.querySelector('input').checked)localStorage.setItem(dismissedKey,'1');
    wrap.remove();
  };
  wrap.querySelector('button').onclick=close;
  document.body.appendChild(wrap);
}
function detectBrowserFontOverride(){
  const locale=navigator.language||'ko-KR';
  const language=locale.split('-')[0].toLowerCase();
  const platform=String(navigator.userAgentData?.platform||navigator.platform||'').toLowerCase();
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d');
  if(!context)return null;
  const sampleSets={
    latin:['Hamburgefontsiv 012345','The quick brown fox jumps','MWil1 O0'],
    regional:language==='ko'
      ?['현재 지역 글꼴 확인','가나다라마바사 012345','한글 Aa 09']
      :language==='ja'
        ?['現在地域フォント確認','日本語 Aa 09']
        :language==='zh'
          ?['当前区域字体确认','中文 Aa 09']
          :['Hamburgefontsiv 012345','The quick brown fox jumps','MWil1 O0']
  };
  const signature=(font,texts)=>{
    context.font=`72px ${font}`;
    return texts.flatMap(text=>{
      const measured=context.measureText(text);
      return [
        measured.width,
        measured.actualBoundingBoxAscent||0,
        measured.actualBoundingBoxDescent||0
      ];
    });
  };
  const distance=(left,right)=>left.reduce((sum,value,index)=>sum+Math.abs(value-right[index]),0);
  const quote=name=>`"${String(name).replace(/"/g,'\\"')}"`;
  const available=(name,texts)=>{
    const explicit=quote(name);
    return['monospace','serif','sans-serif'].some(fallback=>
      distance(signature(`${explicit},${fallback}`,texts),signature(fallback,texts))>.5
    );
  };
  const defaults=platform.includes('mac')
    ?{
        standard:['Times','Times New Roman'],
        sans:['Helvetica','Arial'],
        regional:language==='ko'?['Apple SD Gothic Neo']:language==='ja'?['Hiragino Sans']:language==='zh'?['PingFang SC','PingFang TC']:['Helvetica','Arial']
      }
    :platform.includes('android')
      ?{standard:['Roboto'],sans:['Roboto'],regional:['Roboto','Noto Sans CJK KR','Noto Sans KR']}
      :platform.includes('linux')
        ?{
            standard:['Times New Roman','Liberation Serif','DejaVu Serif'],
            sans:['Arial','Liberation Sans','DejaVu Sans','Noto Sans'],
            regional:language==='ko'?['Noto Sans CJK KR','Noto Sans KR','Nanum Gothic']:language==='ja'?['Noto Sans CJK JP']:language==='zh'?['Noto Sans CJK SC']:['Arial','Liberation Sans','DejaVu Sans']
          }
        :{
            standard:['Times New Roman'],
            sans:['Arial'],
            regional:language==='ko'?['Malgun Gothic']:language==='ja'?['Yu Gothic','Meiryo']:language==='zh'?['Microsoft YaHei','SimSun']:['Arial']
          };
  const compare=(generic,names,texts)=>{
    const target=signature(generic,texts);
    const installed=names.filter(name=>available(name,texts));
    if(!installed.length)return{changed:false,target,closest:names[0]||generic,difference:0};
    const ranked=installed
      .map(name=>({name,difference:distance(target,signature(`${quote(name)},${generic}`,texts))}))
      .sort((a,b)=>a.difference-b.difference);
    return{changed:ranked[0].difference>2,target,closest:ranked[0].name,difference:ranked[0].difference};
  };
  const standard=compare('serif',defaults.standard,sampleSets.latin);
  const sans=compare('sans-serif',defaults.sans,sampleSets.latin);
  const regional=compare('sans-serif',defaults.regional,sampleSets.regional);
  const candidates=[...new Set([
    ...defaults.standard,...defaults.sans,...defaults.regional,
    'Pretendard','Inter','Segoe UI','Calibri','Roboto','Noto Sans','Open Sans',
    'Verdana','Tahoma','Georgia','Noto Sans KR','Noto Sans CJK KR','Nanum Gothic',
    'Spoqa Han Sans Neo','Apple SD Gothic Neo','Malgun Gothic','Yu Gothic','Meiryo',
    'Microsoft YaHei','SimSun','Arial Unicode MS'
  ])];
  const identify=(target,texts,fallback)=>{
    const ranked=candidates
      .filter(name=>available(name,texts))
      .map(name=>({name,difference:distance(target,signature(`${quote(name)},sans-serif`,texts))}))
      .sort((a,b)=>a.difference-b.difference);
    return ranked[0]&&ranked[0].difference<=2?ranked[0].name:fallback;
  };
  const englishChanged=standard.changed||sans.changed;
  return{
    changed:englishChanged||regional.changed,
    englishFont:englishChanged
      ?identify(standard.changed?standard.target:sans.target,sampleSets.latin,'사용자 지정 글꼴')
      :(standard.closest||sans.closest),
    regionalFont:regional.changed
      ?identify(regional.target,sampleSets.regional,'사용자 지정 글꼴')
      :regional.closest,
    locale,
    language,
    checks:{standard,sans,regional}
  };
}
function showStrictFontEnvironmentNotice(){
  const dismissedKey='zz-browser-font-notice-dismissed-v5';
  if(document.querySelector('.font-notice')||localStorage.getItem(dismissedKey)==='1')return;
  const detected=detectBrowserFontOverride();
  if(!detected?.changed)return;
  let localeName=detected.locale;
  try{
    localeName=new Intl.DisplayNames([detected.locale],{type:'language'}).of(detected.language)||detected.locale;
  }catch(_){}
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop font-notice';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="font-notice-title">
    <h3 id="font-notice-title">브라우저 사용자 글꼴 감지</h3>
    <p>브라우저 기본 글꼴이 운영체제 기본값과 다르게 설정되어 있습니다.</p>
    <div class="font-notice-list">
      <div><b>영어</b><span title="${htmlEsc(detected.englishFont)}">${htmlEsc(detected.englishFont)}</span></div>
      <div><b>${htmlEsc(localeName)} (현재 지역)</b><span title="${htmlEsc(detected.regionalFont)}">${htmlEsc(detected.regionalFont)}</span></div>
    </div>
    <label class="font-notice-dismiss"><input type="checkbox"> 다시는 보지 않기</label>
    <div class="modal-actions"><button class="tool primary" type="button">확인</button></div>
  </div>`;
  wrap.querySelector('button').onclick=()=>{
    if(wrap.querySelector('input').checked)localStorage.setItem(dismissedKey,'1');
    wrap.remove();
  };
  document.body.appendChild(wrap);
}
function markdownFileChanged(file){return file.text!==(Object.hasOwn(file,'savedText')?file.savedText:file.text)}
function safeZipPath(raw,fallback='file'){
  const parts=String(raw||fallback).replace(/\\/g,'/').replace(/^[a-z]:/i,'').split('/').filter(part=>part&&part!=='.'&&part!=='..');
  return parts.join('/')||fallback;
}
function zipEntryPath(file,used){
  let parts=safeZipPath(file.path||file.name,'document.md').split('/');
  if(!mdExt.test(parts[parts.length-1]))parts[parts.length-1]=file.name||`${parts[parts.length-1]}.md`;
  let path=parts.join('/'),n=2;
  const dot=path.lastIndexOf('.'),base=dot>path.lastIndexOf('/')?path.slice(0,dot):path,ext=dot>path.lastIndexOf('/')?path.slice(dot):'';
  while(used.has(path))path=`${base} (${n++})${ext}`;
  used.add(path);
  return path;
}
function markZipFilesSaved(files){
  files.forEach(file=>{file.savedText=file.text});
  const active=state.files[state.active];
  if(active&&files.includes(active)){state.savedText=active.text;state.dirty=false}
}
async function exportMarkdownZip(files,name,includeFolderAssets=false){
  if(state.active>=0)state.files[state.active].text=els.editor.value;
  if(!files.length){showInfoNotice('저장할 문서 없음','조건에 맞는 마크다운 문서가 없습니다.');return}
  if(!window.JSZip){showInfoNotice('ZIP 저장 준비 실패','ZIP 기능을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');return}
  const zip=new JSZip(),used=new Set();
  if(includeFolderAssets){
    const markdownPaths=new Set(files.map(file=>safeZipPath(file.path||file.name,'document.md')));
    state.assets.forEach((asset,path)=>{const safe=safeZipPath(path,asset.name||'file');if(!markdownPaths.has(safe))zip.file(safe,asset)});
  }
  files.forEach(file=>zip.file(zipEntryPath(file,used),file.text||''));
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  const anchor=document.createElement('a'),url=URL.createObjectURL(blob);
  anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1200);
  markZipFilesSaved(files);
  setStatus(`${files.length}개 문서를 ZIP으로 저장했습니다.`);
}
function selectZipFiles(){
  if(!state.files.length){showInfoNotice('저장할 문서 없음','먼저 마크다운 문서를 열어 주세요.');return Promise.resolve([])}
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop zip-select-dialog';
    const rows=state.files.map((file,index)=>`<label class="check-row"><input type="checkbox" value="${index}" ${index===state.active?'checked':''}><span><span class="merge-name">${htmlEsc(file.displayName||file.name)}</span><span class="merge-path">${htmlEsc(file.path||file.name)}</span></span></label>`).join('');
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="zip-select-title"><h3 id="zip-select-title">ZIP에 담을 문서 선택</h3><p>선택한 마크다운 문서의 폴더 경로를 유지해서 저장합니다.</p><div class="zip-select-tools"><button class="tool" type="button" data-zip-select="all">전체 선택</button><button class="tool" type="button" data-zip-select="none">전체 해제</button></div><div class="zip-file-list">${rows}</div><div class="modal-actions"><button class="tool" type="button" data-zip-action="cancel">취소</button><button class="tool primary" type="button" data-zip-action="save">선택 문서 ZIP 저장</button></div></div>`;
    const finish=files=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(files)};
    const onKey=e=>{if(e.key==='Escape')finish([])};
    wrap.querySelector('[data-zip-select="all"]').onclick=()=>wrap.querySelectorAll('.zip-file-list input').forEach(input=>input.checked=true);
    wrap.querySelector('[data-zip-select="none"]').onclick=()=>wrap.querySelectorAll('.zip-file-list input').forEach(input=>input.checked=false);
    wrap.querySelector('[data-zip-action="cancel"]').onclick=()=>finish([]);
    wrap.querySelector('[data-zip-action="save"]').onclick=()=>{
      const files=[...wrap.querySelectorAll('.zip-file-list input:checked')].map(input=>state.files[Number(input.value)]).filter(Boolean);
      if(!files.length){showInfoNotice('선택한 문서 없음','ZIP에 담을 문서를 하나 이상 선택해 주세요.');return}
      finish(files);
    };
    wrap.addEventListener('click',e=>{if(e.target===wrap)finish([])});
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
  });
}
function saveChangedZip(){if(state.active>=0)state.files[state.active].text=els.editor.value;return exportMarkdownZip(state.files.filter(markdownFileChanged),'markdown-changes.zip')}
async function saveSelectedZip(){const files=await selectZipFiles();if(files.length)await exportMarkdownZip(files,'markdown-selection.zip')}
function saveAllZip(){return exportMarkdownZip([...state.files],'markdown-folder.zip',true)}
function confirmDirtyAction(actionLabel){
  if(!state.dirty)return Promise.resolve('continue');
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="dirty-title">
      <h3 id="dirty-title">저장되지 않은 변경사항</h3>
      <p>현재 문서에 저장되지 않은 수정사항이 있습니다. 계속하기 전에 어떻게 처리할까요?</p>
      <div class="modal-actions">
        <button class="tool primary" data-choice="save">저장 후 ${actionLabel}</button>
        <button class="tool" data-choice="discard">저장하지 않고 ${actionLabel}</button>
        <button class="tool" data-choice="cancel">취소</button>
      </div>
    </div>`;
    function esc(e){if(e.key==='Escape')done('cancel')}
    function done(choice){document.removeEventListener('keydown',esc);wrap.remove();resolve(choice)}
    wrap.addEventListener('click',e=>{if(e.target===wrap)done('cancel')});
    wrap.querySelectorAll('button').forEach(b=>b.onclick=()=>done(b.dataset.choice));
    document.addEventListener('keydown',esc);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-choice="save"]').focus();
  });
}
function chooseDirtySaveFormat(actionLabel){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="save-format-title">
      <h3 id="save-format-title">저장 형식 선택</h3>
      <p>현재 문서를 어떤 형식으로 저장한 뒤 ${htmlEsc(actionLabel)}할까요?</p>
      <div class="modal-actions">
        <button class="tool" type="button" data-format="pdf">PDF 저장</button>
        <button class="tool primary" type="button" data-format="md">MD 저장</button>
        <button class="tool" type="button" data-format="cancel">취소</button>
      </div>
    </div>`;
    const done=format=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(format)};
    const onKey=e=>{if(e.key==='Escape')done('cancel')};
    wrap.querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>done(button.dataset.format));
    wrap.addEventListener('click',e=>{if(e.target===wrap)done('cancel')});
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-format="md"]').focus();
  });
}
async function saveCurrentAsPdf(){
  const file=state.files[state.active];
  if(file)file.text=els.editor.value;
  clearTimeout(editorRenderTimer);
  editorRenderTimer=null;
  pendingEditorRender=els.editor.value;
  renderMarkdown(els.editor.value);
  const title=(file?.name||'document.md').replace(/\.(md|markdown)$/i,'')+'.pdf';
  if(!await printDocument(title,els.preview))return false;
  if(file)file.savedText=els.editor.value;
  state.savedText=els.editor.value;
  state.dirty=false;
  return true;
}
async function confirmDirtySave(actionLabel){
  const choice=await confirmDirtyAction(actionLabel);
  if(choice!=='save')return choice==='discard'||choice==='continue';
  const format=await chooseDirtySaveFormat(actionLabel);
  if(format==='md'){saveCurrent();return true}
  if(format==='pdf')return saveCurrentAsPdf();
  return false;
}
function newDocument(){
  if(state.active>=0)state.files[state.active].text=els.editor.value;
  else if(els.editor.value.trim())createDraftFromEditor();
  const name=nextUntitledName();
  state.files.push({name,path:name,dir:'',text:'',savedText:'',source:'local'});
  openFile(state.files.length-1);
}
function clearOpenDocument(){
  state.active=-1;
  state.lastInput=null;
  state.history=[''];
  state.future=[];
  state.savedText='';
  state.dirty=false;
  state.savedSelection=null;
  state.lastEditorSelection={start:0,end:0};
  state.lastInsertionSurface='editor';
  state.savedPreviewRange=null;
  state.pendingInsertionContext=null;
  els.editor.value='';
  els.preview.innerHTML='';
  lastRenderedMarkdownText=null;
  convertPreviewSnapshot=[];
  convertPreviewJob++;
  mergePreviewSnapshot=[];
  mergePreviewJob++;
  els.convertPreview.innerHTML='<div class="upload-box">MD 파일을 업로드하거나 왼쪽 목록에서 선택하세요.</div>';
  delete els.homeOutput.dataset.touched;
  els.homeOutput.value='converted-document';
  if(els.homeOutputExt){els.homeOutputExt.textContent='';els.homeOutputExt.classList.add('pending');}
  renderList();
  renderMergeList();
  updateHomeConvert();
  updateUndoRedoButtons();
  updateLineNumbers();
}
async function closeDocument(){if(!await confirmDirtySave('닫기'))return;if(state.active>=0)state.files.splice(state.active,1);clearOpenDocument();setMode('edit',false)}
let savedSplitCols='';
const EDIT_VIEW_STORAGE_KEY='md-edit-view-mode';
function setEditView(view,{persist=true}={}){
  if(!['both','md','preview'].includes(view))view='both';
  const inSplit=!els.editSplit.classList.contains('edit-md-only')&&!els.editSplit.classList.contains('edit-preview-only');
  if(view==='both'){
    els.editSplit.style.gridTemplateColumns=savedSplitCols;
  }else{
    if(inSplit)savedSplitCols=els.editSplit.style.gridTemplateColumns;
    els.editSplit.style.gridTemplateColumns='1fr';
  }
  els.editSplit.classList.toggle('edit-md-only',view==='md');
  els.editSplit.classList.toggle('edit-preview-only',view==='preview');
  ['view-both','view-md-only','view-preview-only'].forEach(id=>{
    const map={'view-both':'both','view-md-only':'md','view-preview-only':'preview'};
    const el=$(id);if(el)el.classList.toggle('active',map[id]===view);
  });
  if(persist)localStorage.setItem(EDIT_VIEW_STORAGE_KEY,view);
}
function selectionText(){const saved=state.savedSelection;const s=saved?saved.start:els.editor.selectionStart,e=saved?saved.end:els.editor.selectionEnd;state.savedSelection=null;return{start:s,end:e,text:els.editor.value.slice(s,e)}}
function previewTopLevelAnchor(range){
  if(!range)return null;
  let anchor=range.endContainer;
  if(anchor===els.preview){
    const index=Math.min(range.endOffset,els.preview.childNodes.length)-1;
    return index>=0?els.preview.childNodes[index]:null;
  }
  if(anchor.nodeType!==Node.ELEMENT_NODE)anchor=anchor.parentNode;
  while(anchor&&anchor.parentNode!==els.preview)anchor=anchor.parentNode;
  return anchor&&anchor.parentNode===els.preview?anchor:null;
}
function captureInsertionContext(){
  if(state.pendingInsertionContext){
    const pending=state.pendingInsertionContext;
    state.pendingInsertionContext=null;
    if(pending.kind==='preview'&&pending.range&&els.preview.contains(pending.range.commonAncestorContainer)){
      return{...pending,range:pending.range.cloneRange()};
    }
    if(pending.kind==='editor'){
      const start=Math.max(0,Math.min(els.editor.value.length,pending.start));
      const end=Math.max(start,Math.min(els.editor.value.length,pending.end));
      return{kind:'editor',start,end,text:els.editor.value.slice(start,end)};
    }
  }
  const range=state.lastInsertionSurface==='preview'?previewRange():null;
  if(range&&els.preview.contains(range.commonAncestorContainer)){
    return{
      kind:'preview',
      range:range.cloneRange(),
      anchor:previewTopLevelAnchor(range),
      text:range.toString()
    };
  }
  const saved=state.lastEditorSelection||state.savedSelection;
  const start=Math.max(0,Math.min(els.editor.value.length,saved?.start??els.editor.selectionStart));
  const end=Math.max(start,Math.min(els.editor.value.length,saved?.end??els.editor.selectionEnd));
  return{kind:'editor',start,end,text:els.editor.value.slice(start,end)};
}
function restoreInsertionContext(context){
  if(!context)return;
  if(context.kind==='preview'&&context.range&&els.preview.contains(context.range.commonAncestorContainer)){
    state.savedPreviewRange=context.range.cloneRange();
    state.savedSelection=null;
  }else if(context.kind==='editor'){
    state.savedSelection={start:context.start,end:context.end};
    state.savedPreviewRange=null;
  }
}
function insertBlockAtEditorContext(text,context){
  const source=els.editor.value;
  const end=context?.kind==='editor'?context.end:els.editor.selectionEnd;
  const selectionEnd=end>0&&source[end-1]==='\n'?end-1:end;
  const nextBreak=source.indexOf('\n',selectionEnd);
  const insertAt=nextBreak<0?source.length:nextBreak+1;
  const before=source.slice(0,insertAt),after=source.slice(insertAt);
  const trailingNewlines=(before.match(/\n*$/)||[''])[0].length;
  const leadingNewlines=(after.match(/^\n*/)||[''])[0].length;
  const prefix='\n'.repeat(Math.max(0,2-trailingNewlines));
  const suffix='\n'.repeat(Math.max(1,2-leadingNewlines));
  replaceRange(`${prefix}${text}${suffix}`,insertAt,insertAt);
}
function appendReferenceDefinition(text){
  const source=els.editor.value;
  const prefix=source&&!source.endsWith('\n\n')?(source.endsWith('\n')?'\n':'\n\n'):'';
  replaceRange(`${prefix}${text}\n`,source.length,source.length);
}
function replaceRange(value,start,end,keepSel=false){pushHistory(true);els.editor.setRangeText(value,start,end,'end');if(keepSel)els.editor.setSelectionRange(start,start+value.length);syncActive();pushHistory(true);els.editor.focus()}
function replaceSelection(value){const{start,end}=selectionText();replaceRange(value,start,end)}
function placeholderSelection(sel,word='TEXT'){return sel.start===sel.end?{...sel,text:word,placeholder:true}:sel}
function wrapSelection(before,after=before){let sel=placeholderSelection(selectionText());const core=sel.text.trimEnd();const trail=sel.text.slice(core.length);const value=`${before}${core}${after}${trail}`;replaceRange(value,sel.start,sel.end,true);if(sel.placeholder)els.editor.setSelectionRange(sel.start+before.length,sel.start+before.length+core.length)}
function applyHeading(tag){
  if(!tag)return;
  if(applyPreviewCommand('formatBlock',tag))return;
  const prefix=tag==='p'?'':'#'.repeat(Number(tag.slice(1)))+' ';
  let sel=placeholderSelection(selectionText());
  if(sel.placeholder){
    replaceRange(`${prefix}${sel.text}`,sel.start,sel.end,true);
    els.editor.setSelectionRange(sel.start+prefix.length,sel.start+prefix.length+sel.text.length);
    return;
  }
  const before=els.editor.value.slice(0,sel.start);
  const lineStart=before.lastIndexOf('\n')+1;
  els.editor.setSelectionRange(lineStart,sel.end);
  const block=els.editor.value.slice(lineStart,sel.end).replace(/^#{1,6}\s*/gm,'').split('\n').map(line=>line?prefix+line:line).join('\n');
  els.editor.setRangeText(block,lineStart,sel.end,'end');
  syncActive();
  els.editor.focus();
}
function styleSpan(styleName,value){
  const originalSel=selectionText();
  const sel=placeholderSelection(originalSel);
  const full=els.editor.value;
  if(value&&sel.start!==sel.end){
    for(const match of full.matchAll(/(`+)([^`\r\n]+)\1/g)){
      const start=match.index+match[1].length,end=start+match[2].length;
      if(sel.start<start||sel.end>end)continue;
      const left=htmlEsc(full.slice(start,sel.start)),inner=htmlEsc(full.slice(sel.start,sel.end)),right=htmlEsc(full.slice(sel.end,end));
      replaceRange(`<code>${left}<span style="${styleName}:${value}">${inner}</span>${right}</code>`,match.index,match.index+match[0].length,true);
      return;
    }
  }
  const escaped=styleName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const removeProp=s=>s.replace(new RegExp(`${escaped}\\s*:\\s*[^;"]+;?\\s*`,'i'),'').trim();
  const mergeStyle=(existing,prop,val)=>{let s=removeProp(existing);if(val===''||val==null)return s;if(s&&!s.endsWith(';'))s+=';';return(s?s+' ':'')+`${prop}:${val}`;};

  // Case 1: 선택 텍스트 자체가 완전한 <span> 태그인 경우
  const fullSpanRe=/^<span style="([^"]*)">([^]*)<\/span>$/;
  const m=sel.text.match(fullSpanRe);
  if(m){
    replaceRange(`<span style="${mergeStyle(m[1],styleName,value)}">${m[2]}</span>`,sel.start,sel.end,true);
    return;
  }

  // Case 2: 선택 범위가 기존 <span> 안의 내용인 경우 (태그 제외하고 드래그한 상황)
  const before=full.slice(0,sel.start);
  const after=full.slice(sel.end);
  const openMatch=before.match(/<span style="([^"]*)">\s*$/);
  const closeMatch=after.match(/^\s*<\/span>/);
  if(openMatch&&closeMatch){
    const tagStart=before.lastIndexOf('<span');
    const tagEnd=sel.end+closeMatch[0].length;
    replaceRange(`<span style="${mergeStyle(openMatch[1],styleName,value)}">${sel.text}</span>`,tagStart,tagEnd,true);
    return;
  }

  // Case 3: 새 span 생성
  if(value===''||value==null){
    replaceRange(sel.text,sel.start,sel.end,true);
    return;
  }
  const valueText=`<span style="${styleName}:${value}">${sel.text}</span>`;
  replaceRange(valueText,sel.start,sel.end,true);
  if(sel.placeholder){
    const innerStart=sel.start+`<span style="${styleName}:${value}">`.length;
    els.editor.setSelectionRange(innerStart,innerStart+sel.text.length);
  }
}
function applyAlign(align){
  const command={left:'justifyLeft',center:'justifyCenter',right:'justifyRight'}[align];
  if(command&&applyPreviewCommand(command))return;
  const sel=selectionText();
  const text=sel.text,core=text.trimEnd(),trail=text.slice(core.length);
  const m=core.match(/^<div style="text-align:[^"]*">\n?([\s\S]*?)\n?<\/div>$/);
  const inner=m?m[1]:core;
  replaceRange(`<div style="text-align:${align}">\n${inner}\n</div>${trail}`,sel.start,sel.end,true);
}
function insertBlock(text,emptyText='TEXT'){const raw=selectionText();const sel=raw.start===raw.end?{...raw,text:emptyText,placeholder:true}:raw;const before=els.editor.value.slice(0,sel.start);const prefix=before&&before[before.length-1]!=='\n'?'\n\n':'';const value=`${prefix}${text.includes('{text}')?text.replace('{text}',sel.text):text}\n`;replaceRange(value,sel.start,sel.end,true);if(sel.placeholder&&value.includes(emptyText)){const p=sel.start+value.indexOf(emptyText);els.editor.setSelectionRange(p,p+emptyText.length)}}
function insertBlockBelowSelection(text){
  const sel=selectionText();
  const source=els.editor.value;
  const selectionEnd=sel.end>sel.start&&source[sel.end-1]==='\n'?sel.end-1:sel.end;
  const nextBreak=source.indexOf('\n',selectionEnd);
  const insertAt=nextBreak<0?source.length:nextBreak+1;
  const before=source.slice(0,insertAt);
  const after=source.slice(insertAt);
  const blockSpacing=text==='<br>'?1:2;
  const trailingNewlines=(before.match(/\n*$/)||[''])[0].length;
  const leadingNewlines=(after.match(/^\n*/)||[''])[0].length;
  const prefix='\n'.repeat(Math.max(0,blockSpacing-trailingNewlines));
  const suffix='\n'.repeat(Math.max(1,blockSpacing-leadingNewlines));
  replaceRange(`${prefix}${text}${suffix}`,insertAt,insertAt);
}
function linePrefix(prefix,emptyText='텍스트'){
  const raw=selectionText();
  const full=els.editor.value;
  const start=full.lastIndexOf('\n',Math.max(0,raw.start-1))+1;
  const nextBreak=full.indexOf('\n',raw.end);
  const end=nextBreak<0?full.length:nextBreak;
  const current=full.slice(start,end);
  const placeholder=!current;
  const source=placeholder?emptyText:current;
  const lines=source.split('\n').map((line,i)=>prefix.replace('{n}',i+1)+(line||emptyText)).join('\n');
  replaceRange(lines,start,end,true);
  if(placeholder){const p=start+prefix.replace('{n}',1).length;els.editor.setSelectionRange(p,p+emptyText.length)}
}
function nextOrderedPrefixAt(pos){
  const before=els.editor.value.slice(0,pos);
  const lines=before.split('\n');
  let last=0;
  for(let i=lines.length-1;i>=0;i--){
    const line=lines[i];
    if(!line.trim())break;
    const m=line.match(/^\s*(\d+)\.\s+/);
    if(m){last=Number(m[1]);break}
  }
  return `${last+1}. `;
}
function orderedListPrefix(){
  const sel=selectionText();
  const prefix=nextOrderedPrefixAt(sel.start);
  state.savedSelection=sel;
  linePrefix(prefix);
}
function insertImageFiles(files){const imgs=[...files].filter(f=>imageExt.test(f.name));imgs.forEach(addImage);if(!imgs.length){state.savedSelection=null;return}const range=previewRange();if(range){insertPreviewHtml(imgs.map(f=>`<img src="${htmlEsc(URL.createObjectURL(f))}" alt="${htmlEsc(f.name)}">`).join(''));return}replaceSelection(imgs.map(f=>`![${f.name}](${encodeURI(f.name)})`).join('\n'));renderMarkdown(els.editor.value)}
function activePrintSource(){
  const activePanel=document.querySelector('.panel.active');
  const source=activePanel?.querySelector('.preview');
  if(source&&(source.textContent.trim()||source.querySelector('.lazy-doc-section')))return source;
  return [els.preview,els.convertPreview,els.mergeResult].find(el=>el&&el.textContent.trim())||els.preview;
}
function normalizePrintClone(root){
  resetTableFilterView(root);
  root.querySelectorAll('.line-gutter,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle,.block-move-handle,.form-move-handle').forEach(el=>el.remove());
  root.querySelectorAll('.img-selected,.table-selected,.move-selected,.moving-element,.move-drop-before,.move-drop-after').forEach(el=>{
    el.classList.remove('img-selected','table-selected','move-selected','moving-element','move-drop-before','move-drop-after');
    el.removeAttribute('aria-selected');
    if(!el.className)el.removeAttribute('class');
  });
  root.querySelectorAll('table,tr,th,td').forEach(el=>{
    el.style.removeProperty('height');
    el.style.removeProperty('min-height');
    el.style.removeProperty('max-height');
    el.removeAttribute('data-base-h');
  });
  root.querySelectorAll('table').forEach(table=>{
    table.style.setProperty('width','100%');
    table.style.setProperty('max-width','100%');
    table.style.setProperty('min-width','0');
    table.style.setProperty('table-layout','fixed');
  });
  root.querySelectorAll('th,td').forEach(cell=>{
    cell.style.removeProperty('width');
    cell.style.removeProperty('min-width');
    cell.style.removeProperty('max-width');
    cell.style.setProperty('overflow-wrap','anywhere');
    cell.style.setProperty('word-break','break-word');
  });
  root.querySelectorAll('.zz-source-chip').forEach(chip=>{
    chip.style.setProperty('max-width','100%');
    chip.style.setProperty('white-space','normal');
    chip.style.setProperty('overflow-wrap','anywhere');
  });
  root.querySelectorAll('article,section,div,blockquote,pre,table,thead,tbody,tfoot,tr').forEach(el=>{
    ['break-before','break-after','break-inside','page-break-before','page-break-after','page-break-inside'].forEach(prop=>el.style.removeProperty(prop));
    if(!el.matches('.zz-math-block')){
      if(!el.matches('pre,.code-block,.code-block-body'))el.style.removeProperty('height');
      el.style.removeProperty('min-height');
      el.style.removeProperty('max-height');
    }
  });
}
function printScaleValue(value){return Math.max(25,Math.min(200,Number(value)||100))}
function printScaledContentWidth(scale){
  const factor=printScaleValue(scale)/100;
  // Below 100% the sheet may naturally use less width. Above 100%, reduce
  // the layout width inversely so enlarged text/cells still end at the page edge.
  return factor>1?100/factor:factor*100;
}
function printPagesPerSheetValue(value){
  const pages=Number(value);
  return[1,2,4,6,9].includes(pages)?pages:1;
}
function printSheetLayout(pages){
  return pages===2
    ?{cols:2,rows:1,scale:210/297,landscape:true}
    :pages===4
      ?{cols:2,rows:2,scale:.5,landscape:false}
      :pages===6
        ?{cols:2,rows:3,scale:1/3,landscape:false}
      :pages===9
        ?{cols:3,rows:3,scale:1/3,landscape:false}
        :{cols:1,rows:1,scale:1,landscape:false};
}
let pagedJsPromise=null;
function loadPagedJs(){
  if(window.Paged?.Previewer)return Promise.resolve(window.Paged);
  if(pagedJsPromise)return pagedJsPromise;
  pagedJsPromise=new Promise((resolve,reject)=>{
    window.PagedConfig={...(window.PagedConfig||{}),auto:false};
    const script=document.createElement('script');
    script.src='https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.min.js';
    script.onload=()=>window.Paged?.Previewer?resolve(window.Paged):reject(new Error('페이지 분할 기능을 초기화하지 못했습니다.'));
    script.onerror=()=>reject(new Error('페이지 분할 모듈을 불러오지 못했습니다.'));
    document.head.appendChild(script);
  }).catch(error=>{pagedJsPromise=null;throw error});
  return pagedJsPromise;
}
function makePrintArticle(source,scale,paged=false){
  const article=source?source.cloneNode(true):document.createElement('article');
  article.removeAttribute('id');
  article.removeAttribute('contenteditable');
  article.classList.add('preview','print-document','print-paged-source');
  normalizePrintClone(article);
  const factor=scale/100;
  const width=`${printScaledContentWidth(scale)}%`;
  article.style.setProperty('--print-scale',String(factor));
  article.style.setProperty('--print-width',width);
  article.style.zoom=String(factor);
  article.style.width=width;
  return article;
}
function arrangePagedPrintPages(pages,pagesPerSheet,target){
  const layout=printSheetLayout(pagesPerSheet);
  const sheets=document.createElement('div');
  sheets.className='print-preview-sheets';
  for(let index=0;index<pages.length;index+=pagesPerSheet){
    const sheet=document.createElement('section');
    sheet.className='print-nup-sheet'+(layout.landscape?' landscape':'');
    sheet.style.setProperty('--nup-cols',String(layout.cols));
    sheet.style.setProperty('--nup-rows',String(layout.rows));
    sheet.style.setProperty('--nup-scale',String(layout.scale));
    pages.slice(index,index+pagesPerSheet).forEach(page=>{
      const cell=document.createElement('div');
      cell.className='print-nup-cell';
      cell.appendChild(page);
      sheet.appendChild(cell);
    });
    sheet.dataset.sheet=String(Math.floor(index/pagesPerSheet)+1);
    sheets.appendChild(sheet);
  }
  target.replaceChildren(sheets);
  return sheets.children.length;
}
async function renderNupPrintSheets(source,scale,pagesPerSheet,target){
  const staging=document.createElement('div');
  staging.className='paged-render-staging';
  const factor=printScaleValue(scale)/100;
  const logicalWidth=210/factor;
  const logicalHeight=297/factor;
  const flowMargin=7/factor;
  const flowGap=flowMargin*2;
  const flowContentWidth=logicalWidth-flowGap;
  const flowContentHeight=logicalHeight-flowGap;
  const flow=source?source.cloneNode(true):document.createElement('article');
  flow.removeAttribute('id');
  flow.removeAttribute('contenteditable');
  flow.classList.add('preview','print-document','print-flow-columns');
  normalizePrintClone(flow);
  flow.style.setProperty('--flow-margin',`${flowMargin}mm`);
  flow.style.setProperty('--flow-gap',`${flowGap}mm`);
  flow.style.setProperty('--flow-content-width',`${flowContentWidth}mm`);
  flow.style.setProperty('--flow-content-height',`${flowContentHeight}mm`);
  staging.style.width=`${logicalWidth}mm`;
  staging.appendChild(flow);
  document.body.appendChild(staging);
  try{
    await document.fonts.ready;
    await Promise.all([...flow.querySelectorAll('img')].map(image=>
      image.complete?Promise.resolve():image.decode?.().catch(()=>{})||Promise.resolve()
    ));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const columnWidth=Math.max(1,flow.clientWidth);
    const gapWidth=columnWidth*(flowGap/flowContentWidth);
    const pageCount=Math.max(1,Math.ceil((flow.scrollWidth+gapWidth-1)/(columnWidth+gapWidth)));
    const pages=Array.from({length:pageCount},(_,index)=>{
      const page=document.createElement('div');
      page.className='print-flow-page';
      const clone=flow.cloneNode(true);
      clone.style.transform=`scale(${factor}) translateX(-${index*logicalWidth}mm)`;
      page.appendChild(clone);
      return page;
    });
    return arrangePagedPrintPages(pages,pagesPerSheet,target);
  }finally{
    staging.remove();
  }
}
function showPrintScaleDialog(source){
  clearPreviewTransientState();
  materializeLazyPreview(source);
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="print-dialog-shell" role="dialog" aria-modal="true" aria-labelledby="print-dialog-title">
      <div class="print-dialog-head">
        <h3 id="print-dialog-title">PDF 저장 미리보기</h3>
        <label class="print-scale-field">배율 <span class="print-scale-input-wrap"><input id="print-scale-input" type="number" min="25" max="200" step="5" value="100" inputmode="numeric"><span>%</span></span></label>
        <label class="print-pages-field">시트당 페이지 <select id="print-pages-select"><option value="1">1쪽</option><option value="2">2쪽</option><option value="4">4쪽</option><option value="6">6쪽</option><option value="9">9쪽</option></select></label>
        <div class="print-dialog-actions"><button class="tool" type="button" data-print-action="cancel">취소</button><button class="tool primary" type="button" data-print-action="print">PDF 저장</button></div>
      </div>
      <div class="print-preview-stage"><div class="print-preview-surface"></div></div>
      <div class="print-viewer-footer">
        <div class="print-viewer-field" aria-label="미리보기 배율 (PDF 파일에는 적용되지 않음)">
          <button type="button" data-view-zoom="-10" title="미리보기 축소">−</button>
          <span class="print-viewer-value" title="PDF 파일에는 적용되지 않는 보기 배율">100%</span>
          <button type="button" data-view-zoom="10" title="미리보기 확대">+</button>
        </div>
      </div>
    </div>`;
    const surface=wrap.querySelector('.print-preview-surface');
    const article=source?source.cloneNode(true):document.createElement('article');
    article.removeAttribute('id');
    article.removeAttribute('contenteditable');
    article.classList.add('preview','print-paged-source');
    normalizePrintClone(article);
    const input=wrap.querySelector('#print-scale-input');
    const pagesSelect=wrap.querySelector('#print-pages-select');
    const printButton=wrap.querySelector('[data-print-action="print"]');
    const viewerValue=wrap.querySelector('.print-viewer-value');
    let viewerZoom=100;
    const updateViewerZoom=()=>{
      viewerZoom=Math.max(40,Math.min(180,viewerZoom));
      surface.style.zoom=String(viewerZoom/100);
      viewerValue.textContent=`${viewerZoom}%`;
    };
    wrap.querySelectorAll('[data-view-zoom]').forEach(button=>button.onclick=()=>{
      viewerZoom+=Number(button.dataset.viewZoom);
      updateViewerZoom();
    });
    let renderTimer=0,renderJob=0,renderPromise=Promise.resolve();
    let renderError=null;
    const renderSinglePage=scale=>{
      const sheet=document.createElement('div');
      sheet.className='print-preview-sheet';
      const content=document.createElement('div');
      content.className='print-preview-content';
      const clone=article.cloneNode(true);
      content.appendChild(clone);
      sheet.appendChild(content);
      surface.replaceChildren(sheet);
      content.style.zoom=String(scale/100);
      content.style.width=printScaledContentWidth(scale)+'%';
    };
    const update=()=>{
      const scale=printScaleValue(input.value);
      const pagesPerSheet=printPagesPerSheetValue(pagesSelect.value);
      clearTimeout(renderTimer);
      const job=++renderJob;
      renderError=null;
      if(pagesPerSheet===1){
        renderSinglePage(scale);
        printButton.disabled=false;
        renderPromise=Promise.resolve();
        return;
      }
      printButton.disabled=true;
      surface.innerHTML='<div class="print-preview-loading">페이지를 나누는 중...</div>';
      renderPromise=new Promise(done=>{
        renderTimer=setTimeout(async()=>{
          try{
            const target=document.createElement('div');
            await renderNupPrintSheets(source,scale,pagesPerSheet,target);
            if(job===renderJob){
              surface.replaceChildren(...target.childNodes);
              printButton.disabled=false;
            }
          }catch(error){
            if(job===renderJob){
              renderError=error;
              printButton.disabled=true;
              surface.innerHTML=`<div class="print-preview-loading">${htmlEsc(error.message)}<br>네트워크 연결을 확인해 주세요.</div>`;
            }
          }finally{done()}
        },180);
      });
    };
    const finish=value=>{
      document.removeEventListener('keydown',onKey);
      wrap.remove();
      resolve(value);
    };
    const onKey=e=>{if(e.key==='Escape')finish(null)};
    input.addEventListener('input',update);
    input.addEventListener('change',()=>{input.value=String(printScaleValue(input.value));update()});
    pagesSelect.addEventListener('change',update);
    wrap.querySelector('[data-print-action="cancel"]').onclick=()=>finish(null);
    printButton.onclick=async()=>{
      await renderPromise;
      if(renderError)return;
      const pagesPerSheet=printPagesPerSheetValue(pagesSelect.value);
      const preparedSheets=pagesPerSheet>1?surface.querySelector('.print-preview-sheets')?.cloneNode(true):null;
      finish({scale:printScaleValue(input.value),pagesPerSheet,preparedSheets});
    };
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    updateViewerZoom();
    update();
    input.focus();
    input.select();
  });
}
async function preparePrint(source=state.printSourceOverride||activePrintSource(),preparedSheets=null){
  clearPreviewTransientState();
  materializeLazyPreview(source);
  const root=$('print-root');
  if(!root)return;
  const scale=printScaleValue(state.printScale);
  const pagesPerSheet=printPagesPerSheetValue(state.printPagesPerSheet);
  root.classList.toggle('print-nup-root',pagesPerSheet>1);
  if(pagesPerSheet>1){
    if(preparedSheets)root.replaceChildren(preparedSheets);
    else await renderNupPrintSheets(source,scale,pagesPerSheet,root);
    const layout=printSheetLayout(pagesPerSheet);
    let pageStyle=$('dynamic-print-page-style');
    if(!pageStyle){
      pageStyle=document.createElement('style');
      pageStyle.id='dynamic-print-page-style';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent=layout.landscape
      ?'@page { size: 297mm 210mm; margin: 0; }'
      :'@page { size: 210mm 297mm; margin: 0; }';
  }else{
    const article=makePrintArticle(source,scale);
    root.replaceChildren(article);
  }
  document.body.classList.add('printing');
  state.printPrepared=true;
}
function cleanupPrint(){
  document.body.classList.remove('printing');
  $('print-root')?.classList.remove('print-nup-root');
  $('dynamic-print-page-style')?.remove();
  state.printPrepared=false;
}
async function printDocument(title,source){
  const printSource=source||activePrintSource();
  const settings=await showPrintScaleDialog(printSource);
  if(settings===null)return false;
  const oldTitle=document.title;
  if(title)document.title=title;
  state.printScale=settings.scale;
  state.printPagesPerSheet=settings.pagesPerSheet;
  state.printSourceOverride=printSource;
  try{
    await preparePrint(printSource,settings.preparedSheets);
  }catch(error){
    document.title=oldTitle;
    state.printSourceOverride=null;
    state.printScale=100;
    state.printPagesPerSheet=1;
    cleanupPrint();
    showInfoNotice('PDF 준비 실패',error?.message||'인쇄 페이지를 준비하지 못했습니다.');
    return false;
  }
  window.addEventListener('afterprint',()=>{document.title=oldTitle},{once:true});
  window.print();
  return true;
}
window.addEventListener('beforeprint',()=>{if(!state.printPrepared)preparePrint()});
window.addEventListener('afterprint',()=>{state.printSourceOverride=null;state.printScale=100;state.printPagesPerSheet=1;cleanupPrint()});
function runHomeConvert(){if(state.files.length>1){setMode('convert',false);return}const base=(els.homeOutput.value||state.files[state.active]?.name||'converted-document').replace(/\.(pdf|md|markdown)$/i,'')||'converted-document';if(state.lastInput?.type==='pdf'&&state.active>=0){download(`${base}.md`,state.files[state.active].text||els.editor.value);return}if(state.files[state.active]||els.editor.value){printDocument(`${base}.pdf`,els.preview);return}els.fileInput.click()}
function selectedConvertIndexes(){return [...els.convertList.querySelectorAll('input:checked')].map(i=>Number(i.value)).filter(i=>state.files[i])}
function removeSelectedConvert(){const idx=selectedConvertIndexes();if(!requireSelection(idx))return;const set=new Set(idx);state.files=state.files.filter((_,i)=>!set.has(i));state.active=-1;els.editor.value='';renderAll()}
const preparedPdfDocuments=new WeakMap();
async function runSelectedConvert(){
  const idx=selectedConvertIndexes();if(!requireSelection(idx))return;
  const files=idx.map(i=>state.files[i]),mdFiles=files.filter(f=>!f.convertedFromPdf);
  if(mdFiles.length>1){showInfoNotice('PDF 변환','MD → PDF는 한 번에 문서 하나를 선택해 주세요.');return}
  files.filter(f=>f.convertedFromPdf).forEach(f=>download((f.name||'converted.md').replace(/\.pdf$/i,'.md'),f.text||''));
  if(mdFiles.length){
    const file=mdFiles[0];state.active=state.files.indexOf(file);els.editor.value=file.text||'';renderMarkdown(els.editor.value);
    if(await printDocument((file.name||'converted-document').replace(/\.(md|markdown)$/i,'.pdf'),els.preview))preparedPdfDocuments.set(file,file.text);
  }
}
function editSelectedConvert(){const idx=selectedConvertIndexes();if(!requireSelection(idx))return;openFile(idx[0])}
function mergeSelectedConvert(){const idx=selectedConvertIndexes();if(!requireSelection(idx))return;const selected=idx.map(i=>state.files[i]).filter(Boolean);const text=buildMerged(selected);els.mergeResult.innerHTML=markdownHtml(text);addMerged(text);setMode('merge')}
function startSplitResize(e){
  if(els.editSplit.classList.contains('edit-md-only')||els.editSplit.classList.contains('edit-preview-only'))return;
  e.preventDefault();
  const rect=els.editSplit.getBoundingClientRect();
  let frame=0,pendingX=e.clientX;
  const apply=()=>{
    frame=0;
    const left=Math.max(260,Math.min(rect.width-260,pendingX-rect.left));
    els.editSplit.style.gridTemplateColumns=`${left}px 8px minmax(260px,1fr)`;
  };
  function move(ev){
    pendingX=ev.clientX;
    if(!frame)frame=requestAnimationFrame(apply);
  }
  function up(ev){
    pendingX=ev.clientX;
    if(frame)cancelAnimationFrame(frame);
    apply();
    document.removeEventListener('mousemove',move);
    document.removeEventListener('mouseup',up);
  }
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',up);
}
function startSourceResize(e,storageKey){
  if(window.matchMedia('(max-width: 860px)').matches)return;
  e.preventDefault();
  const grid=e.currentTarget.parentElement;
  if(grid.classList.contains('source-collapsed'))return;
  const rect=grid.getBoundingClientRect();
  grid.classList.add('source-resizing');
  e.currentTarget.classList.add('dragging');
  let lastLeft=grid.querySelector('.source-pane')?.getBoundingClientRect().width||Math.round(rect.width*.32);
  let frame=0,pendingX=e.clientX;
  const apply=()=>{
    frame=0;
    lastLeft=Math.max(220,Math.min(rect.width-368,pendingX-rect.left));
    grid.style.gridTemplateColumns=`${lastLeft}px 8px minmax(360px,1fr)`;
  };
  function move(ev){
    pendingX=ev.clientX;
    if(!frame)frame=requestAnimationFrame(apply);
  }
  function up(ev){
    pendingX=ev.clientX;
    if(frame)cancelAnimationFrame(frame);
    apply();
    document.removeEventListener('mousemove',move);
    document.removeEventListener('mouseup',up);
    grid.classList.remove('source-resizing');
    e.currentTarget.classList.remove('dragging');
    localStorage.setItem(storageKey,String(Math.round(lastLeft)));
  }
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',up);
}
function setupSourcePane(gridId,toggleId,storagePrefix){
  const grid=$(gridId),toggle=$(toggleId);
  if(!grid||!toggle)return;
  const mobile=window.matchMedia('(max-width: 860px)');
  const widthKey=`${storagePrefix}-width`;
  const collapsedKey=`${storagePrefix}-collapsed`;
  let collapsed=false;
  localStorage.removeItem(collapsedKey);
  const apply=()=>{
    const visuallyCollapsed=collapsed&&!mobile.matches;
    grid.classList.toggle('source-collapsed',visuallyCollapsed);
    toggle.textContent='';
    toggle.setAttribute('aria-expanded',String(!visuallyCollapsed));
    toggle.title=visuallyCollapsed?'파일 목록 펼치기':'파일 목록 접기';
    if(!visuallyCollapsed){
      const savedWidth=Number(localStorage.getItem(widthKey));
      if(savedWidth>=220)grid.style.gridTemplateColumns=`${savedWidth}px 8px minmax(360px,1fr)`;
    }
  };
  toggle.addEventListener('click',()=>{
    if(mobile.matches)return;
    if(!collapsed){
      const currentWidth=grid.querySelector('.source-pane')?.getBoundingClientRect().width;
      if(currentWidth>=220)localStorage.setItem(widthKey,String(Math.round(currentWidth)));
    }
    collapsed=!collapsed;
    apply();
  });
  mobile.addEventListener?.('change',apply);
  apply();
}

['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();els.app.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();els.app.classList.remove('drag')}));
document.addEventListener('dragover',e=>{
  if(![...(e.dataTransfer?.types||[])].includes('Files'))return;
  e.preventDefault();e.dataTransfer.dropEffect='copy';
},true);
document.addEventListener('drop',async e=>{
  if(!e.dataTransfer||(!e.dataTransfer.files.length&&![...e.dataTransfer.items].some(item=>item.kind==='file')))return;
  e.preventDefault();e.stopImmediatePropagation();
  sidebarDragItem=null;clearSidebarDropMark();els.app.classList.remove('drag');
  const target=e.target,pathKey=target.closest('[data-upload-folder]')?.dataset.uploadFolder||'업로드된 파일';
  try{
  const files=await droppedSidebarFiles(e.dataTransfer,els.sidebar.contains(target)?pathKey:'업로드된 파일');
  if(canInsertCodeIntoActiveDocument()&&files.some(file=>codeLanguageFor(file.name))&&els.preview.contains(e.target)){
    const range=document.caretRangeFromPoint?.(e.clientX,e.clientY);
    if(range&&els.preview.contains(range.commonAncestorContainer))state.savedPreviewRange=range.cloneRange();
  }
  if(els.sidebar.contains(target))await uploadIntoSidebar(files,pathKey);else{await addFiles(files);renderList();scheduleWorkspaceSave()}
  }catch(error){console.error('File drop failed',error);showInfoNotice('드래그 업로드 실패',`파일을 읽지 못했습니다. ${error?.message||'파일이 이 컴퓨터에 다운로드되어 있는지 확인해 주세요.'}`)}
},true);
els.sidebar.addEventListener('contextmenu',showSidebarBlankMenu);
els.list.addEventListener('dragover',event=>{
  if(!sidebarDragItem||![...event.dataTransfer.types].includes('application/x-zz-sidebar'))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
  clearSidebarDropMark();const destination=sidebarDropDestination(event);destination.mark.dataset.sidebarDrop=destination.position;
});
els.list.addEventListener('drop',event=>{
  if(!sidebarDragItem||![...event.dataTransfer.types].includes('application/x-zz-sidebar'))return;event.preventDefault();event.stopImmediatePropagation();
  const item=sidebarDragItem;sidebarDragItem=null;const destination=sidebarDropDestination(event);clearSidebarDropMark();moveSidebarItem(item,destination);els.app.classList.remove('drag');
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.sidebar-context-menu').forEach(menu=>menu.remove())});
els.folderInput.onchange=e=>addFiles(e.target.files);
els.fileInput.onchange=e=>addFiles(e.target.files);
els.imageInput.onchange=e=>{if(state.insertingImage){insertImageFiles(e.target.files);state.insertingImage=false}else addFiles(e.target.files)};
$('home-convert-upload').onclick=()=>{state.stayHomeAfterConvert=true;els.fileInput.click()};
$('pdf-drop').onclick=()=>els.pdfInput.click();
els.pdfInput.onchange=e=>addFiles(e.target.files);
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode,false));
document.querySelectorAll('.home [data-mode]').forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  if(b.dataset.mode==='edit'){
    if(b.classList.contains('home-start-button')&&state.files.length){
      if(state.active<0)openFile(0);
      else setMode('edit',false);
      return;
    }
    newDocument();
    scheduleWorkspaceSave();
    return;
  }
  setMode(b.dataset.mode,false);
});
$('home-select-merge').onclick=mergeSelectedFromHome;
function rememberEditorInsertionPoint(){
  state.lastInsertionSurface='editor';
  state.savedPreviewRange=null;
  state.pendingInsertionContext=null;
  state.lastEditorSelection={start:els.editor.selectionStart,end:els.editor.selectionEnd};
}
els.editor.addEventListener('focus',rememberEditorInsertionPoint);
els.editor.addEventListener('mousedown',rememberEditorInsertionPoint);
els.editor.addEventListener('mouseup',rememberEditorInsertionPoint);
els.editor.addEventListener('keyup',rememberEditorInsertionPoint);
els.editor.addEventListener('select',rememberEditorInsertionPoint);
function autoCorrectMd(text){
  // 헬퍼: 앞/뒤 공백 중 하나라도 있으면 trim해서 반환
  const trim=(m,a,inner,b)=>(a||b)?`${m[0]}${m[1]}${inner.trim()}${m[1]}${m[1]}`:m;

  // **bold**: 양쪽 or 한쪽 공백 모두 처리
  text=text.replace(/\*\*([ \t]*)((?:(?!\*\*)[^\n])+?)([ \t]*)\*\*/g,(m,a,inner,b)=>{
    if(!a&&!b)return m;
    const t=inner.trim();
    return t?`**${t}**`:m;
  });
  // *italic*: ** 는 건드리지 않음
  text=text.replace(/(?<!\*)\*([ \t]*)((?:(?!\*)[^\n])+?)([ \t]*)\*(?!\*)/g,(m,a,inner,b)=>{
    if(!a&&!b)return m;
    const t=inner.trim();
    return t?`*${t}*`:m;
  });
  // __bold__
  text=text.replace(/__([ \t]*)((?:(?!__)[^\n])+?)([ \t]*)__/g,(m,a,inner,b)=>{
    if(!a&&!b)return m;
    const t=inner.trim();
    return t?`__${t}__`:m;
  });
  // _italic_
  text=text.replace(/(?<!_)_([ \t]*)((?:(?!_)[^\n])+?)([ \t]*)_(?!_)/g,(m,a,inner,b)=>{
    if(!a&&!b)return m;
    const t=inner.trim();
    return t?`_${t}_`:m;
  });
  // `inline code`
  text=text.replace(/`([ \t]*)([^`\n]+?)([ \t]*)`/g,(m,a,inner,b)=>{
    if(!a&&!b)return m;
    const t=inner.trim();
    return t?`\`${t}\``:m;
  });
  // [링크 ](url) or [ 링크](url)
  text=text.replace(/\[[ \t]+(.*?)[ \t]*\]\(([^)]+)\)/g,(_,label,url)=>`[${label.trim()}](${url})`);
  text=text.replace(/\[[ \t]*(.*?)[ \t]+\]\(([^)]+)\)/g,(_,label,url)=>`[${label.trim()}](${url})`);
  // ## 뒤 공백 2개 이상 → 1개
  text=text.replace(/^(#{1,6}) {2,}/gm,(_,h)=>`${h} `);
  return text;
}
let acEnabled=savedOption('md-option-autocorrect',true);
let colorCorrectEnabled=savedOption('md-option-color-correct',true);
let paragraphBreakEnabled=savedOption('md-option-paragraph-break',true);
let previewMarkdownEnabled=localStorage.getItem('md-preview-markdown')!=='0';
let autoLinkEnabled=localStorage.getItem('md-auto-link')!=='0';
let sourceSyntaxHoverEnabled=localStorage.getItem('md-source-syntax-hover')!=='0';
let sourceSyntaxHoverDelaySeconds=Math.max(1,Math.min(30,Number(localStorage.getItem('md-source-syntax-hover-delay'))||5));
let previewMarkdownTimer=null;
function synchronizeEditorSyncBlocks(){
  const source=els.editor.value;
  const pattern=/(<!--\s*zz:sync\s+id\s*=\s*"([^"]+)"\s*-->\r?\n)([\s\S]*?)(\r?\n<!--\s*\/zz:sync\s*-->)/gi;
  const blocks=[];
  let match;
  while((match=pattern.exec(source))){
    const contentStart=match.index+match[1].length;
    blocks.push({start:match.index,end:match.index+match[0].length,id:match[2].trim().toLowerCase(),content:match[3],contentStart,contentEnd:contentStart+match[3].length,prefix:match[1],suffix:match[4]});
  }
  if(blocks.length<2)return false;
  let caret=els.editor.selectionStart;
  const active=blocks.find(block=>caret>=block.contentStart&&caret<=block.contentEnd);
  if(!active)return false;
  const peers=blocks.filter(block=>block.id===active.id&&block!==active).sort((a,b)=>b.start-a.start);
  if(!peers.length)return false;
  let next=source;
  for(const peer of peers){
    const replacement=peer.prefix+active.content+peer.suffix;
    next=next.slice(0,peer.start)+replacement+next.slice(peer.end);
    if(peer.end<=caret)caret+=replacement.length-(peer.end-peer.start);
  }
  if(next===source)return false;
  els.editor.value=next;
  els.editor.setSelectionRange(caret,caret);
  return true;
}
els.editor.oninput=()=>{
  if(acEnabled){
    const pos=els.editor.selectionStart;
    const lastChar=els.editor.value[pos-1];
    if(['*','_','`',')'].includes(lastChar)){
      const corrected=autoCorrectMd(els.editor.value);
      if(corrected!==els.editor.value){
        const diff=corrected.length-els.editor.value.length;
        els.editor.value=corrected;
        els.editor.setSelectionRange(pos+diff,pos+diff);
      }
    }
  }
  synchronizeEditorSyncBlocks();
  state.lastEditorSelection={start:els.editor.selectionStart,end:els.editor.selectionEnd};
  state.lastInsertionSurface='editor';
  syncActive();pushHistory();
};
els.editor.addEventListener('paste',e=>{
  if(!autoLinkEnabled)return;
  const rawPaste=e.clipboardData?.getData('text/plain')||'';
  if(/[<>]/.test(rawPaste))return;
  const pasted=normalizedLinkUrl(rawPaste);
  if(!pasted||/\s/.test(pasted))return;
  e.preventDefault();
  const start=els.editor.selectionStart,end=els.editor.selectionEnd;
  const selected=els.editor.value.slice(start,end).trim();
  const label=(selected||pasted).replace(/]/g,'\\]');
  const url=pasted.replace(/\)/g,'\\)');
  replaceRange(`[${label}](${url})`,start,end,true);
});
function insertMarkdownHardBreak(){
  const end=els.editor.selectionEnd;
  let start=els.editor.selectionStart;
  const lineStart=els.editor.value.lastIndexOf('\n',Math.max(0,start-1))+1;
  while(start>lineStart&&els.editor.value[start-1]===' ')start--;
  els.editor.setRangeText('  \n',start,end,'end');
  syncActive();
  pushHistory(true);
}
els.editor.addEventListener('beforeinput',e=>{
  if(!paragraphBreakEnabled||!['insertLineBreak','insertParagraph'].includes(e.inputType))return;
  e.preventDefault();
  insertMarkdownHardBreak();
});
els.editor.addEventListener('keydown',e=>{
  if(paragraphBreakEnabled&&e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    e.preventDefault();
    insertMarkdownHardBreak();
    return;
  }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoEdit():undoEdit()}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redoEdit()}
});
$('run-merge').onclick=mergeSelected;
$('home-run-merge').onclick=mergeAllFromHome;
$('find-replace-toggle').onclick=showFindReplaceDialog;
function updateMergeToggleAll(){const btn=$('merge-toggle-all');if(!btn)return;const inputs=[...els.mergeList.querySelectorAll('input')];btn.textContent=inputs.length&&inputs.every(i=>i.checked)?'전체 해제':'전체 선택'}
$('merge-toggle-all').onclick=()=>{const inputs=[...els.mergeList.querySelectorAll('input')];const shouldCheck=!(inputs.length&&inputs.every(i=>i.checked));inputs.forEach(i=>i.checked=shouldCheck);updateMergeToggleAll();updateMergePreview()};
$('convert-select-all').onclick=()=>{els.convertList.querySelectorAll('input').forEach(i=>i.checked=true);updateConvertPreview()};
$('convert-clear-all').onclick=()=>{els.convertList.querySelectorAll('input').forEach(i=>i.checked=false);updateConvertPreview()};
$('convert-remove-selected').onclick=removeSelectedConvert;
$('convert-run-selected').onclick=runSelectedConvert;
$('convert-edit-selected').onclick=editSelectedConvert;
$('convert-merge-selected').onclick=mergeSelectedConvert;
function explicitColorHost(element){
  if(!element||element.nodeType!==1)return null;
  if((element.matches('span')&&element.style.color)||element.matches('font[color]'))return element;
  const colored=[...element.querySelectorAll('span[style],font[color]')].filter(node=>node.matches('font[color]')||node.style.color);
  return colored[colored.length-1]||null;
}
function previousColorHostAtCaret(range){
  if(!range?.collapsed)return null;
  const container=range.startContainer;
  let previous=null;
  if(container.nodeType===3){
    if(range.startOffset!==0)return null;
    previous=container.previousSibling;
  }else{
    previous=container.childNodes[range.startOffset-1]||null;
  }
  while(previous?.nodeType===3&&!previous.textContent)previous=previous.previousSibling;
  return explicitColorHost(previous);
}
function inheritPreviewColorBeforeInput(e){
  if(!['insertText','insertCompositionText','insertReplacementText'].includes(e.inputType))return;
  const selection=window.getSelection();
  if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0);
  if(!range.collapsed||!els.preview.contains(range.commonAncestorContainer))return;
  const origin=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  if(origin?.closest?.('pre,code,.code-head')||origin?.closest?.('span[style*="color"],font[color]'))return;
  const colorHost=previousColorHostAtCaret(range);
  if(!colorHost||!els.preview.contains(colorHost))return;
  if(origin?.closest('td,th')!==colorHost.closest('td,th'))return;
  if(origin?.closest('p,li,h1,h2,h3,h4,h5,h6')!==colorHost.closest('p,li,h1,h2,h3,h4,h5,h6'))return;
  const next=document.createRange();
  next.selectNodeContents(colorHost);
  next.collapse(false);
  selection.removeAllRanges();
  selection.addRange(next);
  state.savedPreviewRange=next.cloneRange();
}
function previewCodeAtSelection(){
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  const node=range&&(range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement);
  return node?.closest?.('pre code')||activePreviewCodePre?.querySelector('code')||null;
}
els.preview.addEventListener('beforeinput',inheritPreviewColorBeforeInput);
els.preview.addEventListener('beforeinput',e=>{
  if(!['insertParagraph','insertLineBreak'].includes(e.inputType))return;
  const selection=window.getSelection();if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0),node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const cell=node?.closest('td,th');
  if(!cell||!els.preview.contains(cell)||!cell.contains(range.endContainer))return;
  e.preventDefault();
  pushHistory(true);range.deleteContents();
  const br=document.createElement('br');range.insertNode(br);
  const tail=document.createTextNode('\u200b');br.after(tail);
  range.setStart(tail,0);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
  rememberPreviewRange();syncFromPreview();pushHistory(true);
});
els.preview.addEventListener('click',e=>{
  const cell=e.target.closest('td,th');
  if(!cell||e.ctrlKey||e.metaKey||e.shiftKey||e.target.closest('a,button,input,select,textarea,.block-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle'))return;
  const selection=window.getSelection();if(selection&&!selection.isCollapsed)return;
  const current=selection?.rangeCount?selection.getRangeAt(0):null;
  if(current&&cell.contains(current.startContainer))return;
  const point=document.caretRangeFromPoint?.(e.clientX,e.clientY);
  const next=point&&cell.contains(point.startContainer)?point:document.createRange();
  if(next!==point){next.selectNodeContents(cell);next.collapse(false)}
  els.preview.focus({preventScroll:true});selection.removeAllRanges();selection.addRange(next);rememberPreviewRange();
});
els.preview.addEventListener('beforeinput',e=>{preservePreviewFormatOnDelete(e)});
els.preview.addEventListener('beforeinput',()=>{
  if(activeSourceChipEdit)keepSourceChipCaretInside();
},true);
els.preview.addEventListener('beforeinput',e=>{
  if(!e.target.closest?.('.zz-doc-embed'))return;
  e.preventDefault();
  e.stopImmediatePropagation();
},true);
function pastedSyncSyntax(raw){
  let text=String(raw||'').replace(/^\uFEFF/,'').trim();
  const fenced=text.match(/^```(?:md|markdown|html)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  if(fenced)text=fenced[1].trim();
  text=text.replace(/&lt;!--/gi,'<!--').replace(/--&gt;/gi,'-->').replace(/&quot;/gi,'"').replace(/&#0*39;|&apos;/gi,"'").replace(/&amp;/gi,'&');
  const match=text.match(/^<!--\s*zz:sync\s+id\s*=\s*(?:["']([^"']+)["']|([^\s>]+))\s*-->\s*([\s\S]*?)\s*<!--\s*\/zz:sync\s*-->$/i);
  return match?{id:(match[1]||match[2]||'sync').trim(),content:(match[3]||'').trim()}:null;
}
function insertPastedSyncBlock(id,content){
  const range=previewRange();
  const anchor=range?previewTopLevelAnchor(range):null;
  const holder=document.createElement('template');
  holder.innerHTML=renderZzSync(id,content);
  const block=holder.content.firstElementChild;
  if(!block)return false;
  const exit=document.createElement('p');exit.innerHTML='<br>';
  pushHistory(true);
  if(anchor?.parentNode===els.preview){
    const replaceEmpty=anchor.matches('p,div')&&!anchor.textContent.replace(/[\u200b\u00a0]/g,'').trim()&&!anchor.querySelector('img,table,hr');
    if(replaceEmpty)anchor.replaceWith(block,exit);
    else anchor.after(block,exit);
  }else els.preview.append(block,exit);
  addMovableElements(els.preview);
  syncFromPreview();
  pushHistory(true);
  activatePreviewExitTarget(exit,false);
  return true;
}
els.preview.addEventListener('paste',e=>{
  const sync=pastedSyncSyntax(e.clipboardData?.getData('text/plain'));
  if(!sync)return;
  e.preventDefault();
  e.stopImmediatePropagation();
  insertPastedSyncBlock(sync.id,sync.content);
},true);
function isChatGptCitationLink(link){
  const href=link?.getAttribute?.('href')||'';
  try{
    const url=new URL(href,location.href);
    if((url.searchParams.get('utm_source')||'').toLowerCase()==='chatgpt.com')return true;
  }catch{}
  return link?.matches?.('[data-citation],[data-source],[class*="citation" i],[class*="source" i]')||false;
}
els.preview.addEventListener('paste',e=>{
  const clipboardHtml=e.clipboardData?.getData('text/html')||'';
  if(!clipboardHtml||!/<a\b/i.test(clipboardHtml))return;
  const holder=document.createElement('div');holder.innerHTML=clipboardHtml;
  holder.querySelectorAll('script,style,meta,link').forEach(node=>node.remove());
  const markerWalker=document.createTreeWalker(holder,NodeFilter.SHOW_TEXT);
  const markerNodes=[];while(markerWalker.nextNode())markerNodes.push(markerWalker.currentNode);
  markerNodes.forEach(node=>{node.data=node.data.replace(/\b(?:StartFragment|EndFragment)\b/gi,'')});
  [...holder.childNodes].filter(node=>node.nodeType===Node.COMMENT_NODE).forEach(node=>node.remove());
  const links=[...holder.querySelectorAll('a[href]')].filter(isChatGptCitationLink);
  if(!links.length)return;
  links.forEach(link=>{
    const label=(link.textContent||link.getAttribute('href')||'출처').trim();
    link.className='zz-source-chip';
    link.removeAttribute('style');
    link.querySelectorAll('*').forEach(child=>child.removeAttribute('style'));
    link.innerHTML=`<span class="zz-source-chip-label">${htmlEsc(label)}</span>`;
    const previous=link.previousSibling,next=link.nextSibling;
    if(previous?.nodeType===Node.TEXT_NODE&&next?.nodeType===Node.TEXT_NODE&&/\(\s*$/.test(previous.data)&&/^\s*\)/.test(next.data)){
      previous.data=previous.data.replace(/\(\s*$/,'');
      next.data=next.data.replace(/^\s*\)/,'');
    }
  });
  holder.querySelectorAll('*').forEach(node=>{
    [...node.attributes].forEach(attribute=>{if(/^on/i.test(attribute.name))node.removeAttribute(attribute.name)});
  });
  e.preventDefault();
  e.stopImmediatePropagation();
  insertPreviewHtml(holder.innerHTML);
},true);
els.preview.addEventListener('paste',e=>{
  if(!autoLinkEnabled)return;
  const rawPaste=e.clipboardData?.getData('text/plain')||'';
  if(/[<>]/.test(rawPaste))return;
  const pasted=normalizedLinkUrl(rawPaste);
  if(!pasted||/\s/.test(pasted))return;
  const range=previewRange();
  const origin=range&&(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement);
  if(!range||origin?.closest?.('a,pre,code'))return;
  e.preventDefault();
  e.stopPropagation();
  const text=range.toString().trim()||pasted;
  state.savedPreviewRange=range.cloneRange();
  insertPreviewHtml(`<a href="${htmlEsc(pasted)}">${htmlEsc(text)}</a>`);
});
els.preview.addEventListener('input',e=>{
  if(e.target.closest?.('.zz-source-chip-editing')){
    rememberPreviewRange();
    return;
  }
  trackPreviewEnterSplitInput();
  const uniqueTitle=e.target.closest?.('[data-unique-title]');
  if(uniqueTitle){
    rememberPreviewRange();
    scheduleSyncFromPreview();
    return;
  }
  normalizePreviewCodeCaret();
  const editedCode=previewCodeAtSelection();
  rememberPreviewRange();
  scheduleSyncFromPreview();
  if(editedCode&&!e.isComposing)scheduleEditableCodeHighlight(editedCode);
  schedulePreviewMarkdownApply(e.target);
});
els.preview.addEventListener('compositionend',e=>{
  if(e.target.closest?.('.zz-source-chip-editing'))return;
  scheduleEditableCodeHighlight(previewCodeAtSelection());
  schedulePreviewMarkdownApply(e.target);
});
els.preview.addEventListener('mouseup',()=>{rememberPreviewRange();updatePreviewFontSize();updateFormatButtons()});
els.preview.addEventListener('keyup',()=>{rememberPreviewRange();updatePreviewFontSize();updateFormatButtons()});
els.preview.addEventListener('mousedown',trackActivePreviewCode);
els.preview.addEventListener('mousedown',trackActivePreviewLens);
els.preview.addEventListener('mousedown',trackActivePreviewStructuredBlock,true);
els.preview.addEventListener('mousedown',exitStructuredBlockOnPreviewMargin);
els.preview.addEventListener('mousedown',exitLensOnOutsideClick);
els.preview.addEventListener('mousedown',rememberPreviewPoint);
els.preview.addEventListener('mousedown',exitCodeOnBlankPreviewClick);
els.preview.addEventListener('click',trackActivePreviewCode);
els.preview.addEventListener('click',trackActivePreviewLens);
els.preview.addEventListener('click',trackActivePreviewStructuredBlock,true);
els.preview.addEventListener('click',exitStructuredBlockOnPreviewMargin);
els.preview.addEventListener('click',exitLensOnOutsideClick);
els.preview.addEventListener('click',exitCodeOnBlankPreviewClick);
els.preview.addEventListener('click',rememberPreviewPoint);
document.addEventListener('mousedown',exitLensOnOutsideClick);
els.preview.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){
    e.preventDefault();
    const range=document.createRange();
    range.selectNodeContents(els.preview);
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    state.savedPreviewRange=range.cloneRange();
    updatePreviewFontSize();
    updatePreviewFormatButtons(range);
    return;
  }
  if(preservePreviewFormatOnDelete(e))return;
  if(insertPlainPreviewParagraph(e))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoEdit():undoEdit()}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redoEdit()}
});
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||state.mode!=='edit'||!(e.ctrlKey||e.metaKey))return;
  if(e.target!==els.editor&&!els.preview.contains(e.target)&&e.target.closest?.('input,textarea,[contenteditable="true"],[role="dialog"],.modal-backdrop'))return;
  const key=e.key.toLowerCase();
  if(key==='z'){e.preventDefault();e.shiftKey?redoEdit():undoEdit()}
  else if(key==='y'){e.preventDefault();redoEdit()}
});
$('view-pdf-to-md').onclick=()=>els.pdfInput.click();
$('view-md-to-pdf').onclick=runSelectedConvert;
$('view-both').onclick=()=>setEditView('both');
$('view-md-only').onclick=()=>setEditView('md');
$('view-preview-only').onclick=()=>setEditView('preview');
setEditView(localStorage.getItem(EDIT_VIEW_STORAGE_KEY)||'both',{persist:false});

// ── 툴바 클릭 시 에디터 선택 유지 (capture=true → color mousedown보다 먼저 실행) ──
document.getElementById('format-tools').addEventListener('mousedown',e=>{
  const sel=window.getSelection();
  if(sel&&sel.rangeCount){
    const range=sel.getRangeAt(0);
    if(els.preview.contains(range.commonAncestorContainer)){
      state.lastInsertionSurface='preview';
      state.savedPreviewRange=range.cloneRange();
      state.pendingInsertionContext={kind:'preview',range:range.cloneRange(),anchor:previewTopLevelAnchor(range),text:range.toString()};
      state.savedSelection=null;
      if(e.target.closest('button'))e.preventDefault();
      return;
    }
  }
  if(state.savedPreviewRange&&e.target.closest('button'))e.preventDefault();
  if(document.activeElement===els.editor||els.editor.selectionStart!==els.editor.selectionEnd){
    state.lastInsertionSurface='editor';
    state.savedSelection={start:els.editor.selectionStart,end:els.editor.selectionEnd};
    state.lastEditorSelection={...state.savedSelection};
    state.pendingInsertionContext={kind:'editor',...state.savedSelection,text:els.editor.value.slice(state.savedSelection.start,state.savedSelection.end)};
    state.savedPreviewRange=null;
  }
},true);

// ── 스크롤 동기화 ──
let syncScrollEnabled=savedOption('md-option-sync-scroll',false);
let syncScrollLock=false;
function onEditorScroll(){
  if(!syncScrollEnabled||syncScrollLock)return;
  const editor=els.editor,preview=els.preview;
  const ratio=editor.scrollTop/(editor.scrollHeight-editor.clientHeight||1);
  syncScrollLock=true;
  preview.scrollTop=ratio*(preview.scrollHeight-preview.clientHeight);
  requestAnimationFrame(()=>{syncScrollLock=false});
}
function onPreviewScroll(){
  if(!syncScrollEnabled||syncScrollLock)return;
  const editor=els.editor,preview=els.preview;
  const ratio=preview.scrollTop/(preview.scrollHeight-preview.clientHeight||1);
  syncScrollLock=true;
  editor.scrollTop=ratio*(editor.scrollHeight-editor.clientHeight);
  requestAnimationFrame(()=>{syncScrollLock=false});
}
els.editor.addEventListener('scroll',onEditorScroll);
els.editor.addEventListener('scroll',()=>{if(els.lineGutter)els.lineGutter.scrollTop=els.editor.scrollTop});
els.editor.addEventListener('scroll',syncMarkdownHighlightScroll);
els.preview.addEventListener('scroll',onPreviewScroll);
els.preview.addEventListener('scroll',()=>{if(els.previewLineGutter)els.previewLineGutter.scrollTop=els.preview.scrollTop});
els.preview.addEventListener('load',schedulePreviewLineNumbers,true);
if(window.ResizeObserver)new ResizeObserver(schedulePreviewLineNumbers).observe(els.preview);
window.addEventListener('resize',schedulePreviewLineNumbers);
els.convertPreview.addEventListener('click',()=>{if(!state.files.length)els.fileInput.click()});
$('home-convert-run').onclick=runHomeConvert;
$('split-resizer').addEventListener('mousedown',startSplitResize);
$('convert-resizer').addEventListener('mousedown',e=>startSourceResize(e,'md-convert-source-width'));
$('merge-resizer').addEventListener('mousedown',e=>startSourceResize(e,'md-merge-source-width'));
setupSourcePane('convert-grid','convert-source-toggle','md-convert-source');
setupSourcePane('merge-grid','merge-source-toggle','md-merge-source');
function showHeadingMenu(){
  const menu=$('fmt-heading-menu'),combo=$('fmt-heading-combo'),toggle=$('fmt-heading-toggle'),r=combo.getBoundingClientRect();
  menu.classList.remove('hidden');toggle.setAttribute('aria-expanded','true');
  const width=menu.getBoundingClientRect().width||86;
  menu.style.top=(r.bottom+4)+'px';menu.style.left=Math.max(8,Math.min(r.left,window.innerWidth-width-8))+'px';
}
function hideHeadingMenu(){$('fmt-heading-menu').classList.add('hidden');$('fmt-heading-toggle').setAttribute('aria-expanded','false')}
$('fmt-heading-toggle').onmousedown=e=>e.preventDefault();
$('fmt-heading-toggle').onclick=e=>{e.stopPropagation();$('fmt-heading-menu').classList.contains('hidden')?showHeadingMenu():hideHeadingMenu()};
$('fmt-heading-menu').addEventListener('click',e=>{const button=e.target.closest('[data-heading]');if(!button)return;applyHeading(button.dataset.heading);hideHeadingMenu()});
function applyFontSizeInput(){
  const input=$('fmt-size');
  const size=Math.max(6,Math.min(96,Number(input.value)||0));
  if(!size)return;
  input.value=size;
  if(!stylePreviewSelection('font-size',`${size}px`))styleSpan('font-size',`${size}px`);
}
function stepWholePreviewFontSize(range,delta){
  if(!rangeSelectsWholePreview(range))return false;
  const direct=[...els.preview.children].filter(node=>
    !node.matches('.line-gutter,.preview-arrival-marker')&&
    (node.textContent.trim()||node.matches('table,pre,blockquote'))
  );
  const explicit=[...els.preview.querySelectorAll('[style]')].filter(node=>
    node.style.fontSize&&
    !node.matches('.line-gutter,.preview-arrival-marker')&&
    !direct.includes(node)
  );
  const targets=[...direct,...explicit];
  if(!targets.length)return false;
  const sizes=new Map(targets.map(node=>[node,parseFloat(getComputedStyle(node).fontSize)]));
  pushHistory(true);
  targets.forEach(node=>{
    const current=sizes.get(node);
    if(Number.isFinite(current))node.style.fontSize=`${Math.max(6,Math.min(96,current+delta))}px`;
  });
  const next=document.createRange();
  next.selectNodeContents(els.preview);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(next);
  state.savedPreviewRange=next.cloneRange();
  syncFromPreview();
  pushHistory(true);
  updatePreviewFontSize();
  return true;
}
function stepFontSize(delta){
  const range=previewRange();
  if(range&&stepWholePreviewFontSize(range,delta))return;
  const input=$('fmt-size');
  const current=Number(input.value)||14;
  input.value=Math.max(6,Math.min(96,current+delta));
  applyFontSizeInput();
}
function showFontSizeMenu(){
  const menu=$('fmt-size-menu'), combo=$('fmt-size-combo');
  const r=combo.getBoundingClientRect();
  menu.classList.remove('hidden');
  const w=menu.getBoundingClientRect().width||70;
  menu.style.top=(r.bottom+4)+'px';
  menu.style.left=Math.max(8,Math.min(r.left,window.innerWidth-w-8))+'px';
}
function hideFontSizeMenu(){$('fmt-size-menu').classList.add('hidden')}
$('fmt-size').addEventListener('change',applyFontSizeInput);
$('fmt-size').addEventListener('focus',showFontSizeMenu);
$('fmt-size').addEventListener('click',e=>{e.stopPropagation();showFontSizeMenu()});
$('fmt-size').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyFontSizeInput();hideFontSizeMenu()}});
$('fmt-size-toggle').onclick=e=>{e.stopPropagation();$('fmt-size-menu').classList.contains('hidden')?showFontSizeMenu():hideFontSizeMenu()};
$('fmt-size-up').onclick=()=>stepFontSize(1);
$('fmt-size-down').onclick=()=>stepFontSize(-1);
$('fmt-size-menu').addEventListener('click',e=>{
  const btn=e.target.closest('[data-size]');
  if(!btn)return;
  $('fmt-size').value=btn.dataset.size;
  hideFontSizeMenu();
  applyFontSizeInput();
});
document.addEventListener('click',e=>{
  if(!$('fmt-size-combo').contains(e.target))hideFontSizeMenu();
  if(!$('fmt-heading-combo').contains(e.target))hideHeadingMenu();
});
$('fmt-undo').onclick=undoEdit;$('fmt-redo').onclick=redoEdit;
function toggleWrap(before,after=before){
  let sel=placeholderSelection(selectionText());
  const text=sel.text,val=els.editor.value,s=sel.start,e=sel.end;
  const core=text.trimEnd(),trail=text.slice(core.length);
  if(core.startsWith(before)&&core.endsWith(after)&&core.length>before.length+after.length){
    replaceRange(core.slice(before.length,core.length-after.length)+trail,s,e,true);return;
  }
  const preStart=s-before.length,postEnd=e+after.length;
  if(preStart>=0&&postEnd<=val.length&&val.slice(preStart,s)===before&&val.slice(e,postEnd)===after){
    replaceRange(text,preStart,postEnd,true);return;
  }
  replaceRange(`${before}${core}${after}${trail}`,s,e,true);
  if(sel.placeholder)els.editor.setSelectionRange(s+before.length,s+before.length+core.length);
}
function toggleEmphasis(kind){
  let sel=placeholderSelection(selectionText());
  const text=sel.text,val=els.editor.value,s=sel.start,e=sel.end;
  const core=text.trimEnd(),trail=text.slice(core.length);
  const isBold=kind==='bold';
  const triple=core.startsWith('***')&&core.endsWith('***')&&core.length>6;
  const bold=core.startsWith('**')&&core.endsWith('**')&&core.length>4&&!triple;
  const italic=core.startsWith('*')&&core.endsWith('*')&&core.length>2&&!bold&&!triple;
  if(triple){
    const inner=core.slice(3,-3);
    replaceRange((isBold?`*${inner}*`:`**${inner}**`)+trail,s,e,true);
    return;
  }
  if(isBold&&bold){replaceRange(core.slice(2,-2)+trail,s,e,true);return}
  if(!isBold&&italic){replaceRange(core.slice(1,-1)+trail,s,e,true);return}
  if(s>=3&&e+3<=val.length&&val.slice(s-3,s)==='***'&&val.slice(e,e+3)==='***'){
    replaceRange(isBold?`*${text}*`:`**${text}**`,s-3,e+3,true);
    return;
  }
  if(isBold&&s>=2&&e+2<=val.length&&val.slice(s-2,s)==='**'&&val.slice(e,e+2)==='**'){
    replaceRange(text,s-2,e+2,true);
    return;
  }
  if(!isBold&&s>=1&&e+1<=val.length&&val.slice(s-1,s)==='*'&&val.slice(e,e+1)==='*'&&val.slice(s-2,s)!=='**'&&val.slice(e,e+2)!=='**'){
    replaceRange(text,s-1,e+1,true);
    return;
  }
  if(isBold&&italic){
    const inner=core.slice(1,-1);
    replaceRange(`***${inner}***${trail}`,s,e,true);
    return;
  }
  if(!isBold&&bold){
    const inner=core.slice(2,-2);
    replaceRange(`***${inner}***${trail}`,s,e,true);
    return;
  }
  const mark=isBold?'**':'*';
  replaceRange(`${mark}${core}${mark}${trail}`,s,e,true);
  if(sel.placeholder)els.editor.setSelectionRange(s+mark.length,s+mark.length+core.length);
}
function rememberPreviewRange(){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount)return;
  const range=sel.getRangeAt(0);
  if(els.preview.contains(range.commonAncestorContainer)){
    state.lastInsertionSurface='preview';
    state.savedPreviewRange=range.cloneRange();
  }
}
function previewSelectionFontSizes(range){
  const sizes=[];
  const add=node=>{
    const el=node?.nodeType===1?node:node?.parentElement;
    if(!el||el.closest('.code-head'))return;
    const size=parseFloat(getComputedStyle(el).fontSize);
    if(Number.isFinite(size))sizes.push(size);
  };
  if(range.collapsed){
    add(range.startContainer);
    return sizes;
  }
  const walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    if(!node.textContent||!range.intersectsNode(node))continue;
    let start=0,end=node.textContent.length;
    if(node===range.startContainer)start=range.startOffset;
    if(node===range.endContainer)end=range.endOffset;
    if(end>start&&node.textContent.slice(start,end).trim())add(node);
  }
  return sizes;
}
function updatePreviewFontSize(){
  if($('fmt-size-combo').contains(document.activeElement))return;
  const selection=window.getSelection();
  if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0);
  if(!els.preview.contains(range.commonAncestorContainer))return;
  const sizes=previewSelectionFontSizes(range);
  if(!sizes.length)return;
  const first=sizes[0];
  const input=$('fmt-size');
  if(sizes.some(size=>Math.abs(size-first)>.1)){
    input.value='';
    input.placeholder='혼합';
    input.title='선택한 글씨 크기가 서로 다릅니다.';
    return;
  }
  const shown=String(Math.round(first));
  input.value=shown;
  input.placeholder='크기';
  input.title=`선택 글씨 크기: ${shown}px`;
}
function rememberPreviewPoint(e){
  if(!els.preview.contains(e.target))return;
  requestAnimationFrame(()=>{rememberPreviewRange();updatePreviewFontSize()});
}
function previewRange(){
  const selection=window.getSelection();
  if(selection?.rangeCount){
    const live=selection.getRangeAt(0);
    if(els.preview.contains(live.commonAncestorContainer)){
      state.savedPreviewRange=live.cloneRange();
      return live.cloneRange();
    }
  }
  const range=state.savedPreviewRange;
  if(range&&els.preview.contains(range.commonAncestorContainer))return range.cloneRange();
  rememberPreviewRange();
  const next=state.savedPreviewRange;
  return next&&els.preview.contains(next.commonAncestorContainer)?next.cloneRange():null;
}
function selectedPreviewMath(){
  return clickMoveElement?.matches?.('.zz-math')&&els.preview.contains(clickMoveElement)?clickMoveElement:null;
}
function mathFormatRoot(math){
  let root=math;
  while(root.parentElement&&root.parentElement!==els.preview){
    const parent=root.parentElement;
    const formatWrapper=parent.matches('strong,b,em,i,u,span[style],div[style]');
    if(!formatWrapper||parent.childNodes.length!==1)break;
    root=parent;
  }
  return root;
}
function mathMovementElement(element){
  return element?.matches?.('.zz-math')?mathFormatRoot(element):element;
}
function selectMathNode(math){
  if(!math||!els.preview.contains(math))return;
  const range=document.createRange();
  range.selectNode(math);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  state.savedPreviewRange=range.cloneRange();
  updatePreviewFontSize();
  updatePreviewFormatButtons(range);
}
function finishMathFormat(math){
  const mathIndex=[...els.preview.querySelectorAll('.zz-math')].indexOf(math);
  syncFromPreview();
  pushHistory(true);
  const refreshedMath=els.preview.querySelectorAll('.zz-math')[mathIndex];
  if(refreshedMath){
    clickMoveElement=refreshedMath;
    refreshedMath.classList.add('move-selected');
    refreshedMath.setAttribute('aria-selected','true');
    selectMathNode(refreshedMath);
  }
  return true;
}
function toggleSelectedMathWrapper(math,tags,tagName){
  pushHistory(true);
  const existing=math.closest(tags);
  if(existing&&els.preview.contains(existing)&&existing.childNodes.length===1){
    existing.replaceWith(...existing.childNodes);
  }else{
    const wrapper=document.createElement(tagName);
    math.before(wrapper);
    wrapper.appendChild(math);
  }
  return finishMathFormat(math);
}
function styleSelectedMath(math,styleName,value){
  pushHistory(true);
  let wrapper=math.parentElement;
  const wrapperTag=math.matches('.zz-math-block')?'div':'span';
  if(wrapper?.tagName.toLowerCase()!==wrapperTag||!wrapper.hasAttribute('style')||wrapper.childNodes.length!==1){
    wrapper=document.createElement(wrapperTag);
    math.before(wrapper);
    wrapper.appendChild(math);
  }
  const property=styleName.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  wrapper.style[property]=value;
  if(!wrapper.getAttribute('style'))wrapper.replaceWith(...wrapper.childNodes);
  return finishMathFormat(math);
}
function alignSelectedMath(math,align){
  pushHistory(true);
  const root=mathFormatRoot(math);
  let wrapper=root.parentElement;
  if(!wrapper?.matches('div[style*="text-align"]')||wrapper.childNodes.length!==1){
    wrapper=document.createElement('div');
    root.before(wrapper);
    wrapper.appendChild(root);
  }
  wrapper.style.textAlign=align;
  return finishMathFormat(math);
}
function applySelectedMathCommand(command,value=null){
  const math=selectedPreviewMath();
  if(!math)return false;
  if(command==='bold')return toggleSelectedMathWrapper(math,'strong,b','strong');
  if(command==='italic')return toggleSelectedMathWrapper(math,'em,i','em');
  if(command==='underline')return toggleSelectedMathWrapper(math,'u','u');
  const align={justifyLeft:'left',justifyCenter:'center',justifyRight:'right'}[command];
  if(align)return alignSelectedMath(math,align);
  if(command==='foreColor')return styleSelectedMath(math,'color',value);
  if(command==='hiliteColor'||command==='backColor')return styleSelectedMath(math,'background-color',value);
  return false;
}
function tableFormatTextParts(){
  if(document.activeElement===els.editor)return null;
  const cells=[...els.preview.querySelectorAll('td.table-cell-selected,th.table-cell-selected')];
  const range=cells.length?null:previewRange();
  if(!cells.length&&(!range||range.collapsed))return null;
  if(!cells.length&&![...els.preview.querySelectorAll('td,th')].some(cell=>range.intersectsNode(cell)))return null;
  const parts=[],walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    if(!node.data||node.parentElement.closest('.block-move-handle,.form-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.code-head,.zz-math'))continue;
    if(cells.length){if(!cells.some(cell=>cell.contains(node)))continue}
    else if(!range.intersectsNode(node))continue;
    const start=range&&node===range.startContainer?range.startOffset:0;
    const end=range&&node===range.endContainer?range.endOffset:node.length;
    if(end>start)parts.push({node,start,end});
  }
  return {parts,cells};
}
function removeInlineStyleProperty(element,styleName){
  element.style.removeProperty(styleName);
  if(styleName==='background-color')element.style.removeProperty('background');
  if(!element.getAttribute('style'))element.removeAttribute('style');
}
function inlineStyleHost(node,styleName,boundary){
  for(let element=node?.nodeType===1?node:node?.parentElement;element&&element!==boundary;element=element.parentElement){
    if(element.matches?.('span,font,mark')&&(element.style.getPropertyValue(styleName)||(styleName==='background-color'&&(element.matches('mark')||element.style.background))))return element;
  }
  return null;
}
function splitInlineStyleHost(host,startNode,startOffset,endNode,endOffset,styleName){
  if(!host?.contains(startNode)||!host.contains(endNode))return null;
  const before=document.createRange(),middle=document.createRange(),after=document.createRange();
  before.setStart(host,0);before.setEnd(startNode,startOffset);
  middle.setStart(startNode,startOffset);middle.setEnd(endNode,endOffset);
  after.setStart(endNode,endOffset);after.setEnd(host,host.childNodes.length);
  const fragment=document.createDocumentFragment(),append=(contents,clear=false)=>{
    if(!contents.childNodes.length||(!contents.textContent&&![...contents.childNodes].some(node=>node.nodeType===1)))return null;
    let clone=host.cloneNode(false);
    if(clear&&styleName==='background-color'&&host.matches('mark')){const span=document.createElement('span');for(const attr of [...clone.attributes])if(attr.name!=='class')span.setAttribute(attr.name,attr.value);clone=span}
    if(clear)removeInlineStyleProperty(clone,styleName);clone.append(contents);fragment.append(clone);return clone;
  };
  append(before.cloneContents());const cleared=append(middle.cloneContents(),true);append(after.cloneContents());host.replaceWith(fragment);return cleared;
}
function clearTableTextBackground(selection){
  if(!selection)return false;
  const {parts,cells}=selection;
  if(cells.length){
    pushHistory(true);cells.forEach(cell=>{removeInlineStyleProperty(cell,'background-color');cell.querySelectorAll('span[style],font[style]').forEach(node=>removeInlineStyleProperty(node,'background-color'));cell.querySelectorAll('mark').forEach(mark=>mark.replaceWith(...mark.childNodes))});
    syncFromPreview();pushHistory(true);return true;
  }
  pushHistory(true);
  const groups=new Map();
  parts.forEach(part=>{const host=inlineStyleHost(part.node,'background-color',part.node.parentElement.closest('td,th'));if(host){const list=groups.get(host)||[];list.push(part);groups.set(host,list)}});
  const selectedCells=[...new Set(parts.map(part=>part.node.parentElement.closest('td,th')).filter(Boolean))];
  selectedCells.forEach(cell=>{const cellParts=parts.filter(part=>cell.contains(part.node)),selected=cellParts.map(part=>part.node.data.slice(part.start,part.end)).join('');if(selected.trim()===cell.textContent.trim())removeInlineStyleProperty(cell,'background-color')});
  if(!groups.size){syncFromPreview();pushHistory(true);return true}
  const cleared=[];
  [...groups].reverse().forEach(([host,list])=>{const first=list[0],last=list.at(-1),node=splitInlineStyleHost(host,first.node,first.start,last.node,last.end,'background-color');if(node)cleared.push(node)});
  if(cleared.length){const next=document.createRange();next.selectNodeContents(cleared.at(-1));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(next);state.savedPreviewRange=next.cloneRange()}
  syncFromPreview();pushHistory(true);return true;
}
function styleTableTextSelection(styleName,value,selection=tableFormatTextParts()){
  if(!selection)return false;
  if(styleName==='background-color'&&(value===''||value==null))return clearTableTextBackground(selection);
  const {parts,cells}=selection;if(!parts.length)return true;
  pushHistory(true);
  const spans=[];
  for(const {node,start,end} of parts){
    // Never extract a range containing td/tr/table: format leaf text in place.
    const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);
    const span=document.createElement('span');
    span.style.setProperty(styleName,value||({color:'inherit','background-color':'transparent','font-weight':'normal','font-style':'normal','text-decoration':'none'}[styleName]||'inherit'));
    span.appendChild(range.extractContents());range.insertNode(span);spans.push(span);
  }
  if(!cells.length){
    const next=document.createRange();next.setStart(spans[0].firstChild,0);next.setEnd(spans.at(-1).lastChild,spans.at(-1).lastChild.length);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(next);state.savedPreviewRange=next.cloneRange();
  }
  syncFromPreview();pushHistory(true);return true;
}
function applyPreviewCommand(command,value=null){
  const tableSelection=tableFormatTextParts();
  const align={justifyLeft:'left',justifyCenter:'center',justifyRight:'right',justifyFull:'justify'}[command];
  if(tableSelection&&(align||command==='formatBlock')){
    const cells=tableSelection.cells.length?tableSelection.cells:[...new Set(tableSelection.parts.map(part=>part.node.parentElement.closest('td,th')).filter(Boolean))];
    pushHistory(true);
    const saved=previewRange();
    for(const cell of cells){
      if(align){cell.style.textAlign=align;cell.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6').forEach(block=>block.style.textAlign=align)}
      else{
        const parts=tableSelection.parts.filter(part=>cell.contains(part.node));if(!parts.length)continue;
        const range=document.createRange();range.setStart(parts[0].node,parts[0].start);range.setEnd(parts.at(-1).node,parts.at(-1).end);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        document.execCommand(command,false,value);
      }
    }
    const selection=window.getSelection();selection.removeAllRanges();
    if(!tableSelection.cells.length&&saved){selection.addRange(saved);state.savedPreviewRange=saved.cloneRange()}
    syncFromPreview();pushHistory(true);return true;
  }
  const inline={bold:['font-weight','700','400'],italic:['font-style','italic','normal'],underline:['text-decoration','underline','none'],strikeThrough:['text-decoration','line-through','none']}[command];
  if(tableSelection&&inline){
    const [prop,on,off]=inline;
    const enabled=tableSelection.parts.length&&tableSelection.parts.every(({node})=>{
      const style=getComputedStyle(node.parentElement);
      return command==='bold'?Number(style.fontWeight)>=600:style.getPropertyValue(prop).includes(on);
    });
    return styleTableTextSelection(prop,enabled?off:on,tableSelection);
  }
  if(applySelectedMathCommand(command,value))return true;
  const range=previewRange();
  if(!range)return false;
  els.preview.focus();
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  pushHistory(true);
  document.execCommand(command,false,value);
  rememberPreviewRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function closestStyleHost(node,range){
  let el=node.nodeType===1?node:node.parentElement;
  while(el&&el!==els.preview){
    if((el.matches('span,font')||el.hasAttribute('style'))&&el.contains(range.startContainer)&&el.contains(range.endContainer))return el;
    el=el.parentElement;
  }
  return null;
}
function applyPreviewStyleToExisting(range,styleName,value){
  const host=closestStyleHost(range.commonAncestorContainer,range)
    || closestStyleHost(range.startContainer,range)
    || closestStyleHost(range.endContainer,range);
  // Reuse an inline wrapper only when all of its text is selected.
  // A styled cell/block or a partially selected span must not expand the range.
  if(!host||!host.matches('span,font')||range.toString()!==host.textContent)return false;
  pushHistory(true);
  const prop=styleName.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  if(value===''||value==null){
    host.style[prop]='';
    if(styleName==='color'&&host.tagName==='FONT')host.removeAttribute('color');
    if(!host.getAttribute('style'))host.removeAttribute('style');
  }else{
    host.style[prop]=value;
    if(styleName==='color'&&host.tagName==='FONT')host.removeAttribute('color');
  }
  const next=document.createRange();
  next.selectNodeContents(host);
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(next);
  state.savedPreviewRange=next.cloneRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function rangeSelectsWholePreview(range){
  if(!range||range.collapsed)return false;
  const full=document.createRange();
  full.selectNodeContents(els.preview);
  return range.compareBoundaryPoints(Range.START_TO_START,full)<=0
    &&range.compareBoundaryPoints(Range.END_TO_END,full)>=0
    ||range.toString().trim()===full.toString().trim();
}
function styleWholePreview(styleName,value){
  const property=styleName.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  const children=[...els.preview.children].filter(node=>!node.matches('.line-gutter,.preview-arrival-marker'));
  if(!children.length)return false;
  pushHistory(true);
  children.forEach(node=>{
    node.style[property]=value||'';
    if(!node.getAttribute('style'))node.removeAttribute('style');
    if(styleName==='background-color'&&(value===''||value==null)){
      node.querySelectorAll('[style]').forEach(child=>removeInlineStyleProperty(child,'background-color'));
      node.querySelectorAll('mark').forEach(mark=>mark.replaceWith(...mark.childNodes));
    }
  });
  const next=document.createRange();
  next.selectNodeContents(els.preview);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(next);
  state.savedPreviewRange=next.cloneRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function clearPreviewInlineStyle(range,styleName){
  const parts=[],walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode()))if(node.data&&range.intersectsNode(node)){const start=node===range.startContainer?range.startOffset:0,end=node===range.endContainer?range.endOffset:node.length;if(end>start)parts.push({node,start,end})}
  const groups=new Map();parts.forEach(part=>{const host=inlineStyleHost(part.node,styleName,els.preview);if(host){const list=groups.get(host)||[];list.push(part);groups.set(host,list)}});
  if(!groups.size)return false;
  pushHistory(true);const cleared=[];
  [...groups].reverse().forEach(([host,list])=>{const first=list[0],last=list.at(-1),element=splitInlineStyleHost(host,first.node,first.start,last.node,last.end,styleName);if(element)cleared.push(element)});
  if(!cleared.length)return false;
  const next=document.createRange();next.selectNodeContents(cleared.at(-1));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(next);state.savedPreviewRange=next.cloneRange();
  syncFromPreview();pushHistory(true);return true;
}
function stylePreviewSelection(styleName,value){
  if(styleTableTextSelection(styleName,value))return true;
  const math=selectedPreviewMath();
  if(math)return styleSelectedMath(math,styleName,value);
  const range=previewRange();
  if(!range)return false;
  const rangeNode=range.commonAncestorContainer.nodeType===Node.ELEMENT_NODE?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  const chipLabel=rangeNode?.closest?.('.zz-source-chip-label');
  if(chipLabel&&els.preview.contains(chipLabel)){
    if(range.collapsed)return true;
    pushHistory(true);
    const span=document.createElement('span');
    span.style[styleName.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    const next=document.createRange();next.selectNodeContents(span);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(next);
    state.savedPreviewRange=next.cloneRange();syncFromPreview();pushHistory(true);return true;
  }
  if(rangeSelectsWholePreview(range))return styleWholePreview(styleName,value);
  if((value===''||value==null)&&!range.collapsed&&clearPreviewInlineStyle(range,styleName))return true;
  if(!range.collapsed&&applyPreviewStyleToExisting(range,styleName,value))return true;
  if(value===''||value==null)return false;
  pushHistory(true);
  const span=document.createElement('span');
  span.style[styleName.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  if(range.collapsed)span.textContent='TEXT';
  else span.appendChild(range.extractContents());
  range.insertNode(span);
  const sel=window.getSelection();
  sel.removeAllRanges();
  const next=document.createRange();
  next.selectNodeContents(span);
  sel.addRange(next);
  state.savedPreviewRange=next.cloneRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
let textContextMenu=null,textContextRange=null,pendingTextContextRange=null,lastTextContextRange=null,copiedTextFormat=null,copiedPreviewText='';
function hideTextContextMenu(){
  if(textContextMenu)textContextMenu.hidden=true;
}
function selectedPreviewTextRange(){
  if(pendingTextContextRange&&!pendingTextContextRange.collapsed&&pendingTextContextRange.toString()&&els.preview.contains(pendingTextContextRange.commonAncestorContainer)){
    const range=pendingTextContextRange.cloneRange();
    pendingTextContextRange=null;
    return range;
  }
  const selection=window.getSelection();
  if(selection?.rangeCount){
    const range=selection.getRangeAt(0);
    if(!range.collapsed&&range.toString()&&els.preview.contains(range.commonAncestorContainer))return range.cloneRange();
  }
  const saved=state.savedPreviewRange;
  if(saved&&!saved.collapsed&&saved.toString()&&els.preview.contains(saved.commonAncestorContainer))return saved.cloneRange();
  return lastTextContextRange&&!lastTextContextRange.collapsed&&lastTextContextRange.toString()&&els.preview.contains(lastTextContextRange.commonAncestorContainer)
    ?lastTextContextRange.cloneRange()
    :null;
}
document.addEventListener('mousedown',e=>{
  if(e.button===0){
    lastTextContextRange=null;
    return;
  }
  if(e.button!==2||!els.preview.contains(e.target))return;
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  pendingTextContextRange=range&&!range.collapsed&&range.toString()&&els.preview.contains(range.commonAncestorContainer)
    ?range.cloneRange()
    :null;
},true);
document.addEventListener('selectionchange',()=>{
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(range&&!range.collapsed&&range.toString()&&els.preview.contains(range.commonAncestorContainer)){
    lastTextContextRange=range.cloneRange();
  }
});
function restoreTextContextRange(){
  const range=textContextRange;
  if(!range||!els.preview.contains(range.commonAncestorContainer))return null;
  clearClickMove();
  selectPreviewImage(null);
  els.preview.focus({preventScroll:true});
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  state.savedPreviewRange=range.cloneRange();
  return range;
}
function previewSelectionClipboardData(range){
  const host=document.createElement('div');
  host.appendChild(range.cloneContents());
  cleanPreviewHtml(host);
  return{html:serializePreviewHtml(host),text:range.toString()};
}
async function writePreviewSelectionClipboard(range){
  const data=previewSelectionClipboardData(range);
  copiedPreviewText=data.text;
  try{
    if(navigator.clipboard?.write&&window.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain':new Blob([data.text],{type:'text/plain'}),
        'text/html':new Blob([data.html],{type:'text/html'})
      })]);
      return true;
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(data.text);
      return true;
    }
  }catch{}
  restoreTextContextRange();
  return document.execCommand('copy');
}
function finishPreviewTextMutation(range){
  const selection=window.getSelection();
  if(selection?.rangeCount)state.savedPreviewRange=selection.getRangeAt(0).cloneRange();
  else state.savedPreviewRange=range?.cloneRange()||null;
  syncFromPreview();
  pushHistory(true);
}
async function cutPreviewSelection(){
  const range=restoreTextContextRange();
  if(!range||!await writePreviewSelectionClipboard(range))return false;
  pushHistory(true);
  range.deleteContents();
  range.collapse(true);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  finishPreviewTextMutation(range);
  return true;
}
async function copyPreviewSelection(){
  const range=restoreTextContextRange();
  return !!range&&writePreviewSelectionClipboard(range);
}
async function pasteIntoPreviewSelection(){
  let text='';
  try{text=await navigator.clipboard?.readText?.()}catch{}
  if(!text)text=copiedPreviewText;
  if(!text){
    showInfoNotice('붙여넣기 실패','클립보드의 텍스트를 읽을 수 없습니다. 브라우저의 클립보드 권한을 확인해 주세요.');
    return false;
  }
  const range=restoreTextContextRange();
  if(!range)return false;
  pushHistory(true);
  range.deleteContents();
  const node=document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  finishPreviewTextMutation(range);
  return true;
}
function explicitPreviewBackground(element){
  for(let node=element;node&&node!==els.preview;node=node.parentElement){
    if(node.style?.backgroundColor||node.style?.background)return getComputedStyle(node).backgroundColor;
  }
  return '';
}
function selectedPreviewFormatDetails(range){
  const walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.data||!range.intersectsNode(node)||node.parentElement?.closest('.block-move-handle,.code-head'))return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  const samples=[];
  let node;
  while((node=walker.nextNode())){
    const element=node.parentElement;
    if(!element)continue;
    const style=getComputedStyle(element);
    const block=closestPreviewBlock(element);
    const weight=Number.parseInt(style.fontWeight,10);
    samples.push({
      blockTag:block&&/^(P|H[1-6])$/.test(block.tagName)?block.tagName.toLowerCase():'',
      textAlign:block?getComputedStyle(block).textAlign:'',
      color:style.color,
      backgroundColor:explicitPreviewBackground(element),
      fontSize:style.fontSize,
      fontWeight:style.fontWeight,
      bold:Number.isFinite(weight)?weight>=600:/^(bold|bolder)$/i.test(style.fontWeight),
      fontStyle:style.fontStyle,
      italic:style.fontStyle!=='normal',
      textDecoration:style.textDecorationLine,
      underline:style.textDecorationLine.split(/\s+/).includes('underline')
    });
  }
  if(!samples.length)return null;
  const uniform=key=>samples.every(sample=>sample[key]===samples[0][key]);
  const first=samples[0];
  return{
    values:first,
    uniform:{
      blockTag:uniform('blockTag'),
      fontSize:uniform('fontSize'),
      color:uniform('color'),
      backgroundColor:uniform('backgroundColor'),
      bold:uniform('bold'),
      italic:uniform('italic'),
      underline:uniform('underline'),
      textAlign:uniform('textAlign')
    },
    options:{
      blockTag:{available:uniform('blockTag')&&!!first.blockTag,value:first.blockTag},
      fontSize:{available:uniform('fontSize')&&!!first.fontSize,value:first.fontSize},
      color:{available:uniform('color')&&!!first.color,value:first.color},
      backgroundColor:{available:uniform('backgroundColor')&&!!first.backgroundColor,value:first.backgroundColor},
      bold:{available:samples.every(sample=>sample.bold),value:first.fontWeight},
      italic:{available:samples.every(sample=>sample.italic),value:first.fontStyle},
      underline:{available:samples.every(sample=>sample.underline),value:first.textDecoration},
      textAlign:{available:uniform('textAlign')&&!!first.textAlign,value:first.textAlign}
    }
  };
}
function formatCopyOptionLabel(key,value){
  const labels={
    blockTag:{p:'본문',h1:'제목 1',h2:'제목 2',h3:'제목 3',h4:'제목 4',h5:'제목 5',h6:'제목 6'},
    textAlign:{left:'왼쪽',start:'왼쪽',center:'가운데',right:'오른쪽',end:'오른쪽',justify:'양쪽'}
  };
  if(key==='blockTag')return labels.blockTag[value]||value;
  if(key==='textAlign')return `${labels.textAlign[value]||value} 정렬`;
  if(key==='bold')return '선택 영역 전체에 적용됨';
  if(key==='italic')return '선택 영역 전체에 적용됨';
  if(key==='underline')return '선택 영역 전체에 적용됨';
  return value||'적용되지 않음';
}
function copyPreviewSelectionFormat(){
  const range=restoreTextContextRange();
  if(!range)return false;
  const details=selectedPreviewFormatDetails(range);
  if(!details)return false;
  const definitions=[
    ['blockTag','서식'],
    ['fontSize','글자 크기'],
    ['color','글자색'],
    ['backgroundColor','배경색'],
    ['bold','굵게'],
    ['italic','기울임'],
    ['underline','밑줄'],
    ['textAlign','정렬']
  ];
  const rows=definitions.map(([key,label])=>{
    const option=details.options[key];
    const inactiveStatus={
      backgroundColor:'전체에 배경색이 없음',
      bold:'전체에 굵게가 적용되지 않음',
      italic:'전체에 기울임이 적용되지 않음',
      underline:'전체에 밑줄이 적용되지 않음'
    };
    const status=option.available?formatCopyOptionLabel(key,option.value):(inactiveStatus[key]||'선택 영역 전체에 동일하지 않음');
    return `<label class="format-copy-option"><input type="checkbox" data-format-field="${key}" ${option.available?'checked':'disabled'}><span><strong>${label}</strong><small>${htmlEsc(status)}</small></span></label>`;
  }).join('');
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop format-copy-dialog';
  wrap.innerHTML=`<div class="modal-card format-copy-card" role="dialog" aria-modal="true" aria-labelledby="format-copy-title">
    <h3 id="format-copy-title">복사할 서식 선택</h3>
    <p>선택 영역 전체에 동일하게 적용된 항목만 복사할 수 있습니다.</p>
    <div class="format-copy-options">${rows}</div>
    <div class="modal-actions"><button class="tool" type="button" data-format-action="cancel">취소</button><button class="tool primary" type="button" data-format-action="copy">서식 복사</button></div>
  </div>`;
  const copyButton=wrap.querySelector('[data-format-action="copy"]');
  const updateCopyButton=()=>{copyButton.disabled=!wrap.querySelector('[data-format-field]:checked')};
  wrap.querySelectorAll('[data-format-field]').forEach(input=>input.addEventListener('change',updateCopyButton));
  const close=()=>wrap.remove();
  wrap.addEventListener('click',event=>{
    if(event.target===wrap||event.target.closest('[data-format-action="cancel"]'))return close();
    if(!event.target.closest('[data-format-action="copy"]'))return;
    const fields=new Set([...wrap.querySelectorAll('[data-format-field]:checked')].map(input=>input.dataset.formatField));
    copiedTextFormat={
      fields:[...fields],
      blockTag:fields.has('blockTag')?details.options.blockTag.value:'',
      textAlign:fields.has('textAlign')?details.options.textAlign.value:'',
      inline:{
        ...(fields.has('fontSize')?{fontSize:details.options.fontSize.value}:{}),
        ...(fields.has('color')?{color:details.options.color.value}:{}),
        ...(fields.has('backgroundColor')?{backgroundColor:details.options.backgroundColor.value}:{}),
        ...(fields.has('bold')?{fontWeight:details.options.bold.value}:{}),
        ...(fields.has('italic')?{fontStyle:details.options.italic.value}:{}),
        ...(fields.has('underline')?{textDecoration:details.options.underline.value}:{})
      }
    };
    close();
  });
  wrap.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
  document.body.appendChild(wrap);
  updateCopyButton();
  wrap.querySelector('[data-format-field]:not(:disabled),button')?.focus();
  return true;
}
function neutralizeFormatTag(element){
  if(element.attributes.length){
    const span=document.createElement('span');
    [...element.attributes].forEach(attribute=>span.setAttribute(attribute.name,attribute.value));
    span.append(...element.childNodes);
    element.replaceWith(span);
  }else{
    element.replaceWith(...element.childNodes);
  }
}
function stripSelectedCopiedTextFormatting(fragment,fields){
  fragment.querySelectorAll('[style]').forEach(element=>{
    if(fields.has('fontSize'))element.style.removeProperty('font-size');
    if(fields.has('color'))element.style.removeProperty('color');
    if(fields.has('backgroundColor')){
      element.style.removeProperty('background');
      element.style.removeProperty('background-color');
    }
    if(fields.has('bold'))element.style.removeProperty('font-weight');
    if(fields.has('italic'))element.style.removeProperty('font-style');
    if(fields.has('underline')){
      element.style.removeProperty('text-decoration');
      element.style.removeProperty('text-decoration-line');
    }
    if(!element.getAttribute('style')?.trim())element.removeAttribute('style');
  });
  if(fields.has('color'))fragment.querySelectorAll('font[color]').forEach(element=>{
    element.removeAttribute('color');
    if(!element.attributes.length)neutralizeFormatTag(element);
  });
  const selectors=[
    ...(fields.has('bold')?['strong','b']:[]),
    ...(fields.has('italic')?['em','i']:[]),
    ...(fields.has('underline')?['u']:[])
  ];
  if(selectors.length)[...fragment.querySelectorAll(selectors.join(','))].reverse().forEach(neutralizeFormatTag);
}
function applyAllPreviewBoldMarkup(root){
  if(!previewMarkdownEnabled||!root)return false;
  let changed=false;
  for(let guard=0;guard<100;guard++){
    const text=previewBlockPlainText(root);
    if(!applyPreviewBoldMarkup(root,text.length))break;
    changed=true;
  }
  return changed;
}
function pastePreviewSelectionFormat(){
  if(!copiedTextFormat)return false;
  let range=restoreTextContextRange();
  if(!range)return false;
  const fields=new Set(copiedTextFormat.fields||['blockTag','fontSize','color','backgroundColor','bold','italic','underline','textAlign']);
  pushHistory(true);
  let selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const fragment=range.extractContents();
  stripSelectedCopiedTextFormatting(fragment,fields);
  const span=document.createElement('span');
  Object.assign(span.style,copiedTextFormat.inline);
  span.appendChild(fragment);
  range.insertNode(span);
  applyAllPreviewBoldMarkup(span);
  const selectInserted=()=>{
    const selected=document.createRange();
    selected.selectNodeContents(span);
    selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(selected);
    return selected;
  };
  let next=selectInserted();
  if(fields.has('blockTag')&&copiedTextFormat.blockTag)document.execCommand('formatBlock',false,copiedTextFormat.blockTag);
  const alignCommand={left:'justifyLeft',center:'justifyCenter',right:'justifyRight',start:'justifyLeft',end:'justifyRight'}[copiedTextFormat.textAlign];
  if(fields.has('textAlign')&&alignCommand)document.execCommand(alignCommand,false,null);
  if(span.isConnected)next=selectInserted();
  finishPreviewTextMutation(next);
  return true;
}
const CUSTOM_FORMAT_STORAGE_KEY='zz-custom-formats-v1';
const CUSTOM_FORMAT_FIELDS=['blockTag','fontSize','color','backgroundColor','bold','italic','underline','textAlign'];
const CUSTOM_FORMAT_FIELD_LABELS={
  blockTag:'서식',fontSize:'글자 크기',color:'글자색',backgroundColor:'배경색',
  bold:'굵게',italic:'기울임',underline:'밑줄',textAlign:'정렬'
};
let customFormatPanel=null;
let customFormatRootCollapsed=false;
function customFormatId(prefix='format'){
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
}
function loadCustomFormats(){
  try{
    const parsed=JSON.parse(localStorage.getItem(CUSTOM_FORMAT_STORAGE_KEY)||'{}');
    return{
      folders:Array.isArray(parsed.folders)?parsed.folders.filter(folder=>folder&&folder.id&&folder.name):[],
      presets:Array.isArray(parsed.presets)?parsed.presets.filter(preset=>preset&&preset.id&&preset.name):[]
    };
  }catch(_){return{folders:[],presets:[]}}
}
function saveCustomFormats(store){
  localStorage.setItem(CUSTOM_FORMAT_STORAGE_KEY,JSON.stringify(store));
}
function customFormatColor(value,fallback){
  if(value==='transparent')return 'transparent';
  if(/^#[0-9a-f]{6}$/i.test(value||''))return value;
  const match=String(value||'').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if(!match)return fallback;
  return `#${match.slice(1,4).map(part=>Math.max(0,Math.min(255,Number(part))).toString(16).padStart(2,'0')).join('')}`;
}
function customFormatSelectionHasStyle(range,property,{block=false}={}){
  const walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.data||!range.intersectsNode(node)||node.parentElement?.closest('.block-move-handle,.code-head'))return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  const results=[];
  let node;
  while((node=walker.nextNode())){
    let element=block?closestPreviewBlock(node.parentElement):node.parentElement;
    let found=false;
    while(element&&element!==els.preview){
      if(element.style?.[property]){found=true;break}
      if(block)break;
      element=element.parentElement;
    }
    results.push(found);
  }
  return !!results.length&&results.every(Boolean);
}
function customFormatSource(){
  const range=previewRange();
  if(!range||range.collapsed||!els.preview.contains(range.commonAncestorContainer)){
    showInfoNotice('텍스트를 선택해 주세요','프리뷰에서 저장하거나 서식을 적용할 텍스트를 먼저 드래그해 주세요.');
    return null;
  }
  state.savedPreviewRange=range.cloneRange();
  const details=selectedPreviewFormatDetails(range);
  if(!details)return null;
  const text=range.toString().replace(/\s+/g,' ').trim()||'미리보기 텍스트';
  return{
    previewText:text.slice(0,120),
    values:{
      blockTag:details.values.blockTag||'p',
      fontSize:Number.parseFloat(details.values.fontSize)||14,
      color:customFormatColor(details.values.color,'#111111'),
      backgroundColor:customFormatColor(details.values.backgroundColor,'transparent'),
      bold:!!details.values.bold,
      italic:!!details.values.italic,
      underline:!!details.values.underline,
      textAlign:details.values.textAlign||'left'
    },
    available:{
      blockTag:!!details.uniform.blockTag&&/^h[1-6]$/.test(details.values.blockTag||''),
      fontSize:!!details.uniform.fontSize&&customFormatSelectionHasStyle(range,'fontSize'),
      color:!!details.uniform.color&&customFormatSelectionHasStyle(range,'color'),
      backgroundColor:!!details.uniform.backgroundColor&&customFormatSelectionHasStyle(range,'backgroundColor'),
      bold:!!details.uniform.bold&&!!details.values.bold,
      italic:!!details.uniform.italic&&!!details.values.italic,
      underline:!!details.uniform.underline&&!!details.values.underline,
      textAlign:!!details.uniform.textAlign&&customFormatSelectionHasStyle(range,'textAlign',{block:true})
    }
  };
}
function customFormatInlineStyle(preset){
  const fields=new Set(preset.fields||[]);
  const styles=[];
  if(fields.has('fontSize')&&preset.fontSize)styles.push(`font-size:${Number(preset.fontSize)}px`);
  if(fields.has('color')&&preset.color)styles.push(`color:${preset.color}`);
  if(fields.has('backgroundColor')&&preset.backgroundColor&&preset.backgroundColor!=='transparent')styles.push(`background-color:${preset.backgroundColor}`);
  if(fields.has('bold'))styles.push(`font-weight:${preset.bold?'700':'400'}`);
  if(fields.has('italic'))styles.push(`font-style:${preset.italic?'italic':'normal'}`);
  if(fields.has('underline'))styles.push(`text-decoration:${preset.underline?'underline':'none'}`);
  if(fields.has('textAlign')&&preset.textAlign)styles.push(`text-align:${preset.textAlign}`);
  return styles.join(';');
}
function positionCustomFormatPanel(){
  if(!customFormatPanel||customFormatPanel.hidden)return;
  const anchor=$('custom-format-toggle').getBoundingClientRect();
  const width=customFormatPanel.offsetWidth||360;
  const height=customFormatPanel.offsetHeight||500;
  const left=Math.max(8,Math.min(window.innerWidth-width-8,anchor.left));
  const roomBelow=window.innerHeight-anchor.bottom-8;
  const top=roomBelow>=Math.min(height,420)?anchor.bottom+6:Math.max(8,anchor.top-height-6);
  customFormatPanel.style.left=`${Math.round(left)}px`;
  customFormatPanel.style.top=`${Math.round(top)}px`;
}
function closeCustomFormatMenus(){
  // Management actions are always visible; retained for older stored panels.
}
function renderCustomFormatPanel(){
  if(!customFormatPanel)return;
  const store=loadCustomFormats();
  const query=(customFormatPanel.querySelector('[data-custom-format-search]')?.value||'').trim().toLocaleLowerCase();
  const list=customFormatPanel.querySelector('.custom-format-list');
  list.innerHTML='';
  const groups=[{id:'',name:'개별 서식',collapsed:customFormatRootCollapsed},...store.folders];
  let visibleCount=0;
  groups.forEach(folder=>{
    const presets=store.presets.filter(preset=>(preset.folderId||'')===folder.id&&(!query||`${preset.name} ${preset.previewText||''}`.toLocaleLowerCase().includes(query)));
    if(query&&!presets.length)return;
    visibleCount+=presets.length;
    const group=document.createElement('section');
    group.className='custom-format-folder';
    group.dataset.folderId=folder.id;
    const head=document.createElement('div');
    head.className='custom-format-folder-head';
    head.innerHTML=`<button class="custom-format-folder-toggle" type="button" data-custom-format-action="toggle-folder" aria-expanded="${String(!folder.collapsed)}"><span class="arrow">${folder.collapsed?'›':'⌄'}</span><span>${htmlEsc(folder.name)}</span><span class="custom-format-folder-count">${presets.length}</span></button>${folder.id?'<span class="custom-format-folder-actions"><button type="button" data-custom-format-action="rename-folder" title="폴더 이름 변경" aria-label="폴더 이름 변경">✎</button><button type="button" data-custom-format-action="delete-folder" title="폴더 삭제" aria-label="폴더 삭제">×</button></span>':''}`;
    group.appendChild(head);
    const items=document.createElement('div');
    items.className='custom-format-items';
    items.hidden=!!folder.collapsed&&!query;
    presets.forEach(preset=>{
      const item=document.createElement('div');
      item.className='custom-format-item';
      item.dataset.presetId=preset.id;
      item.innerHTML=`<button class="custom-format-apply" type="button" data-custom-format-action="apply"><span class="custom-format-name">${htmlEsc(preset.name)}</span><span class="custom-format-sample" style="${htmlEsc(customFormatInlineStyle(preset))}">${htmlEsc(preset.previewText||'미리보기 텍스트')}</span></button><div class="custom-format-item-actions"><button type="button" data-custom-format-action="edit" title="서식 수정" aria-label="서식 수정">⚙</button><button type="button" data-custom-format-action="duplicate" title="복제" aria-label="복제">⧉</button><button type="button" data-custom-format-action="rename" title="이름 변경" aria-label="이름 변경">✎</button><button type="button" data-custom-format-action="delete" title="삭제" aria-label="삭제">×</button></div>`;
      items.appendChild(item);
    });
    if(!presets.length&&!query){
      const empty=document.createElement('div');
      empty.className='custom-format-empty';
      empty.textContent='저장된 서식이 없습니다.';
      items.appendChild(empty);
    }
    group.appendChild(items);
    list.appendChild(group);
  });
  if(!visibleCount&&query)list.innerHTML='<div class="custom-format-empty">검색 결과가 없습니다.</div>';
  positionCustomFormatPanel();
}
function ensureCustomFormatPanel(){
  if(customFormatPanel)return customFormatPanel;
  customFormatPanel=document.createElement('div');
  customFormatPanel.className='custom-format-panel';
  customFormatPanel.hidden=true;
  customFormatPanel.innerHTML=`
    <div class="custom-format-panel-head"><strong>사용자 지정 서식</strong><button type="button" data-custom-format-action="close" aria-label="닫기">×</button></div>
    <div class="custom-format-action-row"><button type="button" data-custom-format-action="new">새 서식</button><button type="button" data-custom-format-action="save-selection">선택 서식 저장</button><button type="button" data-custom-format-action="new-folder" title="폴더 추가" aria-label="폴더 추가">＋</button></div>
    <label class="custom-format-search"><input type="search" data-custom-format-search placeholder="서식 검색" aria-label="사용자 지정 서식 검색"></label>
    <div class="custom-format-list"></div>`;
  customFormatPanel.querySelector('[data-custom-format-search]').addEventListener('input',renderCustomFormatPanel);
  customFormatPanel.addEventListener('click',handleCustomFormatPanelClick);
  document.body.appendChild(customFormatPanel);
  return customFormatPanel;
}
function toggleCustomFormatPanel(force){
  const panel=ensureCustomFormatPanel();
  const open=force??panel.hidden;
  panel.hidden=!open;
  $('custom-format-toggle').setAttribute('aria-expanded',String(open));
  if(open){renderCustomFormatPanel();positionCustomFormatPanel()}
  else closeCustomFormatMenus();
}
function requestCustomFormatName(title,value='',label='이름'){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>${htmlEsc(title)}</h3><label><span>${htmlEsc(label)}</span><input type="text" value="${htmlEsc(value)}" maxlength="60"></label><div class="modal-actions"><button class="tool" type="button" data-name-action="cancel">취소</button><button class="tool primary" type="button" data-name-action="save">확인</button></div></div>`;
    const input=wrap.querySelector('input');
    const close=result=>{wrap.remove();resolve(result)};
    wrap.addEventListener('click',event=>{
      if(event.target===wrap||event.target.closest('[data-name-action="cancel"]'))close(null);
      if(event.target.closest('[data-name-action="save"]'))close(input.value.trim()||null);
    });
    input.addEventListener('keydown',event=>{if(event.key==='Enter')close(input.value.trim()||null);if(event.key==='Escape')close(null)});
    document.body.appendChild(wrap);
    input.focus();input.select();
  });
}
function customFormatEditor(preset=null,source=null){
  const store=loadCustomFormats();
  const initial={
    name:preset?.name||'새 서식',
    folderId:preset?.folderId||'',
    previewText:preset?.previewText||source?.previewText||'미리보기 텍스트',
    fields:preset?.fields||(source?CUSTOM_FORMAT_FIELDS.filter(field=>source.available[field]):['blockTag','fontSize','color']),
    blockTag:preset?.blockTag||source?.values.blockTag||'p',
    fontSize:Number(preset?.fontSize||source?.values.fontSize||14),
    color:preset?.color||source?.values.color||'#111111',
    backgroundColor:preset?.backgroundColor||source?.values.backgroundColor||'transparent',
    bold:preset?.bold??source?.values.bold??false,
    italic:preset?.italic??source?.values.italic??false,
    underline:preset?.underline??source?.values.underline??false,
    textAlign:preset?.textAlign||source?.values.textAlign||'left'
  };
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    const fieldRows=CUSTOM_FORMAT_FIELDS.map(field=>{
      const checked=initial.fields.includes(field);
      return `<label><input type="checkbox" data-custom-field="${field}" ${checked?'checked':''}><span>${CUSTOM_FORMAT_FIELD_LABELS[field]}</span></label>`;
    }).join('');
    wrap.innerHTML=`<div class="modal-card custom-format-editor-card" role="dialog" aria-modal="true" aria-labelledby="custom-format-editor-title">
      <h3 id="custom-format-editor-title">${preset?'사용자 지정 서식 수정':source?'선택 서식 저장':'새 사용자 지정 서식'}</h3>
      <p class="custom-format-editor-subtitle">${source?'선택한 텍스트에 실제로 적용된 속성만 저장 항목으로 선택했습니다.':'왼쪽에서 서식을 만들고, 오른쪽에서 이름과 저장할 속성을 정합니다.'}</p>
      <div class="custom-format-editor-grid">
        <div class="custom-format-editor-main">
          <section class="custom-format-editor-section">
          <strong class="custom-format-editor-section-title">서식 설정</strong>
          <span class="custom-format-editor-section-desc">아래 값을 바꾸면 해당 속성이 자동으로 저장 항목에 포함됩니다.</span>
          <div class="custom-format-control-row">
            <label><span>서식</span><select data-custom-control="blockTag"><option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="h3">제목 3</option><option value="h4">제목 4</option><option value="h5">제목 5</option></select></label>
            <label><span>크기</span><input type="number" min="6" max="160" data-custom-control="fontSize"></label>
            <label><span>정렬</span><select data-custom-control="textAlign"><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option><option value="justify">양쪽</option></select></label>
          </div>
          <div class="custom-format-inline-tools"><button type="button" data-custom-toggle="bold"><b>B</b></button><button type="button" data-custom-toggle="italic"><i>I</i></button><button type="button" data-custom-toggle="underline"><u>U</u></button></div>
          <div class="custom-format-color-row">
            <div class="custom-format-color-control"><span>글자색</span><button class="custom-format-color-button" type="button" data-custom-color-open="color" aria-expanded="false"><i class="custom-format-color-chip"></i><code class="custom-format-color-code"></code><span class="custom-format-color-chevron">▼</span></button></div>
            <div class="custom-format-color-control"><span>배경색</span><button class="custom-format-color-button" type="button" data-custom-color-open="backgroundColor" aria-expanded="false"><i class="custom-format-color-chip"></i><code class="custom-format-color-code"></code><span class="custom-format-color-chevron">▼</span></button></div>
          </div>
          </section>
          <div class="cp-panel custom-format-color-panel hidden" data-custom-color-panel>
            <div class="cp-picker-row">
              <div class="cp-picker-top"><span>색 조절</span><span class="cp-current" data-custom-color-current></span></div>
              <div class="cp-picker-main" data-custom-color-picker><div class="cp-sv"><span class="cp-sv-handle"></span></div><div class="cp-hue"><span class="cp-hue-handle"></span></div></div>
              <label class="cp-hex-field"><span class="cp-hex-prefix">#</span><input class="cp-hex" data-custom-color-hex maxlength="6" spellcheck="false" aria-label="색상 코드"></label>
              <div class="cp-quick" data-custom-color-quick></div>
            </div>
            <details class="cp-section recent-colors" open><summary>최근 사용</summary><div class="cp-swatches" data-custom-color-history></div></details>
            <details class="cp-section" open><summary>저장됨 <small>우클릭으로 삭제</small></summary><div class="cp-swatches" data-custom-color-saved></div><div class="cp-save-row"><button class="cp-save-btn" type="button" data-custom-color-default>기본</button><button class="cp-save-btn primary" type="button" data-custom-color-save>색 저장</button></div></details>
          </div>
          <section class="custom-format-editor-section" style="margin-top:12px">
            <strong class="custom-format-editor-section-title">미리보기</strong>
            <span class="custom-format-editor-section-desc">문구를 직접 바꿔 저장 목록에서 보일 예시를 확인할 수 있습니다.</span>
            <div class="custom-format-preview"><span class="custom-format-preview-text" contenteditable="true" spellcheck="false"></span></div>
          </section>
        </div>
        <div class="custom-format-editor-side">
          <section class="custom-format-editor-section">
            <strong class="custom-format-editor-section-title">저장 정보</strong>
            <label><span>서식명</span><input type="text" maxlength="60" data-custom-meta="name"></label>
            <label style="margin-top:10px"><span>폴더</span><select data-custom-meta="folder"><option value="">개별 서식</option>${store.folders.map(folder=>`<option value="${htmlEsc(folder.id)}">${htmlEsc(folder.name)}</option>`).join('')}</select></label>
          </section>
          <section class="custom-format-editor-section">
            <strong class="custom-format-editor-section-title">저장할 항목</strong>
            <span class="custom-format-editor-section-desc">체크한 속성만 텍스트에 적용됩니다.</span>
            <div class="custom-format-fields">${fieldRows}</div>
          </section>
        </div>
      </div>
      <div class="modal-actions"><button class="tool" type="button" data-custom-editor-action="cancel">취소</button><button class="tool primary" type="button" data-custom-editor-action="save">저장</button></div>
    </div>`;
    const preview=wrap.querySelector('.custom-format-preview-text');
    const control=name=>wrap.querySelector(`[data-custom-control="${name}"]`);
    const meta=name=>wrap.querySelector(`[data-custom-meta="${name}"]`);
    const values={...initial};
    meta('name').value=initial.name;
    meta('folder').value=initial.folderId;
    control('blockTag').value=initial.blockTag;
    control('fontSize').value=initial.fontSize;
    control('textAlign').value=initial.textAlign;
    values.color=customFormatColor(initial.color,'#111111');
    values.backgroundColor=customFormatColor(initial.backgroundColor,'transparent');
    preview.textContent=initial.previewText;
    const fieldInput=name=>wrap.querySelector(`[data-custom-field="${name}"]`);
    const setFieldChecked=(name,checked=true)=>{
      const input=fieldInput(name);
      if(input&&!input.disabled)input.checked=!!checked;
    };
    const refresh=()=>{
      Object.assign(preview.style,{
        fontSize:`${values.fontSize}px`,color:values.color,backgroundColor:values.backgroundColor==='transparent'?'transparent':values.backgroundColor,
        fontWeight:values.bold?'700':'400',fontStyle:values.italic?'italic':'normal',
        textDecoration:values.underline?'underline':'none'
      });
      preview.parentElement.style.justifyContent={left:'flex-start',center:'center',right:'flex-end',justify:'stretch'}[values.textAlign]||'flex-start';
      preview.style.textAlign=values.textAlign;
      wrap.querySelectorAll('[data-custom-toggle]').forEach(button=>button.setAttribute('aria-pressed',String(!!values[button.dataset.customToggle])));
    };
    ['blockTag','fontSize','textAlign'].forEach(name=>control(name).addEventListener('input',event=>{
      values[name]=name==='fontSize'?Math.max(6,Math.min(160,Number(event.target.value)||14)):event.target.value;
      setFieldChecked(name,true);
      refresh();
    }));
    const colorPanel=wrap.querySelector('[data-custom-color-panel]');
    const colorPicker=colorPanel.querySelector('[data-custom-color-picker]');
    const colorHex=colorPanel.querySelector('[data-custom-color-hex]');
    const colorCurrent=colorPanel.querySelector('[data-custom-color-current]');
    const colorQuick=colorPanel.querySelector('[data-custom-color-quick]');
    const colorHistory=colorPanel.querySelector('[data-custom-color-history]');
    const colorSaved=colorPanel.querySelector('[data-custom-color-saved]');
    const colorDefault=colorPanel.querySelector('[data-custom-color-default]');
    let colorChannel='color';
    const colorType=()=>colorChannel==='color'?'text':'bg';
    const colorFallback=()=>colorChannel==='color'?'#111111':'transparent';
    const colorPalettes={
      color:['#111111','#ffffff','#991b1b','#92400e','#166534','#1e40af','#5b21b6','#9d174d'],
      backgroundColor:['#111111','#ffffff','#f3f4f6','#f8f4e6','#e3d5d5','#cae4e8','#ddd6fe','#fce7f3']
    };
    const updateColorButtons=()=>wrap.querySelectorAll('[data-custom-color-open]').forEach(button=>{
      const value=values[button.dataset.customColorOpen];
      const chip=button.querySelector('.custom-format-color-chip');
      chip.classList.toggle('is-transparent',value==='transparent');
      chip.style.background=value==='transparent'?'transparent':value;
      button.querySelector('.custom-format-color-code').textContent=value==='transparent'?'없음':value;
      button.setAttribute('aria-expanded',String(!colorPanel.classList.contains('hidden')&&button.dataset.customColorOpen===colorChannel));
    });
    const setCustomFormatColor=(value,{recent=false}={})=>{
      if(value==='transparent'){
        values[colorChannel]='transparent';
        setFieldChecked(colorChannel,false);
        updateColorButtons();
        refresh();
        return true;
      }
      const normalized=normalizeColorValue(value);
      if(!normalized)return false;
      values[colorChannel]=normalized;
      setFieldChecked(colorChannel,true);
      setHexInputValue(colorHex,normalized);
      colorCurrent.style.background=normalized;
      syncCustomFormatColorSliders(normalized);
      updateColorButtons();
      refresh();
      if(recent){
        trackColor(colorType(),normalized);
        renderCustomFormatColors();
      }
      return true;
    };
    const makeColorSwatch=(color,{saved=false}={})=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='cp-swatch'+(saved?' saved':'');
      button.style.background=color;
      button.title=saved?`${color} · 우클릭으로 삭제`:`${color} · 우클릭으로 저장`;
      button.addEventListener('click',event=>{event.stopPropagation();setCustomFormatColor(color,{recent:true})});
      button.addEventListener('contextmenu',event=>{
        event.preventDefault();event.stopPropagation();
        const type=colorType();
        if(saved){
          const colors=type==='text'?cs.tSave:cs.bSave;
          const index=colors.indexOf(color);
          if(index>=0)colors.splice(index,1);
          saveC(type==='text'?'md-c-ts':'md-c-bs',colors);
          renderAllSwatches();
          renderCustomFormatColors();
        }else{
          savePaletteColor(type,color);
          renderCustomFormatColors();
        }
      });
      return button;
    };
    const fillColorSection=(element,colors,saved)=>{
      element.innerHTML='';
      if(!colors.length){
        const empty=document.createElement('span');
        empty.className='cp-empty';
        empty.textContent=saved?'저장된 색 없음':'사용 기록 없음';
        element.appendChild(empty);
        return;
      }
      colors.slice(0,saved?MAX_CSAVE:MAX_CHIST).forEach(color=>element.appendChild(makeColorSwatch(color,{saved})));
    };
    function renderCustomFormatColors(){
      const type=colorType();
      const history=type==='text'?cs.tHist:cs.bHist;
      const saved=type==='text'?cs.tSave:cs.bSave;
      colorQuick.innerHTML='';
      colorPalettes[colorChannel].forEach(color=>{
        const button=document.createElement('button');
        button.type='button';button.dataset.color=color;button.style.background=color;button.title=color;
        button.addEventListener('click',event=>{event.stopPropagation();setCustomFormatColor(color,{recent:true})});
        colorQuick.appendChild(button);
      });
      fillColorSection(colorHistory,history,false);
      fillColorSection(colorSaved,saved,true);
      colorDefault.textContent=colorChannel==='backgroundColor'?'없음':'기본';
      const current=values[colorChannel]||colorFallback();
      const pickerColor=current==='transparent'?'#ffffff':current;
      setHexInputValue(colorHex,pickerColor);
      colorCurrent.style.background=pickerColor;
      syncCustomFormatColorSliders(pickerColor);
      updateColorButtons();
    }
    function syncCustomFormatColorSliders(color){
      const rgb=hexToRgb(color);
      if(!rgb)return;
      const hsv=rgbToHsv(rgb);
      if(hsv.s>.001||!colorPicker.dataset.hue)colorPicker.dataset.hue=String(hsv.h);
      const hue=Number(colorPicker.dataset.hue)||0;
      colorPicker.querySelector('.cp-sv').style.backgroundColor=`hsl(${hue} 100% 50%)`;
      colorPicker.querySelector('.cp-sv-handle').style.left=(hsv.s*100)+'%';
      colorPicker.querySelector('.cp-sv-handle').style.top=((1-hsv.v)*100)+'%';
      colorPicker.querySelector('.cp-hue-handle').style.top=((hue/360)*100)+'%';
    }
    wrap.querySelectorAll('[data-custom-color-open]').forEach(button=>button.addEventListener('click',event=>{
      event.stopPropagation();
      const next=button.dataset.customColorOpen;
      const wasOpen=!colorPanel.classList.contains('hidden')&&colorChannel===next;
      colorChannel=next;
      colorPanel.classList.toggle('hidden',wasOpen);
      if(!wasOpen){
        const mainRect=wrap.querySelector('.custom-format-editor-main').getBoundingClientRect();
        const buttonRect=button.getBoundingClientRect();
        colorPanel.style.top=`${Math.round(buttonRect.bottom-mainRect.top+6)}px`;
      }
      renderCustomFormatColors();
    }));
    colorHex.addEventListener('input',event=>{
      const cleaned=event.target.value.replace(/[^0-9a-f]/gi,'').slice(0,6);
      if(event.target.value!==cleaned)event.target.value=cleaned;
      if(cleaned.length===6)setCustomFormatColor('#'+cleaned);
    });
    colorHex.addEventListener('change',()=>setCustomFormatColor(colorHex.value,{recent:true}));
    colorPicker.querySelectorAll('.cp-sv,.cp-hue').forEach(part=>part.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      part.setPointerCapture(event.pointerId);
      const update=pointerEvent=>{
        const current=rgbToHsv(hexToRgb(values[colorChannel]==='transparent'?'#ffffff':values[colorChannel])||{r:255,g:0,b:0});
        let hue=Number(colorPicker.dataset.hue)||current.h,saturation=current.s,brightness=current.v;
        const rect=part.getBoundingClientRect();
        if(part.classList.contains('cp-hue')){
          hue=Math.max(0,Math.min(360,((pointerEvent.clientY-rect.top)/rect.height)*360));
          colorPicker.dataset.hue=String(hue);
          if(saturation<.08)saturation=1;
          if(brightness<.12)brightness=1;
        }else{
          saturation=Math.max(0,Math.min(1,(pointerEvent.clientX-rect.left)/rect.width));
          brightness=1-Math.max(0,Math.min(1,(pointerEvent.clientY-rect.top)/rect.height));
        }
        const rgb=hsvToRgb(hue,saturation,brightness);
        setCustomFormatColor(rgbToHex(rgb.r,rgb.g,rgb.b));
      };
      update(event);
      const move=moveEvent=>update(moveEvent);
      part.addEventListener('pointermove',move);
      part.addEventListener('pointerup',()=>{
        part.removeEventListener('pointermove',move);
        trackColor(colorType(),values[colorChannel]);
        renderCustomFormatColors();
      },{once:true});
    }));
    colorPicker.querySelector('.cp-sv-handle').addEventListener('contextmenu',event=>{
      event.preventDefault();event.stopPropagation();
      savePaletteColor(colorType(),values[colorChannel]);
      renderCustomFormatColors();
    });
    colorPanel.querySelector('[data-custom-color-save]').addEventListener('click',event=>{
      event.stopPropagation();savePaletteColor(colorType(),values[colorChannel]);renderCustomFormatColors();
    });
    colorDefault.addEventListener('click',event=>{
      event.stopPropagation();
      setCustomFormatColor(colorFallback(),{recent:false});
      colorPanel.classList.add('hidden');
      updateColorButtons();
    });
    colorPanel.addEventListener('click',event=>event.stopPropagation());
    wrap.addEventListener('click',event=>{
      if(!event.target.closest('[data-custom-color-panel],[data-custom-color-open]')){
        colorPanel.classList.add('hidden');
        updateColorButtons();
      }
    });
    wrap.querySelectorAll('[data-custom-toggle]').forEach(button=>button.addEventListener('click',()=>{
      const field=button.dataset.customToggle;
      values[field]=!values[field];
      setFieldChecked(field,values[field]);
      refresh();
    }));
    const close=result=>{wrap.remove();resolve(result)};
    wrap.addEventListener('click',event=>{
      if(event.target===wrap||event.target.closest('[data-custom-editor-action="cancel"]'))return close(null);
      if(!event.target.closest('[data-custom-editor-action="save"]'))return;
      const fields=[...wrap.querySelectorAll('[data-custom-field]:checked')].map(input=>input.dataset.customField);
      const name=meta('name').value.trim();
      if(!name){meta('name').focus();return}
      if(!fields.length){showInfoNotice('저장할 항목을 선택해 주세요','최소 하나 이상의 서식 항목을 선택해야 합니다.');return}
      close({
        id:preset?.id||customFormatId(),
        ...values,
        name,folderId:meta('folder').value,
        previewText:preview.textContent.trim()||'미리보기 텍스트',
        fields
      });
    });
    document.body.appendChild(wrap);
    updateColorButtons();
    refresh();
    meta('name').focus();meta('name').select();
  });
}
async function saveCustomFormatFromSelection(){
  const source=customFormatSource();
  if(!source)return;
  const preset=await customFormatEditor(null,source);
  if(!preset)return;
  const store=loadCustomFormats();
  store.presets.push(preset);saveCustomFormats(store);renderCustomFormatPanel();
}
async function createCustomFormat(){
  const preset=await customFormatEditor();
  if(!preset)return;
  const store=loadCustomFormats();
  store.presets.push(preset);saveCustomFormats(store);renderCustomFormatPanel();
}
function applyCustomFormatPreset(preset){
  let range=previewRange();
  if(!range||range.collapsed||!els.preview.contains(range.commonAncestorContainer)){
    showInfoNotice('텍스트를 선택해 주세요','프리뷰에서 서식을 적용할 텍스트를 먼저 드래그해 주세요.');
    return false;
  }
  const fields=new Set(preset.fields||[]);
  pushHistory(true);
  let selection=window.getSelection();
  selection.removeAllRanges();selection.addRange(range);
  const fragment=range.extractContents();
  stripSelectedCopiedTextFormatting(fragment,fields);
  const span=document.createElement('span');
  if(fields.has('fontSize'))span.style.fontSize=`${Number(preset.fontSize)||14}px`;
  if(fields.has('color'))span.style.color=preset.color;
  if(fields.has('backgroundColor'))span.style.backgroundColor=preset.backgroundColor;
  if(fields.has('bold'))span.style.fontWeight=preset.bold?'700':'400';
  if(fields.has('italic'))span.style.fontStyle=preset.italic?'italic':'normal';
  if(fields.has('underline'))span.style.textDecoration=preset.underline?'underline':'none';
  span.appendChild(fragment);range.insertNode(span);applyAllPreviewBoldMarkup(span);
  const selectInserted=()=>{
    const selected=document.createRange();selected.selectNodeContents(span);
    selection=window.getSelection();selection.removeAllRanges();selection.addRange(selected);
    return selected;
  };
  let next=selectInserted();
  if(fields.has('blockTag')&&preset.blockTag)document.execCommand('formatBlock',false,preset.blockTag);
  const alignCommand={left:'justifyLeft',center:'justifyCenter',right:'justifyRight',justify:'justifyFull'}[preset.textAlign];
  if(fields.has('textAlign')&&alignCommand)document.execCommand(alignCommand,false,null);
  if(span.isConnected)next=selectInserted();
  finishPreviewTextMutation(next);
  return true;
}
async function handleCustomFormatPanelClick(event){
  const actionButton=event.target.closest('[data-custom-format-action]');
  if(!actionButton)return;
  const action=actionButton.dataset.customFormatAction;
  const presetId=actionButton.closest('[data-preset-id]')?.dataset.presetId;
  const folderId=actionButton.closest('[data-folder-id]')?.dataset.folderId||'';
  if(action==='close')return toggleCustomFormatPanel(false);
  if(action==='save-selection')return saveCustomFormatFromSelection();
  if(action==='new')return createCustomFormat();
  if(action==='new-folder'){
    const name=await requestCustomFormatName('새 서식 폴더','','폴더명');
    if(!name)return;
    const store=loadCustomFormats();store.folders.push({id:customFormatId('folder'),name,collapsed:false});saveCustomFormats(store);return renderCustomFormatPanel();
  }
  const store=loadCustomFormats();
  const preset=store.presets.find(item=>item.id===presetId);
  const folder=store.folders.find(item=>item.id===folderId);
  if(action==='toggle-folder'){
    if(!folderId){customFormatRootCollapsed=!customFormatRootCollapsed;return renderCustomFormatPanel()}
    if(folder){folder.collapsed=!folder.collapsed;saveCustomFormats(store);return renderCustomFormatPanel()}
  }
  if(action==='folder-menu'||action==='preset-menu'){
    const menu=actionButton.parentElement.querySelector('.custom-format-menu')||actionButton.nextElementSibling;
    const open=menu?.hidden;closeCustomFormatMenus();if(menu)menu.hidden=!open;return;
  }
  if(action==='apply'&&preset)return applyCustomFormatPreset(preset);
  if(action==='edit'&&preset){
    const edited=await customFormatEditor(preset);
    if(!edited)return;
    store.presets[store.presets.findIndex(item=>item.id===preset.id)]=edited;saveCustomFormats(store);return renderCustomFormatPanel();
  }
  if(action==='duplicate'&&preset){
    const copy={...preset,id:customFormatId(),name:`${preset.name} 복사본`};
    store.presets.push(copy);saveCustomFormats(store);return renderCustomFormatPanel();
  }
  if(action==='rename'&&preset){
    const name=await requestCustomFormatName('서식 이름 수정',preset.name,'서식명');
    if(!name)return;preset.name=name;saveCustomFormats(store);return renderCustomFormatPanel();
  }
  if(action==='delete'&&preset){
    store.presets=store.presets.filter(item=>item.id!==preset.id);saveCustomFormats(store);return renderCustomFormatPanel();
  }
  if(action==='rename-folder'&&folder){
    const name=await requestCustomFormatName('폴더 이름 수정',folder.name,'폴더명');
    if(!name)return;folder.name=name;saveCustomFormats(store);return renderCustomFormatPanel();
  }
  if(action==='delete-folder'&&folder){
    store.presets.forEach(item=>{if(item.folderId===folder.id)item.folderId=''});
    store.folders=store.folders.filter(item=>item.id!==folder.id);saveCustomFormats(store);return renderCustomFormatPanel();
  }
}
$('custom-format-toggle').addEventListener('mousedown',rememberPreviewRange);
$('custom-format-toggle').addEventListener('click',()=>toggleCustomFormatPanel());
document.addEventListener('mousedown',event=>{
  if(customFormatPanel&&!customFormatPanel.hidden&&!customFormatPanel.contains(event.target)&&!event.target.closest('#custom-format-toggle'))toggleCustomFormatPanel(false);
});
window.addEventListener('resize',positionCustomFormatPanel);
function clearPreviewSelectionFormat(){
  const range=restoreTextContextRange();
  if(!range)return false;
  pushHistory(true);
  document.execCommand('removeFormat',false,null);
  rememberPreviewRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function ensureTextContextMenu(){
  if(textContextMenu)return textContextMenu;
  textContextMenu=document.createElement('div');
  textContextMenu.className='file-context-menu text-context-menu';
  textContextMenu.hidden=true;
  textContextMenu.innerHTML=`
    <button type="button" data-text-action="cut">잘라내기</button>
    <button type="button" data-text-action="copy">복사</button>
    <button type="button" data-text-action="paste">붙여넣기</button>
    <hr>
    <button type="button" data-text-action="copy-format">서식 복사</button>
    <button type="button" data-text-action="paste-format">서식 붙여넣기</button>
    <button type="button" data-text-action="clear-format">서식 제거</button>`;
  textContextMenu.addEventListener('mousedown',e=>e.preventDefault());
  textContextMenu.addEventListener('click',async e=>{
    const action=e.target.closest('[data-text-action]')?.dataset.textAction;
    if(!action)return;
    hideTextContextMenu();
    if(action==='cut')await cutPreviewSelection();
    else if(action==='copy')await copyPreviewSelection();
    else if(action==='paste')await pasteIntoPreviewSelection();
    else if(action==='copy-format')copyPreviewSelectionFormat();
    else if(action==='paste-format')pastePreviewSelectionFormat();
    else if(action==='clear-format')clearPreviewSelectionFormat();
  });
  document.addEventListener('mousedown',e=>{if(!textContextMenu.hidden&&!textContextMenu.contains(e.target))hideTextContextMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTextContextMenu()});
  window.addEventListener('resize',hideTextContextMenu);
  document.addEventListener('scroll',hideTextContextMenu,true);
  document.body.appendChild(textContextMenu);
  return textContextMenu;
}
function showTextContextMenu(e){
  if(!els.preview.contains(e.target))return false;
  const range=selectedPreviewTextRange();
  if(!range)return false;
  try{
    if(e.target!==els.preview&&!range.intersectsNode(e.target))return false;
  }catch{return false}
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  hideImageContextMenu();
  textContextRange=range;
  state.savedPreviewRange=range.cloneRange();
  const menu=ensureTextContextMenu();
  menu.querySelector('[data-text-action="paste-format"]').disabled=!copiedTextFormat;
  menu.hidden=false;
  menu.style.left=e.clientX+'px';
  menu.style.top=e.clientY+'px';
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.max(6,Math.min(e.clientX,window.innerWidth-rect.width-6))+'px';
  menu.style.top=Math.max(6,Math.min(e.clientY,window.innerHeight-rect.height-6))+'px';
  return true;
}
function insertPreviewHtml(html,enhancement='all'){
  const range=previewRange();
  if(!range)return false;
  els.preview.focus();
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  pushHistory(true);
  document.execCommand('insertHTML',false,html);
  if(enhancement==='quote'){
    els.preview.querySelectorAll('blockquote').forEach(quote=>{
      if(!quote.querySelector(':scope > .block-move-handle'))quote.appendChild(makeMoveHandle('인용 위치 이동'));
    });
  }else{
    fixSpanColors(els.preview);
    runHighlight(els.preview);
    decorateCodeBlocks(els.preview);
    addTableResize(els.preview);
    addImageResize(els.preview);
    addMovableElements(els.preview);
  }
  rememberPreviewRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function insertPreviewHtmlAtContext(html,context,enhancement='all'){
  if(context?.kind!=='preview'||!context.range)return false;
  const range=context.range.cloneRange();
  const host=range.commonAncestorContainer;
  if(!host?.isConnected||!els.preview.contains(host))return false;
  const template=document.createElement('template');
  template.innerHTML=html;
  const inserted=[...template.content.childNodes];
  if(!inserted.length)return false;
  pushHistory(true);
  range.deleteContents();
  range.insertNode(template.content);
  const caret=document.createRange();
  caret.setStartAfter(inserted[inserted.length-1]);
  caret.collapse(true);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(caret);
  if(enhancement==='quote'){
    els.preview.querySelectorAll('blockquote').forEach(quote=>{
      if(!quote.querySelector(':scope > .block-move-handle'))quote.appendChild(makeMoveHandle('인용 위치 이동'));
    });
  }else{
    fixSpanColors(els.preview);
    runHighlight(els.preview);
    decorateCodeBlocks(els.preview);
    addTableResize(els.preview);
    addImageResize(els.preview);
    addMovableElements(els.preview);
  }
  state.savedPreviewRange=caret.cloneRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function insertPreviewBlockBelow(html){
  const range=previewRange();
  if(!range)return false;
  let anchor=range.endContainer;
  if(anchor===els.preview){
    const index=Math.min(range.endOffset,els.preview.childNodes.length)-1;
    anchor=index>=0?els.preview.childNodes[index]:null;
  }else{
    if(anchor.nodeType!==Node.ELEMENT_NODE)anchor=anchor.parentNode;
    while(anchor&&anchor.parentNode!==els.preview)anchor=anchor.parentNode;
  }
  const template=document.createElement('template');
  template.innerHTML=html;
  const inserted=[...template.content.childNodes];
  if(!inserted.length)return false;
  pushHistory(true);
  if(anchor&&anchor.parentNode===els.preview)anchor.after(template.content);
  else els.preview.appendChild(template.content);
  fixSpanColors(els.preview);
  addMovableElements(els.preview);
  const insertion=document.createRange();
  insertion.setStartAfter(inserted[inserted.length-1]);
  insertion.collapse(true);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(insertion);
  state.savedPreviewRange=insertion.cloneRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function insertPreviewInlineCode(){
  const range=previewRange();
  if(!range)return false;
  pushHistory(true);
  const code=document.createElement('code');
  code.textContent=range.toString()||'코드';
  range.deleteContents();
  range.insertNode(code);
  addMovableElements(els.preview);
  const next=document.createRange();
  next.selectNodeContents(code);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(next);
  state.savedPreviewRange=next.cloneRange();
  els.preview.focus();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function insertPreviewCodeBlock(){
  const range=previewRange();
  if(!range)return false;
  const selectedText=range.toString()||'코드';
  const pre=document.createElement('pre');
  const code=document.createElement('code');
  code.setAttribute('data-code-language','');
  code.textContent=selectedText;
  pre.appendChild(code);
  const spacer=document.createElement('p');
  spacer.innerHTML='<br>';
  const marker=document.createElement('span');
  marker.hidden=true;
  pushHistory(true);
  range.deleteContents();
  range.insertNode(marker);
  const block=closestPreviewBlock(marker);
  if(block?.parentElement===els.preview){
    const tailRange=document.createRange();
    tailRange.setStartAfter(marker);
    tailRange.setEnd(block,block.childNodes.length);
    const tail=tailRange.extractContents();
    marker.remove();
    const afterBlock=block.cloneNode(false);
    afterBlock.removeAttribute('id');
    afterBlock.appendChild(tail);
    afterBlock.querySelectorAll?.('.block-move-handle,.code-head').forEach(node=>node.remove());
    block.insertAdjacentElement('afterend',pre);
    pre.insertAdjacentElement('afterend',afterBlock);
    if(!block.textContent.trim()&&!block.querySelector('img,table,hr'))block.remove();
    if(!afterBlock.textContent.trim()&&!afterBlock.querySelector('img,table,hr'))afterBlock.replaceChildren(document.createElement('br'));
  }else{
    let top=marker;
    while(top.parentElement&&top.parentElement!==els.preview)top=top.parentElement;
    if(top!==marker&&top.parentElement===els.preview){
      marker.remove();
      top.insertAdjacentElement('afterend',pre);
      pre.insertAdjacentElement('afterend',spacer);
    }else{
      marker.replaceWith(pre,spacer);
    }
  }
  runHighlight(els.preview);
  decorateCodeBlocks(els.preview);
  addMovableElements(els.preview);
  const selectionRange=document.createRange();
  selectionRange.selectNodeContents(code);
  const selection=window.getSelection();
  selection.removeAllRanges();
  selection.addRange(selectionRange);
  state.savedPreviewRange=selectionRange.cloneRange();
  els.preview.focus();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function closestPreviewBlock(node){
  let el=node.nodeType===1?node:node.parentElement;
  while(el&&el!==els.preview){
    if(el.closest&&el.closest('table'))return null;
    if(el.matches&&el.matches('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre'))return el;
    el=el.parentElement;
  }
  return null;
}
function placeCaretInPreviewBlock(block){
  els.preview.focus();
  const range=document.createRange();
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT,{acceptNode(node){
    return node.parentElement?.closest('.block-move-handle,.code-head')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;
  }});
  const firstText=walker.nextNode();
  if(firstText)range.setStart(firstText,0);
  else{
    range.selectNodeContents(block);
    range.collapse(true);
  }
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  state.savedPreviewRange=range.cloneRange();
}
function placeCaretAtPreviewEnd(block){
  els.preview.focus();
  const range=document.createRange();
  range.selectNodeContents(block);
  range.collapse(false);
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  state.savedPreviewRange=range.cloneRange();
}
function placeCaretAtPreviewTextOffset(root,offset){
  if(!root?.isConnected)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    return node.parentElement?.closest('.block-move-handle,.code-head')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;
  }});
  let remaining=Math.max(0,offset),node;
  while((node=walker.nextNode())){
    if(remaining<=node.data.length){
      const range=document.createRange();
      range.setStart(node,remaining);
      range.collapse(true);
      const sel=window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      state.savedPreviewRange=range.cloneRange();
      els.preview.focus();
      return;
    }
    remaining-=node.data.length;
  }
  placeCaretAtPreviewEnd(root);
}
function previewBlockPlainText(block){
  const clone=block.cloneNode(true);
  clone.querySelectorAll('.block-move-handle,.form-move-handle,.code-head').forEach(node=>node.remove());
  return clone.textContent||'';
}
function previewMarkdownCaretOffset(source,offset){
  const holder=document.createElement('div');
  holder.innerHTML=markdownHtml(source.slice(0,offset)).trim();
  return holder.textContent.length;
}
function previewMarkdownCandidate(text){
  return /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|!?\[[^\]\n]+\]\([^)\n]+\)|(?:^|\s)[*_][^*_\n]+[*_](?:\s|$))/.test(text)
    || /^\s{0,3}(?:#{1,6}\s+\S|[-+*]\s*(?:\S.*)?|\d+\.\s+\S|>\s+\S|```|~~~|(?:---+|\*\*\*+)\s*$)/.test(text);
}
function applyPreviewStructuralMarkdown(block,text){
  if(/^\s*-\s+$/.test(text)){
    const list=document.createElement('ul');
    const item=document.createElement('li');
    item.appendChild(document.createElement('br'));
    list.appendChild(item);
    block.replaceWith(list);
    addMovableElements(els.preview);
    placeCaretInPreviewBlock(item);
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  if(/^\s*---\s*$/.test(text)){
    const rule=document.createElement('hr');
    const paragraph=document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    let target=block;
    while(target.parentElement&&target.parentElement!==els.preview)target=target.parentElement;
    target.replaceWith(rule,paragraph);
    addMovableElements(els.preview);
    placeCaretInPreviewBlock(paragraph);
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  return false;
}
function applyPreviewBoldMarkup(block,caretOffset){
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT,{acceptNode(node){
    return node.parentElement?.closest('.block-move-handle,.code-head,pre,code')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;
  }});
  const entries=[];
  let text='',node;
  while((node=walker.nextNode())){
    const start=text.length;
    text+=node.data;
    entries.push({node,start,end:text.length});
  }
  const matches=[...text.matchAll(/\*\*(?!\s)([^\n]*?\S)\*\*/g)].filter(match=>match.index+match[0].length<=caretOffset);
  const match=matches[matches.length-1];
  if(!match)return false;
  const openStart=match.index,openEnd=openStart+2;
  const closeStart=openStart+match[0].length-2,closeEnd=closeStart+2;
  const pointAt=offset=>{
    const entry=entries.find(item=>offset>=item.start&&offset<=item.end);
    return entry?{node:entry.node,offset:Math.max(0,Math.min(entry.node.data.length,offset-entry.start))}:null;
  };
  const removeMarker=(start,end,marker)=>{
    const a=pointAt(start),b=pointAt(end);
    if(!a||!b)return false;
    const range=document.createRange();
    range.setStart(a.node,a.offset);
    range.setEnd(b.node,b.offset);
    range.deleteContents();
    range.insertNode(marker);
    return true;
  };
  const closeMarker=document.createComment('md-bold-close');
  if(!removeMarker(closeStart,closeEnd,closeMarker))return false;
  const openMarker=document.createComment('md-bold-open');
  if(!removeMarker(openStart,openEnd,openMarker)){closeMarker.remove();return false}
  const contentRange=document.createRange();
  contentRange.setStartAfter(openMarker);
  contentRange.setEndBefore(closeMarker);
  const content=contentRange.extractContents();
  const strong=document.createElement('strong');
  strong.appendChild(content);
  closeMarker.before(strong);
  openMarker.remove();
  closeMarker.remove();
  const selection=window.getSelection(),next=document.createRange();
  next.setStartAfter(strong);
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
  state.savedPreviewRange=next.cloneRange();
  return true;
}
function wrapPreviewInlineRun(node){
  let top=node||null;
  while(top&&top.parentNode!==els.preview)top=top.parentNode;
  if(!top||top===els.preview)return null;
  const isInline=item=>item.nodeType===3||(item.nodeType===1&&!item.matches('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,hr,.code-block'));
  if(!isInline(top))return null;
  let first=top;
  while(first.previousSibling&&isInline(first.previousSibling))first=first.previousSibling;
  const paragraph=document.createElement('p');
  first.before(paragraph);
  let current=first;
  while(current&&isInline(current)){
    const next=current.nextSibling;
    paragraph.appendChild(current);
    current=next;
  }
  return paragraph;
}
function previewEditBlock(node){
  const origin=node?.nodeType===1?node:node?.parentElement;
  let block=origin?.closest?.('p,div,li,h1,h2,h3,h4,h5,h6,blockquote');
  if(block&&!els.preview.contains(block))block=null;
  block=block||wrapPreviewInlineRun(node);
  if(!block||block===els.preview||block.closest('pre,table,.code-head'))return null;
  return block;
}
function applyPreviewMarkdown(block){
  if(!previewMarkdownEnabled||!block?.isConnected||!els.preview.contains(block))return false;
  const selection=window.getSelection();
  if(!selection?.rangeCount||!selection.isCollapsed)return false;
  const range=selection.getRangeAt(0);
  if(!block.contains(range.endContainer))return false;
  const before=document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.endContainer,range.endOffset);
  const text=previewBlockPlainText(block);
  const caretOffset=Math.min(text.length,before.toString().length);
  if(!previewMarkdownCandidate(text))return false;
  if(applyPreviewStructuralMarkdown(block,text))return true;
  if(applyPreviewBoldMarkup(block,caretOffset)){
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  const renderedCaretOffset=previewMarkdownCaretOffset(text,caretOffset);
  const holder=document.createElement('div');
  holder.innerHTML=markdownHtml(text).trim();
  if(!holder.firstElementChild)return false;
  let caretTarget;
  if(block.tagName==='P'&&holder.children.length===1&&holder.firstElementChild.tagName==='P'){
    if(holder.firstElementChild.innerHTML===block.innerHTML)return false;
    block.innerHTML=holder.firstElementChild.innerHTML;
    caretTarget=block;
  }else{
    const nodes=[...holder.childNodes];
    if(!nodes.length)return false;
    block.replaceWith(...nodes);
    caretTarget=[...nodes].reverse().find(node=>node.nodeType===1)||nodes[nodes.length-1];
  }
  if(caretTarget?.nodeType===1)placeCaretAtPreviewTextOffset(caretTarget,renderedCaretOffset);
  fixSpanColors(els.preview);
  runHighlight(els.preview);
  decorateCodeBlocks(els.preview);
  addMovableElements(els.preview);
  addTableResize(els.preview);
  syncFromPreview();
  pushHistory(true);
  return true;
}
function schedulePreviewMarkdownApply(node){
  if(!previewMarkdownEnabled)return;
  clearTimeout(previewMarkdownTimer);
  const selection=window.getSelection();
  const liveRange=selection?.rangeCount?selection.getRangeAt(0):null;
  let caretNode=liveRange?.endContainer||null;
  const caretElement=caretNode?.nodeType===Node.ELEMENT_NODE?caretNode:caretNode?.parentElement;
  // input.target is the editing root even when typing inside a table.
  // A cell is intentionally excluded from Markdown block conversion; it must
  // not fall back to an unrelated root-level inline run and move the caret.
  if(caretElement?.closest('table,pre,.code-head'))return;
  const rootCaret=caretNode===els.preview;
  if(rootCaret){
    const offset=Math.max(0,liveRange.endOffset-1);
    caretNode=els.preview.childNodes[offset]||els.preview.childNodes[liveRange.endOffset]||null;
  }
  let block=previewEditBlock(caretNode)||previewEditBlock(node);
  if(!block&&node===els.preview&&rootCaret){
    const direct=[...els.preview.childNodes].reverse().find(item=>item.nodeType===3||(item.nodeType===1&&!item.matches('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,hr,.code-block')));
    if(direct)block=wrapPreviewInlineRun(direct);
  }
  if(!block)return;
  if(rootCaret||!liveRange||!block.contains(liveRange.endContainer))placeCaretAtPreviewEnd(block);
  clearTimeout(previewMarkdownTimer);
  previewMarkdownTimer=setTimeout(()=>applyPreviewMarkdown(block),180);
}
const previewStructuredExitSelector='.code-block,pre,table,blockquote,.zz-lens,.obsidian-callout,.zz-sync-block,.zz-toc,.zz-sheet,.zz-html-embed,.zz-doc-embed,.reference-list,.zz-math-block';
let activePreviewCodePre=null,activePreviewLens=null,activePreviewStructuredBlock=null;
function trackActivePreviewCode(e){
  const pre=e.target.closest?.('pre');
  if(pre&&els.preview.contains(pre))activePreviewCodePre=pre;
}
function trackActivePreviewLens(e){
  const lens=e.target.closest?.('.zz-lens');
  if(lens&&els.preview.contains(lens))activePreviewLens=lens;
}
function trackActivePreviewStructuredBlock(e){
  if(e.target.closest?.('.block-move-handle,.form-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle,input,select,button,textarea'))return;
  let block=structuredPreviewBlockFromNode(e.target);
  if(!block||!els.preview.contains(block))return;
  activePreviewStructuredBlock=block;
}
function structuredPreviewBlockFromNode(node){
  const element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  if(!element)return null;
  let block=element.closest?.(previewStructuredExitSelector);
  if(block?.matches('pre')&&block.closest('.code-block'))block=block.closest('.code-block');
  return block||null;
}
function trackSelectedPreviewStructuredBlock(){
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(!range||!els.preview.contains(range.commonAncestorContainer))return;
  const block=structuredPreviewBlockFromNode(range.commonAncestorContainer);
  if(block&&els.preview.contains(block))activePreviewStructuredBlock=block;
}
document.addEventListener('selectionchange',trackSelectedPreviewStructuredBlock);
function previewExitTarget(block,after){
  let target=after?block.nextElementSibling:block.previousElementSibling;
  const unusable=!target
    ||target.matches(previewStructuredExitSelector+',hr,img')
    ||target.getAttribute('contenteditable')==='false';
  if(unusable){
    target=document.createElement('p');
    target.innerHTML='<br>';
    block.insertAdjacentElement(after?'afterend':'beforebegin',target);
    return{target,created:true};
  }
  return{target,created:false};
}
function activatePreviewExitTarget(target,shouldSync=false){
  if(!target)return;
  if(shouldSync)syncFromPreview();
  const restore=()=>{
    if(!target.isConnected)return;
    target.dataset.previewExitTarget='1';
    target.setAttribute('contenteditable','true');
    if(!target.childNodes.length)target.innerHTML='<br>';
    els.preview.focus({preventScroll:true});
    placeCaretInPreviewBlock(target);
    rememberPreviewRange();
    activePreviewStructuredBlock=null;
    activePreviewCodePre=null;
    activePreviewLens=null;
  };
  restore();
  requestAnimationFrame(restore);
}
function exitStructuredBlockOnPreviewMargin(e){
  const block=activePreviewStructuredBlock;
  if(!block||!block.isConnected){
    activePreviewStructuredBlock=null;
    return false;
  }
  if(block.contains(e.target))return false;
  if(!els.preview.contains(e.target)){
    const selection=window.getSelection();
    const range=selection?.rangeCount?selection.getRangeAt(0):null;
    if(range&&block.contains(range.commonAncestorContainer))selection.removeAllRanges();
    activePreviewStructuredBlock=null;
    return false;
  }
  const rect=block.getBoundingClientRect();
  const outsideBlock=e.clientX<rect.left-2||e.clientX>rect.right+2||e.clientY<rect.top-2||e.clientY>rect.bottom+2;
  if(!outsideBlock)return false;
  const hitStructured=structuredPreviewBlockFromNode(e.target);
  if(hitStructured&&hitStructured!==block)return false;
  const hitElement=e.target?.nodeType===Node.ELEMENT_NODE?e.target:e.target?.parentElement;
  const interactive=hitElement?.closest?.('a,input,select,button,textarea,[contenteditable="true"],.block-move-handle,.form-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle');
  // The preview root itself is the blank editing canvas. Treating it as an
  // external contenteditable element prevents the caret from escaping a
  // structured block (notably a sync block) when its empty margin is clicked.
  if(interactive&&interactive!==els.preview&&!block.contains(interactive))return false;
  const hitContent=hitElement?.closest?.('p,li,h1,h2,h3,h4,h5,h6,hr,img');
  if(hitContent&&!block.contains(hitContent))return false;
  e.preventDefault();
  e.stopPropagation();
  clearClickMove();
  const after=e.clientY>=rect.top+rect.height/2;
  const exit=previewExitTarget(block,after);
  activatePreviewExitTarget(exit.target,exit.created);
  if(exit.created){
    pushHistory(true);
  }
  return true;
}
function exitLensOnOutsideClick(e){
  const lens=activePreviewLens;
  if(!lens||!lens.isConnected){
    activePreviewLens=null;
    return false;
  }
  if(lens.contains(e.target))return false;
  activePreviewLens=null;
  if(!els.preview.contains(e.target)){
    const selection=window.getSelection();
    const range=selection?.rangeCount?selection.getRangeAt(0):null;
    if(range&&lens.contains(range.commonAncestorContainer))selection.removeAllRanges();
    state.savedPreviewRange=null;
    return false;
  }
  if(e.target!==els.preview)return false;
  e.preventDefault();
  e.stopPropagation();
  const after=e.clientY>=lens.getBoundingClientRect().bottom;
  let target=after?lens.nextElementSibling:lens.previousElementSibling;
  let created=false;
  if(!target||target.matches('.zz-lens,.code-block,table,hr')){
    target=document.createElement('p');
    target.innerHTML='<br>';
    lens.insertAdjacentElement(after?'afterend':'beforebegin',target);
    created=true;
  }
  activatePreviewExitTarget(target,created);
  if(created){
    pushHistory(true);
  }
  return true;
}
function exitPreviewCodeBlock(pre){
  if(!pre||!els.preview.contains(pre))return false;
  const codeBlock=pre.closest('.code-block')||pre;
  let target=codeBlock.nextElementSibling;
  if(!target||target.matches('.code-block,table,hr')){
    target=document.createElement('p');
    target.innerHTML='<br>';
    codeBlock.insertAdjacentElement('afterend',target);
  }
  activatePreviewExitTarget(target,true);
  pushHistory(true);
  activePreviewCodePre=null;
  return true;
}
function exitPreviewStructuredBlock(origin){
  let container=origin?.closest?.('blockquote,ul,ol');
  if(!container||!els.preview.contains(container))return false;
  const quote=container.matches('blockquote');
  let parent=container.parentElement?.closest?.(quote?'blockquote':'ul,ol');
  while(parent&&els.preview.contains(parent)){
    container=parent;
    parent=container.parentElement?.closest?.(quote?'blockquote':'ul,ol');
  }
  pushHistory(true);
  let target=container.nextElementSibling;
  if(!target||!target.matches('p')){
    target=document.createElement('p');
    target.innerHTML='<br>';
    container.insertAdjacentElement('afterend',target);
  }
  activatePreviewExitTarget(target,true);
  pushHistory(true);
  return true;
}
function previewListItemIsEmpty(item){
  if(!item?.matches?.('li'))return false;
  const clone=item.cloneNode(true);
  clone.querySelectorAll('ul,ol,.block-move-handle,.form-move-handle').forEach(node=>node.remove());
  const text=(clone.textContent||'').replace(/\u200b/g,'').trim();
  return !text&&!clone.querySelector('img,table,hr,pre');
}
function exitEmptyPreviewListItem(item){
  const list=item?.parentElement;
  if(!list?.matches?.('ul,ol')||!els.preview.contains(list))return false;
  let outer=list,parent=outer.parentElement?.closest?.('ul,ol');
  while(parent&&els.preview.contains(parent)){
    outer=parent;
    parent=outer.parentElement?.closest?.('ul,ol');
  }
  pushHistory(true);
  let target=outer.nextElementSibling;
  if(!target||!target.matches('p')){
    target=document.createElement('p');
    target.innerHTML='<br>';
    outer.insertAdjacentElement('afterend',target);
  }
  item.remove();
  let current=list;
  while(current&&current.matches?.('ul,ol')&&!current.querySelector(':scope > li')){
    const parentList=current.parentElement?.closest?.('ul,ol');
    current.remove();
    current=parentList;
  }
  placeCaretInPreviewBlock(target);
  rememberPreviewRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function exitPreviewInlineCode(code,range){
  if(!code||code.closest('pre')||!els.preview.contains(code))return false;
  const structure=code.closest('blockquote,ul,ol');
  if(structure)return exitPreviewStructuredBlock(code);
  const block=closestPreviewBlock(code);
  if(!block)return false;
  pushHistory(true);
  if(!range.collapsed)range.collapse(false);
  code.dataset.inlineExit='1';
  const tailRange=document.createRange();
  tailRange.setStart(range.startContainer,range.startOffset);
  tailRange.setEnd(block,block.childNodes.length);
  const tail=tailRange.extractContents();
  code.removeAttribute('data-inline-exit');
  const continuedCode=tail.querySelector('code[data-inline-exit]');
  if(continuedCode){
    continuedCode.replaceWith(document.createTextNode(continuedCode.textContent));
  }
  if(!code.textContent)code.remove();
  const nextBlock=document.createElement('p');
  nextBlock.appendChild(tail);
  if(!nextBlock.textContent&&!nextBlock.querySelector('br,img'))nextBlock.appendChild(document.createElement('br'));
  block.insertAdjacentElement('afterend',nextBlock);
  placeCaretInPreviewBlock(nextBlock);
  rememberPreviewRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function exitCodeOnBlankPreviewClick(e){
  if(e.target!==els.preview)return false;
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  const selectedNode=range&&(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement);
  const selectedPre=selectedNode?.closest?.('pre')||activePreviewCodePre;
  if(!selectedPre)return false;
  const codeBlock=selectedPre.closest('.code-block')||selectedPre;
  if(e.clientY<codeBlock.getBoundingClientRect().bottom)return false;
  e.preventDefault();
  return exitPreviewCodeBlock(selectedPre);
}
function normalizePreviewCodeCaret(){
  const selection=window.getSelection();
  if(!selection?.rangeCount)return;
  const live=selection.getRangeAt(0);
  const origin=live.endContainer.nodeType===1?live.endContainer:live.endContainer.parentElement;
  const code=origin?.closest?.('pre code');
  if(!code||!els.preview.contains(code)||!code.textContent.includes('\u200b'))return;
  const before=document.createRange();
  before.selectNodeContents(code);
  before.setEnd(live.endContainer,live.endOffset);
  const offset=before.toString().replace(/\u200b/g,'').length;
  const textNode=document.createTextNode(code.textContent.replace(/\u200b/g,''));
  code.replaceChildren(textNode);
  const next=document.createRange();
  next.setStart(textNode,Math.min(offset,textNode.data.length));
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
}
function previewBlockIsEmpty(block){
  if(!block)return false;
  const clone=block.cloneNode(true);
  clone.querySelectorAll('.block-move-handle,.form-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle').forEach(node=>node.remove());
  return !(clone.textContent||'').replace(/\u200b/g,'').trim()&&!clone.querySelector('img,table,hr,pre');
}
function previewRangeSideIsEmpty(block,range,beforeCaret){
  const side=document.createRange();
  side.selectNodeContents(block);
  if(beforeCaret)side.setEnd(range.startContainer,range.startOffset);
  else side.setStart(range.endContainer,range.endOffset);
  return !side.toString().replace(/\u200b/g,'').trim();
}
function trackPreviewEnterSplitInput(){
  const split=lastPreviewEnterSplit;
  if(!split)return;
  if(!split.previous?.isConnected||!split.next?.isConnected){
    lastPreviewEnterSplit=null;
    return;
  }
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  const block=range&&closestPreviewBlock(range.startContainer);
  if(block===split.previous||block===split.next)split.edited=true;
  else lastPreviewEnterSplit=null;
}
function normalizedPreviewInlineStyle(element){
  return [...element.style]
    .sort()
    .map(name=>`${name}:${element.style.getPropertyValue(name).trim()}!${element.style.getPropertyPriority(name)}`)
    .join(';');
}
function equivalentPreviewInlineElements(left,right){
  if(left.tagName!==right.tagName)return false;
  if(normalizedPreviewInlineStyle(left)!==normalizedPreviewInlineStyle(right))return false;
  if(left.getAttribute('class')!==right.getAttribute('class'))return false;
  if(left.getAttribute('color')!==right.getAttribute('color'))return false;
  const ignored=new Set(['style','class','color']);
  const attributes=element=>[...element.attributes]
    .filter(attribute=>!ignored.has(attribute.name))
    .map(attribute=>`${attribute.name}=${attribute.value}`)
    .sort()
    .join(';');
  return attributes(left)===attributes(right);
}
function mergeEquivalentPreviewSpans(root){
  root.querySelectorAll('span,font').forEach(element=>{
    if(!(element.textContent||'').replace(/\u200b/g,'')&&!element.querySelector('img,br'))element.remove();
  });
  let changed=true;
  while(changed){
    changed=false;
    root.querySelectorAll('span,font').forEach(element=>{
      if(!element.isConnected)return;
      let next=element.nextSibling;
      const between=[];
      while(next?.nodeType===Node.TEXT_NODE&&!next.textContent.replace(/\u200b/g,'').trim()){
        between.push(next);
        next=next.nextSibling;
      }
      if(next?.nodeType!==Node.ELEMENT_NODE||next.tagName!==element.tagName)return;
      if(!equivalentPreviewInlineElements(element,next))return;
      between.forEach(node=>element.appendChild(node));
      while(next.firstChild)element.appendChild(next.firstChild);
      next.remove();
      changed=true;
    });
  }
}
function previewSplitMatchesOriginal(split){
  if(!split?.previous?.isConnected||!split.next?.isConnected)return false;
  const holder=document.createElement('div');
  holder.innerHTML=split.previousHtml||'';
  const normalize=text=>String(text||'').replace(/\u200b/g,'').replace(/\u00a0/g,' ');
  const original=normalize(holder.textContent);
  const current=normalize(previewBlockPlainText(split.previous)+previewBlockPlainText(split.next));
  return current===original;
}
function previewSplitOriginalText(split){
  const holder=document.createElement('div');
  holder.innerHTML=split?.previousHtml||'';
  return (holder.textContent||'').replace(/\u200b/g,'').replace(/\u00a0/g,' ');
}
function previewTextPointAt(root,offset){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    return node.parentElement?.closest('.block-move-handle,.code-head')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;
  }});
  let remaining=Math.max(0,offset),node,last=null;
  while((node=walker.nextNode())){
    last=node;
    const length=node.data.replace(/\u200b/g,'').length;
    if(remaining<=length)return{node,offset:Math.min(node.data.length,remaining)};
    remaining-=length;
  }
  return last?{node:last,offset:last.data.length}:null;
}
function restorePreviewEnterSplit(split,caretOffset=split.splitTextOffset){
  const previous=split.previous,next=split.next;
  previous.innerHTML=split.previousHtml;
  const point=previewTextPointAt(previous,split.splitTextOffset);
  const tailRange=document.createRange();
  if(point)tailRange.setStart(point.node,point.offset);
  else tailRange.setStart(previous,previous.childNodes.length);
  tailRange.setEnd(previous,previous.childNodes.length);
  const tail=tailRange.extractContents();
  next.replaceChildren(tail);
  if(previewBlockIsEmpty(next))next.replaceChildren(document.createElement('br'));
  [previous,next].forEach(item=>{
    item.querySelectorAll(':scope > .block-move-handle,:scope > .form-move-handle').forEach(handle=>handle.remove());
    if(!item.textContent&&!item.querySelector('br,img,table,hr'))item.appendChild(document.createElement('br'));
  });
  mergeEquivalentPreviewSpans(previous);
  mergeEquivalentPreviewSpans(next);
  addMovableElements(els.preview);
  if(caretOffset<split.splitTextOffset)placeCaretAtPreviewTextOffset(previous,caretOffset);
  else placeCaretAtPreviewTextOffset(next,caretOffset-split.splitTextOffset);
  split.edited=false;
}
function previewSplitDeletionReturnsToOriginal(split,block,range,backward){
  if(!split?.edited||(block!==split.previous&&block!==split.next))return null;
  const normalize=text=>String(text||'').replace(/\u200b/g,'').replace(/\u00a0/g,' ');
  const previousText=normalize(previewBlockPlainText(split.previous));
  const nextText=normalize(previewBlockPlainText(split.next));
  const current=previousText+nextText;
  const before=document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer,range.startOffset);
  const localOffset=normalize(before.toString()).length;
  const caretOffset=(block===split.previous?0:previousText.length)+localOffset;
  const deleteAt=backward?caretOffset-1:caretOffset;
  if(deleteAt<0||deleteAt>=current.length)return null;
  const after=current.slice(0,deleteAt)+current.slice(deleteAt+1);
  return after===previewSplitOriginalText(split)?deleteAt:null;
}
function mergeEditedPreviewSplit(split){
  const previous=split.previous,next=split.next;
  const joinOffset=(previous.textContent||'').replace(/\u200b/g,'').length;
  previous.querySelectorAll(':scope > br').forEach(br=>{
    if(previewBlockIsEmpty(previous))br.remove();
  });
  while(next.firstChild)previous.appendChild(next.firstChild);
  next.remove();
  mergeEquivalentPreviewSpans(previous);
  return joinOffset;
}
function preservePreviewFormatOnDelete(e){
  const backward=e.key==='Backspace'||e.inputType==='deleteContentBackward';
  const forward=e.key==='Delete'||e.inputType==='deleteContentForward';
  if((!backward&&!forward)||e.ctrlKey||e.metaKey||e.altKey)return false;
  const range=previewRange();
  if(!range?.collapsed||!els.preview.contains(range.commonAncestorContainer))return false;
  const block=closestPreviewBlock(range.startContainer);
  if(!block||block.closest('pre,table'))return false;
  const split=lastPreviewEnterSplit;
  const mergeSplitBackward=backward&&split?.next===block&&split.previous===block.previousElementSibling&&previewRangeSideIsEmpty(block,range,true);
  const mergeSplitForward=forward&&split?.previous===block&&split.next===block.nextElementSibling&&previewRangeSideIsEmpty(block,range,false);
  if((mergeSplitBackward||mergeSplitForward)&&split.previous?.isConnected&&split.next?.isConnected){
    e.preventDefault();
    e.stopPropagation();
    clearClickMove();
    selectPreviewImage(null);
    pushHistory(true);
    const restoreOriginal=!split.edited||previewSplitMatchesOriginal(split);
    const caretOffset=restoreOriginal
      ?split.splitTextOffset
      :mergeEditedPreviewSplit(split);
    if(restoreOriginal){
      split.previous.innerHTML=split.previousHtml;
      split.next.remove();
    }
    addMovableElements(els.preview);
    placeCaretAtPreviewTextOffset(split.previous,caretOffset);
    lastPreviewEnterSplit=null;
    rememberPreviewRange();
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  const restoredCaret=split&&previewSplitDeletionReturnsToOriginal(split,block,range,backward);
  if(restoredCaret!==null&&restoredCaret!==undefined){
    e.preventDefault();
    e.stopPropagation();
    clearClickMove();
    selectPreviewImage(null);
    pushHistory(true);
    restorePreviewEnterSplit(split,restoredCaret);
    rememberPreviewRange();
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  let removeBlock,caretBlock;
  if(backward&&previewBlockIsEmpty(block)&&previewRangeSideIsEmpty(block,range,true)){
    removeBlock=block;
    caretBlock=block.previousElementSibling;
  }else if(forward&&previewRangeSideIsEmpty(block,range,false)&&previewBlockIsEmpty(block.nextElementSibling)){
    removeBlock=block.nextElementSibling;
    caretBlock=block;
  }
  if(!removeBlock||!caretBlock||caretBlock.matches('hr,table,.code-block'))return false;
  e.preventDefault();
  e.stopPropagation();
  clearClickMove();
  selectPreviewImage(null);
  pushHistory(true);
  if(split&&split.previous===caretBlock&&split.next===removeBlock&&caretBlock.isConnected){
    caretBlock.innerHTML=split.previousHtml;
  }
  lastPreviewEnterSplit=null;
  removeBlock.remove();
  placeCaretAtPreviewEnd(caretBlock);
  addMovableElements(els.preview);
  rememberPreviewRange();
  syncFromPreview();
  pushHistory(true);
  return true;
}
function insertPlainPreviewParagraph(e){
  if(e.key!=='Enter'||e.ctrlKey||e.metaKey||e.altKey)return false;
  const range=previewRange();
  if(!range||!els.preview.contains(range.commonAncestorContainer))return false;
  const origin=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  if(origin?.closest?.('table'))return false;
  const pre=origin?.closest?.('pre');
  if(e.shiftKey&&pre){
    e.preventDefault();
    return exitPreviewCodeBlock(pre);
  }
  const listItem=origin?.closest?.('li');
  if(!e.shiftKey&&previewListItemIsEmpty(listItem)){
    e.preventDefault();
    return exitEmptyPreviewListItem(listItem);
  }
  if(e.shiftKey){
    const inlineCode=origin?.closest?.('code');
    if(inlineCode&&!inlineCode.closest('pre')){
      e.preventDefault();
      return exitPreviewInlineCode(inlineCode,range);
    }
    const structure=origin?.closest?.('blockquote,ul,ol');
    if(!structure)return false;
    e.preventDefault();
    return exitPreviewStructuredBlock(origin);
  }
  e.preventDefault();
  pushHistory(true);
  if(pre){
    const code=pre.querySelector('code')||pre;
    const startRange=document.createRange();
    startRange.selectNodeContents(code);
    startRange.setEnd(range.startContainer,range.startOffset);
    const endRange=document.createRange();
    endRange.selectNodeContents(code);
    endRange.setEnd(range.endContainer,range.endOffset);
    const start=startRange.toString().replace(/\u200b/g,'').length;
    const end=endRange.toString().replace(/\u200b/g,'').length;
    const text=(code.textContent||'').replace(/\u200b/g,'');
    const textNode=document.createTextNode(text.slice(0,start)+'\n\u200b'+text.slice(end));
    code.replaceChildren(textNode);
    code.removeAttribute('data-highlighted');
    const next=document.createRange();
    next.setStart(textNode,start+1);
    next.collapse(true);
    const sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(next);
    state.savedPreviewRange=next.cloneRange();
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  const block=closestPreviewBlock(range.startContainer);
  const insertBeforeHeading=range.collapsed
    &&/^H[1-6]$/.test(block?.tagName||'')
    &&previewRangeSideIsEmpty(block,range,true);
  range.deleteContents();
  let previousHtml='';
  let nextBlock;
  if(insertBeforeHeading){
    nextBlock=document.createElement('p');
    nextBlock.innerHTML='<br>';
    block.insertAdjacentElement('beforebegin',nextBlock);
    lastPreviewEnterSplit=null;
    addMovableElements(els.preview);
    placeCaretInPreviewBlock(nextBlock);
    rememberPreviewRange();
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  if(block){
    const cleanBlock=block.cloneNode(true);
    cleanBlock.querySelectorAll('.block-move-handle,.form-move-handle,.tbl-resize-handle,.tbl-row-resize-handle,.tbl-table-resize-handle,.img-resize-handle').forEach(node=>node.remove());
    previousHtml=cleanBlock.innerHTML;
    range.collapse(true);
    const beforeSplit=document.createRange();
    beforeSplit.selectNodeContents(block);
    beforeSplit.setEnd(range.startContainer,range.startOffset);
    var splitTextOffset=beforeSplit.toString().replace(/\u200b/g,'').length;
    const tailRange=document.createRange();
    tailRange.setStart(range.startContainer,range.startOffset);
    tailRange.setEnd(block,block.childNodes.length);
    const tail=tailRange.extractContents();
    nextBlock=/^H[1-6]$/.test(block.tagName)?document.createElement('p'):block.cloneNode(false);
    nextBlock.removeAttribute('id');
    nextBlock.appendChild(tail);
    block.insertAdjacentElement('afterend',nextBlock);
    if(previewBlockIsEmpty(nextBlock)){
      nextBlock.replaceChildren(document.createElement('br'));
    }
    [block,nextBlock].forEach(item=>{
      item.querySelectorAll(':scope > .block-move-handle,:scope > .form-move-handle').forEach(handle=>handle.remove());
      if(!item.textContent&&!item.querySelector('br,img,table,hr'))item.appendChild(document.createElement('br'));
    });
    addMovableElements(els.preview);
  }else{
    nextBlock=document.createElement('p');
    nextBlock.innerHTML='<br>';
    els.preview.appendChild(nextBlock);
  }
  lastPreviewEnterSplit=block
    ?{previous:block,next:nextBlock,previousHtml,splitTextOffset}
    :null;
  placeCaretInPreviewBlock(nextBlock);
  syncFromPreview();
  pushHistory(true);
  return true;
}
function normalizedLinkUrl(value){
  let url=String(value||'').trim();
  if(!url||/^javascript:/i.test(url))return '';
  if(/^www\./i.test(url))url='https://'+url;
  return url;
}
function showLinkDialog(initialText='',initialUrl='https://',editing=false,initialStyle='standard'){
  return new Promise(resolve=>{
    let style=initialStyle==='chip'?'chip':'standard';
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card link-dialog-card" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
      <h3 id="link-dialog-title">${editing?'링크 수정':'링크 삽입'}</h3>
      <div class="link-style-preview"><span>미리보기</span><div class="link-style-preview-box" data-link-style-preview></div></div>
      <div class="link-dialog-fields">
        <label>표시할 텍스트<input class="file-dialog-input" type="text" data-link-field="text" value="${htmlEsc(initialText)}" placeholder="비워두면 링크 주소를 표시"></label>
        <label>링크 주소<input class="file-dialog-input" type="url" data-link-field="url" value="${htmlEsc(initialUrl||'https://')}" placeholder="https://example.com"></label>
      </div>
      <fieldset class="link-style-field">
        <legend>표시 형식</legend>
        <div class="link-style-options">
          <button class="link-style-option${style==='standard'?' active':''}" type="button" data-link-style="standard" aria-pressed="${style==='standard'}"><strong>일반 링크</strong><small>기존 밑줄 링크</small></button>
          <button class="link-style-option${style==='chip'?' active':''}" type="button" data-link-style="chip" aria-pressed="${style==='chip'}"><strong>출처 칩</strong><small>둥근 출처 표시</small></button>
        </div>
      </fieldset>
      <div class="file-dialog-error" aria-live="polite"></div>
      <div class="modal-actions"><button class="tool" type="button" data-link-action="cancel">취소</button><button class="tool primary" type="button" data-link-action="insert">${editing?'수정':'삽입'}</button></div>
    </div>`;
    const textInput=wrap.querySelector('[data-link-field="text"]');
    const urlInput=wrap.querySelector('[data-link-field="url"]');
    const error=wrap.querySelector('.file-dialog-error');
    const preview=wrap.querySelector('[data-link-style-preview]');
    const renderStylePreview=()=>{
      const url=normalizedLinkUrl(urlInput.value)||'https://example.com';
      const label=textInput.value.trim()||url;
      preview.innerHTML=style==='chip'
        ?`<a class="zz-source-chip" href="#" tabindex="-1"><span class="zz-source-chip-label">${htmlEsc(label)}</span></a>`
        :`<a href="#" tabindex="-1">${htmlEsc(label)}</a>`;
    };
    const done=value=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(value)};
    const insert=()=>{
      const url=normalizedLinkUrl(urlInput.value);
      if(!url){error.textContent='링크 주소를 입력해 주세요.';urlInput.focus();return}
      done({text:textInput.value.trim()||url,url,style});
    };
    const onKey=e=>{
      if(e.key==='Escape')done(null);
      else if(e.key==='Enter'){e.preventDefault();insert()}
    };
    wrap.querySelector('[data-link-action="cancel"]').onclick=()=>done(null);
    wrap.querySelector('[data-link-action="insert"]').onclick=insert;
    wrap.querySelectorAll('[data-link-style]').forEach(button=>button.onclick=()=>{
      style=button.dataset.linkStyle;
      wrap.querySelectorAll('[data-link-style]').forEach(item=>{
        const active=item.dataset.linkStyle===style;
        item.classList.toggle('active',active);
        item.setAttribute('aria-pressed',String(active));
      });
      renderStylePreview();
    });
    textInput.addEventListener('input',renderStylePreview);
    urlInput.addEventListener('input',renderStylePreview);
    preview.addEventListener('click',event=>event.preventDefault());
    wrap.addEventListener('click',e=>{if(e.target===wrap)done(null)});
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    renderStylePreview();
    urlInput.focus();
    urlInput.select();
  });
}
function showMathDialog(initialLatex='',initialDisplay='inline'){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card math-dialog-card" role="dialog" aria-modal="true" aria-labelledby="math-dialog-title">
      <h3 id="math-dialog-title">수식 입력</h3>
      <p>수식은 표준 Markdown의 $...$ 또는 $$...$$ 형태로 저장됩니다.</p>
      <div class="math-dialog-tools"><button class="tool ${initialDisplay==='inline'?'active':''}" type="button" data-math-mode="inline">인라인</button><button class="tool ${initialDisplay==='block'?'active':''}" type="button" data-math-mode="block">블록</button></div>
      <div class="math-field-wrap" data-math-field-wrap></div>
      <div class="math-template-row">
        <button type="button" data-math-template="\\frac{a}{b}">a/b</button>
        <button type="button" data-math-template="\\sqrt{x}">√</button>
        <button type="button" data-math-template="x^{n}">xⁿ</button>
        <button type="button" data-math-template="\\sum_{i=1}^{n}">Σ</button>
        <button type="button" data-math-template="\\int_{a}^{b}">∫</button>
        <button type="button" data-math-template="\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}">행렬</button>
      </div>
      <div class="math-live-preview" data-math-preview></div>
      <div class="file-dialog-error" aria-live="polite"></div>
      <div class="modal-actions"><button class="tool" type="button" data-math-action="cancel">취소</button><button class="tool primary" type="button" data-math-action="insert">${initialLatex?'수정':'삽입'}</button></div>
    </div>`;
    let mode=initialDisplay==='block'?'block':'inline';
    const host=wrap.querySelector('[data-math-field-wrap]');
    const useMathLive=!!customElements.get('math-field');
    const field=document.createElement(useMathLive?'math-field':'textarea');
    if(!useMathLive)field.className='math-latex-input';
    field.value=initialLatex;
    host.appendChild(field);
    const preview=wrap.querySelector('[data-math-preview]');
    const error=wrap.querySelector('.file-dialog-error');
    const value=()=>String(field.value||'').trim();
    const render=()=>{
      const latex=value();
      error.textContent='';
      if(!latex){preview.innerHTML='<span class="muted">수식을 입력해 주세요.</span>';return}
      try{
        preview.innerHTML=window.katex?katex.renderToString(latex,{displayMode:mode==='block',throwOnError:true,trust:false,strict:'warn'}):htmlEsc(latex);
      }catch(err){
        preview.textContent=latex;
        error.textContent='수식 문법을 확인해 주세요.';
      }
    };
    const done=result=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(result)};
    const insert=()=>{const latex=value();if(!latex){error.textContent='수식을 입력해 주세요.';field.focus();return}done({latex,display:mode})};
    const onKey=e=>{
      if(e.key==='Escape')done(null);
      else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();insert()}
    };
    wrap.querySelectorAll('[data-math-mode]').forEach(button=>button.onclick=()=>{
      mode=button.dataset.mathMode;
      wrap.querySelectorAll('[data-math-mode]').forEach(item=>item.classList.toggle('active',item===button));
      render();
    });
    wrap.querySelectorAll('[data-math-template]').forEach(button=>button.onclick=()=>{
      const template=button.dataset.mathTemplate;
      if(typeof field.insert==='function')field.insert(template);
      else{field.value+=template;field.focus()}
      render();
    });
    field.addEventListener('input',render);
    wrap.querySelector('[data-math-action="cancel"]').onclick=()=>done(null);
    wrap.querySelector('[data-math-action="insert"]').onclick=insert;
    wrap.addEventListener('click',e=>{if(e.target===wrap)done(null)});
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    render();
    setTimeout(()=>field.focus(),0);
  });
}
async function insertMathWithDialog(){
  rememberPreviewRange();
  const editorText=els.editor.value.slice(els.editor.selectionStart,els.editor.selectionEnd).trim();
  const initial=editorText.replace(/^\$\$?|\$\$?$/g,'');
  const result=await showMathDialog(initial,editorText.startsWith('$$')?'block':'inline');
  if(!result)return;
  const marker=result.display==='block'?'$$':'$';
  insertMarkdownSyntax(`${marker}${result.latex}${marker}`);
}
async function editPreviewMath(math){
  if(!math||!els.preview.contains(math))return;
  const result=await showMathDialog(math.dataset.latex||'',math.dataset.display||'inline');
  if(!result||!math.isConnected)return;
  const marker=result.display==='block'?'$$':'$';
  math.replaceWith(document.createTextNode(`${marker}${result.latex}${marker}`));
  syncFromPreview();
  renderMarkdown(els.editor.value);
  pushHistory(true);
}
async function insertLinkWithDialog(){
  rememberPreviewRange();
  const previewSelection=previewRange();
  const editorSelection={start:els.editor.selectionStart,end:els.editor.selectionEnd,text:els.editor.value.slice(els.editor.selectionStart,els.editor.selectionEnd)};
  const initialText=(previewSelection?.toString()||editorSelection.text||'').trim();
  const link=await showLinkDialog(initialText);
  if(!link)return false;
  if(previewSelection&&els.preview.contains(previewSelection.commonAncestorContainer)){
    state.savedPreviewRange=previewSelection.cloneRange();
    const className=link.style==='chip'?' class="zz-source-chip"':'';
    const title=link.style==='chip'?` title="${htmlEsc(link.url)}"`:'';
    const contents=link.style==='chip'?`<span class="zz-source-chip-label">${htmlEsc(link.text)}</span>`:htmlEsc(link.text);
    return insertPreviewHtml(`<a${className} href="${htmlEsc(link.url)}"${title}>${contents}</a>`);
  }
  state.savedSelection={start:editorSelection.start,end:editorSelection.end};
  els.editor.setSelectionRange(editorSelection.start,editorSelection.end);
  const label=link.text.replace(/]/g,'\\]');
  const url=link.url.replace(/\)/g,'\\)');
  replaceRange(`${link.style==='chip'?'``':''}[${label}](${url})`,editorSelection.start,editorSelection.end,true);
  return true;
}
async function editPreviewLink(link){
  if(!link||!els.preview.contains(link))return false;
  const originalText=(link.textContent||'').trim();
  const originalUrl=link.getAttribute('href')||'';
  const originalStyle=link.classList.contains('zz-source-chip')?'chip':'standard';
  const edited=await showLinkDialog(originalText,originalUrl,true,originalStyle);
  if(!edited||!link.isConnected||!els.preview.contains(link))return false;
  pushHistory(true);
  link.classList.toggle('zz-source-chip',edited.style==='chip');
  if(edited.style==='chip'){
    link.innerHTML=`<span class="zz-source-chip-label">${htmlEsc(edited.text)}</span>`;
    link.title=edited.url;
  }else{
    link.textContent=edited.text;
    link.removeAttribute('title');
  }
  link.setAttribute('href',edited.url);
  syncFromPreview();
  pushHistory(true);
  return true;
}
const LINK_NAVIGATION_NOTICE_KEY='zz-link-navigation-notice-dismissed-v1';
function confirmPreviewLinkNavigation(url){
  if(localStorage.getItem(LINK_NAVIGATION_NOTICE_KEY)==='1')return Promise.resolve(true);
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop link-navigation-dialog';
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="link-navigation-title">
      <h3 id="link-navigation-title">링크로 이동하시겠습니까?</h3>
      <p>새 창에서 다음 주소를 엽니다.</p>
      <p class="link-navigation-url">${htmlEsc(url)}</p>
      <label class="font-notice-dismiss"><input type="checkbox" data-link-dismiss> 다시는 보지 않기</label>
      <div class="modal-actions"><button class="tool" type="button" data-link-action="cancel">취소</button><button class="tool primary" type="button" data-link-action="open">이동</button></div>
    </div>`;
    const finish=result=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(result)};
    const onKey=event=>{if(event.key==='Escape')finish(false)};
    wrap.addEventListener('click',event=>{
      const action=event.target.closest('[data-link-action]')?.dataset.linkAction;
      if(action==='cancel'||event.target===wrap)return finish(false);
      if(action==='open'){
        if(wrap.querySelector('[data-link-dismiss]').checked)localStorage.setItem(LINK_NAVIGATION_NOTICE_KEY,'1');
        finish(true);
      }
    });
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-link-action="open"]')?.focus();
  });
}
function safePreviewLinkUrl(link){
  const raw=link?.getAttribute('href')||'';
  if(!raw)return'';
  try{
    const resolved=new URL(raw,location.href);
    return /^(https?:|mailto:|tel:|file:)$/.test(resolved.protocol)?resolved.href:'';
  }catch{return''}
}
[els.convertPreview,els.mergeResult,els.hoverPreview].forEach(root=>root?.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');
  if(!link||!root.contains(link))return;
  event.preventDefault();
  event.stopPropagation();
  const url=safePreviewLinkUrl(link);
  if(url)window.open(url,'_blank','noopener,noreferrer');
}));
els.preview.addEventListener('click',event=>{
  if(event.target.closest('a:not(.zz-wikilink):not(.zz-toc-link)'))event.preventDefault();
},true);
els.preview.addEventListener('dblclick',async event=>{
  const math=event.target.closest('.zz-math[data-latex]');
  if(math){
    event.preventDefault();
    event.stopImmediatePropagation();
    clearClickMove();
    hideMathContextMenu();
    closeSourceSyntaxPopover();
    await editPreviewMath(math);
    return;
  }
  const link=event.target.closest('a:not(.zz-wikilink):not(.zz-toc-link)');
  if(!link||link.classList.contains('zz-source-chip-editing')||event.target.closest('.zz-source-chip-edit'))return;
  event.preventDefault();
  event.stopPropagation();
  const url=safePreviewLinkUrl(link);
  if(!url){showInfoNotice('링크 이동','열 수 있는 링크 주소가 아닙니다.');return}
  if(await confirmPreviewLinkNavigation(url))window.open(url,'_blank','noopener,noreferrer');
},true);
document.addEventListener('keydown',event=>{
  if(event.key!=='F2'||!clickMoveElement?.matches?.('a.zz-source-chip')||!els.preview.contains(clickMoveElement))return;
  event.preventDefault();
  event.stopImmediatePropagation();
  startSourceChipInlineEdit(clickMoveElement);
},true);
function tableInsertHtml(rows=2,cols=3){
  const safeRows=Math.max(1,Math.min(100,Number(rows)||2));
  const safeCols=Math.max(1,Math.min(100,Number(cols)||3));
  const headings=Array.from({length:safeCols},(_,i)=>`<th>제목 ${i+1}</th>`).join('');
  const bodyRows=Array.from({length:Math.max(0,safeRows-1)},()=>`<tr>${'<td>내용</td>'.repeat(safeCols)}</tr>`).join('');
  return `<table><thead><tr>${headings}</tr></thead>${bodyRows?`<tbody>${bodyRows}</tbody>`:''}</table><p><br></p>`;
}
function insertPreviewTable(rows=2,cols=3){
  const range=previewRange();
  if(!range)return false;
  els.preview.focus();
  const current=window.getSelection();
  current.removeAllRanges();
  current.addRange(range);
  pushHistory(true);
  document.execCommand('insertHTML',false,tableInsertHtml(rows,cols));
  rememberPreviewRange();
  syncFromPreview();
  renderMarkdown(els.editor.value);
  pushHistory(true);
  return true;
}
function previewFormatElements(range){
  const elements=[];
  const add=node=>{
    const element=node?.nodeType===1?node:node?.parentElement;
    if(element&&els.preview.contains(element)&&!elements.includes(element))elements.push(element);
  };
  if(range.collapsed){add(range.startContainer);return elements}
  const walker=document.createTreeWalker(els.preview,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    if(!node.nodeValue?.trim())continue;
    try{if(range.intersectsNode(node))add(node)}catch{}
  }
  if(!elements.length)add(range.commonAncestorContainer);
  return elements;
}
function updatePreviewFormatButtons(range){
  const elements=previewFormatElements(range);
  if(!elements.length)return false;
  const every=predicate=>elements.every(element=>predicate(element,getComputedStyle(element)));
  const inBold=every((element,style)=>element.closest('strong,b')||style.fontWeight==='bold'||Number(style.fontWeight)>=600);
  const inItalic=every((element,style)=>element.closest('em,i')||style.fontStyle==='italic'||style.fontStyle==='oblique');
  const inUnder=every((element,style)=>element.closest('u')||style.textDecorationLine.includes('underline'));
  $('fmt-bold').classList.toggle('active',inBold);
  $('fmt-italic').classList.toggle('active',inItalic);
  $('fmt-underline').classList.toggle('active',inUnder);
  updateFormatButtons._last={inBold,inItalic,inUnder};
  return true;
}
function updateFormatButtons(){
  const selection=window.getSelection();
  const previewRange=selection?.rangeCount?selection.getRangeAt(0):null;
  if(previewRange&&els.preview.contains(previewRange.commonAncestorContainer)){
    updatePreviewFormatButtons(previewRange);
    return;
  }
  const v=els.editor.value,s=els.editor.selectionStart,e=els.editor.selectionEnd;
  const sel=v.slice(s,e),before=v.slice(0,s),after=v.slice(e);
  // Bold: ** or <strong>
  const selBoth=sel.startsWith('***')&&sel.endsWith('***')&&sel.length>6;
  const selBold=selBoth||(sel.startsWith('**')&&sel.endsWith('**')&&sel.length>4)||(sel.startsWith('<strong>')&&sel.endsWith('</strong>'));
  const curBold=/\*\*[^*]*$/.test(before)&&/^[^*]*\*\*/.test(after);
  const inBold=selBold||curBold;
  // Italic: * (single)
  const selCore=sel.replace(/^\*+/,'').replace(/\*+$/,'').replace(/^<strong>/,'').replace(/<\/strong>$/,'');
  const selItalic=selBoth||(!sel.startsWith('**')&&sel.startsWith('*')&&sel.endsWith('*')&&sel.length>2);
  const curItalic=(/(?<!\*)\*(?!\*)[^*]*$/.test(before)&&/^[^*]*\*(?!\*)/.test(after))||(/\*\*\*[^*]*$/.test(before)&&/^[^*]*\*\*\*/.test(after));
  const inItalic=selItalic||curItalic;
  // Underline: <u> — also detect when inside ** or <strong>
  const selUnder=sel.startsWith('<u>')&&sel.endsWith('</u>')||selCore.startsWith('<u>')&&selCore.endsWith('</u>');
  const lastUOpen=before.lastIndexOf('<u>');
  const firstUClose=after.indexOf('</u>');
  const curUnder=(lastUOpen>=0&&firstUClose>=0&&!before.slice(lastUOpen+3).includes('</u>')&&!after.slice(0,firstUClose).includes('<u>'))||selUnder;
  const inUnder=curUnder;
  $('fmt-bold').classList.toggle('active',inBold);
  $('fmt-italic').classList.toggle('active',inItalic);
  $('fmt-underline').classList.toggle('active',inUnder);
  updateFormatButtons._last={inBold,inItalic,inUnder};
}
// Bold: use <strong> when content has HTML (e.g. <u>), else **
$('fmt-bold').onclick=()=>{
  if(applyPreviewCommand('bold'))return;
  toggleEmphasis('bold');
};
$('fmt-italic').onclick=()=>{if(!applyPreviewCommand('italic'))toggleEmphasis('italic')};
$('fmt-underline').onclick=()=>{
  if(applyPreviewCommand('underline'))return;
  const sel=selectionText();
  let core=sel.text.trimEnd(),trail=sel.text.slice(core.length);
  // 마크다운 마커 안쪽에 <u> 삽입 (**bold** → **<u>bold</u>**)
  for(const mk of['**','*','__','_']){
    if(core.startsWith(mk)&&core.endsWith(mk)&&core.length>mk.length*2){
      const inner=core.slice(mk.length,-mk.length);
      // 이미 <u> 있으면 제거 (토글)
      if(inner.startsWith('<u>')&&inner.endsWith('</u>'))
        replaceRange(`${mk}${inner.slice(3,-4)}${mk}${trail}`,sel.start,sel.end,true);
      else
        replaceRange(`${mk}<u>${inner}</u>${mk}${trail}`,sel.start,sel.end,true);
      return;
    }
  }
  toggleWrap('<u>','</u>');
};
els.editor.addEventListener('mouseup',updateFormatButtons);
els.editor.addEventListener('keyup',updateFormatButtons);
document.addEventListener('selectionchange',()=>{
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(range&&els.preview.contains(range.commonAncestorContainer)){
    updateFormatButtons();
    updatePreviewFontSize();
  }else if(document.activeElement===els.editor)updateFormatButtons();
});
// ── Color palette ──
const MAX_CHIST=16,MAX_CSAVE=16,CUSTOM_THEME_HISTORY_MAX=16;
function loadC(k){try{return JSON.parse(localStorage.getItem(k))||[]}catch{return[]}}
function saveC(k,a){localStorage.setItem(k,JSON.stringify(a))}
const cs={tHist:loadC('md-c-th'),tSave:loadC('md-c-ts'),bHist:loadC('md-c-bh'),bSave:loadC('md-c-bs')};
const customThemeHist={
  background:loadC('md-theme-bg-hist'),
  text:loadC('md-theme-text-hist')
};
const customThemeSaved={
  background:loadC('md-theme-bg-saved'),
  text:loadC('md-theme-text-saved')
};
function pushHist(arr,color,max){const i=arr.indexOf(color);if(i>=0)arr.splice(i,1);arr.unshift(color);while(arr.length>max)arr.pop()}
function renderCustomThemeHistory(){
  const el=$('custom-theme-hist');
  if(!el)return;
  const colors=customThemeHist[customThemeChannel];
  el.innerHTML='';
  if(!colors.length){
    const empty=document.createElement('span');
    empty.className='cp-empty';
    empty.textContent='사용 기록 없음';
    el.appendChild(empty);
    return;
  }
  colors.slice(0,CUSTOM_THEME_HISTORY_MAX).forEach(color=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='cp-swatch';
    button.style.background=color;
    button.title=color;
    button.onclick=e=>{
      e.stopPropagation();
      setCustomThemeColor(color,true);
    };
    button.oncontextmenu=e=>{
      e.preventDefault();
      e.stopPropagation();
      saveCustomThemeColor(color);
    };
    el.appendChild(button);
  });
}
function renderCustomThemeSaved(){
  const el=$('custom-theme-saved');
  if(!el)return;
  const colors=customThemeSaved[customThemeChannel];
  el.innerHTML='';
  if(!colors.length){
    const empty=document.createElement('span');
    empty.className='cp-empty';
    empty.textContent='저장된 색 없음';
    el.appendChild(empty);
    return;
  }
  colors.forEach(color=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='cp-swatch saved';
    button.style.background=color;
    button.title=`${color} · 우클릭으로 삭제`;
    button.onclick=e=>{
      e.stopPropagation();
      setCustomThemeColor(color,true);
    };
    button.oncontextmenu=e=>{
      e.preventDefault();
      e.stopPropagation();
      const index=colors.indexOf(color);
      if(index>=0)colors.splice(index,1);
      saveC(customThemeChannel==='background'?'md-theme-bg-saved':'md-theme-text-saved',colors);
      renderCustomThemeSaved();
    };
    el.appendChild(button);
  });
}
function saveCustomThemeColor(color=customTheme[customThemeChannel]){
  const normalized=normalizeColorValue(color);
  if(!normalized)return false;
  const colors=customThemeSaved[customThemeChannel];
  pushHist(colors,normalized,MAX_CSAVE);
  saveC(customThemeChannel==='background'?'md-theme-bg-saved':'md-theme-text-saved',colors);
  renderCustomThemeSaved();
  return true;
}
function trackCustomThemeColor(channel,color){
  const colors=customThemeHist[channel];
  const key=channel==='background'?'md-theme-bg-hist':'md-theme-text-hist';
  pushHist(colors,color,CUSTOM_THEME_HISTORY_MAX);
  saveC(key,colors);
  renderCustomThemeHistory();
}
function savePaletteColor(type,color){
  const normalized=normalizeColorValue(color);
  if(!normalized)return false;
  const saved=type==='text'?cs.tSave:cs.bSave;
  const key=type==='text'?'md-c-ts':'md-c-bs';
  pushHist(saved,normalized,MAX_CSAVE);
  saveC(key,saved);
  renderAllSwatches();
  return true;
}

function renderSection(containerId,arr,saveKey,onPick,isSaved,type){
  const el=$(containerId);if(!el)return;el.innerHTML='';
  if(!arr.length){const e=document.createElement('span');e.className='cp-empty';e.textContent=isSaved?'저장된 색 없음':'사용 기록 없음';el.appendChild(e);return}
  arr.slice(0,isSaved?MAX_CSAVE:MAX_CHIST).forEach(c=>{
    const b=document.createElement('button');
    b.className='cp-swatch'+(isSaved?' saved':'');
    b.style.background=c;b.title=isSaved?`${c} · 우클릭으로 삭제`:`${c} · 우클릭으로 저장`;
    b.onclick=()=>{onPick(c);closeAllPanels()};
    if(isSaved)b.oncontextmenu=e=>{e.preventDefault();arr.splice(arr.indexOf(c),1);saveC(saveKey,arr);renderAllSwatches()};
    else b.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();savePaletteColor(type,c)};
    el.appendChild(b)
  })
}
function renderAllSwatches(){
  renderSection('text-color-hist',cs.tHist,'md-c-th',c=>applyPickedColor('text',c),false,'text');
  renderSection('text-color-saved',cs.tSave,'md-c-ts',c=>applyPickedColor('text',c),true,'text');
  renderSection('bg-color-hist',cs.bHist,'md-c-bh',c=>applyPickedColor('bg',c),false,'bg');
  renderSection('bg-color-saved',cs.bSave,'md-c-bs',c=>applyPickedColor('bg',c),true,'bg');
}
function trackColor(type,color){
  if(type==='text'){pushHist(cs.tHist,color,MAX_CHIST);saveC('md-c-th',cs.tHist)}
  else{pushHist(cs.bHist,color,MAX_CHIST);saveC('md-c-bh',cs.bHist)}
  renderAllSwatches();
}

// ── Panel positioning (fixed, escapes overflow:hidden) ──
const tableSizePanel=document.createElement('div');
tableSizePanel.id='table-size-panel';
tableSizePanel.className='table-size-panel hidden';
tableSizePanel.setAttribute('contenteditable','false');
tableSizePanel.innerHTML=`
  <div class="table-mode-tabs" role="tablist" aria-label="표 만들기 방식">
    <button class="table-mode-tab active" id="table-mode-create" type="button" role="tab" aria-selected="true" data-table-mode="create">빈 표 생성</button>
    <button class="table-mode-tab" id="table-mode-delimited" type="button" role="tab" aria-selected="false" data-table-mode="delimited">데이터로 표 만들기</button>
  </div>
  <section class="table-mode-section" id="table-create-section">
    <div class="table-size-label" id="table-size-label">2행 × 3열</div>
    <div class="table-size-grid" id="table-size-grid"></div>
    <button class="table-custom-toggle" id="table-custom-toggle" type="button">행·열 직접 입력…</button>
    <form class="table-custom-form hidden" id="table-custom-form">
      <label>행<input id="table-custom-rows" type="number" min="1" max="100" value="2" required></label>
      <label>열<input id="table-custom-cols" type="number" min="1" max="100" value="3" required></label>
      <button class="table-custom-submit" type="submit">빈 표 만들기</button>
    </form>
  </section>
  <section class="table-mode-section table-delimited" id="table-delimited-section" hidden>
    <label class="table-delimiter-title">구분할 텍스트<textarea id="table-delimited-text" placeholder="이름, 점수&#10;민지, 95&#10;서준, 88"></textarea></label>
    <span class="table-delimiter-title">구분자 · 여러 개 선택 가능</span>
    <div class="table-delimiter-options">
      <label class="table-delimiter-option"><input type="checkbox" value="auto" checked>자동 감지</label>
      <label class="table-delimiter-option"><input type="checkbox" value="tab">탭</label>
      <label class="table-delimiter-option"><input type="checkbox" value="comma">쉼표</label>
      <label class="table-delimiter-option"><input type="checkbox" value="space">띄어쓰기</label>
      <label class="table-delimiter-option"><input type="checkbox" value="slash">/</label>
      <label class="table-delimiter-option"><input type="checkbox" value="custom">기타</label>
    </div>
    <label class="table-custom-delimiter-wrap" id="table-custom-delimiter-wrap" hidden><span class="table-delimiter-title">기타 구분자</span><input id="table-custom-delimiter" type="text" maxlength="8" placeholder="예: ; 또는 ::"></label>
    <div class="table-delimiter-help">자동 감지는 탭·쉼표·띄어쓰기·/·세미콜론·| 중에서 여러 줄에 반복되고, 각 줄의 열 수가 가장 일정해지는 문자를 선택합니다. <span class="table-delimiter-status" id="table-delimiter-status"></span></div>
    <button class="table-custom-submit" id="table-delimited-submit" type="button">텍스트를 표로 변환</button>
  </section>`;
document.body.appendChild(tableSizePanel);
const tableSizeGrid=$('table-size-grid');
for(let row=1;row<=10;row++){
  for(let col=1;col<=10;col++){
    const cell=document.createElement('button');
    cell.type='button';
    cell.className='table-size-cell';
    cell.dataset.row=row;
    cell.dataset.col=col;
    cell.setAttribute('aria-label',`${row}행 ${col}열 표 삽입`);
    tableSizeGrid.appendChild(cell);
  }
}
function previewTableSize(rows=2,cols=3){
  $('table-size-label').textContent=`${rows}행 × ${cols}열`;
  tableSizeGrid.querySelectorAll('.table-size-cell').forEach(cell=>{
    cell.classList.toggle('selected',Number(cell.dataset.row)<=rows&&Number(cell.dataset.col)<=cols);
  });
}
function insertRequestedTable(rows,cols){
  const safeRows=Math.max(1,Math.min(100,Number(rows)||2));
  const safeCols=Math.max(1,Math.min(100,Number(cols)||3));
  closeAllPanels();
  if(insertPreviewTable(safeRows,safeCols))return;
  const header=`| ${Array.from({length:safeCols},(_,i)=>`제목 ${i+1}`).join(' | ')} |`;
  const divider=`| ${Array(safeCols).fill('---').join(' | ')} |`;
  const body=Array.from({length:Math.max(0,safeRows-1)},()=>`| ${Array(safeCols).fill('내용').join(' | ')} |`).join('\n');
  insertBlock([header,divider,body].filter(Boolean).join('\n'));
}
previewTableSize();

const PANELS=['text-color-panel','bg-color-panel','custom-theme-panel','ins-menu','syntax-menu','table-size-panel'];
const TOGGLES=['text-color-toggle','bg-color-toggle','fmt-insert-toggle','fmt-syntax-toggle','fmt-table-toggle'];
function closeAllPanels(){
  PANELS.forEach(id=>{const el=$(id);if(el)el.classList.add('hidden')});
  TOGGLES.forEach(id=>{
    const el=$(id);
    if(!el)return;
    el.classList.remove('active');
    if(el.hasAttribute('aria-expanded'))el.setAttribute('aria-expanded','false');
  });
}
function openPanel(panelId,toggleId){
  closeAllPanels();
  const panel=$(panelId),toggle=$(toggleId);
  if(!panel||!toggle)return;
  panel.classList.remove('hidden');
  toggle.classList.add('active');
  if(toggle.hasAttribute('aria-expanded'))toggle.setAttribute('aria-expanded','true');
  // position fixed below the toggle button
  const r=toggle.getBoundingClientRect();
  const panelTop=r.bottom+6;
  panel.style.top=panelTop+'px';
  panel.style.left=Math.min(r.left,window.innerWidth-panel.offsetWidth-8)+'px';
  if(panel.classList.contains('cp-panel')){
    panel.style.maxHeight=Math.max(160,window.innerHeight-panelTop-8)+'px';
    panel.style.overflowY='auto';
  }
}
$('text-color-toggle').onclick=e=>{
  e.stopPropagation();
  const open=!$('text-color-panel').classList.contains('hidden');
  open?closeAllPanels():openPanel('text-color-panel','text-color-toggle');
};
$('bg-color-toggle').onclick=e=>{
  e.stopPropagation();
  const open=!$('bg-color-panel').classList.contains('hidden');
  open?closeAllPanels():openPanel('bg-color-panel','bg-color-toggle');
};
$('fmt-table-toggle').addEventListener('mousedown',e=>{
  e.preventDefault();
  rememberPreviewRange();
});
$('fmt-table-toggle').onclick=e=>{
  e.stopPropagation();
  const open=!tableSizePanel.classList.contains('hidden');
  if(open){
    closeAllPanels();
    return;
  }
  previewTableSize();
  $('table-custom-form').classList.add('hidden');
  setTablePanelMode('create');
  openPanel('table-size-panel','fmt-table-toggle');
};
function setTablePanelMode(mode){
  const delimited=mode==='delimited';
  $('table-create-section').hidden=delimited;$('table-delimited-section').hidden=!delimited;
  tableSizePanel.querySelectorAll('[data-table-mode]').forEach(button=>{const active=button.dataset.tableMode===mode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});
  if(delimited){updateDelimiterControls();$('table-delimited-text').focus()}
}
tableSizePanel.querySelector('.table-mode-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-table-mode]');if(button){event.stopPropagation();setTablePanelMode(button.dataset.tableMode)}});
tableSizeGrid.addEventListener('pointerover',e=>{
  const cell=e.target.closest('.table-size-cell');
  if(cell)previewTableSize(Number(cell.dataset.row),Number(cell.dataset.col));
});
tableSizeGrid.addEventListener('pointerleave',()=>previewTableSize());
tableSizeGrid.addEventListener('click',e=>{
  const cell=e.target.closest('.table-size-cell');
  if(!cell)return;
  e.stopPropagation();
  const rows=Number(cell.dataset.row);
  const cols=Number(cell.dataset.col);
  insertRequestedTable(rows,cols);
});
$('table-custom-toggle').onclick=e=>{
  e.stopPropagation();
  const form=$('table-custom-form');
  form.classList.toggle('hidden');
  if(!form.classList.contains('hidden'))$('table-custom-rows').focus();
};
$('table-custom-form').onsubmit=e=>{
  e.preventDefault();
  e.stopPropagation();
  const rows=$('table-custom-rows');
  const cols=$('table-custom-cols');
  if(!rows.reportValidity()||!cols.reportValidity())return;
  insertRequestedTable(rows.value,cols.value);
};
const delimiterDefinitions={tab:{value:'\t',label:'탭'},comma:{value:',',label:'쉼표'},space:{value:' ',label:'띄어쓰기'},slash:{value:'/',label:'/'},semicolon:{value:';',label:'세미콜론'},pipe:{value:'|',label:'|'}};
function splitWithDelimiters(line,delimiters){
  const values=[];let value='',quoted=false;
  for(let i=0;i<line.length;){
    const ch=line[i];
    if(ch==='"'&&line[i+1]==='"'&&quoted){value+='"';i+=2;continue}
    if(ch==='"'){quoted=!quoted;i++;continue}
    let matched='';
    if(!quoted){
      if(delimiters.includes(' ')&&/\s/.test(ch))matched=line.slice(i).match(/^\s+/)?.[0]||'';
      for(const delimiter of delimiters.filter(item=>item!==' ').sort((a,b)=>b.length-a.length))if(line.startsWith(delimiter,i)){matched=delimiter;break}
    }
    if(matched){values.push(value.trim());value='';i+=matched.length}else{value+=ch;i++}
  }
  values.push(value.trim());return values;
}
function detectTableDelimiter(lines){
  const candidates=Object.entries(delimiterDefinitions).map(([kind,definition])=>{
    const counts=lines.map(line=>splitWithDelimiters(line,[definition.value]).length),usable=counts.filter(count=>count>1).length;
    const frequencies=new Map();counts.filter(count=>count>1).forEach(count=>frequencies.set(count,(frequencies.get(count)||0)+1));
    const consistent=Math.max(0,...frequencies.values()),score=usable?consistent/lines.length*100+usable*5+counts.reduce((sum,count)=>sum+count,0)/lines.length:0;
    return{kind,...definition,score,usable,consistent};
  }).filter(item=>item.usable>=Math.max(1,Math.ceil(lines.length*.6))).sort((a,b)=>b.score-a.score);
  return candidates[0]||null;
}
function selectedTableDelimiters(text){
  const kinds=[...tableSizePanel.querySelectorAll('.table-delimiter-options input:checked')].map(input=>input.value),lines=String(text||'').replace(/\r/g,'').split('\n').filter(line=>line.trim());
  const detected=kinds.includes('auto')&&lines.length?detectTableDelimiter(lines):null,values=kinds.filter(kind=>kind!=='auto'&&kind!=='custom').map(kind=>delimiterDefinitions[kind]?.value).filter(Boolean);
  if(detected)values.push(detected.value);
  if(kinds.includes('custom')&&$('table-custom-delimiter').value)values.push($('table-custom-delimiter').value);
  return{values:[...new Set(values)],detected};
}
function updateDelimiterControls(){
  const custom=tableSizePanel.querySelector('.table-delimiter-options input[value="custom"]').checked;
  $('table-custom-delimiter-wrap').hidden=!custom;
  const {detected}=selectedTableDelimiters($('table-delimited-text').value);
  $('table-delimiter-status').textContent=detected?`현재 감지: ${detected.label}`:$('table-delimited-text').value.trim()?'감지 결과 없음':'';
}
function parseDelimitedRows(text,kinds,custom=''){
  const lines=String(text||'').replace(/\r/g,'').split('\n').filter(line=>line.trim());
  if(!lines.length)return[];
  const {values}=selectedTableDelimiters(text);if(!values.length)return[];
  const rows=lines.map(line=>splitWithDelimiters(line,values)),cols=Math.max(...rows.map(row=>row.length));
  return rows.map(row=>[...row,...Array(cols-row.length).fill('')]);
}
function insertDelimitedTable(rows){
  if(!rows.length)return;
  const html=`<table><thead><tr>${rows[0].map(value=>`<th>${htmlEsc(value)}</th>`).join('')}</tr></thead>${rows.length>1?`<tbody>${rows.slice(1).map(row=>`<tr>${row.map(value=>`<td>${htmlEsc(value)}</td>`).join('')}</tr>`).join('')}</tbody>`:''}</table><p><br></p>`;
  closeAllPanels();
  if(insertPreviewHtml(html))return;
  const md=rows.map((row,index)=>`| ${row.map(value=>String(value).replace(/\|/g,'\\|')).join(' | ')} |${index===0?`\n| ${row.map(()=>'---').join(' | ')} |`:''}`).join('\n');
  insertBlock(md);
}
$('table-delimited-submit').onclick=e=>{
  e.stopPropagation();
  const text=$('table-delimited-text').value,kinds=[...tableSizePanel.querySelectorAll('.table-delimiter-options input:checked')].map(input=>input.value),custom=$('table-custom-delimiter').value;
  const rows=parseDelimitedRows(text,kinds,custom);
  if(!rows.length){showInfoNotice('표 만들기','구분할 텍스트와 올바른 구분자를 입력해 주세요.');return}
  insertDelimitedTable(rows);
};
tableSizePanel.querySelector('.table-delimiter-options').addEventListener('change',updateDelimiterControls);
$('table-delimited-text').addEventListener('input',updateDelimiterControls);
$('table-custom-delimiter').addEventListener('input',updateDelimiterControls);
document.addEventListener('click',e=>{
  if(!e.target.closest('.info-notice')&&!e.target.closest('.cp-wrap')&&!e.target.closest('.cp-panel')&&!e.target.closest('#fmt-insert-toggle')&&!e.target.closest('#ins-menu')&&!e.target.closest('#fmt-syntax-toggle')&&!e.target.closest('#syntax-menu')&&!e.target.closest('#table-insert-control')&&!e.target.closest('#table-size-panel')&&!e.target.closest('#ac-panel')&&!e.target.closest('#autocorrect-toggle'))
    closeAllPanels();
});

// ── Autocorrect panel ──
const acPanelHtml=`
<div id="ac-panel" class="ac-panel hidden">
  <div class="ac-group">
    <div class="ac-group-title">작성 옵션</div>
    <label title="Enter를 누르면 마크다운 강제 줄바꿈 문법인 공백 두 칸 + 줄바꿈을 넣습니다.">
      <input type="checkbox" id="enable-paragraph-break" checked>
      <span><b>Enter로 줄바꿈</b><div class="ac-desc">Enter로 바로 줄바꿈</div></span>
    </label>
    <label title="프리뷰에서 완성한 마크다운 문법을 굵게, 코드, 제목, 목록 등의 실제 서식으로 바로 변환합니다.">
      <input type="checkbox" id="enable-preview-markdown" checked>
      <span><b>프리뷰 MD 문법 적용</b><div class="ac-desc">입력한 MD 문법을 바로 서식으로 변환</div></span>
    </label>
    <label title="URL을 붙여넣으면 클릭할 수 있는 링크 서식으로 자동 변환합니다.">
      <input type="checkbox" id="enable-auto-link" checked>
      <span><b>URL 자동 링크</b><div class="ac-desc">붙여넣은 주소를 링크로 자동 변환</div></span>
    </label>
    <div class="ac-option-block">
      <label title="미리보기의 글씨에 설정한 시간 동안 마우스를 올리면 원문을 수정할 수 있는 작은 창을 표시합니다.">
        <input type="checkbox" id="enable-source-syntax-hover" checked>
        <span><b>문법 빠른 편집</b><div class="ac-desc">미리보기에서 드래그한 글씨의 실제 문법 수정</div></span>
      </label>
      <div class="ac-hover-delay" id="source-syntax-hover-delay-wrap">
        <span>창 표시까지</span><input type="number" id="source-syntax-hover-delay" min="1" max="30" step="1" value="5" inputmode="numeric" aria-label="빠른 편집 대기 시간"><span>초</span>
      </div>
    </div>
    <label title="마크다운 기호 안 불필요한 공백을 자동으로 제거합니다.&#10;&#10;예시:&#10;  **김밥 **  →  **김밥**&#10;  * 텍스트 *  →  *텍스트*&#10;  _ 내용 _  →  _내용_&#10;  \` 코드 \`  →  \`코드\`&#10;  [ 링크 ](url)  →  [링크](url)&#10;  ##  제목  →  ## 제목&#10;&#10;* 및 _ 를 입력할 때만 실행됩니다.">
      <input type="checkbox" id="enable-autocorrect" checked>
      <span><b>기호 공백 보정</b><div class="ac-desc">MD 기호 안의 불필요한 공백 제거</div></span>
    </label>
    <label title="라이트 모드에서 흰색/밝은 글씨를 검은색 계열로,&#10;다크 모드에서 검은색/어두운 글씨를 흰색 계열로&#10;자동 변환하여 가독성을 높입니다.&#10;&#10;(미리보기에만 적용, 원본은 변경하지 않음)">
      <input type="checkbox" id="enable-color-correct" checked>
      <span><b>색상 가독성 보정</b><div class="ac-desc">모드에 맞춰 글자색 자동 보정</div></span>
    </label>
  </div>
  <div class="ac-group">
    <div class="ac-group-title">보기 옵션</div>
    <label><input type="checkbox" id="enable-table-filter"><span><b>표 필터·정렬</b><div class="ac-desc">표 머리글에서 필터·정렬 · 원문은 유지</div></span></label>
    <label title="편집창과 미리보기의 세로 스크롤 위치를 서로 맞춥니다.">
      <input type="checkbox" id="enable-sync-scroll">
      <span><b>스크롤 동기화</b><div class="ac-desc">Markdown과 Preview를 함께 스크롤</div></span>
    </label>
    <label title="마크다운 편집창 왼쪽에 행 번호를 표시합니다.">
      <input type="checkbox" id="enable-line-numbers">
      <span><b>행 번호 보기</b><div class="ac-desc">Markdown(편집 모드)에서 현재 위치를 행 번호로 표시</div></span>
    </label>
    <label title="분할 보기에서 Preview를 왼쪽, Markdown을 오른쪽으로 배치합니다.">
      <input type="checkbox" id="enable-swap-panes">
      <span><b>분할 위치 바꾸기</b><div class="ac-desc">Preview와 Markdown의 좌우 위치 변경</div></span>
    </label>
    <label title="문서 탐색 하단에 현재 문서에서 사용한 해시태그를 모아서 표시합니다.">
      <input type="checkbox" id="enable-hashtag-navigator">
      <span><b>해시태그 탐색</b><div class="ac-desc">문서의 #태그를 모아 빠르게 이동</div></span>
    </label>
  </div>
</div>`;
document.body.insertAdjacentHTML('beforeend',acPanelHtml);
PANELS.push('ac-panel');TOGGLES.push('autocorrect-toggle');
$('autocorrect-toggle').onclick=e=>{
  e.stopPropagation();
  const open=!$('ac-panel').classList.contains('hidden');
  open?closeAllPanels():openPanel('ac-panel','autocorrect-toggle');
};
$('enable-autocorrect').checked=acEnabled;
$('enable-color-correct').checked=colorCorrectEnabled;
$('enable-paragraph-break').checked=paragraphBreakEnabled;
$('enable-sync-scroll').checked=syncScrollEnabled;
$('enable-line-numbers').checked=savedOption('md-option-line-numbers',false);
$('enable-table-filter').checked=savedOption('md-option-table-filter',false);
$('enable-table-filter').onchange=e=>{localStorage.setItem('md-option-table-filter',e.target.checked?'1':'0');document.querySelector('.table-filter-popup')?.remove();resetTableFilterView(els.preview);if(e.target.checked)installTableFilters()};
$('enable-swap-panes').checked=savedOption('md-option-swap-panes',false);
$('enable-hashtag-navigator').checked=hashtagNavigatorEnabled;
$('enable-autocorrect').onchange=e=>{acEnabled=e.target.checked;localStorage.setItem('md-option-autocorrect',acEnabled?'1':'0')};
$('enable-sync-scroll').onchange=e=>{syncScrollEnabled=e.target.checked;localStorage.setItem('md-option-sync-scroll',syncScrollEnabled?'1':'0')};
$('enable-line-numbers').onchange=e=>{setLineNumbers(e.target.checked);localStorage.setItem('md-option-line-numbers',e.target.checked?'1':'0')};
$('enable-swap-panes').onchange=e=>{setSwapPanes(e.target.checked);localStorage.setItem('md-option-swap-panes',e.target.checked?'1':'0')};
$('enable-hashtag-navigator').onchange=e=>{hashtagNavigatorEnabled=e.target.checked;localStorage.setItem('md-option-hashtag-navigator',hashtagNavigatorEnabled?'1':'0');renderDocumentOutline()};
$('enable-paragraph-break').onchange=e=>{paragraphBreakEnabled=e.target.checked;localStorage.setItem('md-option-paragraph-break',paragraphBreakEnabled?'1':'0')};
$('enable-preview-markdown').checked=previewMarkdownEnabled;
$('enable-preview-markdown').onchange=e=>{
  previewMarkdownEnabled=e.target.checked;
  localStorage.setItem('md-preview-markdown',previewMarkdownEnabled?'1':'0');
  if(previewMarkdownEnabled){
    const range=previewRange();
    const node=range?.endContainer;
    const block=node&&previewEditBlock(node);
    if(block)applyPreviewMarkdown(block);
  }
};
$('enable-auto-link').checked=autoLinkEnabled;
$('enable-auto-link').onchange=e=>{
  autoLinkEnabled=e.target.checked;
  localStorage.setItem('md-auto-link',autoLinkEnabled?'1':'0');
};
$('enable-source-syntax-hover').checked=sourceSyntaxHoverEnabled;
$('source-syntax-hover-delay').value=String(sourceSyntaxHoverDelaySeconds);
$('source-syntax-hover-delay-wrap').hidden=!sourceSyntaxHoverEnabled;
$('enable-source-syntax-hover').onchange=e=>{
  sourceSyntaxHoverEnabled=e.target.checked;
  localStorage.setItem('md-source-syntax-hover',sourceSyntaxHoverEnabled?'1':'0');
  $('source-syntax-hover-delay-wrap').hidden=!sourceSyntaxHoverEnabled;
  if(!sourceSyntaxHoverEnabled)closeSourceSyntaxPopover();
};
$('source-syntax-hover-delay').onchange=e=>{
  sourceSyntaxHoverDelaySeconds=Math.max(1,Math.min(30,Math.round(Number(e.target.value)||5)));
  e.target.value=String(sourceSyntaxHoverDelaySeconds);
  localStorage.setItem('md-source-syntax-hover-delay',String(sourceSyntaxHoverDelaySeconds));
  clearTimeout(sourceSyntaxHoverTimer);
  sourceSyntaxHoverCandidate=null;
};
$('enable-color-correct').onchange=e=>{colorCorrectEnabled=e.target.checked;localStorage.setItem('md-option-color-correct',colorCorrectEnabled?'1':'0');renderMarkdown(els.editor.value)};

// ── Insert menu (구분선, 줄바꿈 등) ──
const insMenuHtml=`
<div id="ins-menu" class="ins-menu hidden">
  <button class="ins-item" id="ins-hr"><span class="ins-item-icon">─</span>수평선<span class="ins-item-desc">---</span></button>
  <button class="ins-item" id="ins-br"><span class="ins-item-icon">↵</span>줄바꿈<span class="ins-item-desc">&lt;br&gt;</span></button>
  <button class="ins-item" id="ins-pagebreak"><span class="ins-item-icon">⋯</span>페이지 구분<span class="ins-item-desc">***</span></button>
  <div class="ins-sep"></div>
  <button class="ins-item" id="ins-quote"><span class="ins-item-icon">&gt;</span>인용<span class="ins-item-desc">&gt; 텍스트</span></button>
  <button class="ins-item" id="ins-quote2"><span class="ins-item-icon">&gt;&gt;</span>중첩 인용<span class="ins-item-desc">&gt;&gt; 텍스트</span></button>
  <button class="ins-item" id="ins-footnote"><span class="ins-item-icon">¹</span>각주<span class="ins-item-desc">[^1]</span></button>
  <button class="ins-item" id="ins-citation"><span class="ins-item-icon">“”</span>출처 인용<span class="ins-item-desc">[@key]</span></button>
  <button class="ins-item" id="ins-bibliography"><span class="ins-item-icon">¶</span>참고문헌<span class="ins-item-desc">[@key]: 출처</span></button>
  <div class="ins-sep"></div>
  <button class="ins-item" id="ins-icode"><span class="ins-item-icon">\`\`</span>인라인 코드<span class="ins-item-desc">\`코드\`</span></button>
  <button class="ins-item" id="ins-block-code"><span class="ins-item-icon">{ }</span>코드 블록<span class="ins-item-desc">\`\`\`...\`\`\`</span></button>
  <div class="ins-sep"></div>
  <button class="ins-item" id="ins-ul"><span class="ins-item-icon">•</span>순서없는 목록<span class="ins-item-desc">- 항목</span></button>
  <button class="ins-item" id="ins-ol"><span class="ins-item-icon">1.</span>순서있는 목록<span class="ins-item-desc">1. 항목</span></button>
</div>`;
const syntaxMenuHtml=`
<div id="syntax-menu" class="ins-menu hidden">
  <div class="ins-group-head">
    <span>확장 Markdown</span>
    <button class="ins-group-help" type="button" aria-label="확장 Markdown 저장 지원 안내" aria-expanded="false">?</button>
    <div class="ins-help-popover hidden" role="tooltip">전용 서식 출력은 PDF 저장만 지원합니다. MD 저장에는 문법 원문이 보존됩니다.</div>
  </div>
  <button class="ins-item" id="ins-zz-toc"><span class="ins-item-icon">≡</span>문서 목차<span class="ins-item-desc">제목 이동 목록</span></button>
  <button class="ins-item" id="ins-zz-sync"><span class="ins-item-icon">↔</span>동기화 블록<span class="ins-item-desc">같은 ID의 내용 연결</span></button>
  <button class="ins-item" id="ins-doc-embed"><span class="ins-item-icon">▣</span>미니 문서<span class="ins-item-desc">[[문서!ALL]]</span></button>
  <div class="ins-sep"></div>
  <div class="ins-group-head">
    <span>Obsidian 계열 문법</span>
    <button class="ins-group-help" type="button" aria-label="Obsidian 계열 문법 저장 지원 안내" aria-expanded="false">?</button>
    <div class="ins-help-popover hidden" role="tooltip">전용 서식 출력은 PDF 저장만 지원합니다. MD 저장에는 Obsidian 문법 원문이 보존됩니다.</div>
  </div>
  <button class="ins-item" id="ins-obsidian-callout"><span class="ins-item-icon">!</span>콜아웃<span class="ins-item-desc">&gt; [!note]</span></button>
  <button class="ins-item" id="ins-obsidian-wikilink"><span class="ins-item-icon">[[]]</span>위키 링크<span class="ins-item-desc">[[문서]]</span></button>
  <button class="ins-item" id="ins-obsidian-embed"><span class="ins-item-icon">!</span>파일 임베드<span class="ins-item-desc">![[파일]]</span></button>
  <button class="ins-item" id="ins-obsidian-highlight"><span class="ins-item-icon">==</span>하이라이트<span class="ins-item-desc">==텍스트==</span></button>
</div>`;
document.body.insertAdjacentHTML('beforeend',insMenuHtml+syntaxMenuHtml);
$('fmt-insert-toggle').onclick=e=>{
  e.stopPropagation();
  const open=!$('ins-menu').classList.contains('hidden');
  open?closeAllPanels():openPanel('ins-menu','fmt-insert-toggle');
};
$('fmt-syntax-toggle').onclick=e=>{
  e.stopPropagation();
  const open=!$('syntax-menu').classList.contains('hidden');
  open?closeAllPanels():openPanel('syntax-menu','fmt-syntax-toggle');
};
function setInsertHelpVisible(button,visible){
  const popover=button.closest('.ins-group-head')?.querySelector('.ins-help-popover');
  if(!popover)return;
  popover.classList.toggle('hidden',!visible);
  button.setAttribute('aria-expanded',visible?'true':'false');
}
$('syntax-menu').querySelectorAll('.ins-group-help').forEach(button=>{
  button.addEventListener('mouseenter',()=>setInsertHelpVisible(button,true));
  button.addEventListener('mouseleave',()=>{
    if(button.dataset.pinned!=='1')setInsertHelpVisible(button,false);
  });
  button.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    const pin=button.dataset.pinned!=='1';
    $('syntax-menu').querySelectorAll('.ins-group-help').forEach(other=>{
      other.dataset.pinned='0';
      setInsertHelpVisible(other,false);
    });
    button.dataset.pinned=pin?'1':'0';
    setInsertHelpVisible(button,pin);
  });
});
function previewRangeContent(fallback){
  const range=previewRange();
  if(!range)return null;
  const box=document.createElement('div');
  box.appendChild(range.cloneContents());
  return box.innerHTML.trim()||htmlEsc(fallback);
}
function insertPreviewQuote(level){
  const content=previewRangeContent('텍스트');
  if(content===null)return false;
  const inner=`<blockquote><p>${content}</p></blockquote>`;
  return insertPreviewHtml(level===2?`<blockquote>${inner}</blockquote>`:inner,'quote');
}
function insertPreviewList(ordered){
  const range=previewRange();
  if(!range)return false;
  const lines=(range.toString().trim()||'항목').split(/\r?\n/).filter(Boolean);
  const tag=ordered?'ol':'ul';
  return insertPreviewHtml(`<${tag}>${lines.map(line=>`<li>${htmlEsc(line)}</li>`).join('')}</${tag}>`);
}
function insertMarkdownSyntax(syntax,context=null){
  restoreInsertionContext(context);
  const range=context?.kind==='preview'?context.range.cloneRange():previewRange();
  if(range&&els.preview.contains(range.commonAncestorContainer)){
    els.preview.focus();
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    range.deleteContents();
    const node=document.createTextNode(syntax);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    syncFromPreview();
    renderMarkdown(els.editor.value);
    pushHistory(true);
    return true;
  }
  const selected=context?.kind==='editor'
    ?{start:context.start,end:context.end,text:els.editor.value.slice(context.start,context.end)}
    :selectionText();
  replaceRange(syntax,selected.start,selected.end,true);
  return true;
}
function insertMarkdownBlockAtContext(syntax,context){
  restoreInsertionContext(context);
  if(context?.kind==='preview'&&context.range&&els.preview.contains(context.range.commonAncestorContainer)){
    const range=context.range.cloneRange();
    if(!range.collapsed)range.deleteContents();
    const template=document.createElement('template');
    template.innerHTML=markdownHtml(syntax);
    const inserted=[...template.content.childNodes];
    if(!inserted.length)return false;
    const anchor=context.anchor?.isConnected&&context.anchor.parentNode===els.preview
      ?context.anchor
      :previewTopLevelAnchor(range);
    pushHistory(true);
    if(anchor)anchor.after(template.content);
    else if(range.commonAncestorContainer===els.preview&&range.endOffset===0)els.preview.prepend(template.content);
    else els.preview.appendChild(template.content);
    fixSpanColors(els.preview);
    addMovableElements(els.preview);
    const caret=document.createRange();
    caret.setStartAfter(inserted[inserted.length-1]);
    caret.collapse(true);
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(caret);
    state.savedPreviewRange=caret.cloneRange();
    syncFromPreview();
    pushHistory(true);
    return true;
  }
  insertBlockAtEditorContext(syntax,context);
  return true;
}
function zzLensStarter(type){
  if(type==='quiz')return'Q: 질문을 입력하세요.\nA: 답변을 입력하세요.';
  if(type==='timeline')return'2026: 첫 번째 사건\n2027: 다음 사건';
  if(type==='compare')return'항목 A: 첫 번째 설명\n항목 B: 두 번째 설명';
  return'## 핵심 내용\n\n- 첫 번째 요점\n- 두 번째 요점';
}
function showZzLensDialog(selected=''){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card zz-feature-dialog" role="dialog" aria-modal="true" aria-labelledby="lens-dialog-title">
      <h3 id="lens-dialog-title">다중 보기 블록</h3>
      <p>한 번 작성한 내용을 원문, 요약, 관련 항목으로 전환해 볼 수 있습니다.</p>
      <div class="link-dialog-fields">
        <label>블록 제목
          <input class="file-dialog-input" type="text" data-lens-title value="핵심 정리" placeholder="예: 시험 전 핵심 정리">
          <span class="zz-dialog-help">문서 안에서 이 블록을 구별할 이름입니다.</span>
        </label>
        <label>내용을 보는 방식
          <select class="file-dialog-input" data-lens-type>
            <option value="note">핵심 요약</option>
            <option value="quiz">질문과 답</option>
            <option value="timeline">시간 순서</option>
            <option value="compare">항목 비교</option>
          </select>
          <span class="zz-dialog-help" data-lens-help>긴 내용에서 핵심 문장을 모아 봅니다.</span>
        </label>
        <label class="zz-dialog-wide">내용
          <textarea class="file-dialog-input" rows="7" data-lens-content placeholder="정리할 내용을 입력하세요.">${htmlEsc(selected)}</textarea>
          <span class="zz-dialog-help">선택한 글이 있으면 자동으로 들어옵니다. 만든 뒤에도 본문에서 수정할 수 있습니다.</span>
        </label>
      </div>
      <div class="zz-dialog-preview">
        <span class="zz-dialog-preview-title">만들어지는 모습</span>
        <div class="zz-dialog-preview-body" data-lens-preview></div>
      </div>
      <div class="modal-actions"><button class="tool" type="button" data-lens-action="cancel">취소</button><button class="tool primary" type="button" data-lens-action="insert">삽입</button></div>
    </div>`;
    const title=wrap.querySelector('[data-lens-title]');
    const type=wrap.querySelector('[data-lens-type]');
    const content=wrap.querySelector('[data-lens-content]');
    const help=wrap.querySelector('[data-lens-help]');
    const preview=wrap.querySelector('[data-lens-preview]');
    const descriptions={
      note:'긴 내용에서 핵심 문장을 모아 봅니다.',
      quiz:'Q:와 A:로 작성한 내용을 질문과 답으로 봅니다.',
      timeline:'연도나 날짜가 있는 내용을 순서대로 봅니다.',
      compare:'여러 항목을 나란히 비교해 봅니다.'
    };
    const labels={note:'핵심 요약',quiz:'질문과 답',timeline:'시간 순서',compare:'항목 비교'};
    const updatePreview=()=>{
      const mode=type.value,label=labels[mode];
      help.textContent=descriptions[mode];
      preview.innerHTML=`<div class="zz-dialog-preview-row"><small>제목</small><span>${htmlEsc(title.value.trim()||'핵심 정리')}</span></div>
        <div class="zz-dialog-preview-row"><small>보기</small><span>원문 · ${htmlEsc(label)} · 관련 항목</span></div>
        <div class="zz-dialog-preview-row"><small>용도</small><span>${htmlEsc(descriptions[mode])}</span></div>`;
    };
    const done=value=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(value)};
    const insert=()=>{
      const mode=type.value;
      done({
        type:mode,
        title:title.value.trim()||'핵심 정리',
        content:content.value.trim()||zzLensStarter(mode)
      });
    };
    const onKey=e=>{
      if(e.key==='Escape')done(null);
      else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();insert()}
    };
    wrap.querySelector('[data-lens-action="cancel"]').onclick=()=>done(null);
    wrap.querySelector('[data-lens-action="insert"]').onclick=insert;
    [title,type].forEach(control=>control.addEventListener('input',updatePreview));
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    updatePreview();
    (selected?title:content).focus();
    if(!selected)content.value=zzLensStarter(type.value);
  });
}
async function insertZzLens(){
  const context=captureInsertionContext();
  const options=await showZzLensDialog(context.text.trim());
  if(!options)return;
  const attrs=` type="${options.type}" title="${encodeUniqueTitleAttribute(options.title)}"`;
  insertMarkdownBlockAtContext(`<!-- zz:lens${attrs} -->\n${options.content}\n<!-- /zz:lens -->`,context);
}
function showZzTocDialog(initial=null){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card zz-feature-dialog" role="dialog" aria-modal="true" aria-labelledby="toc-dialog-title">
      <h3 id="toc-dialog-title">${initial?'목차 순서':'문서 목차'}</h3>
      <p>문서의 제목을 찾아 클릭 가능한 이동 목록을 만듭니다. 제목을 바꾸면 목차도 함께 바뀝니다.</p>
      <div class="link-dialog-fields">
        <label>포함할 제목
          <select class="file-dialog-input" data-toc-depth>
            <option value="1-2">큰 제목만 (제목 1-2)</option>
            <option value="2-4" selected>일반 목차 (제목 2-4)</option>
            <option value="1-6">모든 제목 (제목 1-6)</option>
          </select>
          <span class="zz-dialog-help">숫자가 클수록 더 작은 하위 제목까지 포함합니다.</span>
        </label>
        <label>항목 방향
          <select class="file-dialog-input" data-toc-layout>
            <option value="vertical">세로</option>
            <option value="horizontal">가로</option>
          </select>
          <span class="zz-dialog-help">목차 항목이 이어지는 방향을 정합니다.</span>
        </label>
        <label>목차 모양
          <select class="file-dialog-input" data-toc-style>
            <option value="default">세로 목록</option>
            <option value="compact">간단한 2열</option>
            <option value="index" selected>번호와 연결선</option>
          </select>
          <span class="zz-dialog-help">문서 내용은 바뀌지 않고 목차의 모양만 달라집니다.</span>
        </label>
        <label class="check-row zz-dialog-wide"><input type="checkbox" data-toc-numbered checked><span>1, 1.1처럼 번호 붙이기</span></label>
      </div>
      <div class="zz-dialog-preview">
        <span class="zz-dialog-preview-title">현재 문서에서 보이는 항목</span>
        <div class="zz-dialog-preview-body" data-toc-preview></div>
      </div>
      <div class="modal-actions"><button class="tool" type="button" data-toc-action="cancel">취소</button><button class="tool primary" type="button" data-toc-action="insert">${initial?'적용':'삽입'}</button></div>
    </div>`;
    const depth=wrap.querySelector('[data-toc-depth]');
    const style=wrap.querySelector('[data-toc-style]');
    const layout=wrap.querySelector('[data-toc-layout]');
    const numbered=wrap.querySelector('[data-toc-numbered]');
    if(initial){
      depth.value=initial.depth||'2-4';
      style.value=initial.style||'index';
      layout.value=initial.layout||'vertical';
      numbered.checked=initial.numbered!==false;
    }
    const preview=wrap.querySelector('[data-toc-preview]');
    const updatePreview=()=>{
      const entries=zzTocEntries(zzCurrentDocumentHeadings(depth.value),numbered.checked);
      preview.innerHTML=entries.length
        ?entries.slice(0,7).map(item=>`<div class="zz-dialog-preview-row" style="padding-left:${Math.min(item.depth,3)*14}px"><small>H${item.level}</small><span>${htmlEsc(`${item.number?item.number+'. ':''}${item.text}`)}</span></div>`).join('')+(entries.length>7?`<div class="zz-dialog-empty">외 ${entries.length-7}개 제목</div>`:'')
        :'<div class="zz-dialog-empty">이 범위에 해당하는 제목이 없습니다.</div>';
    };
    const done=value=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(value)};
    const insert=()=>done({
      depth:depth.value,
      style:style.value,
      layout:layout.value,
      numbered:numbered.checked
    });
    const onKey=e=>{if(e.key==='Escape')done(null);else if(e.key==='Enter'){e.preventDefault();insert()}};
    wrap.querySelector('[data-toc-action="cancel"]').onclick=()=>done(null);
    wrap.querySelector('[data-toc-action="insert"]').onclick=insert;
    [depth,style,layout,numbered].forEach(control=>control.addEventListener('change',updatePreview));
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    updatePreview();
    depth.focus();
  });
}
async function insertZzToc(){
  const context=captureInsertionContext();
  const options=await showZzTocDialog();
  if(!options)return;
  const attrs=` depth="${options.depth}" style="${options.style}" layout="${options.layout}"${options.numbered?' numbered':''}`;
  const headings=zzCurrentDocumentHeadings(options.depth);
  const body=zzTocMarkdown(headings,options.numbered)||'- 문서에 표시할 제목이 없습니다.';
  const syntax=`<!-- zz:toc${attrs} -->\n${body}\n<!-- /zz:toc -->`;
  insertMarkdownBlockAtContext(syntax,context);
}
async function editZzTocBlock(block){
  if(!block?.matches?.('.zz-toc[data-toc-source]'))return;
  const source=uniqueBlockSource(block),marker=source.match(/<!--\s*zz:toc\b([^>]*)-->/i);
  if(!marker)return;
  const rawAttrs=marker[1]||'',attrs=parseZzAttributes(rawAttrs);
  const options=await showZzTocDialog({
    depth:attrs.depth||'2-4',
    style:['default','compact','index'].includes((attrs.style||'').toLowerCase())?attrs.style.toLowerCase():'index',
    layout:(attrs.layout||'vertical').toLowerCase()==='horizontal'?'horizontal':'vertical',
    numbered:/\bnumbered\b/i.test(rawAttrs)&&!/\bnumbered\s*=\s*(?:"?false"?|"?0"?)/i.test(rawAttrs)
  });
  if(!options||!els.preview.contains(block))return;
  const savedOrder=attrs.order?` order="${String(attrs.order).replace(/"/g,'&quot;')}"`:'';
  const nextAttrs=` depth="${options.depth}" style="${options.style}" layout="${options.layout}"${options.numbered?' numbered':''}${savedOrder}`;
  const headings=zzCurrentDocumentHeadings(options.depth);
  const body=zzTocMarkdown(headings,options.numbered)||'- 문서에 표시할 제목이 없습니다.';
  const nextSource=`<!-- zz:toc${nextAttrs} -->\n${body}\n<!-- /zz:toc -->`;
  const editorSource=els.editor.value;
  let start=editorSource.indexOf(source),length=source.length;
  if(start<0){
    const normalized=normalizeZzTocMarkers(editorSource);
    start=normalized.indexOf(source);
    if(start>=0){
      els.editor.value=normalized;
      length=source.length;
    }
  }
  if(start<0){
    showInfoNotice('목차 수정 실패','원문에서 선택한 목차를 찾지 못했습니다. 미리보기를 새로 고친 뒤 다시 시도해 주세요.');
    return;
  }
  pushHistory(true);
  const current=els.editor.value;
  els.editor.value=current.slice(0,start)+nextSource+current.slice(start+length);
  els.editor.setSelectionRange(start+nextSource.length,start+nextSource.length);
  clearClickMove();
  renderMarkdown(els.editor.value);
  pushHistory(true);
}
function showSyncBlockDialog(initialId=''){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card link-dialog-card" role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title">
      <h3 id="sync-dialog-title">동기화 블록</h3>
      <p>같은 ID를 사용한 블록은 어느 한 곳을 편집해도 함께 바뀝니다.</p>
      <div class="link-dialog-fields"><label>블록 ID<input class="file-dialog-input" type="text" data-sync-field value="${htmlEsc(initialId)}" placeholder="예: project-summary"></label></div>
      <div class="file-dialog-error" aria-live="polite"></div>
      <div class="modal-actions"><button class="tool" type="button" data-sync-action="cancel">취소</button><button class="tool primary" type="button" data-sync-action="insert">삽입</button></div>
    </div>`;
    const input=wrap.querySelector('[data-sync-field]');
    const error=wrap.querySelector('.file-dialog-error');
    const done=value=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(value)};
    const insert=()=>{
      const id=input.value.trim().replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'');
      if(!id){error.textContent='블록 ID를 입력해 주세요.';input.focus();return}
      done(id);
    };
    const onKey=e=>{if(e.key==='Escape')done(null);else if(e.key==='Enter'){e.preventDefault();insert()}};
    wrap.querySelector('[data-sync-action="cancel"]').onclick=()=>done(null);
    wrap.querySelector('[data-sync-action="insert"]').onclick=insert;
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    input.focus();
  });
}
async function insertZzSync(){
  const context=captureInsertionContext();
  const id=await showSyncBlockDialog();
  if(!id)return;
  const selected=context.text.trim();
  const existing=[...els.editor.value.matchAll(/<!--\s*zz:sync\s+id\s*=\s*"([^"]+)"\s*-->\r?\n([\s\S]*?)\r?\n<!--\s*\/zz:sync\s*-->/gi)]
    .find(match=>match[1].trim().toLowerCase()===id.toLowerCase());
  const content=(existing?.[2]??selected)||'동기화할 내용을 입력하세요.';
  insertMarkdownBlockAtContext(`<!-- zz:sync id="${id}" -->\n${content}\n<!-- /zz:sync -->`,context);
}
function insertObsidianCallout(){
  const context=captureInsertionContext();
  const selected=context.text.trim();
  const body=(selected||'내용을 입력하세요.')
    .split(/\r?\n/)
    .map(line=>`> ${line}`)
    .join('\n');
  insertMarkdownBlockAtContext(`> [!note] 메모\n${body}`,context);
}
function insertObsidianWikiLink(){
  const context=captureInsertionContext();
  const selected=context.text.trim();
  insertMarkdownSyntax(`[[${selected||'문서명'}]]`,context);
}
function insertObsidianEmbed(){
  const context=captureInsertionContext();
  const selected=context.text.trim();
  insertMarkdownSyntax(`![[${selected||'파일명.png'}]]`,context);
}
function insertObsidianHighlight(){
  const context=captureInsertionContext();
  const selected=context.text.trim();
  insertMarkdownSyntax(`==${selected||'강조할 텍스트'}==`,context);
}
function showInsertDialog(title,body,confirmLabel='삽입',setup){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>${htmlEsc(title)}</h3>${body}<div class="modal-actions"><button class="tool" type="button" data-action="cancel">취소</button><button class="tool primary" type="button" data-action="confirm">${htmlEsc(confirmLabel)}</button></div></div>`;
    const finish=value=>{document.removeEventListener('keydown',onKey);wrap.remove();resolve(value)};
    const onKey=e=>{if(e.key==='Escape')finish(null);else if(e.key==='Enter'&&!e.target.closest('textarea')&&!wrap.querySelector('[data-action="confirm"]').disabled){e.preventDefault();finish(wrap)}};
    wrap.addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(action==='cancel')finish(null);else if(action==='confirm')finish(wrap)});
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    if(typeof setup==='function')setup(wrap);
    wrap.querySelector('input,select,button')?.focus();
  });
}
function showFormInsertPanel(body,onConfirm){
  let resolvePanel;
  const promise=new Promise(resolve=>{resolvePanel=resolve});
  const panel=document.createElement('div');
  panel.className='find-replace-panel form-insert-panel';
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','false');
  panel.setAttribute('aria-labelledby','form-insert-title');
  panel.innerHTML=`<div class="find-replace-head" data-form-drag>
      <strong id="form-insert-title">양식 개체</strong>
      <button class="find-replace-close" type="button" data-form-action="cancel" aria-label="닫기">×</button>
    </div>
    <div class="find-replace-body">
      ${body}
      <div class="modal-actions">
        <button class="tool" type="button" data-form-action="cancel">취소</button>
        <button class="tool primary" type="button" data-form-action="confirm">삽입</button>
      </div>
    </div>`;
  let finished=false;
  const finish=value=>{
    if(finished)return;
    finished=true;
    document.removeEventListener('keydown',onKey);
    panel.remove();
    resolvePanel(value);
  };
  const onKey=event=>{
    if(event.key==='Escape'&&panel.contains(document.activeElement)){
      event.preventDefault();
      finish(null);
    }
  };
  panel.addEventListener('click',event=>{
    const action=event.target.closest('[data-form-action]')?.dataset.formAction;
    if(action==='cancel')finish(null);
    else if(action==='confirm'&&typeof onConfirm==='function')onConfirm(panel);
  });
  const drag=panel.querySelector('[data-form-drag]');
  drag.addEventListener('pointerdown',event=>{
    if(event.target.closest('button'))return;
    const rect=panel.getBoundingClientRect();
    const offsetX=event.clientX-rect.left;
    const offsetY=event.clientY-rect.top;
    let moved=false;
    drag.setPointerCapture(event.pointerId);
    const move=moveEvent=>{
      moved=true;
      panel.style.transform='none';
      panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,moveEvent.clientX-offsetX))}px`;
      panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,moveEvent.clientY-offsetY))}px`;
      panel.style.right='auto';
    };
    const up=()=>{
      if(moved)saveFloatingPanelPosition(panel,'zz-form-insert-position-v1');
      drag.removeEventListener('pointermove',move);
      drag.removeEventListener('pointerup',up);
      drag.removeEventListener('pointercancel',up);
    };
    drag.addEventListener('pointermove',move);
    drag.addEventListener('pointerup',up);
    drag.addEventListener('pointercancel',up);
  });
  document.addEventListener('keydown',onKey);
  document.body.appendChild(panel);
  restoreFloatingPanelPosition(panel,'zz-form-insert-position-v1');
  panel.querySelector('input,select,button')?.focus();
  return{panel,promise,close:()=>finish(null)};
}
async function insertFootnote(){
  const context=captureInsertionContext();
  const id=Math.max(1,...[...els.editor.value.matchAll(/\[\^(\d+)\]/g)].map(match=>Number(match[1])+1));
  insertMarkdownSyntax(`[^${id}]`,context);
  appendReferenceDefinition(`[^${id}]: 각주 내용을 입력하세요.`);
}
async function insertCitationDefinition(){
  const context=captureInsertionContext();
  const dialog=await showInsertDialog('출처 인용',`<div class="insert-config-grid"><label>출처 키<input id="zz-cite-key" value="source1"></label><label>표시 위치<select id="zz-cite-mode"><option value="both">본문과 참고문헌</option><option value="definition">참고문헌만</option></select></label></div><label class="custom-font-field">출처 정보<input id="zz-cite-body" placeholder="저자, 제목, 발행처, 연도"></label>`);
  if(!dialog)return;
  const key=dialog.querySelector('#zz-cite-key').value.trim().replace(/[^\w가-힣-]/g,'-')||'source1';
  const body=dialog.querySelector('#zz-cite-body').value.trim()||'출처 정보를 입력하세요.';
  const mode=dialog.querySelector('#zz-cite-mode').value;
  if(mode==='both')insertMarkdownSyntax(`[@${key}]`,context);
  appendReferenceDefinition(`[@${key}]: ${body}`);
}
async function insertBibliography(){
  captureInsertionContext();
  const dialog=await showInsertDialog('참고문헌 추가',`<div class="insert-config-grid"><label>출처 키<input id="zz-bib-key" value="source1"></label><label>형식<select><option>일반 참고문헌</option></select></label></div><label class="custom-font-field">출처 정보<input id="zz-bib-body" placeholder="저자, 제목, 발행처, 연도"></label>`);
  if(!dialog)return;
  const key=dialog.querySelector('#zz-bib-key').value.trim().replace(/[^\w가-힣-]/g,'-')||'source1';
  const body=dialog.querySelector('#zz-bib-body').value.trim()||'출처 정보를 입력하세요.';
  appendReferenceDefinition(`[@${key}]: ${body}`);
}
let lastFormInsert={
  type:'checkbox',
  label:'항목',
  options:[
    {label:'선택 1',value:'option-1'},
    {label:'선택 2',value:'option-2'}
  ],
  selectedIndex:0
};
function insertFormControl(){
  const existing=document.querySelector('.form-insert-panel');
  if(existing){
    existing.querySelector('input,select,button')?.focus();
    return;
  }
  let context=captureInsertionContext();
  const selected=type=>lastFormInsert.type===type?' selected':'';
  const optionRow=(option,index)=>`<div class="form-option-row">
    <input type="radio" name="zz-form-default" value="${index}"${index===lastFormInsert.selectedIndex?' checked':''} aria-label="기본 선택">
    <input type="text" class="zz-form-option-label" value="${htmlEsc(option.label)}" placeholder="표시명">
    <input type="text" class="zz-form-option-value" value="${htmlEsc(option.value)}" placeholder="저장값">
    <button class="form-option-remove" type="button" aria-label="옵션 삭제" title="옵션 삭제">×</button>
  </div>`;
  const {panel}=showFormInsertPanel(`<div class="insert-config-grid"><label>개체 종류<select id="zz-form-type"><option value="checkbox"${selected('checkbox')}>선택 상자</option><option value="radio"${selected('radio')}>라디오 단추</option><option value="select"${selected('select')}>콤보 상자</option><option value="text"${selected('text')}>입력 상자</option><option value="button"${selected('button')}>명령 단추</option></select></label><label>표시 문구<input id="zz-form-label" value="${htmlEsc(lastFormInsert.label)}"></label></div>
    <div class="form-option-editor"${lastFormInsert.type==='select'?'':' hidden'}>
      <div class="form-option-editor-head"><span>기본</span><span>표시명</span><span>저장값</span><span></span></div>
      <div class="form-option-list">${lastFormInsert.options.map(optionRow).join('')}</div>
      <button class="form-option-add" type="button">+ 옵션 추가</button>
    </div>
    <p class="custom-font-copy">미리보기에서 선택·입력할 수 있으며, 현재 값은 MD의 HTML에 함께 저장됩니다.</p>`,dialog=>{
    const type=dialog.querySelector('#zz-form-type').value;
    const rawLabel=dialog.querySelector('#zz-form-label').value.trim()||'항목';
    const options=[...dialog.querySelectorAll('.form-option-row')].map((row,index)=>({
      label:row.querySelector('.zz-form-option-label').value.trim()||`선택 ${index+1}`,
      value:row.querySelector('.zz-form-option-value').value.trim()||`option-${index+1}`
    }));
    const selectedIndex=Math.max(0,Number(dialog.querySelector('input[name="zz-form-default"]:checked')?.value)||0);
    lastFormInsert={type,label:rawLabel,options,selectedIndex};
    const label=htmlEsc(rawLabel);
    const selectOptions=options.map((option,index)=>`<option value="${htmlEsc(option.value)}"${index===selectedIndex?' selected':''}>${htmlEsc(option.label)}</option>`).join('');
    const controls={
      checkbox:`<label class="zz-form-control"><input type="checkbox"><span class="zz-form-label">${label}</span></label>`,
      radio:`<label class="zz-form-control"><input type="radio"><span class="zz-form-label">${label}</span></label>`,
      select:`<label class="zz-form-control"><span class="zz-form-label">${label}</span><select>${selectOptions}</select></label>`,
      text:`<label class="zz-form-control"><span class="zz-form-label">${label}</span><input type="text" value="" placeholder="입력"></label>`,
      button:`<button class="zz-form-control" type="button"><span class="zz-form-label">${label}</span></button>`
    };
    const html=`<p>${controls[type]}</p>`;
    const inserted=context.kind==='preview'
      ?insertPreviewHtmlAtContext(html,context)
      :insertMarkdownSyntax(html,context);
    if(!inserted){
      showInfoNotice('양식 개체','삽입할 위치를 다시 선택한 뒤 시도해 주세요.');
      return;
    }
    if(context.kind==='preview'){
      const nextRange=previewRange();
      if(nextRange&&els.preview.contains(nextRange.commonAncestorContainer)){
        context={
          kind:'preview',
          range:nextRange.cloneRange(),
          anchor:previewTopLevelAnchor(nextRange),
          text:''
        };
      }
    }else{
      const start=Math.max(0,Math.min(els.editor.value.length,els.editor.selectionStart));
      const end=Math.max(start,Math.min(els.editor.value.length,els.editor.selectionEnd));
      context={kind:'editor',start,end,text:els.editor.value.slice(start,end)};
    }
    state.pendingInsertionContext=null;
  });
  const typeField=panel.querySelector('#zz-form-type');
  const optionEditor=panel.querySelector('.form-option-editor');
  const optionList=panel.querySelector('.form-option-list');
  const syncOptionIndexes=()=>{
    [...optionList.querySelectorAll('.form-option-row')].forEach((row,index)=>{
      row.querySelector('input[type="radio"]').value=index;
    });
  };
  typeField?.addEventListener('change',()=>{optionEditor.hidden=typeField.value!=='select'});
  panel.addEventListener('click',event=>{
    if(event.target.closest('.form-option-add')){
      const index=optionList.children.length;
      optionList.insertAdjacentHTML('beforeend',optionRow({label:`선택 ${index+1}`,value:`option-${index+1}`},index));
      syncOptionIndexes();
      optionList.lastElementChild?.querySelector('.zz-form-option-label')?.focus();
      return;
    }
    const remove=event.target.closest('.form-option-remove');
    if(!remove)return;
    if(optionList.children.length===1){
      const row=remove.closest('.form-option-row');
      row.querySelector('.zz-form-option-label').value='';
      row.querySelector('.zz-form-option-value').value='';
      return;
    }
    const wasChecked=remove.closest('.form-option-row').querySelector('input[type="radio"]').checked;
    remove.closest('.form-option-row').remove();
    syncOptionIndexes();
    if(wasChecked)optionList.querySelector('input[type="radio"]').checked=true;
  });
}
async function insertDocumentEmbed(){
  const context=captureInsertionContext();
  if(!state.files.length){showInfoNotice('미니 문서','먼저 문서를 업로드하거나 만들어 주세요.');return}
  const options=state.files.map(file=>`<option value="${htmlEsc(file.name)}">${htmlEsc(file.name)}</option>`).join('');
  let selectedStart=null,selectedEnd=null,selectingEnd=false;
  const dialog=await showInsertDialog('미니 문서 삽입',`<div class="insert-config-grid"><label>문서<select id="zz-doc-name">${options}</select></label><label>범위<select id="zz-doc-mode"><option value="ALL">전체 문서</option><option value="MINI">일부 선택</option></select></label><div class="doc-range-picker" id="zz-doc-range-picker" hidden><div class="doc-range-picker-head"><span>원문 미리보기</span><span class="doc-range-picker-status" id="zz-doc-range-status">시작 지점을 선택하세요</span></div><div class="doc-range-list" id="zz-doc-range-list"></div></div></div><p class="custom-font-copy">삽입된 내용은 편집할 수 없습니다. 블록을 선택하면 복사·붙여넣기·삭제·이동할 수 있습니다.</p>`,'삽입',wrap=>{
    wrap.classList.add('mini-doc-dialog');
    const nameInput=wrap.querySelector('#zz-doc-name');
    const modeInput=wrap.querySelector('#zz-doc-mode');
    const picker=wrap.querySelector('#zz-doc-range-picker');
    const list=wrap.querySelector('#zz-doc-range-list');
    const status=wrap.querySelector('#zz-doc-range-status');
    const confirm=wrap.querySelector('[data-action="confirm"]');
    const plainLine=line=>{
      if(!line.trim())return'빈 줄';
      const holder=document.createElement('div');
      holder.innerHTML=String(parser.parseInline(line)||'');
      return (holder.textContent||line).replace(/\s+/g,' ').trim()||line;
    };
    const updateRange=()=>{
      list.querySelectorAll('.doc-range-line,.doc-range-block').forEach(button=>{
        const line=Number(button.dataset.line),endLine=Number(button.dataset.endLine||line);
        const hasRange=selectedStart!==null&&selectedEnd!==null;
        button.classList.toggle('in-range',hasRange&&endLine>=selectedStart&&line<=selectedEnd);
        button.classList.toggle('is-start',hasRange&&line<=selectedStart&&endLine>=selectedStart);
        button.classList.toggle('is-end',hasRange&&line<=selectedEnd&&endLine>=selectedEnd);
      });
      if(selectedStart===null)status.textContent='시작 지점을 선택하세요';
      else if(selectingEnd)status.textContent=`${selectedStart}행부터 · 끝 지점을 선택하세요`;
      else status.textContent=`${selectedStart}–${selectedEnd}행 선택`;
      confirm.disabled=modeInput.value==='MINI'&&(selectedStart===null||selectedEnd===null||selectingEnd);
    };
    let dragStart=null,dragMoved=false;
    const renderSource=()=>{
      const file=state.files.find(item=>item.name===nameInput.value);
      const source=String(file?.text||''),lines=source.split(/\r?\n/);
      selectedStart=null;
      selectedEnd=null;
      selectingEnd=false;
      list.innerHTML='';
      list.classList.add('doc-range-rendered');
      let cursor=1;
      let chunks=[];
      try{
        chunks=parser.lexer(source).filter(token=>token.raw).map(token=>{const start=cursor,raw=token.raw;cursor+=Math.max(1,(raw.match(/\n/g)||[]).length);return{raw,start,end:Math.max(start,cursor-1)}});
      }catch{}
      if(!chunks.length)chunks=lines.map((raw,index)=>({raw,start:index+1,end:index+1}));
      chunks.forEach(chunk=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='doc-range-block';
        button.dataset.line=String(chunk.start);
        button.dataset.endLine=String(chunk.end);
        try{button.innerHTML=markdownHtml(chunk.raw)}catch{button.textContent=plainLine(chunk.raw)}
        list.appendChild(button);
      });
      updateRange();
    };
    list.addEventListener('click',e=>{
      const lineButton=e.target.closest('.doc-range-line,.doc-range-block');
      if(!lineButton)return;
      if(dragMoved){dragMoved=false;return}
      const line=Number(lineButton.dataset.line),endLine=Number(lineButton.dataset.endLine||line);
      if(!selectingEnd){
        selectedStart=line;
        selectedEnd=endLine;
        selectingEnd=true;
      }else{
        const first=selectedStart;
        selectedStart=Math.min(first,line);
        selectedEnd=Math.max(first,endLine);
        selectingEnd=false;
      }
      updateRange();
    });
    list.addEventListener('pointerdown',e=>{
      const block=e.target.closest('.doc-range-block');if(!block||e.button!==0)return;
      dragStart={start:Number(block.dataset.line),end:Number(block.dataset.endLine||block.dataset.line)};dragMoved=false;
    });
    list.addEventListener('pointerover',e=>{
      if(!dragStart||!(e.buttons&1))return;const block=e.target.closest('.doc-range-block');if(!block)return;
      const start=Number(block.dataset.line),end=Number(block.dataset.endLine||start);dragMoved=true;selectingEnd=false;selectedStart=Math.min(dragStart.start,start);selectedEnd=Math.max(dragStart.end,end);updateRange();
    });
    document.addEventListener('pointerup',()=>{dragStart=null});
    nameInput.addEventListener('change',renderSource);
    modeInput.addEventListener('change',()=>{
      picker.hidden=modeInput.value!=='MINI';
      if(modeInput.value==='MINI'&&!list.children.length)renderSource();
      updateRange();
    });
    renderSource();
  });
  if(!dialog)return;
  const name=dialog.querySelector('#zz-doc-name').value,mode=dialog.querySelector('#zz-doc-mode').value;
  insertMarkdownBlockAtContext(`[[${name}!${mode}${mode==='MINI'?`:${selectedStart}-${selectedEnd}`:''}]]`,context);
}
$('ins-hr').onclick=()=>{if(insertPreviewBlockBelow('<hr>'))return;insertBlockBelowSelection('---')};
$('ins-br').onclick=()=>{if(insertPreviewBlockBelow('<br>'))return;insertBlockBelowSelection('<br>')};
$('ins-pagebreak').onclick=()=>{if(insertPreviewBlockBelow('<hr>'))return;insertBlockBelowSelection('***')};
$('ins-quote').onclick=()=>{if(insertPreviewQuote(1))return;linePrefix('> ')};
$('ins-quote2').onclick=()=>{if(insertPreviewQuote(2))return;linePrefix('>> ')};
$('ins-footnote').onclick=insertFootnote;
$('ins-citation').onclick=insertCitationDefinition;
$('ins-bibliography').onclick=insertBibliography;
$('fmt-form').onclick=insertFormControl;
$('ins-zz-toc').onclick=insertZzToc;
$('ins-zz-sync').onclick=insertZzSync;
$('ins-doc-embed').onclick=insertDocumentEmbed;
$('ins-obsidian-callout').onclick=insertObsidianCallout;
$('ins-obsidian-wikilink').onclick=insertObsidianWikiLink;
$('ins-obsidian-embed').onclick=insertObsidianEmbed;
$('ins-obsidian-highlight').onclick=insertObsidianHighlight;
$('ins-icode').onclick=()=>{if(insertPreviewInlineCode())return;toggleWrap('`')};
$('ins-block-code').onclick=()=>{if(insertPreviewCodeBlock())return;insertBlock('```\n{text}\n```','코드')};
$('ins-ul').onclick=()=>{if(insertPreviewList(false))return;linePrefix('- ')};
$('ins-ol').onclick=()=>{if(insertPreviewList(true))return;orderedListPrefix()};

// ── Real-time color (direct apply, no focus() to avoid OS picker conflict) ──
let colorDragState=null;
function initColorDrag(type){
  // capture mousedown on format-tools already saved state.savedSelection
  rememberPreviewRange();
  if(previewRange()){colorDragState=null;return}
  const saved=state.savedSelection||{start:els.editor.selectionStart,end:els.editor.selectionEnd};
  state.savedSelection=null;
  if(saved.start===saved.end){colorDragState=null;return}
  colorDragState={type,snapshot:els.editor.value,start:saved.start,end:saved.end};
}
function applyColorLive(type,value){
  if(!colorDragState||colorDragState.type!==type)return;
  const{snapshot,start,end}=colorDragState;
  const prop=type==='text'?'color':'background-color';
  if(start===end)return;
  const inner=snapshot.slice(start,end);
  // strip existing same-property span if present in snapshot
  const spanRe=new RegExp(`^<span style="[^"]*${prop}[^"]*">([\\s\\S]*)<\\/span>$`);
  const core=inner.match(spanRe)?inner.replace(spanRe,'$1'):inner;
  const newVal=snapshot.slice(0,start)+`<span style="${prop}:${value}">${core}</span>`+snapshot.slice(end);
  els.editor.value=newVal;
  if(state.active>=0)state.files[state.active].text=newVal;
  scheduleEditorRender(newVal);
}
function finalizeColor(type,value){
  // on change: restore snapshot, use full styleSpan for clean merging
  if(!colorDragState||colorDragState.type!==type)return false;
  els.editor.value=colorDragState.snapshot;
  state.savedSelection={start:colorDragState.start,end:colorDragState.end};
  colorDragState=null;
  styleSpan(type==='text'?'color':'background-color',value);
  return true;
}
function applyPickedColor(type,value){
  value=normalizeColorValue(value);
  if(!value&&value!=='')return;
  const prop=type==='text'?'color':'background-color';
  if(value)setHexInputValue(type==='text'?$('fmt-color'):$('fmt-bg'),value);
  syncColorButtons();
  if(styleTableTextSelection(prop,value)){if(value)trackColor(type,value);return}
  if(finalizeColor(type,value)){if(value)trackColor(type,value);return}
  if(state.savedPreviewRange&&stylePreviewSelection(prop,value)){if(value)trackColor(type,value);return}
  const saved=state.savedSelection;
  const hasEditorSelection=saved?saved.start!==saved.end:els.editor.selectionStart!==els.editor.selectionEnd;
  if(hasEditorSelection){styleSpan(prop,value);if(value)trackColor(type,value);return}
  if(document.activeElement===els.editor||!els.preview.contains(document.activeElement)){styleSpan(prop,value);if(value)trackColor(type,value);return}
  if(stylePreviewSelection(prop,value)){if(value)trackColor(type,value);return}
  if(value)trackColor(type,value);
}
function syncColorButtons(){
  const tc=$('text-color-chip'),bc=$('bg-color-chip'),tcur=$('text-color-current'),bcur=$('bg-color-current');
  const textColor=getHexInputValue($('fmt-color'))||'#111110';
  const bgColor=getHexInputValue($('fmt-bg'))||'#f0efed';
  if(tc)tc.style.background=textColor;
  if(bc)bc.style.background=bgColor;
  if(tcur)tcur.style.background=textColor;
  if(bcur)bcur.style.background=bgColor;
  syncColorSliders('text',textColor);
  syncColorSliders('bg',bgColor);
}
function normalizeColorValue(value){
  if(value==='')return '';
  const v=String(value||'').trim();
  if(/^#[0-9a-f]{6}$/i.test(v))return v.toLowerCase();
  if(/^[0-9a-f]{6}$/i.test(v))return '#'+v.toLowerCase();
  return null;
}
function getHexInputValue(input){
  return normalizeColorValue(input&&input.value);
}
function setHexInputValue(input,color){
  const normalized=normalizeColorValue(color);
  if(input&&normalized)input.value=normalized.slice(1);
  return normalized;
}
function bindHexInput(input){
  if(!input)return;
  input.addEventListener('input',()=>{
    const cleaned=input.value.replace(/[^0-9a-f]/gi,'').slice(0,6);
    if(input.value!==cleaned)input.value=cleaned;
  });
  input.addEventListener('paste',event=>{
    const text=(event.clipboardData||window.clipboardData).getData('text');
    const cleaned=text.replace(/[^0-9a-f]/gi,'').slice(-6);
    if(cleaned.length!==6)return;
    event.preventDefault();
    input.value=cleaned;
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  input.addEventListener('copy',event=>{
    const color=getHexInputValue(input);
    if(!color)return;
    event.preventDefault();
    event.clipboardData.setData('text/plain',color);
  });
}
['custom-theme-color','fmt-color','fmt-bg'].forEach(id=>bindHexInput($(id)));
function hexToRgb(hex){
  const c=normalizeColorValue(hex);
  if(!c)return null;
  return {r:parseInt(c.slice(1,3),16),g:parseInt(c.slice(3,5),16),b:parseInt(c.slice(5,7),16)};
}
function rgbToHex(r,g,b){
  return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Number(v)||0)).toString(16).padStart(2,'0')).join('');
}
function rgbToHsv({r,g,b}){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;
  if(d){
    if(max===r)h=60*(((g-b)/d)%6);
    else if(max===g)h=60*((b-r)/d+2);
    else h=60*((r-g)/d+4);
  }
  if(h<0)h+=360;
  return {h,s:max?d/max:0,v:max};
}
function hsvToRgb(h,s,v){
  const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
  let rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return {r:Math.round((rgb[0]+m)*255),g:Math.round((rgb[1]+m)*255),b:Math.round((rgb[2]+m)*255)};
}
function syncCustomThemePanel(){
  customTheme.background=normalizeColorValue(customTheme.background)||'#f7f7f5';
  customTheme.text=normalizeColorValue(customTheme.text)||'#111110';
  const color=customTheme[customThemeChannel];
  const input=$('custom-theme-color');
  setHexInputValue(input,color);
  $('custom-theme-current').style.background=color;
  $('custom-theme-bg-chip').style.background=customTheme.background;
  $('custom-theme-text-chip').style.background=customTheme.text;
  document.querySelectorAll('[data-theme-channel]').forEach(button=>button.classList.toggle('active',button.dataset.themeChannel===customThemeChannel));
  const palettes={
    background:['#111110','#ffffff','#f7f7f5','#242424','#374151','#cae4e8','#f8f4e6','#e3d5d5'],
    text:['#111110','#ffffff','#991b1b','#92400e','#166534','#1e40af','#5b21b6','#9d174d']
  };
  document.querySelectorAll('.cp-quick[data-color-target="theme"] button').forEach((button,index)=>{
    const quickColor=palettes[customThemeChannel][index];
    button.dataset.color=quickColor;
    button.style.background=quickColor;
    button.title=quickColor;
  });
  syncColorSliders('theme',color);
  renderCustomThemeHistory();
  renderCustomThemeSaved();
}
function setCustomThemeColor(value,commit=false){
  const color=normalizeColorValue(value);
  if(!color)return false;
  customTheme[customThemeChannel]=color;
  state.theme='custom';
  localStorage.setItem('md-theme','custom');
  ['light','dark','custom'].forEach(name=>$(`theme-${name}`).classList.toggle('active',name==='custom'));
  applyCustomThemeVars();
  updateThemeFavicon();
  syncCustomThemePanel();
  if(commit){
    localStorage.setItem('md-custom-theme-bg',customTheme.background);
    localStorage.setItem('md-custom-theme-text',customTheme.text);
    trackCustomThemeColor(customThemeChannel,color);
    rerenderForTheme();
  }
  return true;
}
function syncColorSliders(type,color){
  const rgb=hexToRgb(color);
  const picker=document.querySelector(`.cp-picker-main[data-color-target="${type}"]`);
  if(!rgb||!picker)return;
  const hsv=rgbToHsv(rgb);
  if(hsv.s>.001||!picker.dataset.hue)picker.dataset.hue=String(hsv.h);
  const hue=Number(picker.dataset.hue)||0;
  picker.querySelector('.cp-sv').style.backgroundColor=`hsl(${hue} 100% 50%)`;
  const svHandle=picker.querySelector('.cp-sv-handle');
  svHandle.style.left=(hsv.s*100)+'%';
  svHandle.style.top=((1-hsv.v)*100)+'%';
  picker.querySelector('.cp-hue-handle').style.top=((hue/360)*100)+'%';
}
$('apply-text-color').onclick=e=>{e.preventDefault();applyPickedColor('text',getHexInputValue($('fmt-color')))};
$('apply-bg-color').onclick=e=>{e.preventDefault();applyPickedColor('bg',getHexInputValue($('fmt-bg')))};
$('fmt-color').addEventListener('input',e=>{const c=getHexInputValue(e.target);if(c){syncColorButtons();if(colorDragState)applyColorLive('text',c)}});
$('fmt-color').addEventListener('change',e=>applyPickedColor('text',e.target.value));
$('fmt-bg').addEventListener('input',e=>{const c=getHexInputValue(e.target);if(c){syncColorButtons();if(colorDragState)applyColorLive('bg',c)}});
$('fmt-bg').addEventListener('change',e=>applyPickedColor('bg',e.target.value));
document.querySelectorAll('.cp-picker-main').forEach(picker=>{
  const type=picker.dataset.colorTarget;
  const input=$(type==='text'?'fmt-color':type==='bg'?'fmt-bg':'custom-theme-color');
  const update=(part,e)=>{
    const rgb=hexToRgb(getHexInputValue(input))||{r:255,g:0,b:0};
    const current=rgbToHsv(rgb);
    let h=Number(picker.dataset.hue)||current.h,s=current.s,v=current.v;
    const rect=part.getBoundingClientRect();
    if(part.classList.contains('cp-hue')){
      h=Math.max(0,Math.min(360,((e.clientY-rect.top)/rect.height)*360));
      picker.dataset.hue=String(h);
      if(s<.08)s=1;
      if(v<.12)v=1;
    }else{
      s=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
      v=1-Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height));
    }
    const next=hsvToRgb(h,s,v);
    const nextColor=rgbToHex(next.r,next.g,next.b);
    setHexInputValue(input,nextColor);
    if(type==='theme')setCustomThemeColor(nextColor,false);
    else{
      syncColorButtons();
      applyColorLive(type,nextColor);
    }
  };
  picker.querySelectorAll('.cp-sv,.cp-hue').forEach(part=>part.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();
    if(type!=='theme')initColorDrag(type);
    part.setPointerCapture(e.pointerId);
    update(part,e);
    const move=ev=>update(part,ev);
    const up=()=>{
      part.removeEventListener('pointermove',move);
      const selectedColor=getHexInputValue(input);
      if(type==='theme')setCustomThemeColor(selectedColor,true);
      else applyPickedColor(type,selectedColor);
    };
    part.addEventListener('pointermove',move);
    part.addEventListener('pointerup',up,{once:true});
  }));
  picker.querySelector('.cp-sv-handle').addEventListener('contextmenu',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(type==='theme')saveCustomThemeColor(getHexInputValue(input));
    else savePaletteColor(type,getHexInputValue(input));
  });
});
document.querySelectorAll('.cp-quick button').forEach(btn=>btn.onclick=e=>{
  const type=e.currentTarget.closest('.cp-quick').dataset.colorTarget;
  if(type==='theme')setCustomThemeColor(e.currentTarget.dataset.color,true);
  else applyPickedColor(type,e.currentTarget.dataset.color);
});
$('custom-theme-color').addEventListener('input',e=>{
  const color=getHexInputValue(e.target);
  if(color)setCustomThemeColor(color,false);
});
$('custom-theme-color').addEventListener('change',e=>setCustomThemeColor(e.target.value,true));
$('custom-theme-color').addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  e.preventDefault();
  setCustomThemeColor(e.currentTarget.value,true);
});
$('apply-custom-theme-color').onclick=e=>{
  e.stopPropagation();
  setCustomThemeColor(getHexInputValue($('custom-theme-color')),true);
};
document.querySelectorAll('[data-theme-channel]').forEach(button=>button.onclick=e=>{
  e.stopPropagation();
  customThemeChannel=button.dataset.themeChannel;
  syncCustomThemePanel();
});
$('theme-help').onclick=e=>{
  e.stopPropagation();
  showInfoNotice('화면 테마','라이트·다크·사용자 지정 테마는 PDF로 저장할 때 적용됩니다. MD 파일로 저장할 때는 배경색과 글자색이 문서 내용에 포함되지 않습니다.');
};
$('save-custom-theme-color').onclick=e=>{e.stopPropagation();saveCustomThemeColor()};
$('custom-theme-current').oncontextmenu=e=>{e.preventDefault();e.stopPropagation();saveCustomThemeColor()};
$('save-text-color').onclick=e=>{e.stopPropagation();savePaletteColor('text',getHexInputValue($('fmt-color')))};
$('save-bg-color').onclick=e=>{e.stopPropagation();savePaletteColor('bg',getHexInputValue($('fmt-bg')))};
$('clear-text-color').onclick=e=>{e.stopPropagation();applyPickedColor('text','');closeAllPanels()};
$('clear-bg-color').onclick=e=>{e.stopPropagation();applyPickedColor('bg','');closeAllPanels()};

/* ── Extended persistence, compatibility, inserts, and custom fonts ── */
const ZZ_DB_NAME='zz-md-workspace',ZZ_DB_VERSION=1;
let zzDbPromise=null,autosaveTimer=0,lastVersionSignature='';
function zzDb(){
  if(zzDbPromise)return zzDbPromise;
  zzDbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(ZZ_DB_NAME,ZZ_DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      ['session','versions','fonts'].forEach(name=>{if(!db.objectStoreNames.contains(name))db.createObjectStore(name)});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  return zzDbPromise;
}
async function zzStorePut(store,key,value){
  const db=await zzDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).put(value,key);
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error);
  });
}
async function zzStoreGet(store,key){
  const db=await zzDb();
  return new Promise((resolve,reject)=>{
    const request=db.transaction(store).objectStore(store).get(key);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
function serializableWorkspace(){
  return{
    savedAt:Date.now(),
    active:state.active,
    theme:state.theme,
    sidebarFolders:state.sidebarFolders,
    sidebarOrder:state.sidebarOrder,
    assetRoots:state.assetRoots,
    assets:[...state.assets],
    files:state.files.map(file=>({
      name:file.name,displayName:file.displayName,path:file.path,dir:file.dir,text:file.text,
      savedText:file.savedText,source:file.source,convertedFromCode:file.convertedFromCode,
      convertedFromPdf:file.convertedFromPdf,originalName:file.originalName,codeLanguage:file.codeLanguage
    }))
  };
}
async function saveWorkspaceSession(){
  try{await zzStorePut('session','latest',serializableWorkspace())}catch(_){}
}
function scheduleWorkspaceSave(){
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(async()=>{
    await saveWorkspaceSession();
    const file=state.files[state.active];
    if(!file)return;
    const signature=`${file.path}:${file.text}`;
    if(signature===lastVersionSignature)return;
    lastVersionSignature=signature;
    await saveVersionSnapshot('자동 기록');
  },900);
}
async function saveVersionSnapshot(reason='자동 기록'){
  const file=state.files[state.active];
  if(!file)return;
  const key=file.path||file.name;
  const versions=await zzStoreGet('versions',key)||[];
  if(versions[0]?.text===file.text)return;
  versions.unshift({time:Date.now(),reason,text:file.text,name:file.name});
  await zzStorePut('versions',key,versions.slice(0,30));
}
function applyWorkspaceSnapshot(snapshot){
  if(!snapshot?.files||!(snapshot.files.length||snapshot.sidebarFolders?.length||snapshot.assets?.length))return false;
  state.files=snapshot.files;
  state.sidebarFolders=snapshot.sidebarFolders||[];
  state.sidebarOrder=snapshot.sidebarOrder||{};
  state.assetRoots=snapshot.assetRoots||{};
  state.assets=new Map(snapshot.assets||[]);state.images={};
  state.assets.forEach((file,path)=>{sidebarUploadPaths.set(file,path);if(imageExt.test(path))addImage(file)});
  state.active=state.files.length?Math.max(0,Math.min(snapshot.active??0,state.files.length-1)):-1;
  els.editor.value=state.files[state.active]?.text||'';
  state.history=[els.editor.value];
  state.future=[];
  state.savedText=state.files[state.active]?.savedText||'';
  state.dirty=els.editor.value!==state.savedText;
  lastVersionSignature='';
  renderAll();
  setMode('edit',false);
  updateUndoRedoButtons();
  updateLineNumbers();
  return true;
}
async function showVersionHistory(){
  const file=state.files[state.active];
  const snapshot=await zzStoreGet('session','latest').catch(()=>null);
  const versions=file?await zzStoreGet('versions',file.path||file.name)||[]:[];
  if(!file&&!snapshot?.files?.length){showInfoNotice('버전 기록','저장된 버전이 없습니다.');return}
  const recoveryItem=snapshot?.files?.length
    ?`<div class="version-item version-recovery-item"><div><strong>${new Date(snapshot.savedAt).toLocaleString()}</strong><small>자동 복구본 · 문서 ${snapshot.files.length}개</small></div><button class="tool primary" type="button" data-recover-workspace>전체 복원</button></div>`
    :'';
  const documentItems=versions.map((version,index)=>`<div class="version-item"><div><strong>${new Date(version.time).toLocaleString()}</strong><small>${htmlEsc(version.reason)} · ${version.text.length.toLocaleString()}자</small></div><button class="tool" type="button" data-version="${index}">복원</button></div>`).join('');
  const wrap=document.createElement('div');
  wrap.className='modal-backdrop';
  wrap.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true"><h3>버전 기록</h3>${recoveryItem||documentItems
    ?`<div class="version-list">${recoveryItem}${documentItems}</div>`
    :'<p class="recovery-summary">저장된 버전이 없습니다.</p>'}<div class="modal-actions"><button class="tool primary" type="button" data-close-version>닫기</button></div></div>`;
  wrap.onclick=e=>{
    const button=e.target.closest('[data-version]');
    if(button){
      const version=versions[Number(button.dataset.version)];
      if(version){restoreEditor(version.text);wrap.remove();scheduleWorkspaceSave()}
    }else if(e.target.closest('[data-recover-workspace]')){
      if(applyWorkspaceSnapshot(snapshot)){wrap.remove();scheduleWorkspaceSave()}
    }else if(e.target.closest('[data-close-version]'))wrap.remove();
  };
  document.body.appendChild(wrap);
}
async function restoreWorkspaceSession(){
  const snapshot=await zzStoreGet('session','latest').catch(()=>null);
  if(!(snapshot?.files?.length||snapshot?.sidebarFolders?.length||snapshot?.assets?.length)||state.files.length)return;
  const age=new Date(snapshot.savedAt).toLocaleString();
  const dialog=await showInsertDialog('작업 복구',`<p class="recovery-summary">${htmlEsc(age)}에 자동 저장된 문서 ${snapshot.files.length}개가 있습니다.<br>브라우저 저장소가 지워지기 전까지 이 기록을 복구할 수 있습니다.</p>`,'복구');
  if(!dialog)return;
  applyWorkspaceSnapshot(snapshot);
}
function exportCompatibilityIssues(text){
  const source=String(text||''),issues=[];
  const add=(title,detail)=>issues.push({title,detail});
  if(/<!--\s*zz:(?:lens|sync|toc|sheet|html)\b/i.test(source)||/\[\[[^\]]+!(?:ALL|MINI)/i.test(source))add('#ZZ 전용 블록','MD에는 원문이 보존되지만 전용 카드·시트·미니 문서 모양은 #ZZ와 PDF에서만 표시됩니다.');
  if(/^>\s*\[![A-Za-z]/m.test(source)||/!\[\[[^\]]+]]|==[^=\n]+==/.test(source))add('Obsidian 확장 문법','지원하지 않는 Markdown 앱에서는 일반 인용문이나 원문으로 보일 수 있습니다.');
  if(/<label class="zz-form-control"|<button class="zz-form-control"/i.test(source))add('양식 개체','MD에는 HTML로 저장됩니다. HTML을 제한하는 앱에서는 입력 개체가 숨겨질 수 있습니다.');
  if(/<span\s+style=|<u\b|<font\b/i.test(source))add('문자 서식','색상·배경색·크기는 HTML 허용 여부에 따라 다르게 보입니다.');
  return issues;
}
async function confirmExportCompatibility(text,target='md'){
  const issues=exportCompatibilityIssues(text);
  if(!issues.length)return true;
  return new Promise(resolve=>{
    clearPreviewTransientState();
    const wrap=document.createElement('div');
    wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="compat-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="compat-preview-title">
      <div class="print-dialog-head">
        <h3 id="compat-preview-title">내보내기 미리보기</h3>
        <div class="print-viewer-field" aria-label="미리보기 확대">
          <button type="button" data-compat-zoom="-10" title="축소">−</button>
          <span class="compat-preview-zoom">80%</span>
          <button type="button" data-compat-zoom="10" title="확대">+</button>
        </div>
        <div class="print-dialog-actions"><button class="tool" type="button" data-export="cancel">취소</button><button class="tool primary" type="button" data-export="continue">계속 저장</button></div>
      </div>
      <div class="compat-preview-body">
        <div class="print-preview-stage"><div class="print-preview-surface"></div></div>
        <aside class="compat-preview-aside">
          <h4>호환성 확인</h4>
          <p>저장될 MD 원문을 일반 Markdown 기준으로 표시합니다. 실제 모양은 파일을 여는 앱의 Markdown·HTML 지원 범위에 따라 달라질 수 있습니다.</p>
          <ul class="compat-list">${issues.map(issue=>`<li><strong>${htmlEsc(issue.title)}</strong><span>${htmlEsc(issue.detail)}</span></li>`).join('')}</ul>
        </aside>
      </div>
    </div>`;
    const surface=wrap.querySelector('.print-preview-surface');
    const sheet=document.createElement('div');
    sheet.className='print-preview-sheet';
    const content=document.createElement('div');
    content.className='print-preview-content';
    const article=document.createElement('article');
    article.className='preview compat-md-preview';
    article.innerHTML=standardMarkdownHtml(text);
    content.appendChild(article);
    sheet.appendChild(content);
    surface.appendChild(sheet);
    let viewerZoom=80;
    const zoomValue=wrap.querySelector('.compat-preview-zoom');
    const updateZoom=()=>{
      viewerZoom=Math.max(40,Math.min(160,viewerZoom));
      surface.style.zoom=String(viewerZoom/100);
      zoomValue.textContent=`${viewerZoom}%`;
    };
    const finish=value=>{
      document.removeEventListener('keydown',onKey);
      wrap.remove();
      resolve(value);
    };
    const onKey=e=>{if(e.key==='Escape')finish(false)};
    wrap.querySelectorAll('[data-compat-zoom]').forEach(button=>button.onclick=()=>{
      viewerZoom+=Number(button.dataset.compatZoom);
      updateZoom();
    });
    wrap.onclick=e=>{
      const action=e.target.closest('[data-export]')?.dataset.export;
      if(action)finish(action==='continue');
    };
    document.addEventListener('keydown',onKey);
    document.body.appendChild(wrap);
    updateZoom();
  });
}
function fileBaseName(name){return String(name||'').replace(/\.[^.]+$/,'')}
async function insertImageAsset(file){
  addImage(file);
  replaceSelection(`![${fileBaseName(file.name)}](${file.name})`);
}
async function insertHtmlAsset(file){
  const html=await readText(file),payload=zzEncodePayload(html);
  replaceSelection(`<!-- zz:html name="${file.name.replace(/"/g,'&quot;')}" width="720" height="420" -->\n${payload}\n<!-- /zz:html -->`);
}
async function showSheetInsertDialog(file){
  if(!window.XLSX){showInfoNotice('스프레드시트 삽입','스프레드시트 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');return}
  const extension=file.name.split('.').pop().toLowerCase();
  const workbook=extension==='csv'||extension==='tsv'
    ?XLSX.read(await readText(file),{type:'string',FS:extension==='tsv'?'\t':','})
    :XLSX.read(await file.arrayBuffer(),{type:'array'});
  const sheetOptions=workbook.SheetNames.map(name=>`<option value="${htmlEsc(name)}">${htmlEsc(name)}</option>`).join('');
  const first=workbook.Sheets[workbook.SheetNames[0]],defaultRange=first?.['!ref']||'A1:F20';
  const dialog=await showInsertDialog('스프레드시트 삽입',`<div class="insert-config-grid"><label>시트<select id="zz-sheet-name">${sheetOptions}</select></label><label>표시 범위<input id="zz-sheet-range" value="${htmlEsc(defaultRange)}" placeholder="A1:F20"></label><div class="sheet-range-picker"><div class="sheet-range-picker-head"><span>셀을 드래그해 표시 범위를 선택하세요</span><strong data-sheet-range-label>${htmlEsc(defaultRange)}</strong></div><div class="sheet-range-preview" data-sheet-range-preview></div></div><label>배율 (%)<input id="zz-sheet-zoom" type="number" min="50" max="200" value="100"></label><label>초기 크기<input id="zz-sheet-size" value="720 × 360"></label></div><div class="insert-checks"><label><input type="checkbox" id="zz-sheet-headers" checked> 행·열 머리글</label><label><input type="checkbox" id="zz-sheet-scroll" checked> 스크롤 허용</label></div><p class="custom-font-copy">미리보기는 성능을 위해 최대 40행 × 20열만 표시합니다. 삽입되는 데이터는 선택한 범위를 그대로 유지합니다.</p>`,'삽입',wrap=>{
    const sheetSelect=wrap.querySelector('#zz-sheet-name');
    const rangeInput=wrap.querySelector('#zz-sheet-range');
    const label=wrap.querySelector('[data-sheet-range-label]');
    const preview=wrap.querySelector('[data-sheet-range-preview]');
    let anchor=null,dragging=false;
    const colName=index=>XLSX.utils.encode_col(index);
    const paintRange=(s,e)=>{
      preview.querySelectorAll('[data-sheet-cell]').forEach(cell=>{
        const r=Number(cell.dataset.row),c=Number(cell.dataset.col);
        cell.classList.toggle('is-selected',r>=s.r&&r<=e.r&&c>=s.c&&c<=e.c);
      });
    };
    const setRange=(a,b=a)=>{
      const s={r:Math.min(a.r,b.r),c:Math.min(a.c,b.c)},e={r:Math.max(a.r,b.r),c:Math.max(a.c,b.c)};
      const value=XLSX.utils.encode_range({s,e});
      rangeInput.value=value;
      label.textContent=value;
      paintRange(s,e);
    };
    const renderPicker=()=>{
      const sheet=workbook.Sheets[sheetSelect.value];
      const ref=XLSX.utils.decode_range(sheet?.['!ref']||'A1');
      const rowCount=Math.min(40,ref.e.r-ref.s.r+1),colCount=Math.min(20,ref.e.c-ref.s.c+1);
      const grid=document.createElement('div');
      grid.className='sheet-range-grid';
      grid.style.gridTemplateColumns=`34px repeat(${colCount},68px)`;
      const corner=document.createElement('div');corner.className='sheet-range-cell is-head is-col-head is-row-head';grid.appendChild(corner);
      for(let c=0;c<colCount;c++){const head=document.createElement('div');head.className='sheet-range-cell is-head is-col-head';head.textContent=colName(ref.s.c+c);grid.appendChild(head)}
      for(let r=0;r<rowCount;r++){
        const rowHead=document.createElement('div');rowHead.className='sheet-range-cell is-head is-row-head';rowHead.textContent=ref.s.r+r+1;grid.appendChild(rowHead);
        for(let c=0;c<colCount;c++){
          const row=ref.s.r+r,col=ref.s.c+c,cell=document.createElement('button');
          cell.type='button';cell.className='sheet-range-cell';cell.dataset.sheetCell='1';cell.dataset.row=row;cell.dataset.col=col;
          const source=sheet?.[XLSX.utils.encode_cell({r:row,c:col})];cell.textContent=source?.w??source?.v??'';
          cell.onpointerdown=e=>{e.preventDefault();dragging=true;anchor={r:row,c:col};cell.setPointerCapture?.(e.pointerId);setRange(anchor)};
          cell.onpointerenter=()=>{if(dragging&&anchor)setRange(anchor,{r:row,c:col})};
          cell.onpointerup=()=>{if(dragging&&anchor)setRange(anchor,{r:row,c:col});dragging=false};
          grid.appendChild(cell);
        }
      }
      preview.replaceChildren(grid);
      let selected;
      try{selected=XLSX.utils.decode_range(rangeInput.value||XLSX.utils.encode_range(ref))}
      catch(_){selected={s:{...ref.s},e:{...ref.s}};rangeInput.value=XLSX.utils.encode_range(selected)}
      label.textContent=rangeInput.value;
      paintRange(selected.s,selected.e);
    };
    sheetSelect.addEventListener('change',()=>{
      rangeInput.value=workbook.Sheets[sheetSelect.value]?.['!ref']||'A1';
      renderPicker();
    });
    rangeInput.addEventListener('input',()=>{
      label.textContent=rangeInput.value||'범위 없음';
      try{const selected=XLSX.utils.decode_range(rangeInput.value);paintRange(selected.s,selected.e)}catch(_){}
    });
    preview.onpointerup=preview.onpointerleave=()=>{dragging=false};
    renderPicker();
  });
  if(!dialog)return;
  const sheetName=dialog.querySelector('#zz-sheet-name').value,range=dialog.querySelector('#zz-sheet-range').value.trim()||defaultRange;
  const sheet=workbook.Sheets[sheetName];
  let rows;
  try{rows=XLSX.utils.sheet_to_json(sheet,{header:1,range,defval:'',raw:false})}catch(_){showInfoNotice('범위 오류','A1:F20처럼 올바른 셀 범위를 입력해 주세요.');return}
  const size=dialog.querySelector('#zz-sheet-size').value.match(/(\d+)\D+(\d+)/);
  const data=zzEncodePayload(JSON.stringify({rows}));
  const attrs=`name="${file.name.replace(/"/g,'&quot;')}" sheet="${sheetName.replace(/"/g,'&quot;')}" range="${range}" zoom="${Math.max(50,Math.min(200,Number(dialog.querySelector('#zz-sheet-zoom').value)||100))}" headers="${dialog.querySelector('#zz-sheet-headers').checked}" scroll="${dialog.querySelector('#zz-sheet-scroll').checked}" width="${size?size[1]:720}" height="${size?size[2]:360}"`;
  replaceSelection(`<!-- zz:sheet ${attrs} -->\n${data}\n<!-- /zz:sheet -->`);
}
async function insertFilesIntoDocument(fileList){
  if(state.active<0||state.mode!=='edit'){showInfoNotice('파일 삽입','편집할 문서를 먼저 열어 주세요.');return}
  for(const file of [...fileList]){
    if(imageExt.test(file.name))await insertImageAsset(file);
    else if(/\.(xlsx?|csv|tsv)$/i.test(file.name))await showSheetInsertDialog(file);
    else if(/\.html?$/i.test(file.name))await insertHtmlAsset(file);
    else{
      const payload=await codeFilePayload(file);
      if(payload)replaceSelection(payload.text);
      else replaceSelection(await readText(file));
    }
    replaceSelection('\n\n');
  }
  syncActive();
  scheduleWorkspaceSave();
}
$('insert-file-toggle').onclick=()=>$('insert-file-input').click();
$('insert-file-input').onchange=e=>{insertFilesIntoDocument(e.target.files);e.target.value=''};
els.editor.addEventListener('input',scheduleWorkspaceSave);
window.addEventListener('pagehide',saveWorkspaceSession);
syncColorButtons();
$('fmt-left').onclick=()=>applyAlign('left');$('fmt-center').onclick=()=>applyAlign('center');$('fmt-right').onclick=()=>applyAlign('right');
$('fmt-table').addEventListener('mousedown',e=>{e.preventDefault();rememberPreviewRange()});
$('fmt-table').onclick=()=>{if(insertPreviewTable())return;insertBlock('| 제목 1 | 제목 2 | 제목 3 |\n| --- | --- | --- |\n| 내용 | 내용 | 내용 |')};
$('fmt-image').onclick=()=>{rememberPreviewRange();state.insertingImage=true;state.savedSelection={start:els.editor.selectionStart,end:els.editor.selectionEnd};els.imageInput.value='';els.imageInput.click()};
$('fmt-link').onclick=insertLinkWithDialog;
$('fmt-math').onclick=insertMathWithDialog;
$('new-doc').onclick=newDocument;
$('edit-close-doc').onclick=closeDocument;
// ── Open / Save dropdown menus ──
(function(){
  function makeMenu(items,isSubmenu=false){
    const m=document.createElement('div');m.className=isSubmenu?'tb-menu tb-submenu':'tb-menu';
    if(!isSubmenu)m.style.display='none';
    items.forEach(item=>{
      if(item==='-'){const hr=document.createElement('hr');m.appendChild(hr);return;}
      const row=document.createElement('div');row.className='tb-menu-row';
      const b=document.createElement('button');b.type='button';b.innerHTML=item.label;
      if(item.children){
        const arrow=document.createElement('span');arrow.className='tb-menu-arrow';arrow.textContent='›';b.appendChild(arrow);
        const submenu=makeMenu(item.children,true);row.append(b,submenu);
        const openSubmenu=()=>{
          [...m.children].forEach(child=>{if(child!==row)child.classList?.remove('submenu-open')});
          row.classList.add('submenu-open');
        };
        b.onclick=e=>{e.stopPropagation();row.classList.toggle('submenu-open')};
        row.onmouseenter=openSubmenu;
      }else{
        b.onclick=()=>{const root=m.closest('.tb-menu:not(.tb-submenu)')||m;root.style.display='none';activeMenu=null;item.action();};
        row.appendChild(b);
      }
      m.appendChild(row);
    });
    if(!isSubmenu)document.body.appendChild(m);return m;
  }
  function positionMenu(menu,btn){
    const r=btn.getBoundingClientRect();
    menu.style.display='block';
    menu.style.top=(r.bottom+4)+'px';
    menu.style.left=r.left+'px';
    requestAnimationFrame(()=>{
      const mr=menu.getBoundingClientRect();
      if(mr.right>innerWidth)menu.style.left=Math.max(4,r.right-mr.width)+'px';
    });
  }
  const openMenu=makeMenu([
    {label:'<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1.2h4.5l2.5 2.5v8.1H3a1 1 0 01-1-1V2.2a1 1 0 011-1z"/><path d="M7.5 1.2v2.5H10"/><path d="M5.2 7.2h4M7.8 5.8l1.4 1.4-1.4 1.4"/></svg> 파일 열기',action:()=>els.fileInput.click()},
    {label:'<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4.5h11v6a1 1 0 01-1 1H2a1 1 0 01-1-1v-6z"/><path d="M1 4.5l1.5-3h3.3l1.3 1.4H12"/><path d="M5 8h3.8M7.4 6.6L8.8 8 7.4 9.4"/></svg> 폴더 열기',action:()=>els.folderInput.click()},
  ]);
  const saveMenu=makeMenu([
    {label:'<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="11" height="11" rx="1.5"/><rect x="3.5" y="1" width="6" height="3.5" rx=".5"/><rect x="2.5" y="7" width="8" height="3.5" rx=".5"/></svg> PDF 저장',action:()=>printDocument()},
    {label:'<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 10l4-7 4 7"/><line x1="3.5" y1="7.5" x2="8.5" y2="7.5"/></svg> MD 저장',action:saveCurrent},
    '-',
    {label:'<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 3h9v8H2zM3 1h7v2H3z"/><path d="M6.5 3v5M5.5 4h2M5.5 6h2"/></svg> ZIP 저장',children:[
      {label:'변경된 문서만',action:saveChangedZip},
      {label:'문서 선택…',action:saveSelectedZip},
      {label:'폴더 전체',action:saveAllZip},
    ]},
  ]);
  let activeMenu=null;
  function toggleMenu(menu,btn){
    if(activeMenu&&activeMenu!==menu){activeMenu.style.display='none';}
    if(menu.style.display==='block'){menu.style.display='none';activeMenu=null;}
    else{positionMenu(menu,btn);activeMenu=menu;}
  }
  document.addEventListener('click',e=>{
    if(activeMenu&&!activeMenu.contains(e.target)&&e.target.id!=='open-toggle'&&e.target.id!=='save-toggle'&&!e.target.closest('#open-toggle')&&!e.target.closest('#save-toggle'))
      {activeMenu.style.display='none';activeMenu=null;}
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||!activeMenu)return;
    e.preventDefault();
    activeMenu.style.display='none';
    activeMenu=null;
  });
  $('open-toggle').onclick=e=>{e.stopPropagation();toggleMenu(openMenu,$('open-toggle'));};
  $('edit-version-history').onclick=e=>{e.stopPropagation();showVersionHistory();};
  $('save-toggle').onclick=e=>{e.stopPropagation();toggleMenu(saveMenu,$('save-toggle'));};
})();
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  closeAllPanels();
  hideFontSizeMenu();
  closeCodeLanguageMenu();
});
$('sidebar-files-tab').onclick=()=>setSidebarView('files');
// Central shortcut dispatch: consume handled keys before browser/editor defaults.
async function shortcutSaveAs(){
  const dialog=await showInsertDialog('다른 이름으로 저장','<label class="shortcut-save-name"><span>파일명</span><input id="shortcut-save-name" value="'+htmlEsc(state.files[state.active]?.name||'document.md')+'"></label>','저장');
  if(!dialog)return;
  const name=dialog.querySelector('input').value.trim().replace(/[\\/:*?"<>|]/g,'_');
  if(!name)return;
  if(await confirmExportCompatibility(els.editor.value,'md'))download(/\.md$/i.test(name)?name:name+'.md',els.editor.value);
}
const SHORTCUT_SAVE_FORMAT_KEY='md-shortcut-save-format';
function showShortcutSaveFormatDialog(){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');wrap.className='modal-backdrop';
    wrap.innerHTML=`<div class="modal-card save-format-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-save-format-title"><h3 id="shortcut-save-format-title">저장 형식 선택</h3><p class="save-format-copy">현재 문서를 어떤 형식으로 저장할까요?</p><div class="save-format-choices"><button class="tool" type="button" data-save-format="md">MD로 저장</button><button class="tool" type="button" data-save-format="pdf">PDF로 저장</button></div><label class="save-format-remember"><input type="checkbox" data-save-format-remember> 다시는 보지 않기</label><div class="modal-actions"><button class="tool" type="button" data-save-format="cancel">취소</button></div></div>`;
    const finish=format=>{document.removeEventListener('keydown',onKey);wrap.remove();if((format==='md'||format==='pdf')&&wrap.querySelector('[data-save-format-remember]').checked)localStorage.setItem(SHORTCUT_SAVE_FORMAT_KEY,format);resolve(format)};
    const onKey=e=>{if(e.key==='Escape')finish(null)};
    wrap.onclick=e=>{const format=e.target.closest('[data-save-format]')?.dataset.saveFormat;if(format)finish(format==='cancel'?null:format)};
    document.addEventListener('keydown',onKey);document.body.appendChild(wrap);wrap.querySelector('[data-save-format="md"]').focus();
  });
}
async function saveShortcutAsFormat(format){
  if(format==='md')return saveCurrent();
  if(format==='pdf'){
    const file=state.files[state.active],title=(file?.name||'document.md').replace(/\.(md|markdown)$/i,'.pdf');
    return printDocument(title,els.preview);
  }
}
async function shortcutSaveResult(){
  if(state.mode==='edit'){
    if(previewSyncTimer)syncFromPreview();
    let format=localStorage.getItem(SHORTCUT_SAVE_FORMAT_KEY);
    if(format!=='md'&&format!=='pdf')format=await showShortcutSaveFormatDialog();
    if(format)return saveShortcutAsFormat(format);
    return;
  }
  if(state.mode==='merge'){
    if(state.shortcutMergeResult!=null)return download('merged-markdown.md',state.shortcutMergeResult);
    return showInfoNotice('저장할 결과 없음','먼저 파일을 병합해 주세요.');
  }
  const files=selectedConvertIndexes().map(i=>state.files[i]);
  if(files.length&&files.every(f=>f.convertedFromPdf||preparedPdfDocuments.get(f)===f.text))return runSelectedConvert();
  showInfoNotice('저장할 결과 없음','MD → PDF는 Ctrl+Enter로 변환한 뒤 인쇄 창에서 PDF로 저장해 주세요.');
}
async function shortcutRemoveChecked(list){
  const files=[...list.querySelectorAll('input:checked')].map(input=>state.files[Number(input.value)]).filter(Boolean);
  if(!files.length)return;
  if(!await confirmFileRemoval(files,`선택한 문서 ${files.length}개`))return;
  const active=state.files[state.active];state.files=state.files.filter(file=>!files.includes(file));
  state.active=state.files.indexOf(active);
  if(state.active<0)clearOpenDocument();
  renderAll();scheduleWorkspaceSave();
}
for(const list of [els.convertList,els.mergeList]){
  list.tabIndex=0;
  list.addEventListener('mousedown',e=>{if(!e.target.closest('input,button'))list.focus({preventScroll:true})});
}
document.addEventListener('keydown',e=>{
  if(e.isComposing||e.defaultPrevented)return;
  const modifier=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
  if(modifier&&e.altKey&&key==='s'){
    e.preventDefault();e.stopImmediatePropagation();if(e.repeat||document.querySelector('.modal-backdrop'))return;
    if(state.mode!=='edit')setMode('edit');rememberPreviewRange();toggleCustomFormatPanel(true);return;
  }
  if(e.altKey)return;
  const target=e.target,dialog=target.closest?.('.modal-backdrop,[role="dialog"],.find-replace-panel');
  const auxiliary=target!==els.editor&&!els.preview.contains(target)&&target.closest?.('textarea,input:not([type="checkbox"]),[contenteditable="true"]');
  const modal=document.querySelector('.modal-backdrop');
  const consume=()=>{e.preventDefault();e.stopImmediatePropagation()};
  if(modifier&&['f1','f2','f3'].includes(key)&&!e.shiftKey){
    consume();if(modal)return;
    if(state.mode==='edit'){if(state.editingPreview||previewSyncTimer)syncFromPreview();else if(state.active>=0)state.files[state.active].text=els.editor.value}
    closeAllPanels();clearPreviewTransientState();hideMergePreview(true);closeSourceSyntaxPopover();
    setMode({f1:'convert',f2:'edit',f3:'merge'}[key]);return;
  }
  if(dialog||auxiliary||modal){
    // Leave text-field undo/select-all native, but stop legacy document handlers.
    if(modifier&&['z','y','a','b','i','u','s','o','p','k','h','f'].includes(key)){
      e.stopImmediatePropagation();
      if(['s','o','p','k','h'].includes(key))e.preventDefault();
    }
    return;
  }
  const list=state.mode==='convert'?els.convertList:state.mode==='merge'?els.mergeList:null;
  if(list&&list.contains(target)&&((modifier&&key==='a')||(!modifier&&key==='delete'))){
    consume();if(key==='delete'){shortcutRemoveChecked(list);return}
    list.querySelectorAll('input[type="checkbox"]').forEach(input=>input.checked=true);
    if(state.mode==='merge'){updateMergeToggleAll();updateMergePreview()}else updateConvertPreview();return;
  }
  if(!modifier)return;
  if(key==='s'){consume();if(e.repeat)return;if(e.shiftKey&&state.mode==='edit')shortcutSaveAs();else shortcutSaveResult();return}
  if(key==='o'){consume();if(!e.repeat)pickSidebarUpload();return}
  if(key==='enter'&&list){consume();if(!e.repeat)(state.mode==='merge'?mergeSelected():runSelectedConvert());return}
  if(key==='f'||key==='h'){
    consume();showFindReplaceDialog();if(key==='h')document.querySelector('[data-replace-field]')?.focus();return;
  }
  if(key==='p'){consume();if(!e.repeat)printDocument(undefined,activeFindPreview());return}
  if(state.mode!=='edit')return;
  if(key==='z'||key==='y'){consume();pushHistory(true);key==='y'||e.shiftKey?redoEdit():undoEdit();return}
  const button={b:'fmt-bold',i:'fmt-italic',u:'fmt-underline',k:'fmt-link'}[key];
  if(button){
    consume();rememberPreviewRange();
    if(target===els.editor){state.savedPreviewRange=null;state.savedSelection={start:els.editor.selectionStart,end:els.editor.selectionEnd}}
    if(key==='k'){
      const range=previewRange(),node=range&&(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement),link=node?.closest('a');
      if(link&&els.preview.contains(link)){editPreviewLink(link);return}
    }
    $(button).click();
  }
},true);
$('sidebar-outline-tab').onclick=()=>setSidebarView('outline');
els.outline.addEventListener('click',e=>{
  const sectionButton=e.target.closest('[data-outline-section]');
  if(sectionButton){
    const section=sectionButton.dataset.outlineSection;
    collapsedOutlineSections[section]=!collapsedOutlineSections[section];
    const panel=sectionButton.closest('.outline-section');
    panel?.classList.toggle('collapsed',collapsedOutlineSections[section]);
    sectionButton.setAttribute('aria-expanded',String(!collapsedOutlineSections[section]));
    return;
  }
  const branchButton=e.target.closest('[data-outline-toggle]');
  if(branchButton){
    const index=Number(branchButton.dataset.outlineToggle);
    if(collapsedOutlineHeadings.has(index))collapsedOutlineHeadings.delete(index);
    else collapsedOutlineHeadings.add(index);
    const node=branchButton.closest('.outline-node');
    const collapsed=collapsedOutlineHeadings.has(index);
    node?.classList.toggle('collapsed',collapsed);
    branchButton.setAttribute('aria-expanded',String(!collapsed));
    branchButton.setAttribute('aria-label',`하위 서식 ${collapsed?'펼치기':'접기'}`);
    return;
  }
  const headingButton=e.target.closest('[data-outline-index]');
  if(headingButton){
    const headingIndex=Number(headingButton.dataset.outlineIndex);
    const heading=els.preview.querySelectorAll('h1,h2,h3,h4,h5,h6')[headingIndex];
    const sourceHeading=[...els.editor.value.matchAll(/^[ \t]{0,3}#{1,6}[ \t]+.*$/gm)][headingIndex];
    const headingText=heading?.textContent.trim()||'';
    heading?.scrollIntoView({block:'center',behavior:'smooth'});
    schedulePreviewArrival(heading,headingText,sourceHeading?.index??els.editor.value.indexOf(headingText));
    headingButton.blur();
    return;
  }
  const tagButton=e.target.closest('[data-outline-tag]');
  if(tagButton){
    const tag=tagButton.dataset.outlineTag;
    if(!scrollPreviewToText(`#${tag}`))scrollPreviewToText(`# ${tag}`);
    tagButton.blur();
  }
});
els.outline.addEventListener('contextmenu',e=>{
  const tagButton=e.target.closest('[data-outline-tag]');
  if(tagButton)showHashtagContextMenu(e,tagButton.dataset.outlineTag);
});
$('side-handle').onclick=()=>els.app.classList.toggle('sidebar-collapsed');
$('side-resizer').addEventListener('mousedown',e=>{
  if(els.app.classList.contains('sidebar-collapsed'))return;
  e.preventDefault();
  els.app.classList.add('sidebar-resizing');
  let frame=0,pendingX=e.clientX;
  const apply=()=>{frame=0;setSidebarWidth(pendingX)};
  function move(ev){
    pendingX=ev.clientX;
    if(!frame)frame=requestAnimationFrame(apply);
  }
  function up(ev){
    pendingX=ev.clientX;
    if(frame)cancelAnimationFrame(frame);
    setSidebarWidth(pendingX,true);
    els.app.classList.remove('sidebar-resizing');
    document.removeEventListener('mousemove',move);
    document.removeEventListener('mouseup',up);
  }
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',up);
});
$('ribbon-toggle').onclick=()=>els.app.classList.toggle('ribbon-collapsed');
$('brand-home').onclick=()=>setMode(state.mode,true);
$('theme-light').onclick=()=>{closeAllPanels();applyTheme('light')};
$('theme-dark').onclick=()=>{closeAllPanels();applyTheme('dark')};
$('theme-custom').onclick=e=>{
  e.stopPropagation();
  const open=!$('custom-theme-panel').classList.contains('hidden');
  if(open){closeAllPanels();return}
  applyTheme('custom');
  syncCustomThemePanel();
  openPanel('custom-theme-panel','theme-custom');
};
els.homeOutput.addEventListener('input',()=>els.homeOutput.dataset.touched='1');
window.addEventListener('beforeunload',e=>{if(!state.dirty)return;e.preventDefault();e.returnValue=''});
setSidebarWidth(Number(localStorage.getItem('md-sidebar-width'))||312);
setSidebarView('files');
setLineNumbers($('enable-line-numbers').checked);
setSwapPanes($('enable-swap-panes').checked);
applyTheme(state.theme);syncCustomThemePanel();setMode('convert',true);renderAll();updateHomeConvert();state.history=[els.editor.value];state.savedText=els.editor.value;renderAllSwatches();updateUndoRedoButtons();updateLineNumbers();
setTimeout(restoreWorkspaceSession,500);
