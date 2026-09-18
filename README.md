# #ZZ.md

웹에서 바로 사용할 수 있는 Markdown Editor입니다.

Markdown 작성과 실시간 미리보기는 물론, 문서 병합, PDF 변환, 표·수식·다이어그램 편집, 파일 관리 등 문서 작업에 자주 필요한 기능들을 한곳에 모아두었습니다.

> 현재 개발 진행 중인 프로젝트입니다.  
> 기능과 UI는 계속 수정·추가될 예정입니다.

## Demo

https://realzzin.github.io/ZZ_Markdown_Editor/

---

## Features

### Markdown Editing

- Markdown 원문 편집
- 실시간 Preview
- Preview 화면에서 직접 내용 수정
- Editor / Preview 영역 크기 조절
- 여러 Markdown 파일 및 폴더 불러오기

### Document Formatting

- 제목 및 본문 서식
- 글자 크기 / 글자색 / 배경색
- 텍스트 정렬
- 링크 및 이미지 삽입
- 각주
- 코드 블록 및 Syntax Highlighting
- 수식 입력 및 렌더링
- Mermaid 다이어그램
- 표 생성 및 편집
- 표 정렬 및 필터

### Document Navigation

- 제목 기반 문서 목차
- 해시태그 탐색
- 문서 간 이동
- 작업 기록 및 이전 상태 복구

### File Management

- 여러 Markdown 파일 불러오기
- Markdown 문서 병합
- 이미지 및 첨부 파일 관리
- MD / PDF 저장
- 여러 파일 ZIP 저장

### File Conversion

- Markdown → PDF
- PDF → Markdown
- 소스 코드 파일 → Markdown Code Block
- CSV / XLSX 데이터 불러오기

> PDF → Markdown 변환 결과는 원본 PDF의 구조와 레이아웃에 따라 일부 차이가 발생할 수 있습니다.

### Appearance

- Light / Dark Theme
- 사용자 지정 배경색
- 사용자 지정 글자색
- 사이드바 크기 조절
- Editor / Preview 레이아웃 조절

---

## Screenshot

현재 화면

<!--
![ZZ Markdown Editor](./docs/screenshot.png)
-->

---

## Development Status

현재 기본적인 Markdown 편집 및 문서 관리 기능은 구현되어 있으며, 사용 중 발견되는 문제를 수정하고 기능을 추가하고 있습니다.

### Planned

- [ ] 모바일 환경 최적화
- [ ] 전체 UI / UX 개선
- [ ] 처음 사용하는 사용자를 위한 가이드 / 튜토리얼
- [ ] 표 편집 기능 개선
- [ ] 파일 관리 기능 개선
- [ ] 추가 Markdown 편집 기능
- [ ] 단축키 및 작업 편의 기능 추가
- [ ] 오류 처리 및 안정성 개선
- [ ] 테스트 확대

---

## Tech Stack

- HTML
- CSS
- JavaScript
- Vite

### Libraries

- `marked` — Markdown parsing
- `highlight.js` — Syntax Highlighting
- `KaTeX` / `MathLive` — Math
- `Mermaid` — Diagram
- `PDF.js` — PDF processing
- `SheetJS` — Spreadsheet processing
- `JSZip` — ZIP export

---

## Getting Started

### Clone

```bash
git clone https://github.com/RealZZIN/ZZ_Markdown_Editor.git
cd ZZ_Markdown_Editor
```

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

개발 서버 실행 후 터미널에 표시되는 주소로 접속합니다.

### Build

```bash
npm run build
```

빌드 결과는 `dist/` 디렉터리에 생성됩니다.

---

## Project Status

`#ZZ.md`는 현재 개발 중입니다.

실제 Markdown 문서를 작성하고 관리하면서 필요한 기능을 중심으로 개선하고 있으며, 기존 기능의 안정화와 함께 새로운 기능도 계속 추가할 예정입니다.
