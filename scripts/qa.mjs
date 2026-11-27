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
  for(const match of mainSource.matchAll(/\b(?:textContent|title|placeholder)\s*=\s*'((?:\\.|[^'\\])*)'/g))candidates.push(decodeJsText(match[1]));
  for(const match of mainSource.matchAll(/\.setAttribute\(\s*'(?:title|aria-label|placeholder)'\s*,\s*'((?:\\.|[^'\\])*)'/g))candidates.push(decodeJsText(match[1]));
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
  assert(styleSource.includes(':where(.app,.modal-backdrop,.file-context-menu,#tbl-ctx,.cp-panel,.saved-color-window,.saved-custom-format-window,.source-syntax-popover,.find-replace-panel) { font-family:var(--font); }'),'Dynamic application UI can fall back from Pretendard.');
  assert(styleSource.includes("--font:     Pretendard")&&styleSource.includes('button, input, textarea, select { font: inherit;'),'Pretendard is not the global UI font or form controls do not inherit it.');
  assert(indexSource.includes('id="fmt-bg-opacity"'),'Background opacity control is missing.');
  assert(styleSource.includes('.font-bg-opacity'),'Background opacity control styles are missing.');
  assert(mainSource.includes('function refreshColorTargetSnapshot()'),'Color target refresh guard is missing.');
  assert(mainSource.includes('function mutateQuoteDesign('),'Quote formatting scroll guard is missing.');
  assert(mainSource.includes("type==='bg'&&pickedValue?quoteColorWithOpacity"),'Background opacity is not applied to picked colors.');
  assert(mainSource.includes("root.addEventListener('contextmenu',event=>"),'Preview background context-menu suppression is missing.');
  const opacity=indexSource.indexOf('id="fmt-bg-opacity"'),picker=indexSource.indexOf('id="bg-color-current"');
  assert(opacity>=0&&picker>=0&&opacity<picker,'Background opacity must appear above the color picker.');
  assert(indexSource.indexOf('id="clear-text-color"')>indexSource.indexOf('id="text-color-saved"'),'The regular text-color reset action was not restored beside Save color.');
  assert(indexSource.indexOf('id="clear-bg-color"')>indexSource.indexOf('id="bg-color-saved"'),'The regular background-color reset action is not beside Save color.');
  assert(/id="clear-text-color"[\s\S]{0,250}id="save-text-color"/.test(indexSource)&&/id="clear-bg-color"[\s\S]{0,250}id="save-bg-color"/.test(indexSource),'Text and background reset controls are not aligned with their Save color action.');
  assert(!indexSource.includes('글자색 기본')&&!indexSource.includes('배경색 기본')&&!mainSource.includes("'글자색 기본'")&&!mainSource.includes("'배경색 기본'"),'Color reset controls still use the word 기본.');
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
  assert(mainSource.includes("import('@e965/xlsx')")&&mainSource.includes("import('mermaid')")&&mainSource.includes("import('mathlive')")&&mainSource.includes("import('katex')")&&mainSource.includes("import('./syntax-highlight-runtime.js')"),'Large optional editor modules are no longer lazy-loaded.');
  assert(mainSource.includes("matchMedia('(max-width:860px)')")&&mainSource.includes('mobilePreviewScrollInstalled'),'Desktop mode still installs mobile-only preview scroll observers.');
  assert(mainSource.includes("observe(preview,{childList:true,subtree:true})")&&!mainSource.includes("observe(preview,{childList:true,subtree:true,attributes:true})"),'Mobile preview scroll sync watches every attribute mutation.');
  assert(mainSource.includes("els.preview.addEventListener('scroll',()=>{onPreviewScroll();schedulePreviewVisualScroll()}"),'Preview scroll work is split across duplicate listeners.');
}

function auditLifecycleStability(mainSource){
  assert(mainSource.includes("loadMermaidRuntime().then(runtime=>")&&mainSource.includes("console.warn('Mermaid render failed',error)"),'Async Mermaid failures are not contained.');
  assert(mainSource.includes('Preview enhancement stage ${currentStage+1} failed'),'Preview enhancement stages are not isolated.');
  assert(mainSource.includes('sandbox="allow-forms allow-scripts"')&&!mainSource.includes('sandbox="allow-forms allow-scripts allow-same-origin"'),'Uploaded HTML must run inside an opaque-origin sandbox.');
  assert(styleSource.includes('.zz-html-frame { display:block; width:100%; height:calc(100% - 35px); min-height:220px; border:0; background:#fff; pointer-events:auto; }'),'Uploaded HTML interactions are disabled by the preview stylesheet.');
  assert(mainSource.includes("const MERGE_ORDER_STORAGE_KEY='md-merge-order-v1'")&&mainSource.includes('function commitMergeListOrder()'),'Merge order cannot be rearranged or restored.');
  assert(mainSource.includes('data-merge-shift="-1"')&&mainSource.includes("grip.addEventListener('dragstart'"),'Merge order is missing pointer and keyboard-friendly controls.');
  assert(indexSource.includes('id="merge-order-list"')&&indexSource.includes('id="merge-search"'),'Merge selection and merge order are not separated for large document sets.');
  assert(indexSource.indexOf('id="merge-drop"')<indexSource.indexOf('id="merge-search"')&&indexSource.indexOf('id="merge-search"')<indexSource.indexOf('id="merge-list"'),'Merge upload, search, and document selection are not arranged in the requested order.');
  assert(indexSource.includes('id="merge-order-open"')&&indexSource.includes('id="merge-order-dialog"')&&styleSource.includes('.merge-order-dialog-card'),'Merge order is not available as a clean dialog beside the merge action.');
  assert(!indexSource.includes('id="insert-file-toggle"')&&mainSource.includes('현재 문서에 파일 삽입'),'The document insert upload is still a misleading standalone toolbar icon.');
  assert(mainSource.includes('function renderMergeOrderList()')&&mainSource.includes('mergeSelectedKeys'),'Selected merge documents do not have an independent order queue.');
  assert(mainSource.includes("const root={name:'문서',children:new Map(),files:[]}")&&mainSource.includes("file.source==='local'?'로컬':'업로드된 파일'")&&!mainSource.includes("return'루트';return file.dir||'단일문서'"),'Merge documents are not organized under a single document tree matching the file sidebar.');
  assert(mainSource.includes('hoverPreviewShowTimer=setTimeout(()=>renderMergeHoverPreview(anchor,file,context),240)')&&mainSource.includes('const fullText=String(file.text||\'\'),limit=18000')&&mainSource.includes('requestIdleCallback'),'Merge hover previews still render full documents synchronously as soon as the pointer enters a row.');
  assert(mainSource.includes("document.visibilityState==='hidden')flushWorkspaceForLifecycle()"),'Hidden tabs do not flush pending workspace recovery data.');
  assert(mainSource.includes('mutateQuoteDesign(quote,()=>quote.style.removeProperty(property))'),'Resetting quote colors bypasses the scroll-safe mutation path.');
  assert(mainSource.includes('|(?:>[ \\t]*)+\\S|'),'Nested quote markers are not recognized by live preview Markdown.');
  assert(mainSource.includes('depth:(marker[0].match(/>/g)||[]).length'),'Nested quote depth is not preserved during preview conversion.');
  assert(mainSource.includes("type==='list'?[['background','배경색'],['marker','목록 기호']]"),'List markers do not expose color and background controls.');
  assert(mainSource.includes('setQuoteColorKind(button.dataset.quoteColorKind)'),'Reconfigured quote/list color tabs still use a stale target kind.');
  assert(styleSource.includes('.preview li::marker { color:var(--zz-list-marker-color,currentColor); }'),'List marker colors are not rendered independently.');
  assert(mainSource.includes("meaningful(range.toString())!==meaningful(host.textContent)"),'Replacing a selected background can still create nested color wrappers.');
  assert(mainSource.includes('function updatePreviewSelectionColors(range)'),'Selected text colors are not reflected in the toolbar chips.');
  assert(mainSource.includes("'글자색 초기화'")&&mainSource.includes("'배경색 초기화'")&&mainSource.includes('data-saved-custom-format-reset="text"')&&mainSource.includes('data-saved-custom-format-reset="bg"'),'Saved custom styles are missing explicit text/background reset actions.');
  assert(mainSource.includes("['right','bottom'].forEach(edge=>"),'Saved custom styles do not have full-edge resize handles.');
  assert(styleSource.includes('.saved-custom-format-resizer.right')&&styleSource.includes('.saved-custom-format-resizer.bottom'),'Saved custom style resize handles are not visible on both edges.');
  assert(mainSource.includes('matchingHosts.forEach(item=>'),'Background reset does not clear every matching nested wrapper in one pass.');
  assert(mainSource.includes("styleName==='background-color'||meaningful(element.textContent)===meaningful(range.toString())"),'Background reset can still split a highlighted run and leave colored side caps.');
  assert(mainSource.includes("if(styled&&(styleName==='background-color'||meaningful(element.textContent)===meaningful(range.toString())))"),'Text color reset still fails when bold or underline changes the selection boundary.');
  assert(!mainSource.includes('<p>현재 문서에 저장되지 않은 수정사항이 있습니다. 계속하기 전에 어떻게 처리할까요?</p>'),'The unwanted unsaved-changes prompt sentence is still present.');
  assert(styleSource.includes('#tbl-ctx .tbl-ctx-group'),'The table context menu is not visually grouped.');
  assert(!mainSource.includes('class="tbl-ctx-label"'),'The table context menu still shows small section labels.');
  assert(mainSource.includes("submenu('합치기 · 나누기'")&&mainSource.includes("submenu('정렬'")&&mainSource.includes("submenu('행 · 열 추가'")&&mainSource.includes("submenu('삭제'"),'The table context menu is missing progressive submenus.');
  assert(!mainSource.includes("submenu('표 작업'")&&mainSource.includes('<button data-op="reset-shape">표 형태 초기화</button>'),'Duplicate table cut/copy actions still occupy a submenu instead of a direct shape reset.');
  assert(styleSource.includes('width:168px')&&styleSource.includes('left:calc(100% + 8px)'),'Table submenus do not open beside the main menu.');
  assert(mainSource.includes("row.addEventListener('mouseenter',open)"),'Table submenus still require a click instead of pointer hover.');
  assert(mainSource.includes("setTimeout(()=>row.classList.remove('open'),220)")&&styleSource.includes('.tbl-ctx-submenu-row.open::after'),'Table submenus can disappear while crossing the pointer gap.');
  assert(mainSource.includes('function previewQuoteColorValue(')&&mainSource.includes('function commitQuoteColorInteraction('),'List and quote color drags still resync the whole document on every pointer update.');
  assert(mainSource.includes('formatMenuScrollSnapshot=pickerScrollSnapshot')&&mainSource.includes('formatScrollSnapshot=pickerScrollSnapshot'),'Opening list or quote colors can reuse a stale scroll snapshot from a previous target.');
  assert(mainSource.includes('formatScrollRestoreToken')&&mainSource.includes('restoreToken!==formatScrollRestoreToken'),'A delayed formatting restore can overwrite the scroll position of a newly opened list color target.');
  assert(mainSource.includes('quoteColorTarget?.scrollSnapshot')&&mainSource.includes('quoteSnapshot||formatScrollSnapshot'),'List and quote palette events can fall back to a stale generic formatting snapshot.');
  assert(mainSource.includes('function refreshQuoteColorScrollSnapshot(')&&mainSource.includes('snapshot.anchor=null;snapshot.anchorTop=null'),'List color adjustments do not lock the exact live scroll position before each change.');
  assert(mainSource.includes('function restoreQuoteColorScroll(')&&mainSource.includes('beginQuoteColorInteraction(true)'),'List color drags do not directly lock and restore the live preview scroll position.');
  assert(mainSource.includes('quoteColorTarget.values?.set')&&mainSource.includes('const saved=quoteColorTarget.values?.get(kind)'),'Quote/list color tabs do not preserve their latest edited values.');
  assert(mainSource.includes('id="option-search"')&&mainSource.includes('data-option-group')&&mainSource.includes('function filterOptions('),'Editor options are missing searchable accordion groups.');
  assert(mainSource.includes('placeholder="기능 찾기"')&&mainSource.includes("'기능 찾기':'Find a feature'"),'Option search wording is still redundant with the panel title.');
  assert(mainSource.includes('function enableOptionsPanelDrag(')&&mainSource.includes("md-options-panel-position"),'Editor options panel cannot be dragged or restore its position.');
  assert(mainSource.includes('let top=rect.top')&&mainSource.includes('rect.right+gap'),'Option previews are not aligned directly beside their option row.');
  assert(mainSource.includes('positionOptionPreview(activeOptionPreviewLabel)')&&mainSource.includes('function positionOptionPreview('),'Option previews do not follow the options panel while it is dragged.');
  assert(styleSource.includes('.option-example-head { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:5px;'),'Option preview headings are spaced too far from their descriptions.');
  assert(mainSource.includes('function installMobilePreviewScrollDrag(')&&mainSource.includes("rangeX.addEventListener('input'")&&mainSource.includes("rangeY.addEventListener('input'")&&styleSource.includes('.mobile-preview-vscroll { top:10px'),'Mobile preview scroll controls are not persistently visible or synchronized on both axes.');
  assert(mainSource.includes('ZZ_EMERGENCY_WORKSPACE_KEY')&&mainSource.includes('writeEmergencyWorkspace();')&&mainSource.includes('readEmergencyWorkspace()'),'Rapid reloads can lose the latest workspace before IndexedDB autosave completes.');
  assert(mainSource.includes('function scheduleEmergencyWorkspace(')&&mainSource.includes('now-emergencySaveStartedAt>=1000?0:180')&&mainSource.includes('scheduleEmergencyWorkspace();'),'Emergency recovery still serializes every open document on each keystroke.');
  assert(mainSource.includes('class="ac-dependent-options"')&&styleSource.includes('.ac-dependent-options'),'Document split dependencies are not visually grouped beneath their parent option.');
  assert(styleSource.includes('.ac-panel label:hover .ac-desc'),'Option descriptions are still permanently visible instead of appearing on demand.');
  assert(styleSource.includes('width:168px')&&styleSource.includes('font:12px var(--font)'),'The main table menu is not compact or does not use Pretendard.');
  assert(styleSource.includes('.cp-save-row { margin-top:14px;'),'Saved palette colors are still crowded against the reset/save actions.');
  assert(styleSource.includes('color:#f5f5f5;font:11.5px var(--font)'),'Table submenu text is not explicitly white or does not use Pretendard.');
  assert(indexSource.includes('aria-label="글자색 초기화">초기화</button>')&&indexSource.includes('aria-label="배경색 초기화">초기화</button>'),'Color reset buttons do not use the concise visible label.');
  assert(styleSource.includes('#tbl-ctx.flip-submenus .tbl-ctx-submenu'),'Table submenus cannot flip away from the viewport edge.');
  assert(mainSource.includes("Math.max(8,Math.min(x,innerWidth-r.width-8))"),'The table context menu can still render outside the horizontal viewport.');
  assert(mainSource.includes('function closeCustomFormatSavedWindow()'),'Saved custom-format windows have no single close path.');
  assert(mainSource.includes('if(customFormatSavedWindow?.isConnected){event.preventDefault();event.stopPropagation();return}'),'An open saved custom-format window does not suppress single-click panel toggles.');
  assert(mainSource.includes('if(customFormatSavedWindow?.isConnected){closeCustomFormatSavedWindow();return}'),'Double-click does not close an open saved custom-format window.');
  assert(mainSource.includes('btn.ondblclick=event=>{event.preventDefault();event.stopPropagation();showRenameFileDialog(index)}'),'Sidebar files cannot be renamed by double-clicking their list row.');
  assert(mainSource.includes('function insertPreviewTableSpace(e)')&&mainSource.includes("e.inputType!=='insertText'||e.data!==' '")&&mainSource.includes("?' ':'\\u00a0'"),'Leading spaces in preview table cells can still create a second block or line.');
  assert(mainSource.includes("e.key==='Backspace'&&!e.defaultPrevented")&&mainSource.includes("!before.toString().replace(/[\\u200b\\u00a0\\s]/g,'')"),'Backspace at the start of a table cell can still split its text into two lines.');
  assert(mainSource.includes('function deleteTableCellBackwardWithoutBlock(e,range,cell)')&&mainSource.includes('if(backward)return deleteTableCellBackwardWithoutBlock(e,range,cell)'),'Backspace inside a one-line table cell can still invoke native block splitting.');
}

function auditEmbeddedObjectEditing(mainSource,styleSource){
  assert(mainSource.includes(".zz-sheet[data-embed-source],.zz-html-embed[data-embed-source],.zz-doc-embed[data-embed-source]"),'Embedded HTML, spreadsheets, and documents do not share object editing behavior.');
  assert(mainSource.includes("(e.key==='Delete'||e.key==='Backspace')&&clickMoveElement&&els.preview.contains(clickMoveElement)")&&mainSource.includes('deleteSelectedPreviewElement();'),'Backspace/Delete can leave an empty embedded-object frame behind.');
  assert(mainSource.includes('function uploadDocumentName(file)')&&mainSource.includes('function openDocumentWithName(name)')&&mainSource.includes('기존 문서는 덮어쓰지 않았습니다.'),'Opening a same-named document can still overwrite an existing open file.');
  assert(mainSource.includes('e.stopImmediatePropagation();')&&mainSource.includes('deleteSelectedPreviewElement();')&&mainSource.includes('removeHorizontalRule(selectedHorizontalRule)'),'Selected preview objects cannot be removed consistently with Delete or Backspace.');
  assert(mainSource.includes("block?.dataset.referenceSource"),'Reference blocks cannot preserve their source during copy and paste.');
  assert(mainSource.includes('class="zz-sheet" contenteditable="false"')&&mainSource.includes('class="zz-html-embed" contenteditable="false"'),'Read-only embedded objects can still be partially edited or leave an empty shell.');
  assert(styleSource.includes('.zz-html-frame')&&styleSource.includes('pointer-events:none'),'Read-only HTML iframe content still intercepts selection and context-menu input.');
}

function auditResourceIntegrity(mainSource,indexSource,lockSource){
  const lock=JSON.parse(lockSource);
  const unhashed=Object.entries(lock.packages||{}).filter(([path,entry])=>path&&entry.resolved&&!entry.integrity);
  assert(!unhashed.length,`Downloaded packages without recorded integrity hashes: ${unhashed.map(([path])=>path).join(', ')}`);
  assert(indexSource.includes('http-equiv="Content-Security-Policy"'),'The application has no resource-loading Content Security Policy.');
  assert(!/<(?:script|link)\b[^>]*https?:\/\//i.test(indexSource),'Executable code or styles are still loaded directly from a remote CDN.');
  assert(!/(?:import\s*\(|\.src\s*=)[^\n]*(?:cdnjs|cdn\.jsdelivr|unpkg)/i.test(mainSource),'Runtime code can still execute an unverified remote module.');
  assert(mainSource.includes("import './vendor-runtime.js'"),'The verified local vendor runtime is not loaded.');
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

const [mainSource,indexSource,styleSource,lockSource]=await Promise.all([
  fs.readFile(new URL('../src/main.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
  fs.readFile(new URL('../src/styles/app.css',import.meta.url),'utf8'),
  fs.readFile(new URL('../package-lock.json',import.meta.url),'utf8')
]);

await auditTranslations(mainSource,indexSource);
auditSaveMenu(mainSource,indexSource);
auditFormattingStability(mainSource,indexSource,styleSource);
auditDomContracts(mainSource,indexSource);
auditPerformanceGuards(mainSource);
auditLifecycleStability(mainSource);
auditEmbeddedObjectEditing(mainSource,styleSource);
auditResourceIntegrity(mainSource,indexSource,lockSource);
auditPreviewLocalization(mainSource);
const sizes=await auditOfficeExports();
console.log(`QA passed · translations/menu/DOM/formatting/performance/lifecycle · DOCX ${sizes.docxBytes.toLocaleString()} bytes · HWPX ${sizes.hwpxBytes.toLocaleString()} bytes`);
