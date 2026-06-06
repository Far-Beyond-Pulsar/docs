/**
 * Generates static HTML redirect files for legacy /docs/docs/... URLs.
 *
 * Old URL: pulsarnative.com/docs/docs/core-concepts/Helio
 * New URL: pulsarnative.com/docs/core-concepts/Helio
 *
 * Since this is a static export, redirects are plain HTML files placed in
 * public/docs/... (which the webserver serves at /docs/docs/... when the
 * whole app is mounted at /docs/).
 */

const fs = require('fs');
const path = require('path');

const structurePath = path.join(process.cwd(), 'public/docs-structure.json');

if (!fs.existsSync(structurePath)) {
  console.warn('docs-structure.json not found — run generate:docs first');
  process.exit(0);
}

const structure = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));

function redirectHtml(newUrl) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${newUrl}">
<link rel="canonical" href="${newUrl}">
<title>Redirecting…</title>
</head>
<body>
<p>Redirecting to <a href="${newUrl}">${newUrl}</a></p>
<script>window.location.replace("${newUrl}");</script>
</body>
</html>`;
}

function collectPaths(nodes) {
  const paths = [];
  for (const node of nodes || []) {
    if (node.path) paths.push(node.path);
    if (node.children) paths.push(...collectPaths(node.children));
    if (node.indexPage?.path) paths.push(node.indexPage.path);
  }
  return paths;
}

const docPaths = [...new Set(collectPaths(structure.navigation || []))];
let written = 0;

for (const docPath of docPaths) {
  // docPath looks like /docs/core-concepts/Helio
  // Legacy URL is /docs/docs/core-concepts/Helio
  // We write the redirect file at public/docs/core-concepts/Helio/index.html
  // (served at /docs/docs/core-concepts/Helio when mounted at /docs/)
  const stripped = docPath.replace(/^\/docs\//, ''); // core-concepts/Helio
  const outDir = path.join(process.cwd(), 'public', 'docs', stripped);
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'index.html');
  // New URL is the docPath itself (absolute path the browser navigates to)
  fs.writeFileSync(outFile, redirectHtml(docPath));
  written++;
}

console.log(`Generated ${written} legacy redirect files in public/docs/`);
