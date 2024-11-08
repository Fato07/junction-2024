export const logger = {
  error: (message: string, meta?: Record<string, any>) => {
    console.error(message, meta);
  },
  warn: (message: string, meta?: Record<string, any>) => {
    console.warn(message, meta);
  },
  info: (message: string, meta?: Record<string, any>) => {
    console.info(message, meta);
  }
};
