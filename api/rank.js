// POST /api/rank
// body: {
//   "job": "<job description text>",
//   "resumes": [{ "name": "a.pdf", "text": "..." }, ...],
//   "weights": { "semantic": 0.5, "experience": 0.3, "skills": 0.2 },   (optional)
//   "blind": true                                                       (optional)
// }

import { allowCors, readBody, fail, slimCandidate } from './_utils.js';
import { parseResume, parseJob } from '../lib/parser.js';
import { rankCandidates } from '../lib/ranker.js';

const MAX_RESUMES = 200;

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 405, 'Use POST');

  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(res, 400, 'Body must be valid JSON');
  }

  const { job: jobText, resumes, weights, blind = true } = body;
  if (!jobText) return fail(res, 400, 'Missing "job"');
  if (!Array.isArray(resumes) || !resumes.length) return fail(res, 400, '"resumes" must be a non-empty array');
  if (resumes.length > MAX_RESUMES) return fail(res, 413, `At most ${MAX_RESUMES} resumes per request`);

  const started = Date.now();
  const job = parseJob(String(jobText));
  const candidates = resumes
    .filter((r) => r && typeof r.text === 'string' && r.text.trim())
    .map((r, i) => parseResume(r.text, { fileName: r.name || `resume_${i + 1}` }));

  const results = rankCandidates(candidates, job, { weights, blind });

  res.status(200).json({
    job: { ...job, text: undefined },
    took_ms: Date.now() - started,
    results: results.map((r) => ({
      rank: r.rank,
      fit_score: r.fit,
      candidate: slimCandidate(r.candidate),
      breakdown: r.breakdown,
      explanation: r.explanation,
      flags: r.flags,
    })),
  });
}
