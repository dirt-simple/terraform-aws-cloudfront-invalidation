export const log = process.env.NODE_ENV === "test" ? () => {} : console.log;

export function logWarning(warning) {
  const qualifiedWarning = `[WARNING]: ${warning}`;
  log(qualifiedWarning);
}

export function logRetry(message, params) {
  log(`[RETRY]: ${message}`, params);
}
