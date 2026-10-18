<div align="center">

# `#ZZ.md`

### Write. Preview. Organize. Convert. — without leaving your document.

**A feature-rich Markdown workspace built for people who want the speed of plain text<br>
and the comfort of a visual editor.**

[![Live Demo](https://img.shields.io/badge/OPEN_LIVE_DEMO-%23ZZ.md-e59abb?style=for-the-badge)](https://realzzin.github.io/ZZ_Markdown_Editor/)
[![Built with Vite](https://img.shields.io/badge/Built_with-Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Markdown](https://img.shields.io/badge/Markdown-Editor-1f2328?style=flat-square&logo=markdown&logoColor=white)](https://www.markdownguide.org/)

**[English](#english) · [한국어](#한국어)**

</div>

---

# English

## Markdown should feel lightweight — not limited

`#ZZ.md` brings writing, live preview, visual editing, file organization, merging, conversion, tables, math, diagrams, and export into one focused workspace.

Use Markdown when you want control. Use the Preview when you want speed. Move between both without changing tools.

> [!NOTE]
> `#ZZ.md` is actively being developed. Features and interface details may continue to evolve.

## Try it now

### [Open the live editor →](https://realzzin.github.io/ZZ_Markdown_Editor/)

No installation is required for the web demo. Open it, add a Markdown file, and start editing.

## Why `#ZZ.md`?

| One workspace | What it gives you |
| --- | --- |
| ✍️ **Write your way** | Edit Markdown source or work directly in the live Preview. |
| 🗂️ **Handle real projects** | Open multiple files and folders, browse outlines and hashtags, and organize attachments. |
| 🎨 **Format visually** | Apply headings, alignment, colors, links, images, footnotes, and reusable formatting. |
| 📊 **Build rich documents** | Create and edit tables, code blocks, math, and Mermaid diagrams. |
| 🔄 **Convert and combine** | Merge documents and work with Markdown, PDF, source code, CSV, and XLSX inputs. |
| 📦 **Take your work with you** | Save as MD or PDF, or export multiple files as a ZIP archive. |

## Highlights

### A preview you can actually edit

- Live Markdown rendering while you type
- Direct editing inside Preview
- Resizable Editor and Preview panes
- Split, editor-only, and preview-focused workflows
- Quick source editing from Preview
- Undo, recovery history, search, and replace

### More than paragraphs

- Text color, background color, font size, line spacing, and alignment
- Links, images, footnotes, and blockquotes
- Syntax-highlighted code blocks
- KaTeX / MathLive-powered equations
- Mermaid diagrams
- Editable tables with sorting, value filters, formatting filters, and multi-select color filters
- Custom document fonts and light, dark, or personalized themes

### Made for a folder full of notes

- Open multiple Markdown files or an entire folder
- Navigate nested folders, document outlines, and hashtags
- Manage images and attached files
- Merge selected documents
- Save individual files or export a collection as ZIP
- Restore earlier workspace and document states

### Conversion and export

- Markdown → PDF
- PDF → editable Markdown
- Source code → Markdown code block
- CSV / XLSX data import
- Multi-page PDF layout and scale controls

### Desktop and mobile workflow

- Korean and English interface throughout menus, dialogs, tooltips, and document tools
- Responsive formatting toolbar with the same core controls on desktop and mobile
- Seven line-spacing presets (`1.2`–`2.4`, with `1.8` as the default) plus direct numeric input
- Touch-friendly Preview editing, table controls, themes, and settings

## Basic workflow

1. Open a Markdown file, a folder, or create a new document.
2. Write in Markdown, edit directly in Preview, or keep both panes open.
3. Select text or table cells to apply formatting. Use **Spacing** beside font size to change line spacing.
4. Use a table header filter to combine value, formatting, text-color, and background-color conditions.
5. Save as MD or PDF, or export selected documents and folders as ZIP.

> [!IMPORTANT]
> PDF-to-Markdown conversion is best-effort. Results can vary depending on the original PDF's layout, embedded fonts, tables, and graphics.

## Quick start for developers

Requirements: a current Node.js release and npm.

```bash
git clone https://github.com/RealZZIN/ZZ_Markdown_Editor.git
cd ZZ_Markdown_Editor
npm install
npm run dev
```

Open the local address shown in the terminal.

### Production build

```bash
npm run build
npm run preview
```

The production files are generated in `dist/`.

## Technology

`#ZZ.md` is built with HTML, CSS, JavaScript, and Vite.

| Library | Purpose |
| --- | --- |
| marked | Markdown parsing |
| highlight.js | Syntax highlighting |
| KaTeX / MathLive | Mathematical notation |
| Mermaid | Diagrams |
| PDF.js | PDF processing |
| SheetJS | Spreadsheet import |
| JSZip | ZIP export |

## Project status

The editor is usable today and is under active development. Current work focuses on responsiveness, editing stability, file management, PDF performance, and a smoother experience across desktop and mobile screens.

If you find a reproducible issue, please include the input Markdown, what you expected, what happened, and—when helpful—a screenshot.

<div align="center">

### Plain text at heart. A complete document workspace in practice.

[Launch `#ZZ.md`](https://realzzin.github.io/ZZ_Markdown_Editor/) · [Back to top](#zzmd)

</div>

---

# 한국어

## Markdown은 가벼워야 하지만, 기능까지 가벼울 필요는 없으니까

`#ZZ.md`는 작성, 실시간 미리보기, 시각적 편집, 파일 관리, 문서 병합, 변환, 표, 수식, 다이어그램, 내보내기를 하나의 작업 공간에 담은 Markdown 편집기입니다.

세밀하게 다듬을 때는 Markdown 원문을, 빠르게 편집할 때는 Preview를 사용하세요. 도구를 바꾸지 않고 두 방식을 자연스럽게 오갈 수 있습니다.

> [!NOTE]
> `#ZZ.md`는 활발하게 개발 중입니다. 기능과 화면 구성은 계속 개선될 수 있습니다.

## 지금 사용해 보기

### [웹에서 바로 편집기 열기 →](https://realzzin.github.io/ZZ_Markdown_Editor/)

웹 데모는 설치할 필요가 없습니다. 편집기를 열고 Markdown 파일을 추가하면 바로 시작할 수 있습니다.

## 왜 `#ZZ.md`인가요?

| 하나의 작업 공간 | 할 수 있는 일 |
| --- | --- |
| ✍️ **원하는 방식으로 작성** | Markdown 원문과 실시간 Preview 양쪽에서 문서를 편집합니다. |
| 🗂️ **실제 프로젝트 관리** | 여러 파일과 폴더를 열고 목차·해시태그를 탐색하며 첨부 파일을 관리합니다. |
| 🎨 **눈으로 보며 서식 적용** | 제목, 정렬, 색상, 링크, 이미지, 각주와 사용자 서식을 적용합니다. |
| 📊 **풍부한 문서 제작** | 표, 코드 블록, 수식과 Mermaid 다이어그램을 만들고 편집합니다. |
| 🔄 **변환하고 합치기** | 문서를 병합하고 Markdown, PDF, 소스 코드, CSV, XLSX를 다룹니다. |
| 📦 **필요한 형태로 저장** | MD 또는 PDF로 저장하고 여러 파일을 ZIP으로 내보냅니다. |

## 주요 기능

### 보기만 하는 미리보기가 아닙니다

- 입력과 동시에 반영되는 Markdown Preview
- Preview 화면에서 직접 내용 편집
- Editor와 Preview 영역 크기 조절
- 분할 보기, 편집 중심, 미리보기 중심 작업 방식
- Preview에서 Markdown 원문 빠른 편집
- 실행 취소, 복원 기록, 검색과 바꾸기

### 평범한 본문 그 이상

- 글자색, 배경색, 글자 크기, 글 세로 간격과 정렬
- 링크, 이미지, 각주와 인용문
- 문법 강조 코드 블록
- KaTeX / MathLive 기반 수식
- Mermaid 다이어그램
- 값·서식·복수 색상 필터와 정렬을 지원하는 편집 가능한 표
- 사용자 문서 폰트와 라이트·다크·사용자 지정 테마

### 수많은 노트와 폴더를 위해

- 여러 Markdown 파일 또는 폴더 전체 열기
- 중첩 폴더, 문서 목차와 해시태그 탐색
- 이미지와 첨부 파일 관리
- 선택한 문서 병합
- 개별 파일 저장과 여러 파일 ZIP 내보내기
- 이전 작업 공간과 문서 상태 복원

### 변환과 내보내기

- Markdown → PDF
- PDF → 편집 가능한 Markdown
- 소스 코드 → Markdown 코드 블록
- CSV / XLSX 데이터 불러오기
- 여러 페이지 PDF 배치와 배율 조절

### 데스크톱과 모바일 작업 환경

- 메뉴, 대화상자, 도움말과 문서 도구 전반의 한국어·영어 UI
- 데스크톱과 모바일에서 핵심 기능을 동일하게 제공하는 반응형 서식 도구
- `1.2~2.4` 7단계 글 세로 간격(`1.8`이 기본값)과 숫자 직접 입력
- 터치 환경에 맞춘 Preview 편집, 표 조작, 테마와 설정

## 기본 사용 순서

1. Markdown 파일이나 폴더를 열거나 새 문서를 만듭니다.
2. Markdown 원문, Preview 직접 편집 또는 분할 보기로 작성합니다.
3. 글자나 표 셀을 선택해 서식을 적용합니다. 글자 크기 옆의 **간격**에서 글 세로 간격을 바꿀 수 있습니다.
4. 표 머리글 필터에서 값, 서식, 글자색과 배경색 조건을 조합합니다.
5. MD·PDF로 저장하거나 선택 문서와 폴더를 ZIP으로 내보냅니다.

> [!IMPORTANT]
> PDF → Markdown 변환은 원본 구조를 최대한 보존하는 방식입니다. 원본 PDF의 레이아웃, 내장 폰트, 표와 그래픽 구성에 따라 결과가 달라질 수 있습니다.

## 개발 환경에서 실행하기

최신 Node.js와 npm이 필요합니다.

```bash
git clone https://github.com/RealZZIN/ZZ_Markdown_Editor.git
cd ZZ_Markdown_Editor
npm install
npm run dev
```

실행 후 터미널에 표시되는 로컬 주소로 접속하세요.

### 배포용 빌드

```bash
npm run build
npm run preview
```

빌드 결과는 `dist/`에 생성됩니다.

## 사용 기술

`#ZZ.md`는 HTML, CSS, JavaScript와 Vite로 제작되었습니다.

| 라이브러리 | 용도 |
| --- | --- |
| marked | Markdown 파싱 |
| highlight.js | 코드 문법 강조 |
| KaTeX / MathLive | 수식 표현과 편집 |
| Mermaid | 다이어그램 |
| PDF.js | PDF 처리 |
| SheetJS | 스프레드시트 불러오기 |
| JSZip | ZIP 내보내기 |

## 프로젝트 상태

현재 실제 문서 편집에 사용할 수 있으며 계속 개발 중입니다. 반응 속도, 편집 안정성, 파일 관리, PDF 성능과 데스크톱·모바일 사용 경험을 중심으로 개선하고 있습니다.

재현 가능한 문제를 발견했다면 입력한 Markdown, 기대한 결과, 실제 결과와 필요한 경우 스크린샷을 함께 남겨 주세요.

<div align="center">

### 본질은 가벼운 텍스트, 경험은 완전한 문서 작업 공간.

[지금 `#ZZ.md` 사용하기](https://realzzin.github.io/ZZ_Markdown_Editor/) · [맨 위로](#zzmd)

</div>
