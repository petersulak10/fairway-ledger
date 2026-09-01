const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = blocks.join('\n');
fs.writeFileSync('.bundle.js', js);
try {
  new Function(js);
  console.log('JS OK —', blocks.length, 'blocks,', js.split('\n').length, 'lines');
} catch (e) {
  console.log('JS ERROR:', e.message);
  process.exit(1);
}
