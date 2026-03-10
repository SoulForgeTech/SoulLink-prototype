const fs = require('fs');
const html = fs.readFileSync('../index.html', 'utf8');

// Extract the TRANSLATIONS block
const start = html.indexOf("const TRANSLATIONS = {");
const block = html.substring(start);

// Find the en block
const enStart = block.indexOf("en: {") + 5;
const enBlock = block.substring(enStart);
let braceCount = 1;
let enEnd = 0;
for (let i = 0; i < enBlock.length; i++) {
  if (enBlock[i] === '{') braceCount++;
  if (enBlock[i] === '}') braceCount--;
  if (braceCount === 0) { enEnd = i; break; }
}
const enContent = enBlock.substring(0, enEnd);

// Find zh-CN block
const zhStart = block.indexOf("'zh-CN': {") + 10;
const zhBlock = block.substring(zhStart);
braceCount = 1;
let zhEnd = 0;
for (let i = 0; i < zhBlock.length; i++) {
  if (zhBlock[i] === '{') braceCount++;
  if (zhBlock[i] === '}') braceCount--;
  if (braceCount === 0) { zhEnd = i; break; }
}
const zhContent = zhBlock.substring(0, zhEnd);

function parseFlat(content) {
  const flat = {};
  const regex = /'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    flat[match[1]] = match[2].replace(/\\'/g, "'");
  }
  return flat;
}

function toNested(flat) {
  const nested = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split('.');
    let obj = nested;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] === 'string') obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = val;
  }
  return nested;
}

const enFlat = parseFlat(enContent);
const zhFlat = parseFlat(zhContent);

console.log('EN keys:', Object.keys(enFlat).length);
console.log('ZH keys:', Object.keys(zhFlat).length);

fs.writeFileSync('src/i18n/en.json', JSON.stringify(toNested(enFlat), null, 2));
fs.writeFileSync('src/i18n/zh-CN.json', JSON.stringify(toNested(zhFlat), null, 2));
console.log('Done! Files written to src/i18n/');
