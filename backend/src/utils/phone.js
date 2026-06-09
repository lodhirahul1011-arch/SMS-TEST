export function normalizeIndianMobile(input = '') {
  const digits = String(input).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function isValidIndianSmsNumber(number = '') {
  return /^91[6-9]\d{9}$/.test(number);
}
