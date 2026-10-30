import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { canTransitionOrder } from './policies.js';
import type { MediaStorage } from './storage.js';

const transitionBody=z.object({
 status:z.enum(['accepted','rejected','in_progress','completed']),
 reason:z.string().trim().min(5).max(500).optional(),
}).superRefine((body,ctx)=>{
 if(body.status==='rejected'&&!body.reason)ctx.addIssue({code:'custom',path:['reason'],message:'A rejection reason is required.'});
});

export function createOrderTransitionHandler(db:Pick<Pool,'connect'>,storage:MediaStorage){
 return async(req:Request,res:Response)=>{
  const body=transitionBody.parse(req.body),user=res.locals.user as {id:string;role:string},client=await db.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id]);
   if(!result.rowCount)throw Object.assign(new Error('Order not found.'),{status:404});
   const order=result.rows[0];
   if(!canTransitionOrder(order.status,body.status,user.id,order.buyer_id,order.seller_id))throw Object.assign(new Error('This order transition is not allowed.'),{status:409});

   let nextStatus:string=body.status;
   if(user.id===order.seller_id&&['accepted','rejected'].includes(body.status)){
    const payment=await client.query('SELECT * FROM checkout_payments WHERE checkout_batch_id=$1 FOR UPDATE',[order.checkout_batch_id]);
    if(!payment.rowCount)throw Object.assign(new Error('Payment record is unavailable.'),{status:409});
    const method=payment.rows[0].method;
    if(user.id===order.seller_id&&payment.rows[0].status!=='simulated')throw Object.assign(new Error('Seller actions require confirmed payment.'),{status:409});

    if(body.status==='rejected'){
     nextStatus='under_dispute';
     await client.query("INSERT INTO order_issues(order_id,issue_type,claimant_id,reason,pre_dispute_status) VALUES($1,'seller_rejection',$2,$3,$4)",[order.id,user.id,body.reason,'paid']);
    }
   }

   if(body.status==='completed'){
    const deliverables=await client.query('SELECT media_path,delivery_url FROM order_deliverables WHERE order_id=$1',[order.id]);
    let hasDeliverable=deliverables.rows.some(item=>Boolean(item.delivery_url));
    for(const item of deliverables.rows){
     const filename=typeof item.media_path==='string'&&/^\/media\/([0-9a-f-]{36}\.(png|jpg|webp|pdf|doc|docx))$/i.exec(item.media_path)?.[1];
     if(!hasDeliverable&&filename&&await storage.exists(filename))hasDeliverable=true;
    }
    if(!hasDeliverable)throw Object.assign(new Error('Seller must submit work before buyer completion.'),{status:409});
    const payment=await client.query('SELECT * FROM checkout_payments WHERE checkout_batch_id=$1 FOR UPDATE',[order.checkout_batch_id]);
    if(!payment.rowCount||!['simulated','legacy_untracked'].includes(payment.rows[0].status))throw Object.assign(new Error('Payment state is not eligible for completion.'),{status:409});
    if(payment.rows[0].status==='simulated'){
     await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[order.seller_id]);
     const earning=await client.query("INSERT INTO wallet_ledger(seller_id,order_id,entry_type,amount) VALUES($1,$2,'order_earning',$3) ON CONFLICT(order_id,entry_type) DO NOTHING RETURNING id",[order.seller_id,order.id,order.price_snapshot]);
     if(earning.rowCount){
      await client.query("INSERT INTO wallet_transactions(user_id,entry_type,amount,method,order_id,checkout_batch_id) VALUES($1,'order_earning',$2,'marketplace',$3,$4) ON CONFLICT DO NOTHING",[order.seller_id,order.price_snapshot,order.id,order.checkout_batch_id]);
      await client.query("INSERT INTO order_settlements(order_id,outcome,checkout_payment_id,amount,method,provider,recorded_by) SELECT $1,'payment',id,$2,method,provider,$3 FROM checkout_payments WHERE checkout_batch_id=$4 ON CONFLICT(order_id) DO NOTHING",[order.id,order.price_snapshot,user.id,order.checkout_batch_id]);
      await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'seller_earning_credited','order',$2,$3)",[user.id,order.id,JSON.stringify({gross:order.price_snapshot,net:order.price_snapshot,commission:0})]);
     }
    }
   }

   await client.query('UPDATE orders SET status=$1,updated_at=now() WHERE id=$2',[nextStatus,order.id]);
   await client.query('INSERT INTO order_events(order_id,actor_id,from_status,to_status,reason) VALUES($1,$2,$3,$4,$5)',[order.id,user.id,order.status,nextStatus,body.reason||null]);
   if(user.id===order.seller_id&&body.status==='rejected')await client.query("INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES($1,'order_seller_rejected','order',$2,$3)",[user.id,order.id,JSON.stringify({reason:body.reason})]);
   await client.query('COMMIT');
   res.json({ok:true,status:nextStatus});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}
