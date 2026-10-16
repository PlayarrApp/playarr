import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const queueModuleUrl = process.argv[2]
  ? pathToFileURL(process.argv[2]).href
  : new URL('./overlay/src/main/ets/util/PreviewTelemetryQueue.ts', import.meta.url).href;
const queueModule = await import(queueModuleUrl);
const PreviewTelemetryQueue = queueModule.PreviewTelemetryQueue ?? queueModule.default?.PreviewTelemetryQueue;
assert.equal(typeof PreviewTelemetryQueue, 'function', 'production queue module must export PreviewTelemetryQueue');

const batchSize = 64;
const queueLimit = 65536;
const flushMs = 250;

function createHarness(send, queueMax = queueLimit) {
  const timers = new Map();
  const failures = [];
  let timerId = 0;
  const queue = new PreviewTelemetryQueue(
    send,
    (reason, pending) => failures.push({ reason, pending }),
    (callback, delayMs) => {
      assert.ok(delayMs === flushMs || delayMs === 100);
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    (id) => timers.delete(id),
    batchSize,
    queueMax,
    flushMs,
  );
  return {
    queue,
    failures,
    timers,
    flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
  };
}

function getEvent(index) {
  return { method: 'GET', path: '/state?dbg=' + index.toString(), body: '' };
}

function postEvent(index) {
  return { method: 'POST', path: '/detail-load', body: JSON.stringify({ marker: index }) };
}

async function settleMicrotasks() {
  for (let turn = 0; turn < 300; turn += 1) await Promise.resolve();
}

async function testBurstBeyondRegistryLimit() {
  const total = 8193;
  const delivered = [];
  let requests = 0;
  const h = createHarness(async (batch) => {
    requests += 1;
    delivered.push(...batch.map((event) => Number(new URLSearchParams(event.path.slice(event.path.indexOf('?') + 1)).get('dbg'))));
    return 204;
  });
  for (let index = 0; index < total; index += 1) h.queue.enqueue(getEvent(index));
  await settleMicrotasks();
  h.flush();
  await settleMicrotasks();
  assert.equal(delivered.length, total);
  assert.deepEqual(delivered, Array.from({ length: total }, (_, index) => index));
  assert.equal(requests, Math.ceil(total / batchSize));
  assert.ok(requests < 8192, 'one-shot handles stay below the native registry cap');
  assert.deepEqual(h.failures, []);
}

async function testPacedArrivalsUseTimerBoundedBatches() {
  const delivered = [];
  let requests = 0;
  const h = createHarness(async (batch) => {
    requests += 1;
    delivered.push(...batch.map((event) => event.path));
    return 204;
  });
  for (let tick = 0; tick < 40; tick += 1) {
    h.queue.enqueue(getEvent(tick));
    h.flush();
    await settleMicrotasks();
  }
  assert.equal(requests, 40);
  assert.deepEqual(delivered, Array.from({ length: 40 }, (_, index) => getEvent(index).path));
  assert.deepEqual(h.failures, []);
}

async function testEventsArrivingDuringSendRemainOrderedAndSerial() {
  const delivered = [];
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const firstRequest = new Promise((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  const h = createHarness(async (batch) => {
    requests += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    delivered.push(batch.map((event) => event.method + ':' + event.body).join('|'));
    if (requests === 1) await firstRequest;
    active -= 1;
    return 204;
  });
  const expected = [];
  for (let index = 0; index < batchSize; index += 1) {
    const event = index % 2 === 0 ? getEvent(index) : postEvent(index);
    h.queue.enqueue(event);
    expected.push(event.method + ':' + event.body);
  }
  assert.equal(requests, 1);
  const partial = getEvent(batchSize);
  h.queue.enqueue(partial);
  expected.push(partial.method + ':' + partial.body);
  await settleMicrotasks();
  assert.equal(requests, 1, 'underfilled arrivals wait for their 250ms flush while a send is active');
  releaseFirst(204);
  await settleMicrotasks();
  assert.equal(requests, 1, 'a completed send must not bypass the partial batch timer');
  assert.equal(h.timers.size, 1);
  h.flush();
  await settleMicrotasks();
  assert.equal(requests, 2);
  assert.equal(maxActive, 1);
  assert.deepEqual(delivered, [expected.slice(0, batchSize).join('|'), expected.slice(batchSize).join('|')]);
  assert.deepEqual(h.failures, []);
}

async function testTransientFailureReplaysSameBatchAndPreservesOrder() {
  let requests = 0;
  const seen = [];
  const delivered = [];
  const h = createHarness(async (batch, batchId) => {
    requests += 1;
    seen.push({ batchId, paths: batch.map((event) => event.path) });
    if (requests === 1) throw new Error('transport rejection');
    delivered.push(...batch.map((event) => event.path));
    return 204;
  });
  const events = Array.from({ length: batchSize }, (_, index) => getEvent(index));
  for (const event of events) h.queue.enqueue(event);
  await settleMicrotasks();
  h.flush();
  await settleMicrotasks();
  assert.equal(requests, 2);
  assert.deepEqual(h.failures, []);
  assert.deepEqual(seen[0], seen[1], 'a retry must preserve batch identity and payload');
  assert.deepEqual(delivered, events.map((event) => event.path));
}

async function testRetryExhaustionLatchesFatalOnce() {
  let requests = 0;
  const h = createHarness(async () => {
    requests += 1;
    throw new Error('transport rejection');
  });
  for (let index = 0; index < batchSize; index += 1) h.queue.enqueue(getEvent(index));
  await settleMicrotasks();
  h.flush();
  await settleMicrotasks();
  h.flush();
  await settleMicrotasks();
  assert.equal(requests, 3);
  assert.equal(h.failures.length, 1);
  assert.match(h.failures[0].reason, /failed/);
  assert.equal(h.failures[0].pending, batchSize);
}

async function testOverflowDuringInflightFailurePreventsRetry() {
  let rejectFirst;
  let requests = 0;
  const firstRequest = new Promise((_, reject) => { rejectFirst = reject; });
  const h = createHarness(async () => {
    requests += 1;
    return firstRequest;
  }, batchSize);
  for (let index = 0; index < batchSize; index += 1) h.queue.enqueue(getEvent(index));
  assert.equal(requests, 1);
  h.queue.enqueue(getEvent(batchSize));
  assert.equal(h.failures.length, 1);
  assert.match(h.failures[0].reason, /queue limit/);
  rejectFirst(new Error('transport rejection'));
  await settleMicrotasks();
  assert.equal(requests, 1, 'a terminal overflow must prevent replay of an in-flight failed batch');
  assert.equal(h.failures.length, 1);
}

async function testQueueOverflowLatchesWithoutThrowingOrSending() {
  let requests = 0;
  const h = createHarness(async () => {
    requests += 1;
    return 204;
  }, 3);
  for (let index = 0; index < 5; index += 1) h.queue.enqueue(getEvent(index));
  h.flush();
  await settleMicrotasks();
  assert.equal(requests, 0);
  assert.equal(h.failures.length, 1);
  assert.match(h.failures[0].reason, /queue limit/);
  assert.equal(h.failures[0].pending, 4);
}

await testBurstBeyondRegistryLimit();
await testPacedArrivalsUseTimerBoundedBatches();
await testEventsArrivingDuringSendRemainOrderedAndSerial();
await testTransientFailureReplaysSameBatchAndPreservesOrder();
await testRetryExhaustionLatchesFatalOnce();
await testOverflowDuringInflightFailurePreventsRetry();
await testQueueOverflowLatchesWithoutThrowingOrSending();
console.log('Preview telemetry sender tests passed.');
