import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResume, parseJob, findDateRange } from '../lib/parser.js';
import { findSkills, inferImplied, adjacency } from '../lib/ontology.js';
import { redact } from '../lib/redact.js';

const today = new Date('2026-11-09');

test('date ranges in the usual formats', () => {
  assert.equal(findDateRange('Jan 2019 - Dec 2019', today).months, 12);
  assert.equal(findDateRange('03/2020 – 02/2021', today).months, 12);
  assert.equal(findDateRange('2018 - 2020', today).months, 24);
  const open = findDateRange('Senior Engineer | Acme | Jul 2024 - Present', today);
  assert.ok(open.current);
  assert.equal(open.months, 29);
  assert.equal(findDateRange('Improved latency by 40% in 2023', today), null);
});

test('skill aliases collapse to one canonical node', () => {
  const s = findSkills('Worked with K8s, AWS EKS and kubernetes; also GCP and React.js');
  assert.ok(s.has('Kubernetes'));
  assert.ok(s.has('Google Cloud'));
  assert.ok(s.has('React'));
  assert.equal(s.has('Go'), false, '"go" should not match inside normal text');
});

test('ambiguous short tokens only match when written like a skill', () => {
  assert.ok(findSkills('Languages: Go, Rust, Python').has('Go'));
  assert.equal(findSkills('ready to go the extra mile').has('Go'), false);
  assert.equal(findSkills('I excel at stakeholder work').has('Excel'), false);
});

test('implied skills and adjacency', () => {
  const implied = inferImplied(new Set(['PyTorch']));
  assert.ok(implied.has('Python'));
  assert.ok(implied.has('Machine Learning'));
  assert.equal(adjacency('Vue.js', 'React'), 0.7);
  assert.equal(adjacency('AWS', 'Google Cloud'), 0.7);
  assert.equal(adjacency('AWS', 'React'), 0);
});

const RESUME = `Neha Joshi
neha.joshi@example.com | +91 98765 43210 | linkedin.com/in/nehaj

EXPERIENCE
Data Scientist | Acme Analytics | Jan 2022 - Present
• Reduced churn by 12% with an XGBoost model in Python
• Built Airflow pipelines and SQL reports for 5 business teams
Data Science Intern | Beta Labs | Jun 2021 - Aug 2021
• Cleaned data in pandas

EDUCATION
B.Tech Computer Science, VIT Pune, 2021

SKILLS
Python, SQL, XGBoost, Airflow, Tableau`;

test('resume parsing end to end', () => {
  const c = parseResume(RESUME, { today });
  assert.equal(c.contact.name, 'Neha Joshi');
  assert.equal(c.contact.email, 'neha.joshi@example.com');
  assert.ok(c.contact.phone);
  assert.equal(c.experience.length, 2);
  assert.equal(c.experience[0].company, 'Acme Analytics');
  assert.equal(c.experience[0].title, 'Data Scientist');
  assert.ok(c.experience[1].junior, 'internship should be flagged');
  // 4y11m full time + 3 months internship at half weight
  assert.equal(c.total_years_experience, 5);
  assert.equal(c.education.degree_level, 'Bachelors');
  assert.equal(c.education.major, 'Computer Science');
  assert.ok(c.skills.explicit.includes('XGBoost'));
  assert.ok(c.skills.listed_only.includes('Tableau'));
  assert.equal(c.achievements.length, 2);
});

test('job description parsing', () => {
  const job = parseJob(`ML Engineer
Requirements
- 4+ years of experience
- 3+ years of Python
- PyTorch or TensorFlow
- AWS
Nice to have
- Kubernetes
Bachelor's degree required. You must be comfortable with ambiguity.`);
  assert.equal(job.min_years, 4);
  assert.equal(job.skill_years.Python, 3);
  assert.deepEqual(job.any_of, [['PyTorch', 'TensorFlow']]);
  assert.ok(job.must_have.includes('AWS'));
  assert.ok(job.nice_to_have.includes('Kubernetes'));
  assert.equal(job.degree_required, 'Bachelors');
});

test('redaction removes PII and identity signals', () => {
  const text = `Neha Joshi
Flat 4, Lake Road, Pune 411001
neha@example.com | 9876543210
Date of Birth: 01/01/1999
Religion: Hindu
B.Tech, VIT Pune, 2021
Treasurer, Hindu Students Association
She led the analytics team.`;
  const out = redact(text, { name: 'Neha Joshi' }).text;
  for (const leak of ['Neha', 'Joshi', 'neha@example.com', '9876543210', '1999', '2021', 'Religion', 'Hindu', 'Lake Road']) {
    assert.ok(!out.includes(leak), `leaked: ${leak}\n${out}`);
  }
  assert.ok(out.includes('University Association'));
  assert.ok(out.includes('They led'));
});
