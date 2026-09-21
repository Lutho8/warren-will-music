import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyBooking, BOOKING_EMAIL } from '../supabase/functions/booking-inquiry/notification.ts';

const inquiry = {name:'Test Booker',email:'booker@example.com',eventType:'Club night',eventDate:'TBC',cityVenue:'Munich',message:'A & B <details>\nSecond line'};
const config = {apiKey:'test-key',from:'Warren Will <verified@example.com>'};

test('Sends to the fixed booking inbox with visitor Reply-To and all details', async () => {
  let request;
  const result = await notifyBooking({...inquiry,to:'attacker@example.com'},config,'inquiry-123',async (url,options) => {
    request = {url,...options}; return Response.json({id:'provider-message-123'});
  });
  assert.equal(result.status,'accepted');
  assert.equal(request.url,'https://api.resend.com/emails');
  const body = JSON.parse(request.body);
  assert.deepEqual(body.to,[BOOKING_EMAIL]);
  assert.equal(body.reply_to,inquiry.email);
  assert.equal(body.from,config.from);
  for(const value of Object.values(inquiry)) assert.ok(body.text.includes(value));
  assert.equal(body.html,undefined);
  assert.equal(request.headers['Idempotency-Key'],'booking-inquiry-123');
});

test('Missing sender or API key never claims an email was sent', async () => {
  for(const missing of [{...config,apiKey:''},{...config,from:''}]){
    const result = await notifyBooking(inquiry,missing,'id',() => {throw new Error('Must not send');});
    assert.equal(result.status,'unavailable');
    assert.equal(result.reason,'email_not_configured');
  }
});

test('Provider rejection, malformed success and network failure are reported', async () => {
  for(const send of [async () => Response.json({message:'rejected'},{status:403}),async () => Response.json({}),async () => {throw new Error('timeout');}]){
    const result = await notifyBooking(inquiry,config,'id',send);
    assert.equal(result.status,'failed');
  }
});

test('User supplied line breaks cannot add email headers', async () => {
  let body;
  await notifyBooking({...inquiry,eventType:'Club\r\nBcc: unwanted@example.com'},config,'id',async (_,options) => {
    body = JSON.parse(options.body); return Response.json({id:'ok'});
  });
  assert.ok(!/[\r\n]/.test(body.subject));
  assert.deepEqual(body.to,[BOOKING_EMAIL]);
});
