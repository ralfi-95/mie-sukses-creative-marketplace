import { describe, expect, it, vi } from 'vitest';
import { canRateOrder, saveOrderRating } from './ratings';
import { ratingSummary } from './format';

describe('rating UI contract',()=>{
 it('allows only a completed order buyer to rate',()=>{expect(canRateOrder('buyer','buyer','completed')).toBe(true);expect(canRateOrder('seller','buyer','completed')).toBe(false);expect(canRateOrder('buyer','buyer','paid')).toBe(false);});
 it('shows empty ratings separately from completed orders',()=>{expect(ratingSummary(null,0,7)).toEqual({rating:'No ratings yet',completed:'7 completed orders'});expect(ratingSummary(4.25,2,3).rating).toBe('4.3 · 2 reviews');});
 it('submits ratings through the existing upsert endpoint',async()=>{const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({review:{rating:5}}),{status:200,headers:{'Content-Type':'application/json'}}));await saveOrderRating('order-1',5);expect(fetchMock).toHaveBeenCalledWith('/api/orders/order-1/review',expect.objectContaining({method:'PUT',body:'{"rating":5}'}));fetchMock.mockRestore();});
});
