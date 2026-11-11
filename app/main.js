import { extractText } from './extract.js';
import { parseResume, parseJob } from '../lib/parser.js';
import { rankCandidates, outreachEmail, lookAlike, DEFAULT_WEIGHTS } from '../lib/ranker.js';
import { redact } from '../lib/redact.js';
import { SAMPLE_JD, SAMPLE_RESUMES } from '../lib/samples.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  files: [], // { id, name, status: 'busy'|'ok'|'error', candidate, meta, error }
  job: null,
  results: [],
  decisions: loadDecisions(), // candidate_id -> 'shortlisted' | 'rejected'
  filter: 'all',
  lastRunMs: 0,
};

let nextId = 1;

// ---------- small helpers ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function loadDecisions() {
  try {
    return JSON.parse(localStorage.getItem('hiresight.decisions') || '{}');
  } catch {
    return {};
  }
}

function saveDecisions() {
  try {
    localStorage.setItem('hiresight.decisions', JSON.stringify(state.decisions));
  } catch {
    /* storage can be blocked, nothing to do */
  }
}

function scoreColor(v) {
  if (v >= 70) return '#0f766e';
  if (v >= 50) return '#ca8a04';
  return '#b91c1c';
}

function download(name, content, type) {
  try {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    copy(content, 'Download blocked here - copied to clipboard instead');
  }
}

async function copy(text, okMsg = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast('Could not copy - select the text and copy it manually');
  }
}

// ---------- job description ----------

const jdInput = $('#jd');
let jdTimer;
jdInput.addEventListener('input', () => {
  clearTimeout(jdTimer);
  jdTimer = setTimeout(updateJob, 250);
});

function updateJob() {
  const text = jdInput.value.trim();
  state.job = text.length > 30 ? parseJob(text) : null;
  renderJobSummary();
  updateRankButton();
}

function renderJobSummary() {
  const box = $('#jd-summary');
  const job = state.job;
  if (!job) {
    box.hidden = true;
    return;
  }
  const chips = (list, cls) => list.map((s) => `<span class="chip ${cls}">${esc(s)}</span>`).join('');
  const anyOf = (job.any_of || []).map((g) => `<span class="chip soft">${esc(g.join(' or '))}</span>`).join('');
  box.innerHTML = `
    <div class="row"><span class="label">Role</span><strong>${esc(job.title)}</strong></div>
    <div class="row"><span class="label">Must have</span>${chips(job.must_have, 'soft') + anyOf || '<em>none detected</em>'}</div>
    ${job.nice_to_have.length ? `<div class="row"><span class="label">Nice to have</span>${chips(job.nice_to_have, '')}</div>` : ''}
    <div class="row"><span class="label">Experience</span>${job.min_years ? `${job.min_years}+ years` : 'not specified'}
      ${job.degree_required ? ` · ${esc(job.degree_required)} degree` : ''}</div>`;
  box.hidden = false;
}

// ---------- files ----------

const dropzone = $('#dropzone');
const fileInput = $('#file-input');

fileInput.addEventListener('change', () => {
  addFiles([...fileInput.files]);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  })
);
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('over')));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles([...e.dataTransfer.files]);
});

async function addFiles(files) {
  const entries = files.map((f) => ({ id: nextId++, name: f.name, status: 'busy', file: f }));
  state.files.push(...entries);
  renderFiles();

  // parse a few at a time so a 200-file drop doesn't freeze the tab
  const queue = [...entries];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      try {
        const { text, meta } = await extractText(entry.file);
        entry.candidate = parseResume(text, { fileName: entry.name });
        entry.meta = meta;
        entry.status = 'ok';
      } catch (err) {
        console.warn(entry.name, err);
        entry.status = 'error';
        entry.error = err.message || 'Could not read file';
      }
      delete entry.file;
      renderFiles();
    }
  });
  await Promise.all(workers);
  updateRankButton();
}

function addTextResumes(list) {
  for (const r of list) {
    state.files.push({
      id: nextId++,
      name: r.name,
      status: 'ok',
      candidate: parseResume(r.text, { fileName: r.name }),
      meta: { sample: true },
    });
  }
  renderFiles();
  updateRankButton();
}

function renderFiles() {
  const list = $('#file-list');
  list.innerHTML = state.files
    .map((f) => {
      let meta = '';
      if (f.status === 'ok') {
        const c = f.candidate;
        const bits = [`${c.total_years_experience} yrs`, `${c.skills.explicit.length} skills`];
        if (f.meta?.columns === 2) bits.push('2-col');
        meta = `<span class="fmeta">${bits.join(' · ')}</span>`;
      } else if (f.status === 'busy') {
        meta = '<span class="fmeta">reading…</span>';
      }
      return `<li>
        <span class="dot ${f.status}"></span>
        <span class="fname" title="${esc(f.name)}">${esc(f.name)}${f.error ? `<br><span class="err">${esc(f.error)}</span>` : ''}</span>
        ${meta}
        <button type="button" data-remove="${f.id}" aria-label="Remove ${esc(f.name)}">✕</button>
      </li>`;
    })
    .join('');
  $('#clear-files').hidden = !state.files.length;
}

$('#file-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-remove]')?.dataset.remove;
  if (!id) return;
  state.files = state.files.filter((f) => f.id !== +id);
  renderFiles();
  updateRankButton();
});

$('#clear-files').addEventListener('click', () => {
  state.files = [];
  renderFiles();
  updateRankButton();
});

// ---------- weights ----------

const weightInputs = ['semantic', 'experience', 'skills'].map((k) => [k, $(`#w-${k}`)]);

function readWeights() {
  const raw = Object.fromEntries(weightInputs.map(([k, el]) => [k, +el.value]));
  const sum = raw.semantic + raw.experience + raw.skills || 1;
  for (const [k] of weightInputs) $(`#w-${k}-out`).textContent = Math.round((raw[k] / sum) * 100) + '%';
  return { semantic: raw.semantic / sum, experience: raw.experience / sum, skills: raw.skills / sum };
}

for (const [, el] of weightInputs) {
  el.addEventListener('input', () => {
    readWeights();
    if (state.results.length) runRanking();
  });
}

$('#reset-weights').addEventListener('click', () => {
  for (const [k, el] of weightInputs) el.value = Math.round(DEFAULT_WEIGHTS[k] * 100);
  readWeights();
  if (state.results.length) runRanking();
});

$('#blind').addEventListener('change', () => {
  if (state.results.length) runRanking();
});

// ---------- ranking ----------

function readyCandidates() {
  return state.files.filter((f) => f.status === 'ok').map((f) => f.candidate);
}

function updateRankButton() {
  const n = readyCandidates().length;
  const busy = state.files.some((f) => f.status === 'busy');
  const btn = $('#rank-btn');
  btn.disabled = !state.job || !n || busy;
  btn.textContent = n ? `Rank ${n} candidate${n > 1 ? 's' : ''}` : 'Rank candidates';
  $('#rank-hint').textContent = busy
    ? 'Still reading files…'
    : !state.job
      ? 'Add a job description (a few lines at least).'
      : !n
        ? 'Add at least one resume.'
        : 'Scores update live when you change the weights.';
}

$('#rank-btn').addEventListener('click', runRanking);

function runRanking() {
  if (!state.job) return;
  const t0 = performance.now();
  state.results = rankCandidates(readyCandidates(), state.job, {
    weights: readWeights(),
    blind: $('#blind').checked,
  });
  state.lastRunMs = Math.round(performance.now() - t0);
  renderResults();
}

function displayName(c, i) {
  if ($('#blind').checked) return `Candidate ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`;
  return c.contact.name || c.file_name || c.candidate_id;
}

// stable labels in blind mode: based on upload order, not on rank
function blindIndex(c) {
  return readyCandidates().indexOf(c);
}

function renderResults() {
  $('#empty').hidden = true;
  $('#results-wrap').hidden = false;

  const r = state.results;
  const avg = r.length ? r.reduce((s, x) => s + x.fit, 0) / r.length : 0;
  const strong = r.filter((x) => x.fit >= 70).length;
  $('#stats').innerHTML = [
    [r.length, 'candidates ranked'],
    [r[0] ? r[0].fit.toFixed(0) : '–', 'top fit score'],
    [avg.toFixed(0), 'average fit'],
    [strong, 'strong matches (70+)'],
  ]
    .map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`)
    .join('');

  const visible = r.filter((x) => state.filter === 'all' || state.decisions[x.candidate.candidate_id] === state.filter);
  $('#results').innerHTML = visible.length
    ? visible.map(renderCard).join('')
    : `<li class="card" style="display:block;color:var(--ink-3)">Nothing here yet.</li>`;
  renderFeedback();
}

function renderCard(res) {
  const c = res.candidate;
  const b = res.breakdown;
  const decision = state.decisions[c.candidate_id] || '';
  const circumference = 2 * Math.PI * 33;
  const latest = c.experience[0];
  const sub = latest ? `${latest.title || 'Role'}${latest.company ? ' · ' + latest.company : ''}` : c.education.degree_level || '';

  const matched = b.skills.matched
    .map((m) => `<span class="chip good" title="${m.kind === 'implied' ? 'inferred from related skills' : m.kind === 'listed' ? 'only in the skills list' : 'found in work history'}">${esc(m.skill)}${m.kind === 'implied' ? ' <small>inferred</small>' : ''}</span>`)
    .join('');
  const partial = b.skills.partial
    .map((p) => `<span class="chip warn" title="${Math.round(p.credit * 100)}% credit">${esc(p.skill)} <small>via ${esc(p.via)}</small></span>`)
    .join('');
  const missing = b.skills.missing.map((m) => `<span class="chip bad">${esc(m.skill)}</span>`).join('');

  const flags = res.flags.map((f) => `<span class="chip ${/stuffing|below|could not|only/.test(f) ? 'warn' : 'soft'}">${esc(f)}</span>`).join('');

  const bar = (label, v) => `
    <div class="bar">
      <div class="k"><span>${label}</span><b>${Math.round(v * 100)}</b></div>
      <div class="track"><div class="fill" style="width:${Math.round(v * 100)}%"></div></div>
    </div>`;

  return `<li class="card ${decision}" data-id="${c.candidate_id}">
    <div>
      <div class="score">
        <svg viewBox="0 0 76 76"><circle class="track" cx="38" cy="38" r="33"/><circle class="value" cx="38" cy="38" r="33"
          stroke="${scoreColor(res.fit)}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - res.fit / 100)}"/></svg>
        <span class="num">${Math.round(res.fit)}</span>
      </div>
      <span class="rank">#${res.rank}</span>
    </div>
    <div>
      <div class="card-head">
        <h3>${esc(displayName(c, blindIndex(c)))}</h3>
        <span class="sub">${esc(sub)} · ${c.total_years_experience} yrs${c.education.degree_level ? ' · ' + esc(c.education.degree_level) : ''}</span>
        <span class="file">${$('#blind').checked ? esc(c.candidate_id) : esc(c.file_name)}</span>
      </div>
      <div class="bars">
        ${bar('Semantic', b.semantic)}
        ${bar('Experience', b.experience.score)}
        ${bar('Skills', b.skills.score)}
      </div>
      <div class="chips">${matched}${partial}${missing}</div>
      <div class="why">
        <p>Why ${Math.round(res.fit)}%</p>
        <ol>${res.explanation.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      </div>
      ${flags ? `<div class="flags">${flags}</div>` : ''}
      <div class="actions">
        <button class="ghost" data-action="details" type="button">Parsed data</button>
        <button class="ghost" data-action="email" type="button">Draft outreach</button>
        <button class="ghost" data-action="similar" type="button">Find look-alikes</button>
        <span class="spacer"></span>
        <button class="ghost accept ${decision === 'shortlisted' ? 'on' : ''}" data-action="shortlisted" type="button">✓ Shortlist</button>
        <button class="ghost reject ${decision === 'rejected' ? 'on' : ''}" data-action="rejected" type="button">✕ Reject</button>
      </div>
    </div>
  </li>`;
}

$('#results').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.card').dataset.id;
  const res = state.results.find((r) => r.candidate.candidate_id === id);
  if (!res) return;
  const action = btn.dataset.action;

  if (action === 'shortlisted' || action === 'rejected') {
    state.decisions[id] = state.decisions[id] === action ? undefined : action;
    if (!state.decisions[id]) delete state.decisions[id];
    saveDecisions();
    renderResults();
  } else if (action === 'details') showDetails(res);
  else if (action === 'email') showEmail(res);
  else if (action === 'similar') showLookAlikes(res);
});

$$('.chip-btn').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.chip-btn').forEach((x) => x.classList.toggle('active', x === b));
    state.filter = b.dataset.filter;
    renderResults();
  })
);

// ---------- feedback loop ----------
// If recruiters keep rejecting people the model scored highly (or shortlisting
// low scorers), the weights are probably off for this role. We only suggest
// - nothing changes without the recruiter moving a slider.

function renderFeedback() {
  const box = $('#feedback');
  const decided = state.results.filter((r) => state.decisions[r.candidate.candidate_id]);
  if (!decided.length) {
    box.innerHTML = `<h4>Recruiter feedback</h4><p>Shortlist or reject a few candidates and HireSight will check whether its ranking agrees with you.</p>`;
    return;
  }
  const acc = decided.filter((r) => state.decisions[r.candidate.candidate_id] === 'shortlisted');
  const rej = decided.filter((r) => state.decisions[r.candidate.candidate_id] === 'rejected');
  const mean = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);

  const highRejected = rej.filter((r) => r.fit >= 65);
  const lowAccepted = acc.filter((r) => r.fit < 50);
  let suggestion = '';
  if (highRejected.length >= 2 || lowAccepted.length >= 2) {
    // which component separates the two groups best?
    const parts = {
      semantic: (r) => r.breakdown.semantic,
      experience: (r) => r.breakdown.experience.score,
      skills: (r) => r.breakdown.skills.score,
    };
    const gaps = Object.entries(parts)
      .map(([k, f]) => [k, (mean(acc, f) ?? 0.5) - (mean(rej, f) ?? 0.5)])
      .sort((a, b) => b[1] - a[1]);
    const [up] = gaps[0];
    const [down] = gaps[gaps.length - 1];
    suggestion = `<div class="suggest">Your decisions disagree with the model on ${highRejected.length + lowAccepted.length} candidates. The people you shortlist stand out most on <b>${up}</b> and least on <b>${down}</b> - try raising the ${up} weight and lowering ${down}.</div>`;
  }

  box.innerHTML = `<h4>Recruiter feedback</h4>
    <p>${acc.length} shortlisted (avg fit ${mean(acc, (r) => r.fit)?.toFixed(0) ?? '–'}) · ${rej.length} rejected (avg fit ${mean(rej, (r) => r.fit)?.toFixed(0) ?? '–'})</p>
    ${suggestion}`;
}

// ---------- modals ----------

const modal = $('#modal');

function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  modal.showModal();
  $('#modal-body').scrollTop = 0;
}

$$('[data-open]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById(a.dataset.open).showModal();
  })
);

// close any dialog when clicking the backdrop
$$('dialog').forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  })
);

function publicJson(c) {
  const { text, ...rest } = c;
  return rest;
}

function showDetails(res) {
  const c = res.candidate;
  const blind = $('#blind').checked;
  const json = JSON.stringify(publicJson(c), null, 2);
  const blinded = redact(c.text, c.contact);
  const redacted = blinded.text;
  const redSummary = Object.entries(blinded.summary)
    .map(([k, v]) => `<span class="chip soft">${esc(k)} × ${v}</span>`)
    .join('');

  openModal(blind ? c.candidate_id : c.contact.name || c.file_name, `
    <div class="tabs" role="tablist">
      <button class="active" data-tab="overview" type="button">Overview</button>
      <button data-tab="json" type="button">JSON</button>
      <button data-tab="blind" type="button">Blind view</button>
      <button data-tab="raw" type="button">Extracted text</button>
    </div>
    <div data-pane="overview">
      <dl class="kv">
        <dt>Total experience</dt><dd>${c.total_years_experience} yrs ${c.stated_years ? `(resume says ${c.stated_years})` : ''}</dd>
        <dt>Education</dt><dd>${esc([c.education.degree_level, c.education.major].filter(Boolean).join(', ') || '–')}</dd>
        <dt>Skills (explicit)</dt><dd><div class="chips">${c.skills.explicit.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div></dd>
        <dt>Skills (inferred)</dt><dd><div class="chips">${c.skills.implied.map((s) => `<span class="chip soft">${esc(s)}</span>`).join('') || '–'}</div></dd>
        <dt>Quantified bullets</dt><dd>${c.achievements.length} (${Math.round(c.quantified_ratio * 100)}% of bullets)</dd>
        <dt>Scores</dt><dd>retrieval ${res.breakdown.retrieval} · rerank ${res.breakdown.rerank} · semantic ${res.breakdown.semantic} · skill Jaccard ${res.breakdown.skills.jaccard.toFixed(2)}</dd>
      </dl>
      ${c.experience.map((e) => `
        <div style="margin-bottom:12px">
          <strong>${esc(e.title)}</strong>${e.company ? ' · ' + esc(e.company) : ''}
          <span style="color:var(--ink-3)"> · ${esc(e.start)} → ${esc(e.end)} · ${e.duration_months} mo${e.junior ? ' · internship/short' : ''}</span>
          <div class="chips" style="margin-top:4px">${e.technologies_used.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
        </div>`).join('')}
    </div>
    <div data-pane="json" hidden>
      <pre>${esc(json)}</pre>
      <div class="modal-actions"><button class="ghost" data-copy="json" type="button">Copy JSON</button></div>
    </div>
    <div data-pane="blind" hidden>
      <div class="chips" style="margin-bottom:10px">${redSummary || '<span class="chip">nothing to redact</span>'}</div>
      <pre>${esc(redacted)}</pre>
    </div>
    <div data-pane="raw" hidden><pre>${esc(c.text)}</pre></div>
  `);

  const body = $('#modal-body');
  body.querySelectorAll('[data-tab]').forEach((t) =>
    t.addEventListener('click', () => {
      body.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === t));
      body.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
    })
  );
  body.querySelector('[data-copy]').addEventListener('click', () => copy(json, 'JSON copied'));
}

function showEmail(res) {
  const text = outreachEmail(res, state.job, { company: 'our company', recruiter: 'Talent Team' });
  const to = res.candidate.contact.email;
  openModal('Draft outreach email', `
    ${to ? `<p style="margin:0 0 8px;color:var(--ink-2)">To: ${esc(to)}</p>` : ''}
    <textarea class="email-box" id="email-text">${esc(text)}</textarea>
    <div class="modal-actions">
      <button class="ghost" id="copy-email" type="button">Copy</button>
    </div>
  `);
  $('#copy-email').addEventListener('click', () => copy($('#email-text').value, 'Email copied'));
}

function showLookAlikes(res) {
  const pool = readyCandidates().filter((c) => c !== res.candidate);
  if (!pool.length) {
    openModal('Look-alike candidates', '<p>Add more resumes to compare against.</p>');
    return;
  }
  const sims = lookAlike(res.candidate, pool).slice(0, 8);
  const max = sims[0]?.similarity || 1;
  openModal(`People similar to ${displayName(res.candidate, blindIndex(res.candidate))}`, `
    <p style="margin:0 0 12px;color:var(--ink-2)">Nearest neighbours by resume content, independent of the job description.</p>
    <ol class="lookalike">
      ${sims.map((s) => `<li>
        <span class="sim">${s.similarity.toFixed(2)}</span>
        <span class="meter"><span style="width:${Math.round((s.similarity / max) * 100)}%"></span></span>
        <span>${esc(displayName(s.candidate, blindIndex(s.candidate)))} <span style="color:var(--ink-3)">· ${esc(s.candidate.experience[0]?.title || '')}</span></span>
      </li>`).join('')}
    </ol>
  `);
}

// ---------- export ----------

$('#export-csv').addEventListener('click', () => {
  const blind = $('#blind').checked;
  const head = ['rank', 'candidate', 'fit_score', 'semantic', 'experience', 'skills', 'years', 'degree', 'matched_skills', 'missing_skills', 'decision', 'why'];
  const rows = state.results.map((r) => {
    const c = r.candidate;
    return [
      r.rank,
      blind ? c.candidate_id : c.contact.name || c.file_name,
      r.fit,
      r.breakdown.semantic,
      r.breakdown.experience.score,
      r.breakdown.skills.score.toFixed(3),
      c.total_years_experience,
      c.education.degree_level || '',
      r.breakdown.skills.matched.map((m) => m.skill).join('; '),
      r.breakdown.skills.missing.map((m) => m.skill).join('; '),
      state.decisions[c.candidate_id] || '',
      r.explanation.join(' | '),
    ];
  });
  const csv = [head, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  download('ranking.csv', csv, 'text/csv');
});

$('#export-json').addEventListener('click', () => {
  const payload = {
    job: { ...state.job, text: undefined },
    generated_at: new Date().toISOString(),
    results: state.results.map((r) => ({
      rank: r.rank,
      fit_score: r.fit,
      candidate: publicJson(r.candidate),
      breakdown: r.breakdown,
      explanation: r.explanation,
      flags: r.flags,
    })),
  };
  download('ranking.json', JSON.stringify(payload, null, 2), 'application/json');
});

// ---------- sample data ----------

function loadSample() {
  jdInput.value = SAMPLE_JD;
  updateJob();
  state.files = state.files.filter((f) => !f.meta?.sample);
  addTextResumes(SAMPLE_RESUMES);
  runRanking();
  toast('Loaded 8 sample resumes');
}

$('#load-sample').addEventListener('click', loadSample);
$('#empty-sample').addEventListener('click', loadSample);

readWeights();
updateRankButton();
