import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createCheckoutHandler } from './checkout.js';

const idempotencyKey='00000000-0000-4000-8000-000000000001';
const body={idempotencyKey,email:'untrusted@example.test',items:[
 {serviceId:'00000000-0000-4000-8000-000000000002',phone:'0812 3456 7890',projectBrief:'Edit a short product video for social media.'},
 {serviceId:'00000000-0000-4000-8000-000000000003',phone:'0812 3456 7890',projectBrief:'Create a matching product thumbnail.'},
],paymentMethod:'bank_transfer',provider:'BCA'};

function endpoint(balance='1000000',contactPhone:string|null=null){
 const calls:Array<{sql:string;values:any[]}>=[],orders:any[]=[];let batch:any=null,payment:any=null;
 const client={query:vi.fn(async(sql:string,values:any[]=[]):Promise<any>=>{
  calls.push({sql,values});
  if(sql.startsWith('SELECT id,request_fingerprint FROM checkout_batches'))return {rows:batch?[{id:'batch',request_fingerprint:batch.fingerprint}]:[],rowCount:Number(Boolean(batch))};
  if(sql.startsWith('SELECT * FROM orders WHERE checkout_batch_id'))return {rows:orders,rowCount:orders.length};
  if(sql.startsWith('SELECT * FROM checkout_payments'))return {rows:payment?[payment]:[],rowCount:Number(Boolean(payment))};
  if(sql.startsWith('SELECT id FROM carts'))return {rows:[{id:'cart'}],rowCount:1};
  if(sql.startsWith('SELECT id,email,contact_phone'))return {rows:[{id:'buyer',email:'real@example.test',contact_phone:contactPhone}],rowCount:1};
  if(sql.startsWith('SELECT s.id,s.seller_id'))return {rows:[{id:body.items[0].serviceId,seller_id:'seller',title:'Video Edit',price_idr:'100000',seller_name:'Freelancer'},{id:body.items[1].serviceId,seller_id:'seller2',title:'Thumbnail',price_idr:'50000',seller_name:'Other'}],rowCount:2};
  if(sql.startsWith('SELECT count(*)'))return {rows:[{n:2}],rowCount:1};
  if(sql.startsWith('INSERT INTO checkout_batches')){batch={id:'batch',fingerprint:values[2]};return {rows:[{id:'batch'}],rowCount:1};}
  if(sql.startsWith('INSERT INTO orders')){const row={id:`order-${orders.length+1}`,checkout_batch_id:'batch',price_snapshot:String(values[6]),buyer_email_snapshot:values[7],buyer_phone_snapshot:values[8],status:'pending'};orders.push(row);return {rows:[row],rowCount:1};}
  if(sql.startsWith('SELECT coalesce(sum(amount)'))return {rows:[{amount:balance}],rowCount:1};
  if(sql.startsWith('INSERT INTO checkout_payments')){payment={id:'payment',amount:String(values[2]),method:values[3],status:values[4]};return {rows:[payment],rowCount:1};}
  return {rows:[],rowCount:1};
 }),release:vi.fn()};
 const db={connect:vi.fn(async()=>client)} as unknown as Pick<Pool,'connect'>,app=express();app.use(express.json());
 app.post('/checkout',(req,res,next)=>{res.locals.user={id:'buyer',email:'real@example.test'};next();},(req,res,next)=>{void createCheckoutHandler(db)(req,res).catch(next);});
 app.use((error:any,_req:unknown,res:express.Response,_next:unknown)=>res.status(error.status||500).json({error:error.message}));
 return {app,calls};
}

describe('checkout business calculations',()=>{
 it('charges subtotal plus 10 percent once, stores the trusted account email, and replays without another payment',async()=>{
  const t=endpoint(),first=await request(t.app).post('/checkout').send(body),retry=await request(t.app).post('/checkout').send(body);
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({subtotal:'150000',tax:'15000',totalPayable:'165000',aggregateTotal:'165000'});
  expect(first.body.orders[0].buyer_email_snapshot).toBe('real@example.test');
  expect(first.body.orders[0].buyer_phone_snapshot).toBe('+6281234567890');
  expect(retry.body).toMatchObject({subtotal:'150000',tax:'15000',totalPayable:'165000',replayed:true});
  expect(t.calls.filter(c=>c.sql.startsWith('INSERT INTO checkout_payments'))).toHaveLength(1);
 });
 it('rejects a Me-Wallet checkout whose balance does not cover subtotal and tax',async()=>{
  const t=endpoint('164999'),response=await request(t.app).post('/checkout').send({...body,paymentMethod:'me_wallet',provider:undefined});
  expect(response.status).toBe(409);
  expect(t.calls.some(c=>c.sql.startsWith('INSERT INTO checkout_payments'))).toBe(false);
  expect(t.calls.at(-1)?.sql).toBe('ROLLBACK');
 });
 it('rejects reuse of a new idempotency key with changed checkout details',async()=>{
  const t=endpoint();
  await request(t.app).post('/checkout').send(body);
  const changed=await request(t.app).post('/checkout').send({...body,items:body.items.map((item,index)=>index?item:{...item,projectBrief:'Different requirements for this order.'})});
  expect(changed.status).toBe(409);
 });
 it('keeps an unchanged legacy profile phone usable without rewriting it',async()=>{
  const legacyPhone='+1 202 555 0100',t=endpoint('1000000',legacyPhone),items=body.items.map(({phone,...item})=>item);
  const response=await request(t.app).post('/checkout').send({...body,items});
  expect(response.status).toBe(201);
  expect(response.body.orders[0].buyer_phone_snapshot).toBe(legacyPhone);
  expect(t.calls.some(c=>c.sql.startsWith('UPDATE users SET contact_phone'))).toBe(false);
 });
});
