import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVinReply } from './reply.mjs';

test('recognition reply yields one candidate without silently correcting characters', () => {
  assert.deepEqual(parseVinReply('  1hgcm82633a004352\n'), {status:'candidate',vin:'1HGCM82633A004352'});
  for (const reply of ['1HGCM82633AOO4352','1HGCM82633AI04352','1HGCM82633AQ04352']) {
    assert.deepEqual(parseVinReply(reply), {status:'invalid'});
  }
});

test('uncertainty yields no VIN', () => {
  assert.deepEqual(parseVinReply('UNREADABLE'), {status:'unreadable'});
  assert.deepEqual(parseVinReply(' unreadable '), {status:'unreadable'});
});

test('partial, ambiguous and unexpected responses never select a VIN', () => {
  for (const reply of [
    '1HGCM82633A00435', '1HGCM82633A0043520',
    'The VIN is 1HGCM82633A004352',
    '1HGCM82633A004352\n5YJ3E1EA7KF317000',
    'UNREADABLE\n1HGCM82633A004352',
    '', null, {vin:'1HGCM82633A004352'},
  ]) assert.deepEqual(parseVinReply(reply), {status:'invalid'});
});
