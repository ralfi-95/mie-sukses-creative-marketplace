import type { Request, Response } from 'express';
import type { Pool } from 'pg';

export function createBuyerOrderListHandler(db:Pick<Pool,'query'>){
 return async(_req:Request,res:Response)=>{
  const user=res.locals.user as {id:string};
  const result=await db.query('SELECT o.*,o.price_snapshot total,p.method payment_method,p.status payment_status,p.confirmed_at payment_confirmed_at FROM orders o LEFT JOIN checkout_payments p ON p.checkout_batch_id=o.checkout_batch_id WHERE o.buyer_id=$1 ORDER BY o.created_at DESC',[user.id]);
  res.json({orders:result.rows});
 };
}

export function createSellerOrderListHandler(db:Pick<Pool,'query'>){
 return async(_req:Request,res:Response)=>{
  const user=res.locals.user as {id:string};
  const result=await db.query('SELECT o.*,p.method payment_method,p.status payment_status,p.confirmed_at payment_confirmed_at,buyer.display_name buyer_name,buyer.avatar_path buyer_avatar,s.thumbnail_path service_thumbnail FROM orders o LEFT JOIN checkout_payments p ON p.checkout_batch_id=o.checkout_batch_id JOIN users buyer ON buyer.id=o.buyer_id JOIN services s ON s.id=o.service_id WHERE o.seller_id=$1 ORDER BY o.created_at DESC',[user.id]);
  res.json({orders:result.rows.map(({buyer_email_snapshot,...order}:Record<string,unknown>)=>order)});
 };
}

export function createOrderDetailHandler(db:Pick<Pool,'query'>){
 return async(req:Request,res:Response)=>{
  const user=res.locals.user as {id:string;role:string};
  const result=await db.query("SELECT o.*,p.method payment_method,p.provider payment_provider,p.status payment_status,p.amount payment_amount,(SELECT coalesce(sum(batch.price_snapshot),0)::text FROM orders batch WHERE batch.checkout_batch_id=o.checkout_batch_id) payment_subtotal,(p.amount-(SELECT coalesce(sum(batch.price_snapshot),0) FROM orders batch WHERE batch.checkout_batch_id=o.checkout_batch_id))::text payment_tax,CASE WHEN o.buyer_id=$2 THEN p.idempotency_key END payment_attempt_key,CASE WHEN o.buyer_id=$2 THEN r.rating END buyer_review_rating,p.confirmed_at payment_confirmed_at FROM orders o LEFT JOIN checkout_payments p ON p.checkout_batch_id=o.checkout_batch_id LEFT JOIN order_reviews r ON r.order_id=o.id WHERE o.id=$1 AND (o.buyer_id=$2 OR o.seller_id=$2 OR $3=true)",[req.params.id,user.id,user.role==='admin']);
  if(!result.rowCount)return res.status(404).json({error:'NOT_FOUND'});
  const row=result.rows[0],isBuyer=row.buyer_id===user.id,isSeller=row.seller_id===user.id;
  const order={...row,buyer_email_snapshot:isBuyer?row.buyer_email_snapshot:null,buyer_phone_snapshot:isBuyer||isSeller?row.buyer_phone_snapshot:null};
  const [events,deliverables]=await Promise.all([
   db.query("SELECT e.from_status,e.to_status,e.reason,e.created_at,u.display_name actor_name,CASE WHEN u.role='admin' THEN u.avatar_path END actor_avatar,(u.role='admin') actor_is_admin FROM order_events e JOIN users u ON u.id=e.actor_id WHERE e.order_id=$1 ORDER BY e.created_at",[req.params.id]),
   db.query('SELECT d.id,d.message,d.media_path,d.delivery_url,d.created_at,u.display_name seller_name FROM order_deliverables d JOIN users u ON u.id=d.seller_id WHERE d.order_id=$1 ORDER BY d.created_at',[req.params.id]),
  ]);
  res.json({order,events:events.rows,deliverables:deliverables.rows});
 };
}
