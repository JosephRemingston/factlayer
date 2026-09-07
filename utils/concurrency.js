// Runs mapper over items with at most `limit` in flight; results keep the input order.
const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

// In-process limiter: at most `limit` tasks run at once, the rest wait their turn in FIFO order.
const createLimiter = (limit) => {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= limit || !waiting.length) return;
    active += 1;
    const { task, resolve, reject } = waiting.shift();
    task().then(resolve, reject).finally(() => {
      active -= 1;
      next();
    });
  };
  return {
    run: (task) => new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    }),
    get pending() { return waiting.length; },
    get active() { return active; },
  };
};

export { mapWithConcurrency, createLimiter };
