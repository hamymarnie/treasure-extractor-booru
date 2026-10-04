'use strict';

const { randomUUID } = require('node:crypto');
const { extract } = require('./extractor');

class JobManager {
  constructor(extractor = extract) {
    this.extractor = extractor;
    this.jobs = new Map();
    this.active = null;
  }

  start(config) {
    if (this.active) {
      const error = new Error('A batch is already running. Wait for it to finish or cancel it.');
      error.status = 409;
      throw error;
    }
    while (this.jobs.size >= 50) this.jobs.delete(this.jobs.keys().next().value);
    const job = {
      id: randomUUID(),
      status: 'running',
      createdAt: new Date().toISOString(),
      config,
      downloaded: 0,
      failed: 0,
      skipped: 0,
      found: 0,
      processed: 0,
      bytes: 0,
      events: [],
      batchId: null,
      batchPath: null,
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    this.active = job;
    job.promise = Promise.resolve()
      .then(() =>
        this.extractor(config, {
          signal: job.controller.signal,
          onProgress: (event) => {
            for (const key of ['downloaded', 'failed', 'skipped', 'found', 'processed', 'bytes']) {
              if (event[key] !== undefined) job[key] = event[key];
            }
            if (event.id) job.batchId = event.id;
            if (event.batchPath) job.batchPath = event.batchPath;
            job.events.push({ ...event, time: new Date().toISOString() });
            if (job.events.length > 100) job.events.shift();
          },
        }),
      )
      .then((result) => {
        job.status = result.status;
        job.batchId = result.id;
        job.batchPath = result.batchPath;
      })
      .catch((error) => {
        job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
        job.error = error.message;
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        this.active = null;
      });
    return this.snapshot(job);
  }

  snapshot(job) {
    const { controller, promise, ...publicJob } = job;
    return publicJob;
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? this.snapshot(job) : null;
  }

  list() {
    return Array.from(this.jobs.values(), (job) => this.snapshot(job)).reverse();
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'running' || job.status === 'cancelling') {
      job.status = 'cancelling';
      job.controller.abort(new Error('Cancelled by user.'));
    }
    return this.snapshot(job);
  }

  async stop() {
    if (this.active) {
      this.cancel(this.active.id);
      await this.active.promise;
    }
  }
}

module.exports = { JobManager };
