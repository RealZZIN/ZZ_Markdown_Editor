# Resource integrity policy

- Application code, styles, fonts, workers, and document parsers must be bundled from local npm packages. Runtime CDN execution is not allowed.
- Direct dependency versions are pinned in `package.json`. The downloaded archive URL and SHA-512 integrity value for every package are recorded in `package-lock.json`; use `npm ci` so npm verifies each archive before installation.
- The browser Content Security Policy permits executable resources only from the application origin and blocks remote images, objects, and connections by default.
- A new external runtime resource may be introduced only with an immutable version and a recorded cryptographic hash. Add or update the QA integrity audit in the same change.
- User-facing hyperlinks may point off-site, but they are navigation targets and are never executed or fetched as application resources.
