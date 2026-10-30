import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { DEMO_PAYMENT_PIN, supportedBanks, supportedWallets } from './paymentSimulation.js';

const confirmation=z.object({demoPin:z.string().length(6).optional(),attemptKey:z.string().uuid().nullable().optional()});
const paymentMethod=z.object({method:z.enum(['bank_transfer','e_wallet','qris','me_wallet']),provider:z.string().trim().max(40).optional(),attemptKey:z.string().uuid().nullable().optional()}).superRefine((value,ctx)=>{if((value.method==='bank_transfer'&&!supportedBanks.includes(value.provider||''))||(value.method==='e_wallet'&&!supportedWallets.includes(value.provider||'')))ctx.addIssue({code:'custom',path:['provider'],message:'Choose a supported simulated provider.'});});
const paymentCancellation=z.object({attemptKey:z.string().uuid().nullable()});

export function createPaymentAttemptCancellationHandler(db:Pick<Pool,'connect'>){
 return async(req:Request,res:Response)=>{
  const body=paymentCancellation.parse(req.body),user=res.locals.user as {id:string},client=await db.connect();
  try{
   await client.query('BEGIN');
   const orders=await client.query('SELECT id,status FROM orders WHERE checkout_batch_id=$1 AND buyer_id=$2 ORDER BY id FOR UPDATE',[req.params.batchId,user.id]);
   if(!orders.rowCount)throw Object.assign(new Error('Checkout batch not found.'),{status:404});
   const payment=await client.query('SELECT * FROM checkout_payments WHERE checkout_batch_id=$1 AND buyer_id=$2 FOR UPDATE',[req.params.batchId,user.id]);
   if(!payment.rowCount)throw Object.assign(new Error('Payment record not found.'),{status:404});
   if((payment.rows[0].idempotency_key??null)!==body.attemptKey)throw Object.assign(new Error('This payment attempt is no longer current.'),{status:409});
   if(payment.rows[0].status==='cancelled'){
    await client.query('COMMIT');
    return res.json({ok:true,status:'cancelled',replayed:true});
   }
   if(payment.rows[0].status!=='awaiting_payment'||orders.rows.some((order:{status:string})=>order.status!=='pending'))throw Object.assign(new Error('This payment can no longer be cancelled.'),{status:409});
   const cancelledPayment=await client.query("UPDATE checkout_payments SET status='cancelled' WHERE id=$1 AND status='awaiting_payment' RETURNING id",[payment.rows[0].id]);
   if(!cancelledPayment.rowCount)throw Object.assign(new Error('This payment can no longer be cancelled.'),{status:409});
   const cancelledOrders=await client.query("WITH cancelled AS (UPDATE orders SET status='cancelled',updated_at=now() WHERE checkout_batch_id=$1 AND buyer_id=$2 AND status='pending' RETURNING id) INSERT INTO order_events(order_id,actor_id,from_status,to_status,reason) SELECT id,$2,'pending','cancelled','Checkout payment cancelled by buyer' FROM cancelled",[req.params.batchId,user.id]);
   if(cancelledOrders.rowCount!==orders.rowCount)throw Object.assign(new Error('Checkout orders could not be cancelled consistently.'),{status:409});
   await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'checkout_payment_cancelled','checkout_batch',$2,$3)",[user.id,req.params.batchId,JSON.stringify({amount:payment.rows[0].amount,orderCount:orders.rowCount})]);
   await client.query('COMMIT');
   res.json({ok:true,status:'cancelled',replayed:false});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}

export function createPaymentMethodChangeHandler(db:Pick<Pool,'connect'>){
 return async(req:Request,res:Response)=>{
  const body=paymentMethod.parse(req.body),user=res.locals.user as {id:string},client=await db.connect();
  try{
   await client.query('BEGIN');
   const orders=await client.query('SELECT id,status FROM orders WHERE checkout_batch_id=$1 AND buyer_id=$2 ORDER BY id FOR UPDATE',[req.params.batchId,user.id]);
   if(!orders.rowCount)throw Object.assign(new Error('Checkout batch not found.'),{status:404});
   const payment=await client.query('SELECT * FROM checkout_payments WHERE checkout_batch_id=$1 AND buyer_id=$2 FOR UPDATE',[req.params.batchId,user.id]);
   if(!payment.rowCount)throw Object.assign(new Error('Payment record not found.'),{status:404});
   if(payment.rows[0].status!=='awaiting_payment'||orders.rows.some((order:{status:string})=>order.status!=='pending'))throw Object.assign(new Error('This checkout can no longer change payment method.'),{status:409});
   if(payment.rows[0].idempotency_key&&body.attemptKey!==payment.rows[0].idempotency_key)throw Object.assign(new Error('This payment attempt is no longer current.'),{status:409});
   let walletBalance:string|null=null;
   if(body.method==='me_wallet'){
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    const balance=await client.query("SELECT coalesce(sum(amount),0)::text amount FROM (SELECT amount FROM wallet_transactions WHERE user_id=$1 AND status='completed' UNION ALL SELECT l.amount FROM wallet_ledger l WHERE l.seller_id=$1 AND NOT EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.user_id=l.seller_id AND w.order_id=l.order_id AND w.entry_type='order_earning')) entries",[user.id]);
    if(BigInt(balance.rows[0].amount)<BigInt(payment.rows[0].amount))throw Object.assign(new Error('Me-Wallet balance is insufficient.'),{status:409,code:'INSUFFICIENT_WALLET_BALANCE'});
    walletBalance=(BigInt(balance.rows[0].amount)-BigInt(payment.rows[0].amount)).toString();
    await client.query("INSERT INTO wallet_transactions(user_id,entry_type,amount,method,checkout_batch_id,idempotency_key) VALUES($1,'order_payment',$2,'me_wallet',$3,$4)",[user.id,`-${payment.rows[0].amount}`,req.params.batchId,payment.rows[0].idempotency_key]);
    await client.query("UPDATE checkout_payments SET method='me_wallet',provider=NULL,status='simulated',confirmed_at=now() WHERE id=$1 AND status='awaiting_payment'",[payment.rows[0].id]);
    await client.query("UPDATE orders SET status='paid',updated_at=now() WHERE checkout_batch_id=$1 AND status='pending'",[req.params.batchId]);
    await client.query("INSERT INTO order_events(order_id,actor_id,from_status,to_status,reason) SELECT id,$2,'pending','paid','Me-Wallet payment recorded after payment method change' FROM orders WHERE checkout_batch_id=$1",[req.params.batchId,user.id]);
    await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'payment_simulated','checkout_batch',$2,$3)",[user.id,req.params.batchId,JSON.stringify({method:body.method,amount:payment.rows[0].amount})]);
   }else await client.query("UPDATE checkout_payments SET method=$2,provider=$3 WHERE id=$1 AND status='awaiting_payment'",[payment.rows[0].id,body.method,body.provider||null]);
   await client.query('COMMIT');
   res.json({ok:true,status:body.method==='me_wallet'?'simulated':'awaiting_payment',method:body.method,provider:body.provider||null,walletBalance});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}

export function createPaymentConfirmationHandler(db:Pick<Pool,'connect'>){
 return async(req:Request,res:Response)=>{
  const body=confirmation.parse(req.body||{}),user=res.locals.user as {id:string},client=await db.connect();
  try{
   await client.query('BEGIN');
   const orders=await client.query('SELECT id,status FROM orders WHERE checkout_batch_id=$1 AND buyer_id=$2 ORDER BY id FOR UPDATE',[req.params.batchId,user.id]);
   if(!orders.rowCount)throw Object.assign(new Error('Checkout batch not found.'),{status:404});
   const payment=await client.query('SELECT * FROM checkout_payments WHERE checkout_batch_id=$1 AND buyer_id=$2 FOR UPDATE',[req.params.batchId,user.id]);
   if(!payment.rowCount)throw Object.assign(new Error('Payment record not found.'),{status:404});
   if(payment.rows[0].idempotency_key&&body.attemptKey!==payment.rows[0].idempotency_key)throw Object.assign(new Error('This payment attempt is no longer current.'),{status:409});
   if(payment.rows[0].status==='simulated'){
    await client.query('COMMIT');
    return res.json({ok:true,status:'simulated',replayed:true});
   }
   if(payment.rows[0].status!=='awaiting_payment'||orders.rows.some((order:{status:string})=>order.status!=='pending'))throw Object.assign(new Error('This payment can no longer be confirmed.'),{status:409});
   if(['bank_transfer','e_wallet'].includes(payment.rows[0].method)&&body.demoPin!==DEMO_PAYMENT_PIN)throw Object.assign(new Error('Enter the documented demo PIN 123456 to complete this simulation.'),{status:400});
   await client.query("UPDATE checkout_payments SET status='simulated',confirmed_at=now() WHERE id=$1 AND status='awaiting_payment'",[payment.rows[0].id]);
   await client.query("UPDATE orders SET status='paid',updated_at=now() WHERE checkout_batch_id=$1 AND status='pending'",[req.params.batchId]);
   await client.query("INSERT INTO order_events(order_id,actor_id,from_status,to_status,reason) SELECT id,$2,'pending','paid','Simulated payment confirmed' FROM orders WHERE checkout_batch_id=$1",[req.params.batchId,user.id]);
   await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'payment_simulated','checkout_batch',$2,$3)",[user.id,req.params.batchId,JSON.stringify({method:payment.rows[0].method,provider:payment.rows[0].provider,amount:payment.rows[0].amount})]);
   await client.query('COMMIT');
   res.json({ok:true,status:'simulated',replayed:false});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}
