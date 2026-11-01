// Explicit cubic resampling keeps the fine-barcode retry independent of the
// browser's optional canvas imageSmoothingQuality implementation.
function cubic(value) {
  const x=Math.abs(value);
  return x<=1?(1.5*x-2.5)*x*x+1:x<2?((-0.5*x+2.5)*x-4)*x+2:0;
}

export function scaleBarcodePixels(source,width,height) {
  const sw=source.width,sh=source.height;
  if(![sw,sh,width,height].every(n=>Number.isInteger(n)&&n>0)||source.data.length!==sw*sh*4||width*height>5000000)throw new Error('Invalid barcode image size.');
  if(sw===width&&sh===height)return {data:new Uint8ClampedArray(source.data),width,height};
  const output=new Uint8ClampedArray(width*height*4);
  const indexes=new Int32Array(width*4),weights=new Float32Array(width*4);
  for(let x=0;x<width;x++) {
    const position=(x+0.5)*sw/width-0.5,base=Math.floor(position);
    for(let k=0;k<4;k++) {
      indexes[x*4+k]=Math.max(0,Math.min(sw-1,base+k-1))*4;
      weights[x*4+k]=cubic(position-(base+k-1));
    }
  }
  // Cache only the four source rows needed for the current output row.
  const rows=new Map();
  function row(y) {
    if(rows.has(y))return rows.get(y);
    const result=new Float32Array(width*4),offset=y*sw*4;
    for(let x=0;x<width;x++)for(let c=0;c<4;c++) {
      let value=0;
      for(let k=0;k<4;k++)value+=source.data[offset+indexes[x*4+k]+c]*weights[x*4+k];
      result[x*4+c]=value;
    }
    rows.set(y,result);return result;
  }
  for(let y=0;y<height;y++) {
    const position=(y+0.5)*sh/height-0.5,base=Math.floor(position),ys=[],wy=[],samples=[];
    for(let k=0;k<4;k++) {ys[k]=Math.max(0,Math.min(sh-1,base+k-1));wy[k]=cubic(position-(base+k-1));samples[k]=row(ys[k]);}
    for(let x=0;x<width*4;x++)output[y*width*4+x]=samples[0][x]*wy[0]+samples[1][x]*wy[1]+samples[2][x]*wy[2]+samples[3][x]*wy[3];
    for(const key of rows.keys())if(!ys.includes(key))rows.delete(key);
  }
  return {data:output,width,height};
}
