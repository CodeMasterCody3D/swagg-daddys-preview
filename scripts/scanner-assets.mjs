import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';

// Pinned npm releases of the upstream GitHub projects, served by this website.
export async function scannerAssets(destination='public/vendor') {
  const ocr=destination+'/tesseract', barcode=destination+'/zxing';
  await mkdir(ocr+'/core',{recursive:true}); await mkdir(ocr+'/lang',{recursive:true}); await mkdir(barcode,{recursive:true});
  for(const name of ['tesseract.min.js','worker.min.js']) await cp('node_modules/tesseract.js/dist/'+name,ocr+'/'+name);
  for(const name of await readdir('node_modules/tesseract.js-core')) if(name.endsWith('.wasm.js')) await cp('node_modules/tesseract.js-core/'+name,ocr+'/core/'+name);
  await cp('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',ocr+'/lang/eng.traineddata.gz');
  await cp('node_modules/zxing-wasm/dist/iife/reader/index.js',barcode+'/reader.js');
  await cp('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',barcode+'/zxing_reader.wasm');
  await cp('node_modules/tesseract.js/LICENSE.md',ocr+'/LICENSE.txt');
  await cp('node_modules/tesseract.js-core/LICENSE',ocr+'/core/LICENSE.txt');
  for(const name of ['tesseract.min.js','worker.min.js']) await cp('node_modules/tesseract.js/dist/'+name+'.LICENSE.txt',ocr+'/'+name+'.LICENSE.txt');
  await cp('node_modules/zxing-wasm/LICENSE',barcode+'/LICENSE.txt');
  await cp('node_modules/tesseract.js/LICENSE.md',barcode+'/APACHE-2.0.txt');
  await writeFile(destination+'/NOTICE.txt', 'Open-source scanner dependencies: Tesseract.js 6.0.1 (Apache-2.0), tesseract.js-core 6.1.2 (Apache-2.0), @tesseract.js-data/eng 1.0.0 (package MIT), and zxing-wasm 3.1.6 (MIT wrapper; ZXing-C++ and ZXingWasm.cpp Apache-2.0).\nSources: https://github.com/naptha/tesseract.js https://github.com/naptha/tessdata https://github.com/Sec-ant/zxing-wasm https://github.com/zxing-cpp/zxing-cpp\n');
}
