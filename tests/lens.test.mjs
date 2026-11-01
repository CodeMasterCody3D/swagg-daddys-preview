import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LensReadError, lensTransport, lensVinResult, readGoogleVinPhoto } from '../server/lens.mjs';
import { sendGoogleVinPhoto } from '../vin-lens.js';
import { createApi } from '../server/api.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword } from '../server/auth.mjs';

const vin='1HGCM82633A004352';
const endpoint='https://lensfrontend-pa.googleapis.com/v1/crupload';
const image=await readFile(new URL('./fixtures/vin-synthetic.png',import.meta.url));
const require=createRequire(import.meta.url);
const { LensOverlayServerResponse, LensOverlayObjectsResponse }=require('chrome-lens-ocr/src/utils/proto_generated/lens_overlay_server_pb.cjs');
const { Text, TextLayout }=require('chrome-lens-ocr/src/utils/proto_generated/lens_overlay_text_pb.cjs');

function protocolReply(value) {
  const word=new TextLayout.Word();word.setPlainText(value);
  const line=new TextLayout.Line();line.addWords(word);
  const paragraph=new TextLayout.Paragraph();paragraph.addLines(line);
  const layout=new TextLayout();layout.addParagraphs(paragraph);
  const text=new Text();text.setTextLayout(layout);
  const objects=new LensOverlayObjectsResponse();objects.setText(text);
  const response=new LensOverlayServerResponse();response.setObjectsResponse(objects);
  return response.serializeBinary();
}

test('real Lens library serializes a fixture image and decodes a mocked protocol response without network access',async()=>{
  let calls=0;
  const result=await readGoogleVinPhoto(image,{fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,endpoint);assert.equal(init.redirect,'manual');
    assert.equal(init.headers.get('user-agent'),'SwaggDaddys-VIN-Reader/preview');
    assert.equal(init.headers.get('cookie'),null);assert.ok(init.signal);
    assert.ok(init.body.byteLength>image.byteLength);
    return new Response(protocolReply(vin),{headers:{'content-type':'application/x-protobuf'}});
  }});
  assert.equal(calls,1);assert.deepEqual(result.candidates,[{vin,corrected:false,method:'google-lens'}]);
});

test('verification, rate limits and unexpected HTML stop after one upstream request',async()=>{
  for(const [status,body,code] of [[200,'Our systems detected unusual traffic. CAPTCHA required.','verification'],[429,'busy','busy'],[200,'unexpected HTML','unavailable']]) {
    let calls=0;const transport=lensTransport(async()=>{calls++;return new Response(body,{status,headers:{'content-type':'text/html'}});});
    await assert.rejects(transport(endpoint),error=>error instanceof LensReadError&&error.code===code);
    await assert.rejects(transport(endpoint));assert.equal(calls,1);
  }
});

test('transport rejects arbitrary destinations and oversized streamed responses',async()=>{
  let calls=0;const transport=lensTransport(async()=>{calls++;return new Response('unused');});
  await assert.rejects(transport('https://example.com/photo'));assert.equal(calls,0);
  const large=lensTransport(async()=>new Response(new Uint8Array(2*1024*1024+1),{headers:{'content-type':'application/x-protobuf'}}));
  await assert.rejects(large(endpoint));
});

test('recognition keeps exact alternatives and never corrects forbidden VIN letters',()=>{
  const second='5YJ3E1EA7KF317000';
  const result=lensVinResult({segments:[{text:vin},{text:vin},{text:second},{text:'1HGCM82633AOO4352'},{text:'customer@example.com'}]});
  assert.deepEqual(result.candidates.map(item=>item.vin),[vin,second]);
  assert.equal(result.rawText,vin+'\n'+second);
  assert.deepEqual(lensVinResult({segments:[{text:'UNREADABLE'}]}).candidates,[]);
});

test('malformed images are rejected before any external request',async()=>{
  let calls=0;
  await assert.rejects(readGoogleVinPhoto(Buffer.from('not an image'),{fetchImpl:async()=>{calls++;}}));
  assert.equal(calls,0);
});

test('browser request sends only the photo and explicit Google choice and validates the response',async()=>{
  const blob=new Blob([image],{type:'image/png'});
  const result=await sendGoogleVinPhoto(blob,{api:'https://swaggdaddys.com/api',fetchImpl:async(url,init)=>{
    assert.equal(url,'https://swaggdaddys.com/api/vin/photo');assert.equal(init.credentials,'omit');
    assert.deepEqual([...init.body.keys()],['google_consent','photo']);assert.equal(init.body.get('google_consent'),'yes');
    assert.equal(init.body.get('photo').size,image.byteLength);
    return Response.json({candidates:[{vin,corrected:false,method:'google-lens'}]});
  }});
  assert.equal(result.candidates[0].vin,vin);
  await assert.rejects(sendGoogleVinPhoto(blob,{fetchImpl:async()=>Response.json({candidates:[{vin:'partial'}]})}));
  await assert.rejects(sendGoogleVinPhoto(blob,{fetchImpl:async()=>Response.json({error:'Google requires verification.'},{status:503})}),/verification/);
});

// Exercise the client, multipart API, image decoder and actual Lens protocol
// implementation together. Only the external Google response is simulated.
for (const verification of [false,true]) {
  test(`complete photo request ${verification?'reports verification without a candidate':'returns the decoded Lens VIN to the client'}`,async()=>{
    const store=localStore();let calls=0;
    try {
      const env={OWNER_PASSWORD_HASH:await hashPassword('fixture-only-password'),GOOGLE_LENS_ENABLED:'true'};
      const api=createApi({store,env,lensReader:bytes=>readGoogleVinPhoto(bytes,{fetchImpl:async()=>{
        calls++;
        return verification
          ? new Response('Unusual traffic. Verify you are human.',{headers:{'content-type':'text/html'}})
          : new Response(protocolReply(vin),{headers:{'content-type':'application/x-protobuf'}});
      }})});
      const run=()=>sendGoogleVinPhoto(new Blob([image],{type:'image/png'}),{
        api:'https://swaggdaddys.com/api',
        fetchImpl:(url,init)=>api(new Request(url,{...init,headers:{Origin:'https://swaggdaddys.com'}}),{ip:'integration-fixture'})
      });
      if(verification)await assert.rejects(run(),/requires verification/);
      else assert.equal((await run()).candidates[0].vin,vin);
      assert.equal(calls,1);
      assert.deepEqual(await store.keys('media/'),[]);
      assert.deepEqual(await store.keys('requests/'),[]);
    } finally {store.close();}
  });
}
