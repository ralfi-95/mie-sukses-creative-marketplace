import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { createOrderTransitionHandler } from './orderTransition.js';

const orderId='00000000-0000-4000-8000-000000000001';
const buyer={id:'buyer',role:'buyer'},seller={id:'seller',role:'seller'};
function endpoint(status:string,actor:{id:string;role:string},paymentStatus='simulated',hasDeliverables=true,failEvent=false,objectExists=true){
 const calls:Array<{sql:string;values?:unknown[]}>=[];let currentStatus=status;
 const client={query:vi.fn(async(sql:string,values?:unknown[])=>{calls.push({sql,values});
  if(sql.startsWith('SELECT * FROM orders'))return {rows:[{id:orderId,checkout_batch_id:'batch',status:currentStatus,buyer_id:'buyer',seller_id:'seller',price_snapshot:'50000'}],rowCount:1};
  if(sql.startsWith('SELECT * FROM checkout_payments'))return {rows:[{id:'payment',status:paymentStatus,method:'me_wallet',provider:null}],rowCount:1};
  if(sql.startsWith('SELECT media_path,delivery_url FROM order_deliverables'))return {rows:hasDeliverables?[{media_path:'/media/00000000-0000-4000-8000-000000000002.pdf',delivery_url:null}]:[],rowCount:hasDeliverables?1:0};
  if(failEvent&&sql.startsWith('INSERT INTO order_events'))throw new Error('event write failed');
  if(sql.startsWith('INSERT INTO wallet_ledger'))return {rows:[{id:'earning'}],rowCount:1};
  if(sql.startsWith('UPDATE orders'))currentStatus=String(values?.[0]);
  if(sql.startsWith('SELECT 1 FROM order_settlements'))return {rows:currentStatus==='refunded'?[{ok:1}]:[],rowCount:currentStatus==='refunded'?1:0};
  return {rows:[],rowCount:1};}),release:vi.fn()};
 const db={connect:vi.fn(async()=>client)} as unknown as Pick<Pool,'connect'>,storage={exists:vi.fn(async()=>objectExists)} as any,app=express();app.use(express.json());
 app.post('/orders/:id/transition',(req,res,next)=>{res.locals.user=actor;next();},(req,res,next)=>{void createOrderTransitionHandler(db,storage)(req,res).catch(next);});
 app.use((error:any,_req:unknown,res:express.Response,_next:unknown)=>res.status(error instanceof ZodError?400:error.status||500).json({error:error.message}));return {app,calls,client,db};
}

describe('order transition endpoint',()=>{
 it('rejects buyer cancellation through the normal transition API',async()=>{const t=endpoint('pending',buyer,'awaiting_payment');const r=await request(t.app).post(`/orders/${orderId}/transition`).send({status:'cancelled'});expect(r.status).toBe(400);expect(t.db.connect).not.toHaveBeenCalled();});
 it.each([{id:'buyer',role:'seller'},{id:'buyer',role:'admin'}])('lets a participant with role $role complete their purchased order',async actor=>{const t=endpoint('work_submitted',actor);const r=await request(t.app).post(`/orders/${orderId}/transition`).send({status:'completed'});expect(r.status).toBe(200);expect(r.body.status).toBe('completed');});
 it('rejects unrelated admins from buyer actions',async()=>{const t=endpoint('work_submitted',{id:'admin',role:'admin'});expect((await request(t.app).post(`/orders/${orderId}/transition`).send({status:'completed'})).status).toBe(409);expect(t.calls.some(c=>c.sql.startsWith('UPDATE orders'))).toBe(false);});
 it('rejects unrelated users from seller actions',async()=>{const t=endpoint('paid',{id:'admin',role:'admin'});expect((await request(t.app).post(`/orders/${orderId}/transition`).send({status:'accepted'})).status).toBe(409);expect(t.calls.some(c=>c.sql.startsWith('UPDATE orders'))).toBe(false);});
 it('requires a rejection reason before opening a transaction',async()=>{const t=endpoint('paid',seller);const r=await request(t.app).post(`/orders/${orderId}/transition`).send({status:'rejected'});expect(r.status).toBe(400);expect(t.db.connect).not.toHaveBeenCalled();});
 it('turns a seller rejection into a reviewable issue while preserving the paid state',async()=>{const t=endpoint('paid',seller);const r=await request(t.app).post(`/orders/${orderId}/transition`).send({status:'rejected',reason:'I cannot complete this project'});expect(r.status).toBe(200);expect(r.body.status).toBe('under_dispute');expect(t.calls.some(c=>c.sql.includes('pre_dispute_status'))).toBe(true);});
 it('requires a deliverable before completion and credits eligible work once',async()=>{const missing=endpoint('work_submitted',buyer,'simulated',false);expect((await request(missing.app).post(`/orders/${orderId}/transition`).send({status:'completed'})).status).toBe(409);const t=endpoint('work_submitted',buyer);expect((await request(t.app).post(`/orders/${orderId}/transition`).send({status:'completed'})).status).toBe(200);expect(t.calls.some(c=>c.sql.startsWith('INSERT INTO wallet_ledger'))).toBe(true);});
 it('does not treat a missing uploaded deliverable as completion evidence',async()=>{const t=endpoint('work_submitted',buyer,'simulated',true,false,false);const response=await request(t.app).post(`/orders/${orderId}/transition`).send({status:'completed'});expect(response.status).toBe(409);expect(t.calls.some(c=>c.sql.startsWith('UPDATE orders'))).toBe(false);});
 it('does not credit legacy untracked payments',async()=>{const t=endpoint('work_submitted',buyer,'legacy_untracked');expect((await request(t.app).post(`/orders/${orderId}/transition`).send({status:'completed'})).status).toBe(200);expect(t.calls.some(c=>c.sql.startsWith('INSERT INTO wallet_ledger'))).toBe(false);});
 it('rolls the transaction back if order history cannot be recorded',async()=>{const t=endpoint('paid',seller,'simulated',true,true);const r=await request(t.app).post(`/orders/${orderId}/transition`).send({status:'rejected',reason:'The request cannot be fulfilled'});expect(r.status).toBe(500);expect(t.calls.at(-1)?.sql).toBe('ROLLBACK');});
});
