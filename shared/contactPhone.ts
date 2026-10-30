export function normalizePhone(value: string): string {
  const input = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(input)) throw new Error('Enter a valid Indonesian phone number.');
  let digits = input.replace(/\D/g, '');
  if (input.startsWith('+')) {
    if (!digits.startsWith('62')) throw new Error('Use the Indonesian country code +62.');
    digits = digits.slice(2);
  } else {
    if (digits.startsWith('00')) digits = digits.slice(2);
    while (digits.startsWith('62')) digits = digits.slice(2);
  }
  if (digits.startsWith('0')) digits = digits.slice(1);
  while (digits.startsWith('62')) digits = digits.slice(2);
  if (digits.length < 6 || digits.length > 11) throw new Error('Enter 6 to 11 digits after +62.');
  return `+62${digits}`;
}

export function isValidPhone(value: string): boolean {
  try { normalizePhone(value); return true; } catch { return false; }
}

export function formatPhoneInput(value: string): string {
  const input = value.trim();
  if (!input) return '+62 ';
  if (!/^\+?[0-9 ()-]+$/.test(input) || (input.startsWith('+') && !input.startsWith('+62'))) return value;
  let digits = input.replace(/\D/g, '');
  if (input.startsWith('+')) digits = digits.slice(2);
  else {
    if (digits.startsWith('00')) digits = digits.slice(2);
    while (digits.startsWith('62')) digits = digits.slice(2);
  }
  if (digits.startsWith('0')) digits = digits.slice(1);
  while (digits.startsWith('62')) digits = digits.slice(2);
  return `+62 ${digits}`;
}
