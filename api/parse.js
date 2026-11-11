// POST /api/parse
// body: { "text": "<resume text>", "fileName": "optional.pdf" }
//   or: { "job": "<job description text>" }
//
// PDF/DOCX extraction happens in the browser, so this endpoint takes plain text.

import { allowCors, readBody, fail, slimCandidate } from './_utils.js';
import { parseResume, parseJob } from '../lib/parser.js';
import { redact } from '../lib/redact.js';

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

  if (body.job) {
    const { text, ...job } = parseJob(String(body.job));
    return res.status(200).json({ job });
  }

  if (!body.text || typeof body.text !== 'string') return fail(res, 400, 'Missing "text"');
  if (body.text.length > 60000) return fail(res, 413, 'Resume text is too long (60k chars max)');

  const candidate = parseResume(body.text, { fileName: body.fileName || '' });
  const blind = redact(candidate.text, candidate.contact);
  res.status(200).json({ candidate: slimCandidate(candidate), redaction: blind.summary });
}
