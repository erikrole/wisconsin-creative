const fs=require('node:fs');
const {createRequire}=require('node:module');
const req=createRequire('/Users/role/.codex/worktrees/qr-print-audit/wisconsin-creative/package.json');
const sharp=req('sharp');
const qr=req('qrcode');
const jsQR=require('/Users/role/.codex/worktrees/qr-print-audit/wisconsin-creative/public/qrcode/vendor/jsQR.js');
const root=__dirname;
(async()=>{
  const outlines=JSON.parse(fs.readFileSync(root+'/gotham-outlines.json','utf8'));
  if(outlines.postScriptName!=='GothamXNarrow-Bold')throw new Error('Exact Gotham face was not verified');
  const paths=outlines.lines.map((line,i)=>line.glyphs.map(g=>`<path transform="translate(${50-line.advance/2+g.x},${20+i*24})" d="${g.path}"/>`).join('')).join('');
  const textPng=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="90"><g fill="white">${paths}</g></svg>`)).trim().png().toBuffer();
  const {data:text,info}=await sharp(textPng).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.height>76)throw new Error('Text exceeds printable height: '+info.height);
  const q=qr.create('c62a82d7',{version:1,errorCorrectionLevel:'M'});
  if(q.modules.size!==21)throw new Error('Unexpected QR size');
  const width=194,height=76,cell=3,gap=18;
  const left=Math.floor((width-info.width-gap-63)/2),textY=Math.floor((height-info.height)/2),qrX=left+info.width+gap,qrY=Math.floor((height-63)/2);
  const ink=new Uint8Array(width*height);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(text[(y*info.width+x)*4+3]>=128)ink[(y+textY)*width+x+left]=1;
  for(let y=0;y<63;y++)for(let x=0;x<63;x++)if(q.modules.get(Math.floor(y/cell),Math.floor(x/cell)))ink[(qrY+y)*width+qrX+x]=1;
  const raw=Buffer.alloc(width*height*4);
  for(let i=0;i<ink.length;i++){raw[i*4]=raw[i*4+1]=raw[i*4+2]=ink[i]*255;raw[i*4+3]=255;}
  const decoded=jsQR(new Uint8ClampedArray(raw),width,height,{inversionAttempts:'attemptBoth'});
  if(decoded?.data!=='c62a82d7')throw new Error('Raster QR decode failed');
  const png=await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
  fs.writeFileSync(root+'/label-proof.png',png);
  const rasters=[];
  // 128-pin head, centered 76-dot printable area. Top-to-bottom image pixels
  // become bottom-to-top printer pins; byte 15 contains pins 0..7.
  for(let x=0;x<width;x++){
    const bytes=Buffer.alloc(16);
    for(let y=0;y<height;y++)if(ink[y*width+x]){const pin=26+height-1-y;bytes[15-Math.floor(pin/8)]|=1<<(pin%8);}
    rasters.push(bytes.toString('base64'));
  }
  // Independently reconstruct every source pixel from the raster payload.
  for(let x=0;x<width;x++)for(let y=0;y<height;y++){const bytes=Buffer.from(rasters[x],'base64'),pin=26+height-1-y; if(Number(Boolean(bytes[15-Math.floor(pin/8)]&(1<<(pin%8))))!==ink[y*width+x])throw new Error('Raster round trip failed');}
  const job={id:'fb-fx3-1-usb-proof-4-gotham-21px',tag:'FB FX3 1',qr:'c62a82d7',vendorId:0x04f9,productId:0x20e1,tapeWidthMm:12,dpi:180,width,height,cellDots:3,qrVersion:1,qrErrorCorrection:'M',qrCoreDots:63,textFont:'Gotham XNarrow Bold',fontSizePx:outlines.sizePx,verifiedPostScriptName:outlines.postScriptName,textFrame:{x:left,y:textY,width:info.width,height:info.height},qrFrame:{x:qrX,y:qrY,width:63,height:63},inkOuterMargins:{left,right:width-qrX-63},rasters};
  fs.writeFileSync(root+'/job.json',JSON.stringify(job));
  fs.writeFileSync(root+'/job-verification.json',JSON.stringify({...job,rasters:undefined,decodedQr:decoded.data,rasterRoundTrip:true},null,2));
  console.log(fs.readFileSync(root+'/job-verification.json','utf8'));
})().catch(error=>{console.error(error.message);process.exit(1);});
