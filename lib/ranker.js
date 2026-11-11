// Ranking pipeline
//
//   stage 1  retrieval   TF-IDF vectors (with skills folded into canonical
//                        tokens) + cosine similarity, keep the top K
//   stage 2  rerank      passage-level matching: the JD is compared against
//                        each job / project block separately, recent blocks
//                        weigh more
//   stage 3  fit score   semantic 50% + experience 30% + skills 20%
//
// The project brief describes a bi-encoder + cross-encoder setup. Running
// transformer models in the browser (or on a free Vercel function) is too slow
// for a demo, so stage 1 and 2 use classic IR instead. The interfaces are the
// same, so swapping in real embeddings later only touches `embed()`.

import { findSkills, adjacency, SOFT_SKILLS } from './ontology.js';
import { redact } from './redact.js';

export const DEFAULT_WEIGHTS = { semantic: 0.5, experience: 0.3, skills: 0.2 };

const STOPWORDS = new Set(`
a about above after again against all am an and any are as at be because been before being below between both
but by can could did do does doing down during each few for from further had has have having here how i if in
into is it its itself just me more most my no nor not now of off on once only or other our out over own same
should so some such than that the their them then there these they this those through to too under until up
very was we were what when where which while who whom why will with you your yours will would also etc using
use used within across per via able strong good excellent knowledge experience years year work working worked
team role responsible responsibilities candidate job looking ideal including must required preferred plus
skills skill ability like well new based [candidate] [email] [phone] [address] [year] [profile_link]
`.trim().split(/\s+/));

function stem(w) {
  // a very small suffix stripper - enough to make "deployed"/"deploying"/"deployment" meet
  if (w.length <= 4) return w;
  return w
    .replace(/(ations?|ments?|ings?|ers?|ies|ied|ed|es|ly)$/, '')
    .replace(/s$/, '');
}

export function tokenize(text) {
  const tokens = [];
  // skills become a single canonical token each, so "GCP" and "Google Cloud" match
  for (const [skill, count] of findSkills(text)) {
    const tok = 'skill:' + skill.toLowerCase().replace(/\s+/g, '_');
    for (let i = 0; i < Math.min(count, 5); i++) tokens.push(tok);
  }
  const words = text.toLowerCase().match(/[a-z][a-z+#.]{1,}/g) || [];
  for (let w of words) {
    w = w.replace(/\.+$/, '');
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    tokens.push(stem(w));
  }
  return tokens;
}

class Vectorizer {
  constructor(docs) {
    this.df = new Map();
    this.n = docs.length;
    for (const toks of docs) for (const t of new Set(toks)) this.df.set(t, (this.df.get(t) || 0) + 1);
  }

  idf(t) {
    return Math.log((1 + this.n) / (1 + (this.df.get(t) || 0))) + 1;
  }

  vector(tokens) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * this.idf(t) * (t.startsWith('skill:') ? 1.6 : 1);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  }
}

export function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let dot = 0;
  for (const [t, w] of a) {
    const o = b.get(t);
    if (o) dot += w * o;
  }
  return dot;
}

// TF-IDF cosines between a short JD and a full resume rarely go above ~0.5,
// so squash them onto 0..1 in a way that keeps the ordering.
const squash = (x, k = 0.18) => x / (x + k);

function passages(candidate) {
  const blocks = candidate.experience.map((e, i) => ({
    text: [e.title, e.company, ...e.bullets].join(' '),
    // most recent job first in most resumes; older roles count a bit less
    weight: e.current ? 1 : Math.max(0.6, 1 - i * 0.12),
  }));
  if (!blocks.length) {
    // no parsed jobs (fresher resume) - fall back to paragraphs
    const paras = candidate.text.split(/\n(?=[A-Z•])/).filter((p) => p.length > 80);
    for (const p of paras.slice(0, 12)) blocks.push({ text: p, weight: 0.8 });
  }
  return blocks;
}

function experienceScore(have, need) {
  if (!need) return { score: 1, note: null };
  if (have >= need) return { score: 1, note: `${have} yrs vs ${need}+ required` };
  // exponential decay on the relative shortfall: 1 yr short of 5 is ~0.67,
  // 3 yrs short of 5 is ~0.30
  const gap = need - have;
  const score = Math.exp(-2 * (gap / need));
  return { score, note: `${have} yrs vs ${need}+ required (${gap.toFixed(1)} short)` };
}

function skillScore(candidate, job) {
  const explicit = new Set(candidate.skills.explicit);
  const evidenced = new Set(candidate.skills.evidenced || candidate.skills.explicit);
  const implied = new Set(candidate.skills.implied);
  const all = [...explicit, ...implied];

  const matched = [];
  const partial = [];
  const missing = [];

  const credit = (want) => {
    if (evidenced.has(want)) return { value: 1, via: want, kind: 'exact' };
    // only in the skills list, never used anywhere we can see
    if (explicit.has(want)) return { value: 0.75, via: want, kind: 'listed' };
    if (implied.has(want)) return { value: 0.85, via: want, kind: 'implied' };
    let best = { value: 0, via: null, kind: 'missing' };
    for (const have of all) {
      const a = adjacency(want, have) * (explicit.has(have) ? 1 : 0.8);
      if (a > best.value) best = { value: a, via: have, kind: 'adjacent' };
    }
    return best;
  };

  let got = 0;
  let possible = 0;
  const tally = (list, weight) => {
    for (const want of list) {
      const w = SOFT_SKILLS.has(want) ? weight * 0.5 : weight;
      const c = credit(want);
      possible += w;
      got += w * c.value;
      if (c.kind === 'exact' || c.kind === 'implied' || c.kind === 'listed') matched.push({ skill: want, kind: c.kind, weight });
      else if (c.kind === 'adjacent' && c.value >= 0.3) partial.push({ skill: want, via: c.via, credit: +c.value.toFixed(2), weight });
      else missing.push({ skill: want, weight });
    }
  };
  tally(job.must_have, 1);
  for (const group of job.any_of || []) {
    // one requirement, best option counts
    const options = group.map((want) => ({ want, c: credit(want) })).sort((a, b) => b.c.value - a.c.value);
    const { want, c } = options[0];
    possible += 1;
    got += c.value;
    const label = group.join(' / ');
    if (c.kind === 'exact' || c.kind === 'implied' || c.kind === 'listed') matched.push({ skill: want, kind: c.kind, weight: 1, group: label });
    else if (c.kind === 'adjacent' && c.value >= 0.3) partial.push({ skill: label, via: c.via, credit: +c.value.toFixed(2), weight: 1 });
    else missing.push({ skill: label, weight: 1 });
  }
  tally(job.nice_to_have, 0.5);

  // plain Jaccard, kept for reference / the report
  const jobSet = new Set([...job.must_have, ...(job.any_of || []).flat(), ...job.nice_to_have]);
  const candSet = new Set(all);
  const inter = [...jobSet].filter((s) => candSet.has(s)).length;
  const union = new Set([...jobSet, ...candSet]).size || 1;

  partial.sort((a, b) => b.weight - a.weight || b.credit - a.credit);
  return {
    score: possible ? got / possible : 0.5,
    jaccard: inter / union,
    matched,
    partial,
    missing,
  };
}

function skillYearGaps(candidate, job) {
  const gaps = [];
  for (const [skill, need] of Object.entries(job.skill_years || {})) {
    const have = candidate.skills.tenure_years[skill] || 0;
    if (have < need) gaps.push({ skill, have, need });
  }
  return gaps;
}

export function explain(result, job) {
  const c = result.candidate;
  const s = result.breakdown;
  const bullets = [];

  // 1. strongest evidence: required skills they actually used at work
  const strong = s.skills.matched
    .filter((m) => m.weight === 1)
    .map((m) => ({ ...m, years: c.skills.tenure_years[m.skill] || 0 }))
    .sort((a, b) => b.years - a.years);
  if (strong.length) {
    const top = strong.slice(0, 3).map((m) => (m.years >= 1 ? `${m.skill} (${m.years} yrs)` : m.skill));
    const of = job.must_have.length + (job.any_of || []).length;
    bullets.push(`Covers ${strong.length} of ${of} must-have skills, including ${listify(top)}.`);
  } else {
    bullets.push(`None of the must-have skills appear directly on the resume.`);
  }

  // 2. experience + best quantified achievement
  const exp = s.experience;
  const best = c.achievements[0];
  if (best) {
    bullets.push(`${c.total_years_experience} yrs of experience${job.min_years ? ` (role asks for ${job.min_years}+)` : ''}; shows measurable impact, e.g. "${trim(best.text, 110)}".`);
  } else {
    bullets.push(`${c.total_years_experience} yrs of experience${job.min_years ? ` (role asks for ${job.min_years}+)` : ''}; few quantified results on the resume.`);
  }

  // 3. the honest caveat
  const partial = s.skills.partial.filter((p) => p.weight === 1)[0];
  const missing = s.skills.missing.filter((m) => m.weight === 1).map((m) => m.skill);
  const yearGap = s.yearGaps[0];
  const stuffing = result.flags.find((f) => f.includes('keyword stuffing'));
  if (stuffing) {
    bullets.push(`Note: ${stuffing}.`);
  } else if (partial) {
    bullets.push(`Note: no direct ${partial.skill} experience, but adjacent expertise in ${partial.via} (${Math.round(partial.credit * 100)}% credit).`);
  } else if (missing.length) {
    bullets.push(`Note: missing ${listify(missing.slice(0, 3))}.`);
  } else if (yearGap) {
    bullets.push(`Note: ${yearGap.have} yrs of ${yearGap.skill} against ${yearGap.need}+ asked.`);
  } else if (exp.score < 1) {
    bullets.push(`Note: below the experience bar - ${exp.note}.`);
  } else if (result.flags.length) {
    bullets.push(`Note: ${result.flags[0]}.`);
  } else {
    bullets.push(`No significant gaps against the job description.`);
  }

  return bullets;
}

function listify(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function trim(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function outreachEmail(result, job, { company = 'our team', recruiter = 'Recruiting Team' } = {}) {
  const c = result.candidate;
  const first = (c.contact.name || 'there').split(' ')[0];
  const hook = c.achievements[0];
  const skills = result.breakdown.skills.matched.slice(0, 2).map((m) => m.skill);
  const lastJob = c.experience[0];

  const lines = [
    `Subject: ${job.title} at ${company}`,
    '',
    `Hi ${first},`,
    '',
    hook
      ? `I came across your profile and the line about how you ${lowerFirst(trim(hook.text.replace(/\.$/, ''), 140))} stood out.`
      : `I came across your profile${lastJob?.company ? ` and your work at ${lastJob.company}` : ''} and wanted to reach out.`,
    `We're hiring a ${job.title}${skills.length ? ` and the team leans heavily on ${listify(skills)}` : ''}, which looks like a close match for what you've been doing.`,
    '',
    `Would you be open to a 20-minute call this week? Happy to share more about the role and the team.`,
    '',
    `Best,`,
    recruiter,
  ];
  return lines.join('\n');
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function rankCandidates(candidates, job, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const topK = opts.topK || 100;
  const blind = opts.blind !== false;

  const redacted = candidates.map((c) => (blind ? redact(c.text, c.contact) : { text: c.text, summary: {} }));
  const docTokens = redacted.map((r) => tokenize(r.text));
  const jobTokens = tokenize(job.text);
  const vec = new Vectorizer([jobTokens, ...docTokens]);
  const jobVec = vec.vector(jobTokens);

  // stage 1
  const stage1 = candidates
    .map((c, i) => ({ c, i, retrieval: cosine(jobVec, vec.vector(docTokens[i])) }))
    .sort((a, b) => b.retrieval - a.retrieval);
  const shortlist = stage1.slice(0, topK);

  // stage 2 + 3
  const results = shortlist.map(({ c, i, retrieval }) => {
    const blocks = passages({ ...c, text: redacted[i].text });
    let bestPassage = 0;
    let weighted = 0;
    let wsum = 0;
    for (const b of blocks) {
      const sim = cosine(jobVec, vec.vector(tokenize(blind ? redact(b.text, c.contact).text : b.text)));
      bestPassage = Math.max(bestPassage, sim * b.weight);
      weighted += sim * b.weight;
      wsum += b.weight;
    }
    const avgPassage = wsum ? weighted / wsum : 0;
    const rerank = 0.5 * retrieval + 0.3 * bestPassage + 0.2 * avgPassage;
    const semantic = squash(rerank);

    const exp = experienceScore(c.total_years_experience, job.min_years);
    const skills = skillScore(c, job);
    const yearGaps = skillYearGaps(c, job);

    const flags = [];
    if (job.degree_rank && c.education.degree_rank && c.education.degree_rank < job.degree_rank) {
      flags.push(`degree below requirement (${c.education.degree_level} vs ${job.degree_required})`);
    }
    if (!c.education.degree_level && job.degree_rank) flags.push('could not find a degree on the resume');
    const listedOnly = c.skills.listed_only || [];
    if (listedOnly.length >= 6 && listedOnly.length / (c.skills.explicit.length || 1) > 0.5) {
      flags.push(`${listedOnly.length} skills are listed but never used in any job or project (possible keyword stuffing)`);
    }
    if (c.quantified_ratio >= 0.35) flags.push('high density of quantified achievements');
    if (c.experience.some((e) => e.junior) && c.experience.every((e) => e.junior)) flags.push('experience is internships / short projects only');

    const fit = 100 * (weights.semantic * semantic + weights.experience * exp.score + weights.skills * skills.score);
    const total = weights.semantic + weights.experience + weights.skills || 1;

    return {
      candidate: c,
      redacted: redacted[i],
      fit: Math.round((fit / total) * 10) / 10,
      breakdown: {
        retrieval: +retrieval.toFixed(3),
        rerank: +rerank.toFixed(3),
        semantic: +semantic.toFixed(3),
        experience: { score: +exp.score.toFixed(3), note: exp.note },
        skills,
        yearGaps,
      },
      flags,
    };
  });

  results.sort((a, b) => b.fit - a.fit);
  results.forEach((r, i) => {
    r.rank = i + 1;
    r.explanation = explain(r, job);
  });
  return results;
}

// "Find me more people like this one": nearest neighbours of a reference
// candidate, using the same vector space.
export function lookAlike(reference, pool) {
  const docs = [reference, ...pool].map((c) => tokenize(redact(c.text, c.contact).text));
  const vec = new Vectorizer(docs);
  const ref = vec.vector(docs[0]);
  return pool
    .map((c, i) => ({ candidate: c, similarity: +cosine(ref, vec.vector(docs[i + 1])).toFixed(3) }))
    .sort((a, b) => b.similarity - a.similarity);
}
