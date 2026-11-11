# HireSight — Resume Parsing & Candidate Ranking

Internship project for **Persevex** (Data Science, 2026) by **Omkar Vijay Ghate**, Bajaj Degree College.

HireSight parses PDF / DOCX resumes into structured JSON and ranks candidates against a job description with a 0–100 fit score. Every score comes with three bullet points explaining it, so a recruiter can see *why* someone is ranked where they are.

- `/` — project submission page (report, slides, links)
- `/app` — the recruiter app
- `/api/*` — the same engine as serverless functions

## Features

- **Layout-aware PDF parsing** – detects the column gutter on two-column resumes and reads each column separately. Text under 3.5pt (hidden keyword stuffing) is dropped.
- **DOCX support** without a library – the zip is inflated with the browser's `DecompressionStream`.
- **Structured extraction** – contact, jobs (title / company / start / end / months), overlapping jobs counted once, internships at half weight, education level and major, quantified achievements (`<verb> … <metric>`).
- **Skill ontology** – ~70 canonical skills with aliases, implied skills (PyTorch ⇒ Python, Deep Learning) and family-based adjacency (Azure for an AWS requirement = 0.7 credit).
- **Two-stage ranking** – TF-IDF retrieval → passage-level rerank → weighted fit score (50 / 30 / 20, adjustable).
- **Blind mode** – names, contacts, graduation years, DOB / religion / marital-status lines, gendered pronouns and identity-linked club names are redacted before scoring.
- **Recruiter tools** – look-alike search, outreach email drafts, shortlist / reject with a feedback panel that suggests weight changes, CSV / JSON export.

## Run locally

Node 18+ is the only requirement.

```bash
npm test                 # 18 tests: parser, ranker, redaction, API handlers
npx serve .              # or any static server, then open http://localhost:3000/app
npx vercel dev           # static site + /api functions together
```

To regenerate the sample resumes in `assets/samples/` (needs `reportlab` and `python-docx`):

```bash
python3 tools/make_samples.py
```

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. On vercel.com → **Add New… → Project** → import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty. Deploy.

Or from the terminal: `npx vercel --prod`.

## API

```
GET  /api/health
POST /api/parse   { "text": "<resume text>" }   or   { "job": "<jd text>" }
POST /api/rank    { "job": "<jd text>", "resumes": [{ "name": "a.pdf", "text": "..." }],
                    "weights": { "semantic": 0.5, "experience": 0.3, "skills": 0.2 }, "blind": true }
```

The API takes text, not files — PDF extraction runs in the browser.

## Project layout

```
index.html            submission page
app/                  recruiter UI (index.html, main.js, extract.js, style.css)
lib/
  ontology.js         skills, aliases, implications, adjacency
  parser.js           resume + JD parsing
  redact.js           blind-mode redaction
  ranker.js           retrieval, rerank, fit score, explanations, look-alikes, outreach
  samples.js          demo JD and 8 fictional resumes
api/                  Vercel serverless functions
assets/               report PDF, slides, sample resume files
vendor/pdfjs/         pdf.js (Apache-2.0)
tests/                node:test suites
tools/                sample file generator
```

## Design notes

- **Why TF-IDF and not sentence-transformers?** The brief suggests a bi-encoder + cross-encoder. Running those in a browser tab or on a free serverless function is slow (hundreds of MB of weights), so stages 1 and 2 use classic IR. Skills are folded into canonical tokens before vectorising, which fixes the main weakness of keyword matching ("GCP" vs "Google Cloud"). `tokenize()` / `Vectorizer` are the only parts that would change to plug in real embeddings.
- **Why not plain Jaccard for skills?** Jaccard divides by the union, so a candidate with a long, honest skills list is punished for knowing *more*. The score uses JD-anchored coverage with partial credit instead; Jaccard is still computed and shown in the details view.
- **Experience decay**: `exp(-2 · shortfall / required)` — one year short of five keeps ~67%, three years short ~30%.
- **Keyword stuffing**: a skill that appears only in the skills list (never in a job, project or summary) gets 0.75 instead of 1.0, and a long list of such skills raises a flag.

## Limitations

- Scanned (image-only) PDFs are rejected — there is no OCR in the browser build.
- Date parsing covers the common formats (`Jan 2020`, `01/2020`, `2020`, `Present`); unusual ones are missed.
- The ontology is hand-written and tech-heavy; non-tech roles get mostly semantic scoring.
- Redaction is rule-based and can miss unusual formats.

## License

MIT for the project code. pdf.js is Apache-2.0 (see `vendor/pdfjs/LICENSE`).
