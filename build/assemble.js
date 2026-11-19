// Inlines score.js into the page template.
//   site/index.html  -> the claude.ai artifact (the platform adds the document skeleton)
//   dist/            -> a standalone website for any static host (index.html + data/)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const site = path.join(root, 'site'), dist = path.join(root, 'dist');
const page = fs.readFileSync(path.join(site, 'page.html'), 'utf8');
const score = fs.readFileSync(path.join(__dirname, 'score.js'), 'utf8');
if (!page.includes('<!--SCORE-->')) throw new Error('placeholder missing');
const body = page.replace('<!--SCORE-->', () => '<script>\n' + score + '</script>');
fs.writeFileSync(path.join(site, 'index.html'), body);
console.log('wrote site/index.html', fs.statSync(path.join(site, 'index.html')).size, 'bytes');

// standalone: move title, meta, font links and styles into a real <head>
const split = body.indexOf('<div class="wrap">');
if (split < 0) throw new Error('layout marker missing');
const head = body.slice(0, split).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Score any Munich address by what's within walking distance and compare flats with other people.">
<style>:root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); } body { margin: 0; } img { max-width: 100%; }</style>
${head}</head>
<body>
${body.slice(split)}
</body>
</html>
`;
fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), doc);
for (const f of fs.readdirSync(path.join(site, 'data'))) fs.copyFileSync(path.join(site, 'data', f), path.join(dist, 'data', f));
console.log('wrote dist/ with', fs.readdirSync(path.join(dist, 'data')).join(', '));
