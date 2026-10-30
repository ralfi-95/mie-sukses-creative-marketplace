import { requestApi } from './apiResponse';

export function canRateOrder(userId:string|undefined,buyerId:string,status:string){return !!userId&&userId===buyerId&&status==='completed';}

export async function saveOrderRating(orderId:string,rating:number):Promise<unknown|undefined>{
 if(!Number.isInteger(rating)||rating<1||rating>5)throw new Error('Choose a rating from 1 to 5 stars.');
 return requestApi(`/orders/${orderId}/review`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating})},'Rating could not be saved.');
}
