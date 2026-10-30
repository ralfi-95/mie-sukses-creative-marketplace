import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPaymentAttemptCancellationHandler, createPaymentConfirmationHandler, createPaymentMethodChangeHandler } from './payment.js';

const batchId='00000000-0000-4000-8000-000000000001';

function endpoint(initialPayment='awaiting_payment',orderStatus='pending',method='qris'){
 let paymentStatus=initialPayment,audits=0;
 const calls:string[]=[];
 const client={query:vi.fn(async(sql:string)=>{
  calls.push(sql);
  if(sql.startsWith('SELECT id,status FROM orders'))return {rows:[{id:'order',status:orderStatus}],rowCount:1};
  if(sql.startsWith('SELECT * FROM checkout_payments'))return {rows:[{id:'payment',status:paymentStatus,method,provider:'BCA',amount:'50000'}],rowCount:1};
  if(sql.startsWith('UPDATE checkout_payments'))paymentStatus='simulated';
  if(sql.startsWith('INSERT INTO audit_events'))audits++;
  return {rows:[],rowCount:1};
 }),release:vi.fn()};
 const db={connect:vi.fn(async()=>client)} as unknown as Pick<Pool,'connect'>;
 const app=express();
 app.use(express.json());
 app.post('/checkout/:batchId/payment/confirm',(req,res,next)=>{res.locals.user={id:'buyer'};next();},(req,res,next)=>{void createPaymentConfirmationHandler(db)(req,res).catch(next);});
 app.use((error:any,_req:unknown,res:express.Response,_next:unknown)=>res.status(error.status||500).json({error:error.message}));
 return {app,calls,get audits(){return audits;}};
}

function methodEndpoint(initialPayment='awaiting_payment',orderStatus='pending',balance='100000',orderCount=1){
 let paymentStatus=initialPayment,method='qris',attemptKey='00000000-0000-4000-8000-000000000001',audits=0,eventCount=0;
 const orderStatuses=Array.from({length:orderCount},()=>orderStatus),calls:string[]=[];
 const client={query:vi.fn(async(sql:string,values:unknown[]=[] )=>{
  calls.push(sql);
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT id,status FROM orders'))return {rows:orderStatuses.map((status,index)=>({id:`order-${index}`,status})),rowCount:orderStatuses.length};
  if(sql.startsWith('SELECT * FROM checkout_payments'))return {rows:[{id:'payment',status:paymentStatus,method,amount:'50000',idempotency_key:attemptKey}],rowCount:1};
  if(sql.startsWith('SELECT coalesce(sum(amount)'))return {rows:[{amount:balance}],rowCount:1};
  if(sql.startsWith('UPDATE checkout_payments SET idempotency_key'))attemptKey=String(values[1]);
  if(sql.startsWith('UPDATE checkout_payments SET method')){method=String(values[1]);if(method==='me_wallet')paymentStatus='simulated';}
  if(sql.startsWith("UPDATE checkout_payments SET status='simulated'"))paymentStatus='simulated';
  if(sql.startsWith("UPDATE checkout_payments SET status='cancelled'")){paymentStatus='cancelled';return {rows:[{id:'payment'}],rowCount:1};}
  if(sql.startsWith('WITH cancelled AS')){const pending=orderStatuses.filter(status=>status==='pending').length;for(let index=0;index<orderStatuses.length;index++)if(orderStatuses[index]==='pending')orderStatuses[index]='cancelled';eventCount+=pending;return {rows:[],rowCount:pending};}
  if(sql.startsWith('INSERT INTO audit_events'))audits++;
  return {rows:[],rowCount:1};
 }),release:vi.fn()};
 const db={connect:vi.fn(async()=>client)} as unknown as Pick<Pool,'connect'>;const app=express();app.use(express.json());app.post('/checkout/:batchId/payment-method',(req,res,next)=>{res.locals.user={id:'buyer'};next();},(req,res,next)=>{void createPaymentMethodChangeHandler(db)(req,res).catch(next)});app.post('/checkout/:batchId/payment/cancel',(req,res,next)=>{res.locals.user={id:'buyer'};next();},(req,res,next)=>{void createPaymentAttemptCancellationHandler(db)(req,res).catch(next)});app.post('/checkout/:batchId/payment/confirm',(req,res,next)=>{res.locals.user={id:'buyer'};next();},(req,res,next)=>{void createPaymentConfirmationHandler(db)(req,res).catch(next)});app.use((error:any,_req:unknown,res:express.Response,_next:unknown)=>res.status(error.status||500).json({error:error.message}));return {app,calls,orderStatuses,get paymentStatus(){return paymentStatus},get audits(){return audits},get eventCount(){return eventCount}};
}
describe('checkout payment simulation',()=>{
 it('requires explicit confirmation and makes retries idempotent',async()=>{
  const test=endpoint();
  const first=await request(test.app).post(`/checkout/${batchId}/payment/confirm`);
  const second=await request(test.app).post(`/checkout/${batchId}/payment/confirm`);
  expect(first.body).toMatchObject({ok:true,status:'simulated',replayed:false});
  expect(second.body).toMatchObject({ok:true,status:'simulated',replayed:true});
  expect(test.audits).toBe(1);
  expect(test.calls.filter(sql=>sql.startsWith('UPDATE checkout_payments'))).toHaveLength(1);
 });

 it('does not confirm payment after an order leaves pending',async()=>{
  const test=endpoint('awaiting_payment','accepted');
  const response=await request(test.app).post(`/checkout/${batchId}/payment/confirm`);
  expect(response.status).toBe(409);
  expect(test.audits).toBe(0);
  expect(test.calls.at(-1)).toBe('ROLLBACK');
 });

 it('requires the fixed documented demo PIN for e-wallet simulation',async()=>{
  const test=endpoint('awaiting_payment','pending','e_wallet');
  const invalid=await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send({demoPin:'000000'});
  expect(invalid.status).toBe(400);
  expect(test.audits).toBe(0);
  const valid=await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send({demoPin:'123456'});
  expect(valid.status).toBe(200);
  expect(test.calls.some(sql=>sql.startsWith('UPDATE orders SET status=\'paid\''))).toBe(true);
 });

 it('requires the fixed demo PIN for bank-transfer simulation',async()=>{
  const test=endpoint('awaiting_payment','pending','bank_transfer');
  expect((await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send({demoPin:'000000'})).status).toBe(400);
  const valid=await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send({demoPin:'123456'});
  expect(valid.status).toBe(200);
 });

 it('changes the method on the same unpaid checkout without creating orders or payment rows',async()=>{
  const test=methodEndpoint();const response=await request(test.app).post(`/checkout/${batchId}/payment-method`).send({method:'bank_transfer',provider:'BCA',attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(response.body).toMatchObject({status:'awaiting_payment',method:'bank_transfer',provider:'BCA'});
  expect(test.calls.filter(sql=>sql.startsWith('UPDATE checkout_payments'))).toHaveLength(1);
  expect(test.calls.some(sql=>sql.startsWith('INSERT INTO orders')||sql.startsWith('INSERT INTO checkout_payments'))).toBe(false);
 });

 it('settles the same checkout exactly once when changing to Me-Wallet',async()=>{
  const test=methodEndpoint();const response=await request(test.app).post(`/checkout/${batchId}/payment-method`).send({method:'me_wallet',attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(response.body).toMatchObject({status:'simulated',method:'me_wallet',walletBalance:'50000'});
  expect(test.calls.filter(sql=>sql.startsWith('INSERT INTO wallet_transactions'))).toHaveLength(1);
  expect(test.calls.filter(sql=>sql.startsWith('UPDATE orders SET status=\'paid\''))).toHaveLength(1);
 });

 it('does not create a wallet debit when the balance is insufficient',async()=>{
  const test=methodEndpoint('awaiting_payment','pending','49999');const response=await request(test.app).post(`/checkout/${batchId}/payment-method`).send({method:'me_wallet',attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(response.status).toBe(409);expect(test.calls.some(sql=>sql.startsWith('INSERT INTO wallet_transactions'))).toBe(false);expect(test.calls.at(-1)).toBe('ROLLBACK');
 });

 it('does not switch payment methods after payment has settled',async()=>{
  const test=methodEndpoint('simulated');const response=await request(test.app).post(`/checkout/${batchId}/payment-method`).send({method:'qris',attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(response.status).toBe(409);expect(test.calls.at(-1)).toBe('ROLLBACK');
 });

 it('cancels an unpaid checkout and every order in a multi-service batch',async()=>{
  const test=methodEndpoint('awaiting_payment','pending','100000',3);
  const response=await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send({attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(response.body).toMatchObject({ok:true,status:'cancelled',replayed:false});
  expect(test.paymentStatus).toBe('cancelled');expect(test.orderStatuses).toEqual(['cancelled','cancelled','cancelled']);
  expect(test.eventCount).toBe(3);expect(test.audits).toBe(1);
  expect(test.calls[1]).toContain('checkout_batch_id=$1 AND buyer_id=$2');
  expect(test.calls[1]).toContain('FOR UPDATE');
 });

 it('makes repeated cancellation requests idempotent without duplicating events',async()=>{
  const test=methodEndpoint();const payload={attemptKey:'00000000-0000-4000-8000-000000000001'};
  const first=await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send(payload);
  const retry=await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send(payload);
  expect(first.body).toMatchObject({status:'cancelled',replayed:false});
  expect(retry.body).toMatchObject({status:'cancelled',replayed:true});
  expect(test.eventCount).toBe(1);expect(test.audits).toBe(1);
 });

 it('rejects cancellation after payment has been confirmed',async()=>{
  const test=methodEndpoint('simulated','paid');
  const response=await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send({attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(response.status).toBe(409);expect(test.orderStatuses).toEqual(['paid']);
  expect(test.calls.some(sql=>sql.startsWith("UPDATE checkout_payments SET status='cancelled'"))).toBe(false);
 });

 it('prevents confirmation after checkout cancellation',async()=>{
  const test=methodEndpoint();const payload={attemptKey:'00000000-0000-4000-8000-000000000001'};
  await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send(payload);
  const confirmation=await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send(payload);
  expect(confirmation.status).toBe(409);expect(test.paymentStatus).toBe('cancelled');
  expect(test.orderStatuses).toEqual(['cancelled']);
 });

 it('uses the same order-then-payment row locks for confirmation and cancellation',async()=>{
  const payload={attemptKey:'00000000-0000-4000-8000-000000000001'};
  const cancellation=methodEndpoint(),confirmation=methodEndpoint();
  await request(cancellation.app).post(`/checkout/${batchId}/payment/cancel`).send(payload);
  await request(confirmation.app).post(`/checkout/${batchId}/payment/confirm`).send(payload);
  const locks=(calls:string[])=>calls.filter(sql=>sql.startsWith('SELECT id,status FROM orders')||sql.startsWith('SELECT * FROM checkout_payments'));
  expect(locks(cancellation.calls)).toEqual(locks(confirmation.calls));
  expect(locks(cancellation.calls).map(sql=>sql.includes('FROM orders')?'orders':'payment')).toEqual(['orders','payment']);
 });

 it('rejects cancellation when any order has left pending',async()=>{
  const test=methodEndpoint('awaiting_payment','accepted');
  const response=await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send({attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(response.status).toBe(409);expect(test.paymentStatus).toBe('awaiting_payment');
 });
});
