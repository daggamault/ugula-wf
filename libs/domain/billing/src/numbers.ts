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
