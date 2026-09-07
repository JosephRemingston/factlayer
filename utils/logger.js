const ts = () => new Date().toISOString();

const logger = {
  info: (...a) => console.log(`[${ts()}] [info]`, ...a),
  warn: (...a) => console.warn(`[${ts()}] [warn]`, ...a),
  error: (...a) => console.error(`[${ts()}] [error]`, ...a),
  debug: (...a) => {
    if (process.env.NODE_ENV !== "production") console.log(`[${ts()}] [debug]`, ...a);
  },
};

export default logger;
