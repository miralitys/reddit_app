function createLogger({ component }) {
  function log(level, message, meta = {}) {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...meta,
    };

    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    sink(JSON.stringify(record));
  }

  return {
    info(message, meta) {
      log("info", message, meta);
    },
    warn(message, meta) {
      log("warn", message, meta);
    },
    error(message, meta) {
      log("error", message, meta);
    },
  };
}

module.exports = {
  createLogger,
};
