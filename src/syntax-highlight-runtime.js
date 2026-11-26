import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import dos from 'highlight.js/lib/languages/dos';
import dart from 'highlight.js/lib/languages/dart';
import scala from 'highlight.js/lib/languages/scala';
import fsharp from 'highlight.js/lib/languages/fsharp';
import gradle from 'highlight.js/lib/languages/gradle';
import properties from 'highlight.js/lib/languages/properties';
import 'highlight.js/styles/atom-one-dark.min.css';

hljs.registerLanguage('powershell',powershell);
hljs.registerLanguage('dos',dos);
hljs.registerLanguage('dart',dart);
hljs.registerLanguage('scala',scala);
hljs.registerLanguage('fsharp',fsharp);
hljs.registerLanguage('gradle',gradle);
hljs.registerLanguage('properties',properties);
hljs.registerAliases(['vue','svelte'],{languageName:'xml'});
hljs.registerAliases(['toml'],{languageName:'ini'});
hljs.registerAliases(['csv'],{languageName:'plaintext'});

export default hljs;
