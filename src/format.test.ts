import { describe, expect, it } from 'vitest';
import { formatRupiah, orderStatusLabel, paymentMethodLabel, roleLabel, signedRupiah, signedTransactionRupiah, statusTone, transactionMetadataLabel, transactionStatusLabel, transactionTypeLabel } from './format.js';

describe('shared UI labels and financial formatting',()=>{
 it('maps internal order and role values to readable labels',()=>{
  expect(orderStatusLabel('work_submitted')).toBe('Work Submitted');
  expect(orderStatusLabel('resolved')).toBe('Resolved');
  expect(roleLabel('buyer')).toBe('Customer');
  expect(roleLabel('seller')).toBe('Freelancer');
  expect(roleLabel('admin')).toBe('Admin');
 });
 it('formats payment methods and signed wallet events',()=>{
  expect(paymentMethodLabel('e_wallet','DANA')).toBe('E-Wallet · DANA');
  expect(signedRupiah(-50000)).toContain('−');
  expect(signedTransactionRupiah('order_payment',-50000)).toContain('−');
  expect(signedTransactionRupiah('refund',50000)).toContain('+');
  expect(signedTransactionRupiah('refund',-50000)).toContain('−');
 });
 it('formats Rupiah without a gap after the currency symbol',()=>{
  expect(formatRupiah(100000)).toBe('Rp100.000');
  expect(formatRupiah(10000)).toBe('Rp10.000');
  expect(formatRupiah(1500000n)).toBe('Rp1.500.000');
  expect(formatRupiah(0)).toBe('Rp0');
  expect(formatRupiah(-10000)).toBe('-Rp10.000');
 });
 it('maps ledger labels and transaction directions from signed amounts',()=>{
  expect(transactionTypeLabel('payout_reserved')).toBe('Payout Reserved');
  expect(transactionTypeLabel('order_earning')).toBe('Order Earning');
  expect(paymentMethodLabel('bank_transfer')).toBe('Bank Transfer');
  expect(signedTransactionRupiah('order_earning',50000)).toContain('+');
  expect(signedTransactionRupiah('top_up',-50000)).toContain('−');
 });
 it('assigns semantic status variants for the light and dark shared badge styles',()=>{
  expect(statusTone('pending')).toBe('warning');
  expect(statusTone('in_progress')).toBe('warning');
  expect(statusTone('paid')).toBe('success');
  expect(statusTone('approved')).toBe('success');
  expect(statusTone('completed')).toBe('success');
  expect(statusTone('resolved')).toBe('success');
  expect(statusTone('work_submitted')).toBe('success');
  expect(statusTone('approved')).toBe('success');
  expect(statusTone('pending')).toBe('warning');
  expect(statusTone('under_dispute')).toBe('warning');
  expect(statusTone('cancelled')).toBe('danger');
  expect(statusTone('rejected')).toBe('danger');
  expect(statusTone('refunded')).toBe('danger');
  expect(statusTone('awaiting_payment')).toBe('warning');
  expect(statusTone('reversed')).toBe('danger');
 });
 it('keeps payment state distinct and identifies confirmed refund events',()=>{
  expect(transactionStatusLabel('awaiting_payment','order_payment')).toBe('Payment · Awaiting Payment');
  expect(transactionStatusLabel('completed','refund')).toBe('Refunded · Completed');
 });
 it('joins transaction metadata with valid UTF-8 separators without altering values',()=>{
  const orderId='d25dd2b3-7001-4e8e-91cb-2274e7e1f6ca',checkoutId='6aa3a690-abdc-488b-b0fe-918126313824';
  expect(transactionMetadataLabel('Pencairan dana berhasil',`Order ${orderId}`,`Checkout ${checkoutId}`,transactionStatusLabel('pending'))).toBe(`Pencairan dana berhasil · Order ${orderId} · Checkout ${checkoutId} · Pending`);
  expect(transactionMetadataLabel('Withdrawal',transactionTypeLabel('top_up'))).toBe('Withdrawal · Top Up');
  expect(transactionMetadataLabel('30/10/2026, 14.43.26','completed')).toBe('30/10/2026, 14.43.26 · completed');
  const timestamp=new Date('2026-10-30T07:43:26.000Z').toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
  expect(transactionMetadataLabel(timestamp,'completed')).toBe(`${timestamp} · completed`);
  const userText='Pembayaran berhasil — terima kasih! 🎨';
  expect(transactionMetadataLabel(userText)).toBe(userText);
  expect(transactionMetadataLabel('Already correct · punctuation — 🎨')).toBe('Already correct · punctuation — 🎨');
  expect(transactionMetadataLabel(null,'Order metadata',undefined)).toBe('Order metadata');
 });
});
