import test from 'node:test';
import assert from 'node:assert/strict';
import { repairVin, consensusVin, resolveVin, createVinVerifier } from '../vin-repair.js';
import { vinCheckDigit } from '../vin-core.js';

const real = '1HGCM82633A004352';
const onlyReal = async vin => vin === real;   // stands in for NHTSA

test('lookalike repairs always pass the check digit and follow VIN position rules', () => {
  for (const misread of ['1HG0M82633A004352', '1HGCMB2633A004352', '1HGCM82633AOO4352']) {
    const fixes = repairVin(misread);
    assert.ok(fixes.some(f => f.vin === real), misread);
    for (const { vin } of fixes) {
      assert.equal(vinCheckDigit(vin).status, 'match');
      assert.match(vin, /^[A-HJ-NPR-Z0-9]{8}[0-9X][A-HJ-NPR-Y1-9][A-HJ-NPR-Z0-9]{3}[0-9]{4}$/);
    }
  }
  assert.deepEqual(repairVin('TOO-SHORT'), []);
});

test('several imperfect readings combine character by character', () => {
  assert.equal(consensusVin(['1HG0M82633A004352', '1HGCM8Z633A004352', '1HGCM82633A0043S2']), real);
  assert.equal(consensusVin(['1HGCM82633A004352']), null);
});

test('a fix is only used when the verifier confirms it; otherwise nothing is guessed', async () => {
  assert.deepEqual(await resolveVin(['1HG0M82633A004352'], onlyReal), { vin:real, repaired:true });
  assert.deepEqual(await resolveVin([real], onlyReal), { vin:real, repaired:false });
  assert.equal(await resolveVin(['1HG0M82633A004352'], async () => false), null);
  assert.equal(await resolveVin(['ZZZZZZZZZZZZZZZZZ'], onlyReal), null);
});

test('NHTSA confirmation needs a clean, complete decode and is asked once per VIN', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return Response.json({ Results:[{ ErrorCode:url.includes(real) ? '0' : '8', ModelYear:'2003', Make:'HONDA', Model:'Accord' }] }); };
  const verify = createVinVerifier({ fetcher });
  assert.equal(await verify(real), true); assert.equal(await verify(real), true);
  assert.equal(calls.length, 1);
  const otherValid = repairVin('1HG0M82633A004352').find(f => f.vin !== real).vin;
  assert.equal(await verify(otherValid), false, 'decoder errors mean not a real vehicle');
  assert.equal(await verify('1HGCM82633A004353'), false, 'a bad check digit never reaches NHTSA');
  assert.equal(calls.length, 2);
});
