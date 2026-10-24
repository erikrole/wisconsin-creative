// Protocol framing generated/verified against installed D610 SDK; pure, no USB I/O.
function packBits(line) {
  const encoded=[];let i=0;
  while(i<line.length) {
    let end=i+1;while(end<line.length&&line[end]===line[i]&&end-i<128)end++;
    if(end-i>=2) {encoded.push(257-(end-i),line[i]);i=end;continue;}
    const begin=i++;
    while(i<line.length&&i-begin<128) {
      if(i+1<line.length&&line[i]===line[i+1])break;
      i++;
    }
    encoded.push(i-begin-1,...line.slice(begin,i));
  }
  return encoded;
}
export function sdkPage(columns,index,total) {
  if(!Number.isInteger(total)||total<1||total>500||!Number.isInteger(index)||index<0||index>=total||columns.length<1||columns.length>536||columns.some(c=>c.length!==16))throw Error('Invalid D610 page.');
  const rows=columns.length,mode=total===1||index===total-1?2:index===0?0:1,b=[];
  if(index===0)b.push(...new Uint8Array(200),27,105,97,1,27,64,27,105,33,0,27,105,112,1);
  b.push(27,105,122,0xc4,1,12,0,rows&255,(rows>>8)&255,0,0,mode,0,27,105,75,8,27,105,77,64,27,105,65,1,27,105,107,99,total&255,(total>>8)&255,27,105,100,14,0,77,2);
  if(index===0)for(let check=0;check<Math.min(total,3);check++)b.push(27,105,76,0,1,1,27,105,67,1,255,255,255);
  for(const line of columns){const packed=packBits(line);if(packed.length<=16)b.push(71,packed.length,0,...packed);else b.push(71,17,0,15,...line);}
  b.push(index===total-1?26:12);
  return Uint8Array.from(b);
}
