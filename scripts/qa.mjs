import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {createDocxBlob,createHwpxBlob} from '../src/document-export.js';

function assert(condition,message){
  if(!condition)throw new Error(message);
}

function decodeHtmlText(value){
  return String(value)
    .replaceAll('&gt;','>')
    .replaceAll('&lt;','<')
    .replaceAll('&amp;','&')
    .replace(/&#10;/gi,'\n')
    .replace(/\\`/g,'`')
    .replace(/[ \t]+/g,' ')
    .trim();
}

function decodeJsText(value){
  return String(value).replace(/\\n/g,'\n').replace(/\\'/g,"'").replace(/\\`/g,'`').trim();
}

function translationKeyExists(block,value){
  const escaped=value.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n');
  return block.includes(`'${escaped}':`);
}

function isDynamicallyTranslated(value){
  return /\$\{/.test(value)
    || /^\d+쪽$/.test(value)
    || /^\d+행 × \d+열$/.test(value)
    || /^문서 \d+개$/.test(value)
    || value.startsWith('삽입 (**bold**')
    || value.startsWith('마크다운 기호 안 불필요한 공백을 자동으로 제거합니다.')
    || value.startsWith('라이트 모드에서 흰색/밝은 글씨를 검은색 계열로,')
    || value.startsWith('이름, 점수\n민지, 95\n서준, 88');
}

async function auditTranslations(mainSource,indexSource){
  const start=mainSource.indexOf('const EN_TEXT={');
  const end=mainSource.indexOf('function translatedUiText',start);
  assert(start>=0&&end>start,'Could not locate the English translation map.');
  const translations=mainSource.slice(start,end);
  const candidates=[];
  for(const source of [mainSource,indexSource]){
    for(const match of source.matchAll(/>([^<>{}\r\n]*[가-힣][^<>{}\r\n]*)</g))candidates.push(decodeHtmlText(match[1]));
    for(const match of source.matchAll(/(?:title|aria-label|placeholder|data-tooltip)=["']([^"']*[가-힣][^"']*)["']/g))candidates.push(decodeHtmlText(match[1]));
  }
  for(const match of mainSource.matchAll(/\b(?:setStatus|showInsertDialog)\(\s*'((?:\\.|[^'\\])*)'/g))candidates.push(decodeJsText(match[1]));
  for(const match of mainSource.matchAll(/\bshowInfoNotice\(\s*'((?:\\.|[^'\\])*)'\s*,\s*'((?:\\.|[^'\\])*)'/g)){
    candidates.push(decodeJsText(match[1]),decodeJsText(match[2]));
  }
  const missing=[...new Set(candidates)]
    .filter(value=>value&&/[가-힣]/.test(value))
    .filter(value=>!isDynamicallyTranslated(value)&&!translationKeyExists(translations,value));
  assert(!missing.length,`English translations missing for: ${missing.join(' | ')}`);
}

function auditSaveMenu(mainSource,indexSource){
  const menuStart=mainSource.indexOf("const saveMenu=makeMenu([");
  const menuEnd=mainSource.indexOf('let activeMenu=',menuStart);
  assert(menuStart>=0&&menuEnd>menuStart,'Could not locate the save menu.');
  const menu=mainSource.slice(menuStart,menuEnd);
  const documentMenu=menu.indexOf('문서로 저장');
  const pdf=menu.indexOf('PDF 저장',documentMenu);
  const word=menu.indexOf('Word 저장 (.docx)',documentMenu);
  const hangul=menu.indexOf('한글 저장 (.hwpx)',documentMenu);
  assert(documentMenu>=0&&pdf>documentMenu&&word>pdf&&hangul>word,'PDF, Word, and HWPX must remain grouped under 문서로 저장.');
  assert(mainSource.includes("await import('jszip')"),'ZIP support must be loaded locally on demand.');
  assert(!/jszip[^\n]+(?:cdnjs|cdn\.jsdelivr)/i.test(indexSource),'A blocking JSZip CDN script is still present.');
}

function auditFormattingStability(mainSource,indexSource,styleSource){
  assert(indexSource.includes('id="fmt-bg-opacity"'),'Background opacity control is missing.');
  assert(styleSource.includes('.font-bg-opacity'),'Background opacity control styles are missing.');
  assert(mainSource.includes('function refreshColorTargetSnapshot()'),'Color target refresh guard is missing.');
  assert(mainSource.includes('function mutateQuoteDesign('),'Quote formatting scroll guard is missing.');
  assert(mainSource.includes("type==='bg'&&pickedValue?quoteColorWithOpacity"),'Background opacity is not applied to picked colors.');
  assert(mainSource.includes("root.addEventListener('contextmenu',event=>"),'Preview background context-menu suppression is missing.');
  const opacity=indexSource.indexOf('id="fmt-bg-opacity"'),picker=indexSource.indexOf('id="bg-color-current"');
  assert(opacity>=0&&picker>=0&&opacity<picker,'Background opacity must appear above the color picker.');
  assert(styleSource.includes('.font-bg-opacity { display:grid;grid-template-columns:auto minmax(0,1fr) 42px;align-items:center;gap:8px;margin:0 0 10px'),'Background opacity layout has drifted from the quote opacity layout.');
  assert(indexSource.indexOf('id="clear-text-color"')<indexSource.indexOf('id="text-color-current"'),'The text-color reset action must stay at the top of its panel.');
  assert(indexSource.indexOf('id="clear-bg-color"')<indexSource.indexOf('id="fmt-bg-opacity"'),'The background-color reset action must stay at the top of its panel.');
  assert(styleSource.includes('.cp-reset-primary { width:100%;min-height:38px'),'Top-level color reset actions are not visually prominent.');
  assert(mainSource.includes('function colorTargetMath()'),'Equation color targeting is not preserved while using the palette.');
  assert(mainSource.includes("}else applyPickedColor('text','');"),'Resetting text color must remove the explicit color instead of applying a theme color.');
  assert(mainSource.includes("const groups=[{id:'',name:'',collapsed:customFormatRootCollapsed}"),'The unfiled custom-style label is still visible.');
  assert(mainSource.includes('listItem&&previewRangeSideIsEmpty(listItem,range,true)'),'Enter at the start of a list item does not create a preceding blank item.');
  assert(mainSource.includes('listItem.before(blankItem)'),'A leading list split does not preserve list numbering.');
  assert(styleSource.includes('.font-bg-opacity input { width:100%;margin:0;accent-color:var(--t1); }'),'Background opacity does not follow the active theme text color.');
  assert(styleSource.includes('.save-format-extension { align-self:stretch;display:grid;place-items:center;'),'Save-format extension labels are not centered within their column.');
  assert(styleSource.includes('.save-format-choice-copy b { font-size:15.5px;'),'Save-format title labels are too small.');
  const aboutStart=mainSource.indexOf('<section class="app-settings-group app-about"');
  const aboutEnd=mainSource.indexOf('</section>',aboutStart);
  const aboutSource=mainSource.slice(aboutStart,aboutEnd);
  assert(aboutStart>=0&&aboutEnd>aboutStart&&!aboutSource.includes('<p>'),'The About page description label is still present.');
}

function auditDomContracts(mainSource,indexSource){
  const staticIds=[...indexSource.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1]);
  const duplicates=[...new Set(staticIds.filter((id,index)=>staticIds.indexOf(id)!==index))];
  assert(!duplicates.length,`Duplicate static DOM ids: ${duplicates.join(', ')}`);

  const declared=new Set([
    ...staticIds,
    ...[...mainSource.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1])
  ]);
  const referenced=[...new Set([...mainSource.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map(match=>match[1]))];
  const missing=referenced.filter(id=>!declared.has(id));
  assert(!missing.length,`DOM ids referenced by $() but never declared: ${missing.join(', ')}`);
}

function auditPerformanceGuards(mainSource){
  assert(mainSource.includes("import('./document-export.js')"),'Office exporters must remain lazy-loaded.');
  assert(mainSource.includes('function scheduleEditorVisualScroll()'),'Editor visual scroll work is not frame-coalesced.');
  assert(mainSource.includes('function schedulePreviewVisualScroll()'),'Preview visual scroll work is not frame-coalesced.');
  const enhancementStart=mainSource.indexOf('function schedulePostRenderEnhancements(');
  const enhancementEnd=mainSource.indexOf('function assignPreviewHeadingAnchors(',enhancementStart);
  const enhancement=mainSource.slice(enhancementStart,enhancementEnd);
  assert(!enhancement.includes('normalizeTableCellInlineBlocks(els.preview)'),'Table cells are normalized twice during a full preview render.');
  assert(mainSource.includes("if(state.sidebarView!=='outline')return;"),'Hidden document outlines are still rebuilt after every Preview render.');
  const outlineStart=mainSource.indexOf('function renderDocumentOutline()');
  const outlineEnd=mainSource.indexOf('let hashtagContextMenu=',outlineStart);
  const outlineSource=mainSource.slice(outlineStart,outlineEnd);
  assert(outlineStart>=0&&outlineEnd>outlineStart&&!outlineSource.includes('translateUi(els.outline)'),'Document outline still retranslates its full DOM after rendering.');
  assert(outlineSource.includes("const label=(korean,english)=>uiLanguage==='en'?english:korean"),'Document outline does not generate localized chrome directly.');
  assert(mainSource.includes('if(mutation.target===els.preview&&mutation.addedNodes.length){roots.add(els.preview);continue}'),'Preview mutation contrast work is not batched by root.');
  assert(mainSource.includes('function syncUiTranslationObserver()'),'The translation observer cannot be disabled outside English mode.');
  assert(mainSource.includes("const shouldObserve=uiLanguage==='en'"),'Korean mode still records unnecessary translation mutations.');
  assert(!mainSource.includes('lastVersionSignature'),'Autosave still allocates a document-sized version signature.');
  assert(mainSource.includes("els.preview.addEventListener('scroll',()=>{onPreviewScroll();schedulePreviewVisualScroll()}"),'Preview scroll work is split across duplicate listeners.');
}

function auditLifecycleStability(mainSource){
  assert(mainSource.includes("task?.catch?.(error=>console.warn('Mermaid render failed'"),'Async Mermaid failures are not contained.');
  assert(mainSource.includes('Preview enhancement stage ${currentStage+1} failed'),'Preview enhancement stages are not isolated.');
  assert(mainSource.includes("document.visibilityState==='hidden')flushWorkspaceForLifecycle()"),'Hidden tabs do not flush pending workspace recovery data.');
  assert(mainSource.includes('mutateQuoteDesign(quote,()=>quote.style.removeProperty(property))'),'Resetting quote colors bypasses the scroll-safe mutation path.');
  assert(mainSource.includes('function closeCustomFormatSavedWindow()'),'Saved custom-format windows have no single close path.');
  assert(mainSource.includes('if(customFormatSavedWindow?.isConnected){event.preventDefault();event.stopPropagation();return}'),'An open saved custom-format window does not suppress single-click panel toggles.');
  assert(mainSource.includes('if(customFormatSavedWindow?.isConnected){closeCustomFormatSavedWindow();return}'),'Double-click does not close an open saved custom-format window.');
}

function auditPreviewLocalization(mainSource){
  assert(mainSource.includes('function previewUiText(korean,english)'),'Generated Preview UI has no localization helper.');
  assert(mainSource.includes("previewUiText('문서를 찾을 수 없음','Document not found')"),'Missing embedded documents are not localized.');
  assert(mainSource.includes("previewUiText('동기화','Sync')"),'Sync block chrome is not localized.');
  assert(mainSource.includes("previewUiText('관련 항목','Related items')"),'Multi-view block tabs are not localized.');
  assert(mainSource.includes("if(uiLanguage==='en')return fallback==='분할 문서'?'Split document':'No document'"),'Document pane fallbacks ignore the selected UI language.');
}

async function packageText(zip,pattern){
  const entries=Object.keys(zip.files).filter(name=>pattern.test(name));
  const contents=await Promise.all(entries.map(name=>zip.file(name).async('string')));
  return contents.join('\n');
}

async function auditOfficeExports(){
  const rows=Array.from({length:80},(_,index)=>`<tr><td>${index+1}</td><td>한글 안정성 점검 ${index+1}</td><td>English export ${index+1}</td></tr>`).join('');
  const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>내보내기 점검</title></head><body><h1>문서 저장 QA</h1><p><b>한국어</b>와 English, <span style="color:#1f6feb">색상 서식</span>을 보존합니다.</p><table><thead><tr><th>번호</th><th>한글</th><th>English</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;

  const docx=await createDocxBlob(html);
  const docxZip=await JSZip.loadAsync(await docx.arrayBuffer());
  assert(docx.size>1000,'DOCX output is unexpectedly small.');
  assert(docxZip.file('[Content_Types].xml'),'DOCX content types are missing.');
  assert(docxZip.file('word/document.xml'),'DOCX document.xml is missing.');
  const docxText=await packageText(docxZip,/\.(?:xml|mht|html?)$/i);
  assert(docxText.includes('한글 안정성 점검 80'),'DOCX lost Korean table content.');
  assert(docxText.includes('English export 80'),'DOCX lost English table content.');

  const hwpx=await createHwpxBlob(html,{title:'내보내기 점검'});
  const hwpxZip=await JSZip.loadAsync(await hwpx.arrayBuffer());
  assert(hwpx.size>1000,'HWPX output is unexpectedly small.');
  assert(hwpxZip.file('mimetype'),'HWPX mimetype is missing.');
  assert(hwpxZip.file('Contents/header.xml'),'HWPX header.xml is missing.');
  assert(hwpxZip.file('Contents/section0.xml'),'HWPX section0.xml is missing.');
  const mime=await hwpxZip.file('mimetype').async('string');
  assert(mime.trim()==='application/hwp+zip','HWPX uses an invalid MIME marker.');
  const hwpxText=await packageText(hwpxZip,/\.(?:xml|txt)$/i);
  assert(hwpxText.includes('한글 안정성 점검 80'),'HWPX lost Korean table content.');
  assert(hwpxText.includes('English export 80'),'HWPX lost English table content.');

  return {docxBytes:docx.size,hwpxBytes:hwpx.size};
}

const [mainSource,indexSource,styleSource]=await Promise.all([
  fs.readFile(new URL('../src/main.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
  fs.readFile(new URL('../src/styles/app.css',import.meta.url),'utf8')
]);

await auditTranslations(mainSource,indexSource);
auditSaveMenu(mainSource,indexSource);
auditFormattingStability(mainSource,indexSource,styleSource);
auditDomContracts(mainSource,indexSource);
auditPerformanceGuards(mainSource);
auditLifecycleStability(mainSource);
auditPreviewLocalization(mainSource);
const sizes=await auditOfficeExports();
console.log(`QA passed · translations/menu/DOM/formatting/performance/lifecycle · DOCX ${sizes.docxBytes.toLocaleString()} bytes · HWPX ${sizes.hwpxBytes.toLocaleString()} bytes`);
