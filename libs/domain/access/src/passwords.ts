export const MIN_PASSWORD_LENGTH = 12;

export const PASSWORD_TOO_SHORT = `Use at least ${MIN_PASSWORD_LENGTH} characters`;

export const isLongEnoughPassword = (password: string) => password.length >= MIN_PASSWORD_LENGTH;
