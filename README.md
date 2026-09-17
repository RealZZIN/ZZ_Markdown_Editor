# ZZ Markdown Editor

브라우저에서 실행되는 Markdown 편집기입니다. 기존 단일 HTML 버전의 UI와 기능을 유지하면서 Vite 기반 JavaScript 프로젝트로 분리했습니다.

## 실행

```bash
npm install
npm run dev
```

터미널에 표시되는 로컬 주소를 브라우저에서 열면 됩니다.

## 배포 빌드

```bash
npm run build
npm run preview
```

빌드 결과는 `dist/`에 생성됩니다.

## 구조

```text
index.html          화면 구조와 외부 라이브러리 연결
src/main.js         편집기 기능과 상태 관리
src/styles/app.css  전체 UI 스타일
vite.config.js      개발 서버와 빌드 설정
```

프로젝트의 실행 진입점은 `index.html`입니다.
