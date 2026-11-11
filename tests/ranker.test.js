import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResume, parseJob } from '../lib/parser.js';
import { rankCandidates, lookAlike, outreachEmail } from '../lib/ranker.js';
import { SAMPLE_JD, SAMPLE_RESUMES } from '../lib/samples.js';

const today = new Date('2026-11-09');
const job = parseJob(SAMPLE_JD);
const people = SAMPLE_RESUMES.map((r) => parseResume(r.text, { fileName: r.name, today }));
const byName = (results, n) => results.find((r) => r.candidate.contact.name.startsWith(n));

test('scores are bounded and sorted', () => {
  const res = rankCandidates(people, job);
  assert.equal(res.length, people.length);
  for (let i = 0; i < res.length; i++) {
    assert.ok(res[i].fit >= 0 && res[i].fit <= 100);
    assert.equal(res[i].rank, i + 1);
    if (i) assert.ok(res[i - 1].fit >= res[i].fit);
    assert.equal(res[i].explanation.length, 3);
  }
});

test('relevant senior profiles beat unrelated ones', () => {
  const res = rankCandidates(people, job);
  const top4 = res.slice(0, 4).map((r) => r.candidate.contact.name.split(' ')[0]).sort();
  assert.deepEqual(top4, ['Arjun', 'Fatima', 'Priya', 'Rahul']);
  assert.equal(res[res.length - 1].candidate.contact.name, 'Vikram Singh');
});

test('keyword stuffing does not win', () => {
  const res = rankCandidates(people, job);
  const karan = byName(res, 'Karan');
  assert.ok(karan.rank > 4);
  assert.ok(karan.flags.some((f) => f.includes('keyword stuffing')));
});

test('adjacent cloud experience gets partial credit, not zero', () => {
  const res = rankCandidates(people, job);
  const priya = byName(res, 'Priya');
  const aws = priya.breakdown.skills.partial.find((p) => p.skill === 'AWS');
  assert.ok(aws, 'AWS should be a partial match');
  assert.equal(aws.via, 'Google Cloud');
  assert.ok(priya.explanation[2].includes('Google Cloud'));
});

test('weights change the order', () => {
  const expOnly = rankCandidates(people, job, { weights: { semantic: 0, experience: 1, skills: 0 } });
  assert.equal(byName(expOnly, 'Sneha').fit, 100);
  const def = rankCandidates(people, job);
  assert.ok(byName(def, 'Sneha').fit < 60);
});

test('blind mode keeps names out of the scored text', () => {
  const res = rankCandidates(people, job, { blind: true });
  for (const r of res) {
    const first = r.candidate.contact.name.split(' ')[0];
    assert.ok(!r.redacted.text.includes(first), `${first} leaked into redacted text`);
  }
});

test('look-alikes and outreach', () => {
  const rahul = people.find((p) => p.contact.name === 'Rahul Verma');
  const sims = lookAlike(rahul, people.filter((p) => p !== rahul));
  assert.notEqual(sims[0].candidate.contact.name, 'Vikram Singh');
  const res = rankCandidates(people, job);
  const mail = outreachEmail(res[0], job);
  assert.ok(mail.startsWith('Subject:'));
  assert.ok(mail.includes('Hi Rahul'));
});
