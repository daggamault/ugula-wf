const DAILY_NUMBER = /^#?(\d{8})-?(\d{4,9})$/;

export const dailyNumberOf = (text: string) => {
  const match = DAILY_NUMBER.exec(text.trim());
  return match ? `${match[1]}-${match[2]}` : null;
};

export const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

export const dollarsToCents = (dollars: number | string) => {
  const [digits = '', exponent = '0'] = String(dollars).trim().toLowerCase().split('e');
  const cents = Number(`${digits.replace('-', '')}e${Number(exponent) + 2}`);
  return Math.sign(Number(dollars)) * Math.round(cents);
};
