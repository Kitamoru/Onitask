const fs = require('fs');  
const bs = fs.readFileSync('src/components/ui/BottomSheet.tsx','utf8');  
const bsNew = bs.replace('bg-black/60','bg-black/80').replace('bg-[var(--color-bg-surface,#1A1A1A)]','bg-surface').replace(/style={{[}]+}}/g,'');  
fs.writeFileSync('src/components/ui/BottomSheet.tsx',bsNew,'utf8');  
console.log('BottomSheet done');  
