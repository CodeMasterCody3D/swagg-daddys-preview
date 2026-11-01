import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { prepareZXingModule,readBarcodes } from 'zxing-wasm/reader';
import { prepareZXingModule as prepareWriter,writeBarcode } from 'zxing-wasm/writer';
import { scaleBarcodePixels } from '../vin-barcode-scale.js';
import { scannedVins } from '../vin-core.js';

test('cubic resizing preserves constant colors and never modifies source pixels',()=>{
  const data=new Uint8ClampedArray([31,127,219,255,31,127,219,255,31,127,219,255,31,127,219,255]);
  const original=data.slice(),scaled=scaleBarcodePixels({data,width:2,height:2},11,9);
  for(let i=0;i<scaled.data.length;i+=4)assert.deepEqual([...scaled.data.slice(i,i+4)],[31,127,219,255]);
  assert.deepEqual(data,original);
  assert.throws(()=>scaleBarcodePixels({data,width:2,height:2},0,9));
  assert.throws(()=>scaleBarcodePixels({data,width:2,height:2},3000,3000));
});

test('cubic resizing preserves orientation and clamps image edges',()=>{
  const data=new Uint8ClampedArray([0,0,0,255,255,255,255,255]);
  const scaled=scaleBarcodePixels({data,width:2,height:1},9,3);
  assert.equal(scaled.data[0],0);assert.equal(scaled.data[(9-1)*4],255);
  assert.ok(scaled.data[4*4]>=127&&scaled.data[4*4]<=128);
  // Floating interpolation at an exact half-level can round either way;
  // otherwise identical rows must agree within one 8-bit quantization step.
  for(let y=0;y<3;y++)for(let x=0;x<9*4;x++)assert.ok(Math.abs(scaled.data[y*9*4+x]-scaled.data[x])<=1);
});

test('a generated low-resolution JPEG VIN barcode remains decodable after portable cubic scaling',async()=>{
  prepareZXingModule({overrides:{wasmBinary:await readFile(new URL('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',import.meta.url))}});
  prepareWriter({overrides:{wasmBinary:await readFile(new URL('../node_modules/zxing-wasm/dist/writer/zxing_writer.wasm',import.meta.url))}});
  const vin='1HGCM82633A004352';
  const written=await writeBarcode('I'+vin,{format:'Code39',scale:1});
  assert.equal(written.error,'');assert.ok(written.image);
  const jpeg=await sharp(Buffer.from(await written.image.arrayBuffer())).resize(440,55,{fit:'fill'}).jpeg({quality:65}).toBuffer();
  const {data,info}=await sharp(jpeg).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const scaled=scaleBarcodePixels({data,width:info.width,height:info.height},1760,220);
  const decoded=await readBarcodes(scaled,{formats:['Code39'],tryHarder:true,tryRotate:true,tryInvert:true});
  assert.ok(decoded.flatMap(item=>scannedVins(item.text,{barcode:true})).some(item=>item.vin===vin));
});
