import {marked} from 'marked';

import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';

// Exact package versions and SHA integrity values are recorded in package-lock.json.
// `npm ci` verifies them before Vite includes these modules in the local bundle.
Object.assign(globalThis,{
  marked
});
