const fs=require('fs');const path=require('path');const {chromium}=require('playwright');
(async()=>{
  const repo='/home/user/takashima-yuto-site/formats/comiru';
  const scratch='/tmp/claude-0/-home-user-takashima-yuto-site/8319d126-87f7-50b6-aa7f-8e062e29d587/scratchpad';
  const src=fs.readFileSync(path.join(repo,'comisapo-site-flow-a4.src.html'),'utf8');
  // repo copy: Google Fonts link; render copy: local fonts
  fs.writeFileSync(path.join(repo,'comisapo-site-flow-a4.html'),src.replace('/*FONTS*/','https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=Barlow:wght@500;600;700&display=swap'));
  const render=path.join(scratch,'render.html');
  fs.writeFileSync(render,src.replace('/*FONTS*/','fonts/fonts.local.css'));
  const b=await chromium.launch();const p=await b.newPage();
  await p.goto('file://'+render,{waitUntil:'load'});
  await p.evaluate(()=>document.fonts.ready);
  const fontsOk=await p.evaluate(()=>[...document.fonts].filter(f=>f.status==='loaded').length);
  const over=await p.evaluate(()=>[...document.querySelectorAll('.pg')].map((e,i)=>{const b=e.querySelector('.body');const h=b?b.scrollHeight-b.clientHeight:0;return {page:i+1,overflow:h, sh:e.scrollHeight, ch:e.clientHeight}}));
  console.log('fonts loaded',fontsOk);console.log(JSON.stringify(over.filter(o=>o.overflow>0||o.sh>o.ch)));
  const out=path.join(repo,'コミサポ_サイト制作工数整理_叩き台.pdf');
  await p.pdf({path:out,format:'A4',landscape:true,printBackground:true,preferCSSPageSize:true,margin:{top:0,right:0,bottom:0,left:0}});
  await b.close();console.log('pdf',fs.statSync(out).size);
})();
