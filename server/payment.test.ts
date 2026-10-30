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

function methodEndpoint(initialPayment='awaiting_payment',orderStatus='pending',balance='100000'){
 let paymentStatus=initialPayment,method='qris',attemptKey='00000000-0000-4000-8000-000000000001';const calls:string[]=[];
 const client={query:vi.fn(async(sql:string,values:any[]=[] )=>{calls.push(sql);if(sql.startsWith('SELECT id,status FROM orders'))return {rows:[{id:'order',status:orderStatus}],rowCount:1};if(sql.startsWith('SELECT * FROM checkout_payments'))return {rows:[{id:'payment',status:paymentStatus,method,amount:'50000',idempotency_key:attemptKey}],rowCount:1};if(sql.startsWith('SELECT coalesce(sum(amount)'))return {rows:[{amount:balance}],rowCount:1};if(sql.startsWith('UPDATE checkout_payments SET idempotency_key'))attemptKey=String(values[1]);if(sql.startsWith('UPDATE checkout_payments SET method')){method=String(values[1]);if(method==='me_wallet')paymentStatus='simulated';}if(sql.startsWith("UPDATE checkout_payments SET status='simulated'"))paymentStatus='simulated';return {rows:[],rowCount:1};}),release:vi.fn()};
 const db={connect:vi.fn(async()=>client)} as unknown as Pick<Pool,'connect'>;const app=express();app.use(express.json());app.post('/checkout/:batchId/payment-method',(req,res,next)=>{res.locals.user={id:'buyer'};next();},(req,res,next)=>{void createPaymentMethodChangeHandler(db)(req,res).catch(next)});app.post('/checkout/:batchId/payment/cancel',(req,res,next)=>{res.locals.user={id:'buyer'};next();},(req,res,next)=>{void createPaymentAttemptCancellationHandler(db)(req,res).catch(next)});app.post('/checkout/:batchId/payment/confirm',(req,res,next)=>{res.locals.user={id:'buyer'};next();},(req,res,next)=>{void createPaymentConfirmationHandler(db)(req,res).catch(next)});app.use((error:any,_req:unknown,res:express.Response,_next:unknown)=>res.status(error.status||500).json({error:error.message}));return {app,calls};
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

 it('invalidates a cancelled attempt so it cannot later settle',async()=>{
  const test=methodEndpoint();const cancelled=await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send({attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(cancelled.body.status).toBe('awaiting_payment');expect(cancelled.body.attemptKey).not.toBe('00000000-0000-4000-8000-000000000001');
  const stale=await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send({attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(stale.status).toBe(409);expect(test.calls.some(sql=>sql.startsWith('UPDATE orders SET status=\'paid\''))).toBe(false);
 });

 it('rejects a cancelled attempt even after its replacement has settled',async()=>{
  const test=methodEndpoint();const cancelled=await request(test.app).post(`/checkout/${batchId}/payment/cancel`).send({attemptKey:'00000000-0000-4000-8000-000000000001'});
  await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send({attemptKey:cancelled.body.attemptKey});
  const stale=await request(test.app).post(`/checkout/${batchId}/payment/confirm`).send({attemptKey:'00000000-0000-4000-8000-000000000001'});
  expect(stale.status).toBe(409);
 });
});
