export function canRateOrder(userId:string|undefined,buyerId:string,status:string){return !!userId&&userId===buyerId&&status==='completed';}

export async function saveOrderRating(orderId:string,rating:number){
 if(!Number.isInteger(rating)||rating<1||rating>5)throw new Error('Choose a rating from 1 to 5 stars.');
 const response=await fetch(`/api/orders/${orderId}/review`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating})});
 if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||result.error||'Rating could not be saved.');}
 return response.json();
}
