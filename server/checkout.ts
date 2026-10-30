import { z } from 'zod';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { supportedBanks as banks, supportedWallets as wallets } from './paymentSimulation.js';
import { isValidPhone, normalizePhone } from './contactPhone.js';
import { checkoutTotals } from './pricing.js';

export const checkoutBodySchema=z.object({
 idempotencyKey:z.string().uuid(),
 email:z.string().trim().email().max(254),
 items:z.array(z.object({serviceId:z.string().uuid(),phone:z.string().trim().min(1).max(30).optional().refine(value=>value===undefined||isValidPhone(value),{message:'Enter a valid Indonesian phone number.'}),projectBrief:z.string().trim().min(1).max(10000)})).min(1),
 paymentMethod:z.enum(['bank_transfer','e_wallet','qris','me_wallet']),
 provider:z.string().trim().max(40).optional(),
}).superRefine((body,ctx)=>{if((body.paymentMethod==='bank_transfer'&&!banks.includes(body.provider||''))||(body.paymentMethod==='e_wallet'&&!wallets.includes(body.provider||'')))ctx.addIssue({code:'custom',path:['provider'],message:'Choose a supported simulated provider.'});});

export function checkoutWalletBalance(balance:string|number,total:string|number){
 const remaining=BigInt(balance)-BigInt(total);
 if(remaining<0n)throw Object.assign(new Error('Me-Wallet balance is insufficient.'),{status:409,code:'INSUFFICIENT_WALLET_BALANCE'});
 return remaining.toString();
}

const walletBalanceSql="SELECT coalesce(sum(amount),0)::text amount FROM (SELECT amount FROM wallet_transactions WHERE user_id=$1 AND status='completed' UNION ALL SELECT l.amount FROM wallet_ledger l WHERE l.seller_id=$1 AND NOT EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.user_id=l.seller_id AND w.order_id=l.order_id AND w.entry_type='order_earning')) entries";
const fingerprint=(items:{serviceId:string;phone?:string;projectBrief:string}[],method:string,provider?:string)=>createHash('sha256').update(JSON.stringify({items:[...items].sort((a,b)=>a.serviceId.localeCompare(b.serviceId)),method,provider:provider||null})).digest('hex');

export function createCheckoutHandler(db:Pick<Pool,'connect'>){
 return async(req:Request,res:Response)=>{
  const {idempotencyKey,items:requests,paymentMethod,provider}=checkoutBodySchema.parse(req.body);
  const user=res.locals.user as {id:string;email:string},buyer=user.id,client=await db.connect(),requestFingerprint=fingerprint(requests,paymentMethod,provider);
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[buyer,idempotencyKey]);
   const old=await client.query('SELECT id,request_fingerprint FROM checkout_batches WHERE buyer_id=$1 AND idempotency_key=$2',[buyer,idempotencyKey]);
   if(old.rowCount){
    if(old.rows[0].request_fingerprint!=='checkout-v1'&&old.rows[0].request_fingerprint!==requestFingerprint)throw Object.assign(new Error('This idempotency key was already used for a different checkout.'),{status:409,code:'IDEMPOTENCY_CONFLICT'});
    const orders=await client.query('SELECT * FROM orders WHERE checkout_batch_id=$1 ORDER BY created_at,id',[old.rows[0].id]);
    const payment=await client.query('SELECT * FROM checkout_payments WHERE checkout_batch_id=$1',[old.rows[0].id]);
    if(!payment.rowCount)throw Object.assign(new Error('Checkout payment record is unavailable.'),{status:409});
    const totals=checkoutTotals(orders.rows.map((order:{price_snapshot:string|number})=>order.price_snapshot));
    const total=String(payment.rows[0].amount),tax=(BigInt(total)-BigInt(totals.subtotal)).toString();
    const wallet=payment.rows[0].method==='me_wallet'?await client.query(walletBalanceSql,[buyer]):null;
    await client.query('COMMIT');
    return res.json({batchId:old.rows[0].id,orders:orders.rows,subtotal:totals.subtotal,tax,totalPayable:total,aggregateTotal:total,payment:payment.rows[0],walletBalance:wallet?.rows[0].amount??null,replayed:true});
   }
   const cart=await client.query('SELECT id FROM carts WHERE buyer_id=$1 FOR UPDATE',[buyer]);
   if(!cart.rowCount)throw Object.assign(new Error('Cart is empty.'),{status:409,code:'EMPTY_CART'});
   const account=await client.query("SELECT id,email,contact_phone FROM users WHERE id=$1 AND status='active' FOR UPDATE",[buyer]);
   if(!account.rowCount)throw Object.assign(new Error('An active account is required.'),{status:403});
   const items=await client.query("SELECT s.id,s.seller_id,s.title,s.price_idr,u.display_name seller_name FROM cart_items i JOIN services s ON s.id=i.service_id JOIN users u ON u.id=s.seller_id JOIN categories c ON c.id=s.category_id WHERE i.cart_id=$1 AND s.status='published' AND u.status='active' AND u.role='seller' AND c.is_active AND u.id<>$2 ORDER BY s.id FOR UPDATE OF s,u",[cart.rows[0].id,buyer]);
   const count=await client.query('SELECT count(*)::int n FROM cart_items WHERE cart_id=$1',[cart.rows[0].id]);
   if(!count.rows[0].n||items.rowCount!==count.rows[0].n||requests.length!==items.rowCount||new Set(requests.map(i=>i.serviceId)).size!==items.rowCount||items.rows.some((service:{id:string})=>!requests.some(i=>i.serviceId===service.id)))throw Object.assign(new Error('Every cart service needs its own project brief and contact phone.'),{status:409,code:'CART_CHANGED'});
   const phoneByService=new Map<string,string>();
   for(const request of requests){
    const value=request.phone||account.rows[0].contact_phone;
    if(!value)throw Object.assign(new Error('Add a contact phone to your profile or checkout details.'),{status:400,code:'CONTACT_PHONE_REQUIRED'});
    try{phoneByService.set(request.serviceId,normalizePhone(value));}catch{if(request.phone!==undefined)throw Object.assign(new Error('Enter a valid contact phone.'),{status:400,code:'INVALID_CONTACT_PHONE'});phoneByService.set(request.serviceId,String(value));}
   }
   if(!account.rows[0].contact_phone){const firstPhone=phoneByService.values().next().value;await client.query('UPDATE users SET contact_phone=$1 WHERE id=$2 AND contact_phone IS NULL',[firstPhone,buyer]);}
   const batch=await client.query('INSERT INTO checkout_batches(buyer_id,idempotency_key,request_fingerprint) VALUES($1,$2,$3) RETURNING id',[buyer,idempotencyKey,requestFingerprint]);
   const created=[];
   for(const service of items.rows){
    const request=requests.find(item=>item.serviceId===service.id)!;
    const order=await client.query('INSERT INTO orders(checkout_batch_id,buyer_id,seller_id,service_id,title_snapshot,seller_name_snapshot,price_snapshot,buyer_email_snapshot,buyer_phone_snapshot,project_brief) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[batch.rows[0].id,buyer,service.seller_id,service.id,service.title,service.seller_name,service.price_idr,account.rows[0].email,phoneByService.get(service.id),request.projectBrief]);
    await client.query("INSERT INTO order_events(order_id,actor_id,to_status) VALUES($1,$2,'pending')",[order.rows[0].id,buyer]);
    created.push(order.rows[0]);
   }
   const totals=checkoutTotals(created.map((order:{price_snapshot:string|number})=>order.price_snapshot));
   let paymentStatus='awaiting_payment',walletBalance:string|null=null;
   if(paymentMethod==='me_wallet'){
    const balance=await client.query(walletBalanceSql,[buyer]);
    walletBalance=checkoutWalletBalance(balance.rows[0].amount,totals.total);
    await client.query("INSERT INTO wallet_transactions(user_id,entry_type,amount,method,provider,checkout_batch_id,idempotency_key) VALUES($1,'order_payment',$2,'me_wallet',$3,$4,$5)",[buyer,`-${totals.total}`,provider||null,batch.rows[0].id,idempotencyKey]);
    paymentStatus='simulated';
   }
   const payment=await client.query("INSERT INTO checkout_payments(checkout_batch_id,buyer_id,amount,method,status,provider,idempotency_key,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='simulated' THEN now() END) RETURNING *",[batch.rows[0].id,buyer,totals.total,paymentMethod,paymentStatus,provider||null,idempotencyKey]);
   if(paymentStatus==='simulated'){
    await client.query("UPDATE orders SET status='paid',updated_at=now() WHERE checkout_batch_id=$1",[batch.rows[0].id]);
    await client.query("INSERT INTO order_events(order_id,actor_id,from_status,to_status,reason) SELECT id,$2,'pending','paid','Me-Wallet payment recorded' FROM orders WHERE checkout_batch_id=$1",[batch.rows[0].id,buyer]);
    for(const order of created)order.status='paid';
   }
   await client.query('DELETE FROM cart_items WHERE cart_id=$1',[cart.rows[0].id]);
   await client.query('COMMIT');
   res.status(201).json({batchId:batch.rows[0].id,orders:created,subtotal:totals.subtotal,tax:totals.tax,totalPayable:totals.total,aggregateTotal:totals.total,payment:payment.rows[0],walletBalance,replayed:false});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}
