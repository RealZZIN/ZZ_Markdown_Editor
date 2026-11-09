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

const [mainSource,indexSource]=await Promise.all([
  fs.readFile(new URL('../src/main.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../index.html',import.meta.url),'utf8')
]);

await auditTranslations(mainSource,indexSource);
auditSaveMenu(mainSource,indexSource);
const sizes=await auditOfficeExports();
console.log(`QA passed · translations/menu · DOCX ${sizes.docxBytes.toLocaleString()} bytes · HWPX ${sizes.hwpxBytes.toLocaleString()} bytes`);
