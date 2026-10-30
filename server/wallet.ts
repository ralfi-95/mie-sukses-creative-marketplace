import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { DEMO_PAYMENT_PIN, supportedBanks as banks, supportedWallets as wallets } from './paymentSimulation.js';

const payoutBody=z.object({idempotencyKey:z.string().uuid(),amount:z.number().int().positive().safe(),note:z.string().trim().max(500).optional()});
const topUpBody=z.object({idempotencyKey:z.string().uuid(),amount:z.number().int().positive().safe().refine(n=>n%100000===0),method:z.enum(['bank_transfer','e_wallet','qris']),provider:z.string().trim().max(40).optional()}).superRefine((b,c)=>{if((b.method==='bank_transfer'&&!banks.includes(b.provider||''))||(b.method==='e_wallet'&&!wallets.includes(b.provider||'')))c.addIssue({code:'custom',path:['provider'],message:'Choose a supported provider.'});});
const topUpConfirmation=z.object({demoPin:z.string().length(6).optional()});
const withdrawBody=z.object({idempotencyKey:z.string().uuid(),amount:z.number().int().min(50000).safe(),method:z.enum(['bank_transfer','e_wallet']),provider:z.string().trim().min(1).max(40),recipientName:z.string().trim().min(2).max(120),recipientReference:z.string().regex(/^[0-9]{10,16}$/,'Enter a destination number using 10 to 16 digits.')}).superRefine((b,c)=>{if((b.method==='bank_transfer'&&!banks.includes(b.provider))||(b.method==='e_wallet'&&!wallets.includes(b.provider)))c.addIssue({code:'custom',path:['provider'],message:'Choose a supported destination.'});});

export function createPersonalWalletHandler(db:Pick<Pool,'query'>){return async(_req:Request,res:Response)=>{const user=res.locals.user.id;const [balance,transactions]=await Promise.all([db.query("SELECT coalesce(sum(amount),0)::text amount FROM (SELECT amount FROM wallet_transactions WHERE user_id=$1 AND status='completed' UNION ALL SELECT l.amount FROM wallet_ledger l WHERE l.seller_id=$1 AND NOT EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.user_id=l.seller_id AND w.order_id=l.order_id AND w.entry_type='order_earning')) entries",[user]),db.query("SELECT id,entry_type,amount,method,provider,order_id,checkout_batch_id,status,created_at FROM wallet_transactions WHERE user_id=$1 UNION ALL SELECT l.id,l.entry_type,l.amount,NULL,NULL,l.order_id,NULL,'completed',l.created_at FROM wallet_ledger l WHERE l.seller_id=$1 AND NOT EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.user_id=l.seller_id AND w.order_id=l.order_id AND w.entry_type='order_earning') ORDER BY created_at DESC LIMIT 100",[user])]);res.json({balance:balance.rows[0].amount,transactions:transactions.rows});};}

export function createWalletTopUpHandler(db:Pick<Pool,'connect'>){return async(req:Request,res:Response)=>{const body=topUpBody.parse(req.body),user=res.locals.user.id,client=await db.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user]);const prior=await client.query('SELECT * FROM wallet_topup_sessions WHERE user_id=$1 AND idempotency_key=$2 FOR UPDATE',[user,body.idempotencyKey]);if(prior.rowCount){const session=prior.rows[0];if(String(session.amount)!==String(body.amount)||session.method!==body.method||session.provider!==(body.provider||null))throw Object.assign(new Error('This idempotency key was already used for a different top-up.'),{status:409});await client.query('COMMIT');return res.json({session,replayed:true});}const result=await client.query("INSERT INTO wallet_topup_sessions(user_id,amount,method,provider,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING *",[user,body.amount,body.method,body.provider||null,body.idempotencyKey]);await client.query('COMMIT');res.status(201).json({session:result.rows[0],replayed:false});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};}

export function createWalletTopUpCancellationHandler(db:Pick<Pool,'connect'>){return async(req:Request,res:Response)=>{const user=res.locals.user.id,client=await db.connect();try{await client.query('BEGIN');const result=await client.query('SELECT * FROM wallet_topup_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.sessionId,user]);if(!result.rowCount)throw Object.assign(new Error('Top-up session not found.'),{status:404});if(result.rows[0].status==='completed')throw Object.assign(new Error('A completed top-up cannot be cancelled.'),{status:409});if(result.rows[0].status==='awaiting_payment')await client.query("UPDATE wallet_topup_sessions SET status='cancelled',cancelled_at=now() WHERE id=$1 AND status='awaiting_payment'",[req.params.sessionId]);await client.query('COMMIT');res.json({ok:true,status:'cancelled'});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};}

export function createWalletTopUpConfirmationHandler(db:Pick<Pool,'connect'>){return async(req:Request,res:Response)=>{const body=topUpConfirmation.parse(req.body||{}),user=res.locals.user.id,client=await db.connect();try{await client.query('BEGIN');const result=await client.query('SELECT * FROM wallet_topup_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.sessionId,user]);if(!result.rowCount)throw Object.assign(new Error('Top-up session not found.'),{status:404});const session=result.rows[0];if(session.status==='cancelled')throw Object.assign(new Error('This top-up session was cancelled.'),{status:409});if(['bank_transfer','e_wallet'].includes(session.method)&&body.demoPin!==DEMO_PAYMENT_PIN)throw Object.assign(new Error('Use the documented demo PIN 123456.'),{status:400});if(session.status==='completed'){const transaction=await client.query('SELECT * FROM wallet_transactions WHERE id=$1',[session.wallet_transaction_id]);await client.query('COMMIT');return res.json({transaction:transaction.rows[0],replayed:true});}const transaction=await client.query("INSERT INTO wallet_transactions(user_id,entry_type,amount,method,provider,idempotency_key) VALUES($1,'top_up',$2,$3,$4,$5) RETURNING *",[user,session.amount,session.method,session.provider,session.idempotency_key]);await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'wallet_topup_simulated','wallet_transaction',$2,$3)",[user,transaction.rows[0].id,JSON.stringify({amount:session.amount,method:session.method,provider:session.provider})]);await client.query("UPDATE wallet_topup_sessions SET status='completed',wallet_transaction_id=$2,completed_at=now() WHERE id=$1 AND status='awaiting_payment'",[session.id,transaction.rows[0].id]);await client.query('COMMIT');res.status(201).json({transaction:transaction.rows[0],replayed:false});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};}

export function createWalletWithdrawalHandler(db:Pick<Pool,'connect'>){return async(req:Request,res:Response)=>{const body=withdrawBody.parse(req.body),user=res.locals.user.id,client=await db.connect();try{await client.query('BEGIN');const account=await client.query("SELECT id FROM users WHERE id=$1 AND role IN ('buyer','seller','admin') AND status='active' FOR UPDATE",[user]);if(!account.rowCount)throw Object.assign(new Error('An active account is required to withdraw.'),{status:403});const prior=await client.query('SELECT * FROM wallet_transactions WHERE user_id=$1 AND idempotency_key=$2',[user,body.idempotencyKey]);if(prior.rowCount){await client.query('COMMIT');return res.json({transaction:prior.rows[0],replayed:true});}const balance=await client.query("SELECT coalesce(sum(amount),0)::text amount FROM (SELECT amount FROM wallet_transactions WHERE user_id=$1 AND status='completed' UNION ALL SELECT l.amount FROM wallet_ledger l WHERE l.seller_id=$1 AND NOT EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.user_id=l.seller_id AND w.order_id=l.order_id AND w.entry_type='order_earning')) entries",[user]);if(BigInt(balance.rows[0].amount)<BigInt(body.amount))throw Object.assign(new Error('Withdrawal exceeds your available wallet balance.'),{status:409});const result=await client.query("INSERT INTO wallet_transactions(user_id,entry_type,amount,method,provider,idempotency_key,recipient_name,recipient_reference) VALUES($1,'withdrawal',$2,$3,$4,$5,$6,$7) RETURNING *",[user,-body.amount,body.method,body.provider,body.idempotencyKey,body.recipientName,body.recipientReference]);await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'wallet_withdrawal_simulated','wallet_transaction',$2,$3)",[user,result.rows[0].id,JSON.stringify({amount:body.amount,method:body.method,provider:body.provider})]);await client.query('COMMIT');res.status(201).json({transaction:result.rows[0],replayed:false});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};}
const reviewBody=z.object({decision:z.enum(['approved','rejected']),reason:z.string().trim().min(5).max(500).optional()}).superRefine((body,ctx)=>{if(body.decision==='rejected'&&!body.reason)ctx.addIssue({code:'custom',path:['reason'],message:'A reason is required to reject a payout.'});});

export function createSellerWalletHandler(db:Pick<Pool,'query'>){
 return async(_req:Request,res:Response)=>{
  const seller=res.locals.user.id;
  const [balance,held,payouts,ledger]=await Promise.all([
   db.query('SELECT coalesce(sum(amount),0)::text amount FROM wallet_ledger WHERE seller_id=$1',[seller]),
   db.query("SELECT coalesce(sum(o.price_snapshot),0)::text amount FROM orders o JOIN checkout_payments p ON p.checkout_batch_id=o.checkout_batch_id WHERE o.seller_id=$1 AND o.status IN ('pending','accepted','in_progress') AND p.status='simulated'",[seller]),
   db.query('SELECT id,amount,status,request_note,decision_reason,created_at,reviewed_at FROM wallet_payout_requests WHERE seller_id=$1 ORDER BY created_at DESC',[seller]),
   db.query('SELECT entry_type,amount,order_id,payout_request_id,created_at FROM wallet_ledger WHERE seller_id=$1 ORDER BY created_at DESC LIMIT 100',[seller]),
  ]);
  res.json({availableBalance:balance.rows[0].amount,heldEarnings:held.rows[0].amount,payouts:payouts.rows,ledger:ledger.rows});
 };
}

export function createPayoutRequestHandler(db:Pick<Pool,'connect'>){
 return async(req:Request,res:Response)=>{
  const body=payoutBody.parse(req.body),seller=res.locals.user.id,client=await db.connect();
  try{
   await client.query('BEGIN');
   const account=await client.query("SELECT id FROM users WHERE id=$1 AND role='seller' AND status='active' FOR UPDATE",[seller]);
   if(!account.rowCount)throw Object.assign(new Error('Seller account is unavailable.'),{status:403});
   const prior=await client.query('SELECT * FROM wallet_payout_requests WHERE seller_id=$1 AND idempotency_key=$2',[seller,body.idempotencyKey]);
   if(prior.rowCount){await client.query('COMMIT');return res.json({request:prior.rows[0],replayed:true});}
   const available=await client.query('SELECT coalesce(sum(amount),0)::text amount FROM wallet_ledger WHERE seller_id=$1',[seller]);
   if(BigInt(available.rows[0].amount)<BigInt(body.amount))throw Object.assign(new Error('Payout amount exceeds available balance.'),{status:409});
   const payout=await client.query("INSERT INTO wallet_payout_requests(seller_id,idempotency_key,amount,request_note) VALUES($1,$2,$3,$4) RETURNING *",[seller,body.idempotencyKey,body.amount,body.note||null]);
   await client.query("INSERT INTO wallet_ledger(seller_id,payout_request_id,entry_type,amount) VALUES($1,$2,'payout_reserved',$3)",[seller,payout.rows[0].id,-body.amount]);
   await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'seller_payout_requested','payout_request',$2,$3)",[seller,payout.rows[0].id,JSON.stringify({amount:body.amount})]);
   await client.query('COMMIT');
   res.status(201).json({request:payout.rows[0],replayed:false});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}

export function createPayoutReviewHandler(db:Pick<Pool,'connect'>){
 return async(req:Request,res:Response)=>{
  const body=reviewBody.parse(req.body),admin=res.locals.user.id,client=await db.connect();
  try{
   await client.query('BEGIN');
   const payout=await client.query("SELECT * FROM wallet_payout_requests WHERE id=$1 AND status='pending' FOR UPDATE",[req.params.id]);
   if(!payout.rowCount)throw Object.assign(new Error('Payout request is no longer pending.'),{status:409});
   if(body.decision==='rejected')await client.query("INSERT INTO wallet_ledger(seller_id,payout_request_id,entry_type,amount) VALUES($1,$2,'payout_release',$3)",[payout.rows[0].seller_id,payout.rows[0].id,payout.rows[0].amount]);
   await client.query('UPDATE wallet_payout_requests SET status=$1,decision_reason=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4',[body.decision,body.reason||null,admin,payout.rows[0].id]);
   await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,$2,'payout_request',$3,$4)",[admin,'seller_payout_'+body.decision,payout.rows[0].id,JSON.stringify({amount:payout.rows[0].amount,reason:body.reason||null})]);
   await client.query('COMMIT');
   res.json({ok:true,status:body.decision});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}
