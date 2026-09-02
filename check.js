/**
 * Checks index.html's script blocks two ways:
 *   1. syntax — does it parse at all;
 *   2. references — is anything called that is never defined anywhere.
 *
 * The second check exists because a whole feature was once deleted while
 * replacing a neighbouring block: the file still parsed, so `node --check`
 * was happy, and the page only broke when a user typed in a search box.
 */
const fs = require('fs');

const src = fs.readFileSync('index.html', 'utf8');
const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = blocks.join('\n');

try { new Function(js); }
catch (e) { console.log('JS ERROR:', e.message); process.exit(1); }

/* Strip strings, template literals, comments and regexes before scanning. */
const code = js
  .replace(/`(?:[^`\\]|\\[\s\S])*`/g, '``')
  .replace(/'(?:[^'\\\n]|\\[\s\S])*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\[\s\S])*"/g, '""')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const declared = new Set();
const declare = (re, group) => {
  for (const m of code.matchAll(re)) declared.add(m[group || 1]);
};
declare(/\bfunction\s+([A-Za-z_$][\w$]*)/g);
declare(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
declare(/\b(?:const|let|var)\s*\{([^}]*)\}/g);          // destructured
declare(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g);
declare(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
/* destructured names split out */
for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
  m[1].split(',').forEach(x => {
    const name = x.split(':').pop().split('=')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  });
}
/* function parameters */
for (const m of code.matchAll(/(?:function\s*[A-Za-z_$\w]*\s*|=>\s*|\()\(([^)]*)\)\s*(?:=>|\{)/g)) {
  m[1].split(',').forEach(x => {
    const name = x.split('=')[0].replace(/\.\.\./, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  });
}
for (const m of code.matchAll(/\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)) declared.add(m[1]);

const BUILTIN = new Set(('window document location history console setTimeout clearTimeout setInterval ' +
  'clearInterval fetch Promise JSON Math Date Object Array String Number Boolean Set Map RegExp Error ' +
  'parseInt parseFloat isNaN encodeURIComponent decodeURIComponent btoa atob crypto navigator localStorage ' +
  'Intl Blob URL FileReader KeyboardEvent Event CustomEvent alert confirm prompt requestAnimationFrame ' +
  'performance Uint8Array TextEncoder TextDecoder AbortController structuredClone globalThis undefined ' +
  'NaN Infinity arguments this super new typeof void delete in instanceof of let const var function ' +
  'return if else for while do switch case break continue try catch finally throw class extends export ' +
  'import default await async yield true false null').split(/\s+/));

const missing = new Map();
for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
  const name = m[1];
  if (declared.has(name) || BUILTIN.has(name)) continue;
  if (/^[A-Z]/.test(name)) continue;                     // constructors / DOM ctors
  const before = code.slice(Math.max(0, m.index - 1), m.index);
  if (before === '.') continue;                          // a method call
  missing.set(name, (missing.get(name) || 0) + 1);
}

if (missing.size) {
  console.log('UNDEFINED FUNCTIONS CALLED:');
  for (const [name, count] of missing) console.log('  ' + name + '  (' + count + ' call sites)');
  process.exit(1);
}
console.log('JS OK —', blocks.length, 'blocks,', js.split('\n').length, 'lines, no undefined calls');
