const fs=require('fs');const path=require('path');const {chromium}=require('playwright');
const FONTS='https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=Barlow:wght@500;600;700&display=swap';
const THEMES={
  comiru:{src:'comisapo-site-flow-a4.src.html',out:'コミサポ_サイト制作工数整理_叩き台.pdf',html:'comisapo-site-flow-a4.html'},
  kcm:{src:'comisapo-site-flow-a4-kcm.src.html',out:'コミサポ_サイト制作工数整理_叩き台_KCM形式.pdf',html:'comisapo-site-flow-a4-kcm.html'}
};
(async()=>{
  const theme=process.argv[2]||'comiru';const T=THEMES[theme];
  const repo='/home/user/takashima-yuto-site/formats/comiru';
  const scratch='/tmp/claude-0/-home-user-takashima-yuto-site/8319d126-87f7-50b6-aa7f-8e062e29d587/scratchpad';
  const src=fs.readFileSync(path.join(repo,T.src),'utf8');
  fs.writeFileSync(path.join(repo,T.html),src.replace('/*FONTS*/',FONTS));
  const render=path.join(scratch,'render-'+theme+'.html');
  fs.writeFileSync(render,src.replace('/*FONTS*/','fonts/fonts.local.css'));
  const b=await chromium.launch();const p=await b.newPage();
  await p.goto('file://'+render,{waitUntil:'load'});
  await p.evaluate(()=>document.fonts.ready);
  const over=await p.evaluate(()=>[...document.querySelectorAll('.pg')].map((e,i)=>{const b=e.querySelector('.body');const h=b?b.scrollHeight-b.clientHeight:0;return {page:i+1,overflow:h, sh:e.scrollHeight, ch:e.clientHeight}}));
  console.log(theme,'overflow',JSON.stringify(over.filter(o=>o.overflow>0||o.sh>o.ch)));
  const out=path.join(repo,T.out);
  await p.pdf({path:out,format:'A4',landscape:true,printBackground:true,preferCSSPageSize:true,margin:{top:0,right:0,bottom:0,left:0}});
  await b.close();console.log('pdf',T.out,fs.statSync(out).size);
})();
