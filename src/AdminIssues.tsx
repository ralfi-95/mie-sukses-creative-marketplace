import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { confirmAction } from './FinalFeatures';
import { formatRupiah as money, orderStatusLabel } from './format';
import { StatusBadge } from './StatusBadge';

const typeLabel=(t:string)=>t==='refund_request'?'Refund complaint':t==='payment_claim'?'Payment complaint':'Seller rejection';
async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch(`/api${path}`,{credentials:'include',...options,headers:{'Content-Type':'application/json',...options.headers}});if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||result.error||'Request failed.');}return response.json();}

export function AdminIssueCenter(){
 const [rows,setRows]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
 const load=()=>api<{issues:any[]}>('/admin/issues').then(r=>setRows(r.issues)).catch(e=>setError(e.message));
 useEffect(()=>{void load();},[]);
 const groups=useMemo(()=>Object.values(rows.reduce((all:any,row:any)=>{(all[row.order_id]??=[]).push(row);return all;},{} as Record<string,any[]>)) as any[][],[rows]);
 const resolve=async(group:any[],decision:string,label:string)=>{if(!await confirmAction(`${label} for order ${group[0].title_snapshot}? The decision cannot be reversed.`))return;setBusy(true);setError('');try{await api(`/admin/issues/${group[0].id}/resolve`,{method:'POST',body:JSON.stringify({decision})});await load();}catch(e){setError(e instanceof Error?e.message:'Resolution failed.');}finally{setBusy(false);}};
 return <div className="page"><span className="eyebrow">AUTHORIZED ADJUDICATION</span><h1>Order Issues</h1><nav className="admin-issue-nav" aria-label="Admin issue sections"><Link className="button" aria-current="page" to="/admin/issues">Order Issues</Link><Link className="button outline" to="/admin/applications">Role Applications</Link></nav><label className="list-search">Search issues<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Service, order reference, or participant"/></label>{error&&<div className="alert" role="alert">{error}</div>}
  {groups.filter(group=>`${group[0].title_snapshot} ${group[0].order_id} ${group[0].buyer_name} ${group[0].seller_name} ${group.map(i=>i.reason).join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(group=>{const first=group[0],types=new Set(group.map(i=>i.issue_type)),conflicting=types.has('refund_request')&&types.has('payment_claim'),sellerOnly=types.has('payment_claim')&&!types.has('refund_request');return <article className="order issue-card" key={first.order_id}><div><StatusBadge status="under_dispute"/><h3>{first.title_snapshot} · {money(first.price_snapshot)}</h3><p>Customer {first.buyer_name} · Freelancer {first.seller_name}</p><p>Saved state: {first.pre_dispute_status==='paid'?'Paid':'Work Submitted'}</p>
   {group.map(issue=><section key={issue.id}><b>{typeLabel(issue.issue_type)} · {issue.claimant_name} ({issue.claimant_role==='buyer'?'Customer':issue.claimant_role==='seller'?'Freelancer':'Admin'})</b><p>{issue.reason}</p></section>)}<p>Current order status: {orderStatusLabel(first.order_status)}</p>
   {first.deliverables?.map((d:any)=><p key={d.created_at}>{d.delivery_url&&<a href={d.delivery_url} target="_blank" rel="noreferrer">Open delivery URL</a>}{d.media_path&&<a href={d.media_path}>Download report</a>}</p>)}
   <small>Payment {first.payment_status==='simulated'?'Simulated':first.payment_status} · {first.payment_method||'Method unavailable'}{first.provider&&` · ${first.provider}`}</small><p><Link to={`/orders/${first.order_id}`}>Review order details</Link></p></div><div className="orderactions">
   {conflicting?<><button className="button small" disabled={busy} onClick={()=>void resolve(group,'approve_seller','Approve Seller')}>Approve Seller</button><button className="button outline small" disabled={busy} onClick={()=>void resolve(group,'approve_buyer','Approve Buyer')}>Approve Buyer</button></>:sellerOnly?<button className="button small" disabled={busy} onClick={()=>void resolve(group,'approve_payment','Approve Payment')}>Approve Payment</button>:<button className="button small" disabled={busy} onClick={()=>void resolve(group,'approve_refund','Approve Refund')}>Approve Refund</button>}
   <button className="button danger small" disabled={busy} onClick={()=>void resolve(group,'reject','Reject')}>Reject</button></div></article>;})}
  {!groups.length&&!error&&<div className="empty">No open issues.</div>}
 </div>;
}
