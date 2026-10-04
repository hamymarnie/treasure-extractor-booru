'use strict';

// The booru library does not accept AbortSignal. Stop waiting immediately when
// cancelled or timed out; its already-started search may finish in the background.
function waitFor(promise, signal) {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', abort);
      });
  });
}

async function mapConcurrent(items, concurrency, callback, signal) {
  let next = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      await callback(items[index], index);
    }
  });
  // Always settle active workers before finalizing a manifest or throwing.
  const results = await Promise.allSettled(workers);
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  signal?.throwIfAborted();
}

module.exports = { waitFor, mapConcurrent };
