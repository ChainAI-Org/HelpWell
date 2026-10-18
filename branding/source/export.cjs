const fs = require('fs');
const path = require('path');
const sharp = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/sharp');
const root=path.resolve(__dirname,'..');
(async()=>{
  const jobs=[];
  for(const file of fs.readdirSync(path.join(root,'svg'))){
    const base=file.slice(0,-4);
    const widths=base.includes('wordmark')?[256,512,1024,2048,4096]:[16,24,32,48,64,128,256,512,1024];
    for(const width of widths){
      jobs.push({file,width,base});
    }
  }
  for (const {file,width,base} of jobs){
    await sharp(path.join(root,'svg',file),{density:600}).resize({width}).png().toFile(path.join(root,'png',`${base}-${width}.png`));
  }
  await sharp(path.join(root,'preview.svg'),{density:144}).resize({width:1600}).png().toFile(path.join(root,'HelpWell-preview.png'));
  for(const n of [16,32,48,180,192,512]){
    const source=n===16?'helpwell-mark-purple.svg':'helpwell-widget-purple.svg';
    await sharp(path.join(root,'svg',source),{density:600}).resize(n,n).png().toFile(path.join(root,'favicon',`icon-${n}.png`));
  }
  fs.copyFileSync(path.join(root,'svg','helpwell-widget-purple.svg'),path.join(root,'favicon','favicon.svg'));
  console.log(`Exported ${jobs.length} transparent PNGs, 6 favicon PNGs and preview`);
})();
