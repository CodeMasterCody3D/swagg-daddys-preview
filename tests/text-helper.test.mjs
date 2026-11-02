import test from 'node:test';
import assert from 'node:assert/strict';
import { smsLink, textMessage, SHOP_NUMBER } from '../text-helper.js';

test('the text lists only the answers given, with a map link for shared GPS and the photo reference',()=>{
  const body=textMessage({name:' Jane  Doe ',vehicle:'2015 Ford F-150',vin:'1FTFW1EF5FFA00000',location:'Hoover',latitude:'33.405',longitude:'-86.811',urgency:'Urgent — vehicle is stranded',issue:'Vehicle won’t start',details:'Clicks,\n no crank',photos:2,reference:'1793458800000-abc'});
  assert.equal(body,[
    'Hi Swagg Daddys! I need a mobile mechanic.',
    'Name: Jane Doe','Vehicle: 2015 Ford F-150','VIN: 1FTFW1EF5FFA00000',
    'Location: Hoover — https://maps.google.com/?q=33.405000,-86.811000',
    'How soon: Urgent — vehicle is stranded','Problem: Vehicle won’t start','Details: Clicks, no crank',
    'Photos: 2 sent with my online request.'
  ].join('\n'));
  assert.equal(textMessage({}),'Hi Swagg Daddys! I need a mobile mechanic.');
  assert.equal(textMessage({latitude:'',longitude:'',location:'Bessemer'}),'Hi Swagg Daddys! I need a mobile mechanic.\nLocation: Bessemer');
  assert.match(textMessage({reference:'r1'}),/I also sent this request online\.$/);
});

test('the sms link opens a text to the shop with the message, in the form each phone expects',()=>{
  const body='Hi & hello\nLine two?';
  assert.equal(smsLink(body,{ios:false}),'sms:'+SHOP_NUMBER+'?body='+encodeURIComponent(body));
  assert.equal(smsLink(body,{ios:true}),'sms:'+SHOP_NUMBER+'&body='+encodeURIComponent(body));
  assert.ok(!smsLink(body,{ios:false}).includes('\n'));
});
