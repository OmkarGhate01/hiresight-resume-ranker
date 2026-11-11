import { test } from 'node:test';
import assert from 'node:assert/strict';
import rank from '../api/rank.js';
import parse from '../api/parse.js';
import health from '../api/health.js';
import { SAMPLE_JD, SAMPLE_RESUMES } from '../lib/samples.js';

// tiny stand-in for Vercel's req/res
function call(handler, { method = 'POST', body } = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); },
      end() { resolve({ status: this.statusCode }); },
    };
    handler({ method, body }, res);
  });
}

test('GET /api/health', async () => {
  const { status, data } = await call(health, { method: 'GET' });
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
});

test('POST /api/rank', async () => {
  const { status, data } = await call(rank, { body: { job: SAMPLE_JD, resumes: SAMPLE_RESUMES } });
  assert.equal(status, 200);
  assert.equal(data.results.length, SAMPLE_RESUMES.length);
  assert.equal(data.results[0].rank, 1);
  assert.equal(data.results[0].candidate.text, undefined);
});

test('POST /api/rank validates input', async () => {
  assert.equal((await call(rank, { body: { resumes: [] } })).status, 400);
  assert.equal((await call(rank, { method: 'GET' })).status, 405);
});

test('POST /api/parse', async () => {
  const { status, data } = await call(parse, { body: { text: SAMPLE_RESUMES[0].text } });
  assert.equal(status, 200);
  assert.equal(data.candidate.contact.name, 'Priya Sharma');
  const jd = await call(parse, { body: { job: SAMPLE_JD } });
  assert.equal(jd.data.job.min_years, 5);
});
