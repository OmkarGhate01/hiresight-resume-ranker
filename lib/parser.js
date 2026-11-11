// Turns raw resume text into a structured candidate object.
//
// The PDF/DOCX -> text step lives in the browser code (extract.js) because it
// needs pdf.js; everything here works on plain text so it can also run inside
// the Vercel API functions and the node tests.

import { findSkills, inferImplied } from './ontology.js';

const SECTION_HEADERS = {
  summary: /^(professional\s+)?(summary|profile|objective|about( me)?|career objective)$/,
  experience: /^((work|professional|employment|relevant)\s+)?(experience|history|work history|employment history)$|^internships?$|^experience\s*&\s*internships?$/,
  education: /^(education|academics?|academic (background|qualifications?)|qualifications?|educational qualifications?)$/,
  skills: /^((technical|core|key)\s+)?(skills|competencies|expertise|technologies|tech stack|tools)(\s*&\s*tools)?$/,
  projects: /^((academic|personal|key)\s+)?projects$/,
  certifications: /^(certifications?|courses|licenses?( & certifications)?|training)$/,
  achievements: /^(achievements|awards|honou?rs|accomplishments)$/,
  other: /^(languages|interests|hobbies|extra[- ]curricular( activities)?|activities|volunteering|references|personal (details|information)|declaration|leadership)$/,
};

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_RE = `(?:${MONTH_RE}\\.?,?\\s*'?\\d{2,4}|\\d{1,2}[\\/.-]\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(
  `(${DATE_RE})\\s*(?:-|–|—|to|till|until)\\s*(${DATE_RE}|present|current|now|today|ongoing|till date)`,
  'i'
);

const ROLE_WORDS = /\b(engineer|developer|scientist|analyst|manager|intern|lead|consultant|architect|designer|specialist|associate|head|director|officer|administrator|programmer|researcher|trainee|executive|coordinator|founder|technician|tester|qa|sde|devops)\b/i;
const JUNIOR_WORDS = /\b(intern(ship)?|trainee|apprentice|bootcamp|fellowship|volunteer|freelance project)\b/i;

const ACTION_VERBS = new Set(`
  achieved automated built boosted championed created cut decreased delivered deployed designed developed
  drove eliminated engineered established expanded generated grew implemented improved increased introduced
  launched led managed migrated optimized optimised orchestrated overhauled pioneered processed raised
  redesigned reduced refactored resolved restructured saved scaled shipped simplified slashed spearheaded
  streamlined trained transformed upgraded won wrote accelerated analysed analyzed architected collaborated
  conducted consolidated converted coordinated cleaned curated enhanced executed facilitated handled
  integrated maintained mentored modernized negotiated operated produced published rebuilt secured supported
`.trim().split(/\s+/));

const METRIC_RE = /(\d+(\.\d+)?\s*(%|percent|x\b|k\b|m\b|mn\b|million|lakh|crore|hrs?|hours|ms|seconds|(?:[a-z-]+\s)?(?:users|customers|clients|requests|teams|people|engineers|members|projects|services|countries|languages|markets|stores))|[$₹€£]\s?\d|\b\d{2,}\b)/i;

// Long forms are matched case-insensitively; abbreviations like "BE" or "MS"
// only in their usual casing, otherwise "must be" counts as a degree.
const abbr = (body) => new RegExp(`(?:^|[^A-Za-z])(?:${body})(?=[^A-Za-z]|$)`);
const DEGREES = [
  { level: 4, label: 'PhD', re: /\b(ph\.?\s?d|doctorate|doctor of philosophy)\b/i, abbr: abbr('Ph\\.?D') },
  { level: 3, label: 'Masters', re: /\b(master'?s|master of|post\s?graduat\w*|pgdm)\b/i, abbr: abbr('M\\.?\\s?Tech|M\\.E\\.|M\\.S\\.|MS(?!\\s*(?:Excel|Office|Word|SQL|Teams|Azure))|M\\.?Sc|MBA|MCA|M\\.Com|M\\.A\\.') },
  { level: 2, label: 'Bachelors', re: /\b(bachelor'?s|bachelor of|undergraduate degree)\b/i, abbr: abbr('B\\.?\\s?Tech|B\\.E\\.?|BE|B\\.S\\.|BS|B\\.?Sc|BCA|BBA|B\\.?Com|B\\.A\\.|BMS|BSc\\s?IT') },
  { level: 1, label: 'Diploma', re: /\b(diploma|higher secondary|associate degree)\b/i, abbr: abbr('HSC|12th') },
];
const degreeMatches = (text) => DEGREES.filter((d) => d.re.test(text) || d.abbr.test(text));
// for a resume we want the highest degree, for a JD the lowest one it accepts
const matchDegree = (text, lowest = false) => {
  const found = degreeMatches(text);
  return (lowest ? found[found.length - 1] : found[0]) || null;
};

const MAJORS = [
  ['Computer Science', /computer science|computer engineering|\bbca\b|\bmca\b|\bcse\b|\bcs\b|computer applications/i],
  ['Information Technology', /information technology|\bit\b(?! (company|services))/i],
  ['Data Science', /data science|artificial intelligence|machine learning|\bai\s*&\s*ds\b|\bai\b/i],
  ['Statistics', /statistics|statistical/i],
  ['Mathematics', /mathematics|maths?\b/i],
  ['Electronics', /electronics|electrical|\bece\b|\bentc\b|telecommunication/i],
  ['Mechanical Engineering', /mechanical/i],
  ['Business', /business|management|commerce|finance|economics/i],
];

export function normalizeText(raw) {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[•●▪■‣⁃◦]/g, '•')
    .replace(/[‐-‒]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function headerKey(line) {
  const clean = line.toLowerCase().replace(/[:\-–—_|•]+$/, '').replace(/^[^a-z]+/, '').trim();
  if (clean.length > 40) return null;
  for (const [key, re] of Object.entries(SECTION_HEADERS)) if (re.test(clean)) return key;
  return null;
}

// PDF extraction gives us visual lines, so one bullet can arrive as three
// lines. Glue continuation lines back onto the bullet they belong to.
function joinWrappedLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    const prev = out[out.length - 1];
    const continues =
      prev &&
      line &&
      isBullet(prev) &&
      !isBullet(line) &&
      !headerKey(line) &&
      !findDateRange(line) &&
      (/^[a-z0-9(%&]/.test(line) || /([,;(&-]|\b(and|or|to|of|the|a|an|for|with|in|on|by|from|at))$/i.test(prev));
    if (continues) out[out.length - 1] = prev + ' ' + line;
    else out.push(line);
  }
  return out;
}

export function splitSections(text) {
  const sections = { header: [] };
  let current = 'header';
  for (const line of joinWrappedLines(text.split('\n'))) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = headerKey(trimmed);
    if (key) {
      current = key;
      sections[current] = sections[current] || [];
      continue;
    }
    sections[current] = sections[current] || [];
    sections[current].push(trimmed);
  }
  return sections;
}

function parseDatePart(s, isEnd, today) {
  s = s.toLowerCase().trim();
  if (/present|current|now|today|ongoing|till date/.test(s)) {
    return { y: today.getFullYear(), m: today.getMonth() + 1, open: true };
  }
  let m = s.match(/^([a-z]+)\.?,?\s*'?(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4)] || MONTHS[m[1].slice(0, 3)];
    let y = +m[2];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    return mon ? { y, m: mon } : null;
  }
  m = s.match(/^(\d{1,2})[\/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { y: +m[2], m: +m[1] };
  m = s.match(/^(\d{4})$/);
  if (m) return { y: +m[1], m: isEnd ? 12 : 1, yearOnly: true };
  return null;
}

export function findDateRange(line, today = new Date()) {
  const m = line.match(RANGE_RE);
  if (!m) return null;
  const start = parseDatePart(m[1], false, today);
  const end = parseDatePart(m[2], true, today);
  if (!start || !end) return null;
  // "2019 - 2021" reads as roughly two years, not three
  const months = start.yearOnly && end.yearOnly
    ? (end.y - start.y) * 12
    : (end.y - start.y) * 12 + (end.m - start.m) + 1;
  if (months <= 0 || months > 600 || start.y < 1970) return null;
  return { start, end, months, current: !!end.open, raw: m[0] };
}

function splitTitleCompany(text, prevLine) {
  const parts = text
    .split(/\s*(?:\||·|•|,|\s[-–—]\s|\bat\b|@)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p && p.length > 1 && !/^(remote|hybrid|onsite|full[- ]time|part[- ]time)$/i.test(p));

  if (parts.length < 2 && prevLine) parts.unshift(...prevLine.split(/\s*(?:\||,|\s[-–—]\s|\bat\b)\s*/i).filter(Boolean));

  let title = parts.find((p) => ROLE_WORDS.test(p)) || '';
  const notLocation = (p) => !/^[A-Z][a-z]+,?\s*[A-Z]{2,}$/.test(p) && !/^(remote|india|usa|pune|mumbai|bengaluru|bangalore|delhi|hyderabad|chennai)$/i.test(p);
  // "Applied Scientist - NLP | Microsoft" -> NLP is a specialisation, not the company
  let company =
    parts.find((p) => p !== title && notLocation(p) && findSkills(p).size === 0) ||
    parts.find((p) => p !== title && notLocation(p)) ||
    '';
  if (!title && parts.length) title = parts[0];
  if (company === title) company = parts[1] || '';
  return { title: title.replace(/[()]/g, '').trim(), company: company.replace(/[()]/g, '').trim() };
}

function isBullet(line) {
  return /^[•\-*–▪◦>]\s*/.test(line);
}

function parseExperience(lines, today) {
  const entries = [];
  let current = null;

  lines.forEach((line, i) => {
    const range = findDateRange(line, today);
    if (range && !isBullet(line)) {
      const rest = line.replace(range.raw, '').replace(/[()|,–—-]+\s*$/, '').trim();
      const prev = i > 0 && !isBullet(lines[i - 1]) && !findDateRange(lines[i - 1], today) ? lines[i - 1] : '';
      const { title, company } = splitTitleCompany(rest, prev);

      // if the previous line was a plain header for this job, it got swallowed into
      // the previous entry's description - take it back
      if (prev && current && current.lines[current.lines.length - 1] === prev) current.lines.pop();

      current = {
        title,
        company,
        start: range.start,
        end: range.end,
        duration_months: range.months,
        current: range.current,
        junior: JUNIOR_WORDS.test(line + ' ' + prev),
        lines: [],
      };
      entries.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  });

  for (const e of entries) {
    const body = [e.title, ...e.lines].join('\n');
    e.technologies_used = [...findSkills(body).keys()];
    e.bullets = e.lines.map((l) => l.replace(/^[•\-*–▪◦>]\s*/, ''));
    if (!e.junior && e.duration_months <= 4 && /project|course/i.test(body)) e.junior = true;
    delete e.lines;
  }
  return entries;
}

// Total experience in years, counting overlapping jobs once. Internships and
// bootcamps count for half - a three month internship is not three months of
// senior work.
function totalYears(entries) {
  const weights = new Map();
  for (const e of entries) {
    const w = e.junior ? 0.5 : 1;
    let y = e.start.y;
    let m = e.start.m;
    for (let k = 0; k < e.duration_months; k++) {
      const key = y * 12 + m;
      weights.set(key, Math.max(weights.get(key) || 0, w));
      if (++m > 12) { m = 1; y++; }
    }
  }
  let sum = 0;
  for (const w of weights.values()) sum += w;
  return Math.round((sum / 12) * 10) / 10;
}

function skillTenure(entries) {
  // months of hands-on use per skill, from the jobs that mention it
  const tenure = {};
  for (const e of entries) {
    const months = e.junior ? e.duration_months / 2 : e.duration_months;
    const skills = new Set([...e.technologies_used, ...inferImplied(new Set(e.technologies_used))]);
    for (const s of skills) tenure[s] = (tenure[s] || 0) + months;
  }
  for (const k of Object.keys(tenure)) tenure[k] = Math.round((tenure[k] / 12) * 10) / 10;
  return tenure;
}

function parseEducation(lines) {
  const text = lines.join('\n');
  const best = matchDegree(text);
  const major = MAJORS.find(([, re]) => re.test(text));
  const years = (text.match(/\b(19[89]\d|20[0-4]\d)\b/g) || []).map(Number);
  const cgpa = text.match(/\b(cgpa|gpa|cpi)\s*[:\-]?\s*(\d+(\.\d+)?)(\s*\/\s*\d+)?/i);
  const pct = text.match(/\b(\d{2}(\.\d+)?)\s*%/);
  return {
    degree_level: best ? best.label : null,
    degree_rank: best ? best.level : 0,
    major: major ? major[0] : null,
    graduation_year: years.length ? Math.max(...years) : null,
    score: cgpa ? cgpa[2] + (cgpa[4] ? cgpa[4].replace(/\s/g, '') : '') : pct ? pct[1] + '%' : null,
    raw: lines.slice(0, 6),
  };
}

function parseContact(sectionHeader, text) {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  // first number-ish run with a phone-like digit count (skips "2019 - 2021")
  const phone = [...text.matchAll(/(\+?\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s-]?\d{3,5}(?:[\s-]?\d{2,5})?/g)].find((m) => {
    const n = m[0].replace(/\D/g, '').length;
    return n >= 10 && n <= 13;
  });
  const linkedin = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w\-%]+\/?/i);
  const github = text.match(/(https?:\/\/)?(www\.)?github\.com\/[\w\-]+\/?/i);

  let name = null;
  for (const line of sectionHeader.slice(0, 5)) {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (/[@\d]|linkedin|github|resume|curriculum|vitae/i.test(clean)) continue;
    const words = clean.split(' ');
    if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) {
      name = words.map((w) => (w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
      break;
    }
  }

  const phoneDigits = phone ? phone[0].replace(/\D/g, '') : '';
  return {
    name,
    email: email ? email[0] : null,
    phone: phoneDigits.length >= 10 && phoneDigits.length <= 13 ? phone[0].trim() : null,
    linkedin: linkedin ? linkedin[0].replace(/^https?:\/\/(www\.)?/, '') : null,
    github: github ? github[0].replace(/^https?:\/\/(www\.)?/, '') : null,
  };
}

export function extractAchievements(lines) {
  const achievements = [];
  let bulletCount = 0;
  for (const raw of lines) {
    const line = raw.replace(/^[•\-*–▪◦>]\s*/, '').trim();
    if (line.length < 25) continue;
    const firstWord = line.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    const startsWithVerb = ACTION_VERBS.has(firstWord);
    if (startsWithVerb || isBullet(raw)) bulletCount++;
    if (startsWithVerb && METRIC_RE.test(line) && !findDateRange(line)) {
      const metric = line.match(METRIC_RE)[0].trim();
      achievements.push({ verb: firstWord, text: line, metric });
    }
  }
  return { achievements, bulletCount };
}

function statedYears(text) {
  const m = text.match(/(\d{1,2}(\.\d)?)\s*\+?\s*(years|yrs)\s+(of\s+)?(professional\s+|industry\s+|work\s+|hands[- ]on\s+)?experience/i);
  return m ? parseFloat(m[1]) : 0;
}

let idCounter = 0;
function makeId(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return 'cnd_' + (Math.abs(h) % 100000).toString().padStart(5, '0') + (idCounter++ % 10);
}

export function parseResume(rawText, { fileName = '', today = new Date() } = {}) {
  const text = normalizeText(rawText);
  const sections = splitSections(text);

  let expLines = sections.experience || [];
  // some resumes have no explicit "Experience" header; fall back to every line
  // that is not in education/projects and has a date range on it
  if (!expLines.length) {
    const skip = new Set([...(sections.education || []), ...(sections.projects || []), ...(sections.certifications || [])]);
    expLines = text.split('\n').map((l) => l.trim()).filter((l) => l && !skip.has(l));
  }

  const experience = parseExperience(expLines, today);
  let years = totalYears(experience);
  const stated = statedYears(text);
  if (!years && stated) years = stated;

  const explicit = findSkills(text);
  const explicitSet = new Set(explicit.keys());
  // skills that show up somewhere other than the bare skills list - in a job,
  // a project, the summary. A long skills list with nothing behind it is the
  // classic keyword-stuffing pattern.
  const skillListLines = new Set(sections.skills || []);
  const evidenceText = text.split('\n').filter((l) => !skillListLines.has(l.trim())).join('\n');
  const evidenced = new Set(findSkills(evidenceText).keys());
  const implied = inferImplied(explicitSet);

  const allLines = joinWrappedLines(text.split('\n'));
  const { achievements, bulletCount } = extractAchievements(allLines);

  const candidate = {
    candidate_id: makeId(fileName + text.slice(0, 200)),
    file_name: fileName,
    contact: parseContact(sections.header || [], text),
    total_years_experience: years,
    stated_years: stated || null,
    experience: experience.map(({ start, end, ...rest }) => ({
      ...rest,
      start: `${start.y}-${String(start.m).padStart(2, '0')}`,
      end: rest.current ? 'Present' : `${end.y}-${String(end.m).padStart(2, '0')}`,
    })),
    education: parseEducation(sections.education || []),
    skills: {
      explicit: [...explicitSet],
      implied: [...implied],
      evidenced: [...evidenced].filter((sk) => explicitSet.has(sk)),
      listed_only: [...explicitSet].filter((sk) => !evidenced.has(sk)),
      mentions: Object.fromEntries(explicit),
      tenure_years: skillTenure(experience),
    },
    achievements,
    quantified_ratio: bulletCount ? Math.round((achievements.length / bulletCount) * 100) / 100 : 0,
    sections_found: Object.keys(sections).filter((k) => k !== 'header'),
    text,
  };
  return candidate;
}

// ---------- job descriptions ----------

const NICE_HEADER = /(nice[- ]to[- ]have|preferred|bonus|good to have|plus|desirable|optional)/i;
const MUST_HEADER = /(requirements|must[- ]have|required|qualifications|what you('ll)? (need|bring)|skills)/i;

export function parseJob(rawText) {
  const text = normalizeText(rawText);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const must = new Map();
  const nice = new Map();
  const anyOf = []; // "PyTorch or TensorFlow" -> either one is enough
  let mode = 'must';
  for (const line of lines) {
    const short = line.length < 60;
    if (short && NICE_HEADER.test(line)) mode = 'nice';
    else if (short && MUST_HEADER.test(line) && !NICE_HEADER.test(line)) mode = 'must';
    const isNice = mode === 'nice' || /\b(nice to have|preferred|a plus|bonus|good to have)\b/i.test(line);
    const target = isNice ? nice : must;
    const here = findSkills(line);

    const alt = line.match(/([\w.+#/ -]+?)\s+(?:or|\/)\s+([\w.+# -]+)/i);
    if (alt && !isNice && here.size >= 2) {
      const left = [...findSkills(alt[1]).keys()].pop();
      const right = [...findSkills(alt[2]).keys()][0];
      if (left && right && left !== right) {
        anyOf.push([left, right]);
        here.delete(left);
        here.delete(right);
      }
    }
    for (const [s, c] of here) target.set(s, (target.get(s) || 0) + c);
  }
  for (const s of must.keys()) nice.delete(s);
  for (const group of anyOf) for (const s of group) must.delete(s);

  // "5+ years of Python", "3 years experience with AWS"
  const skillYears = {};
  const yearPhrase = /(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)[ \t]+(?:of[ \t]+)?(?:hands[- ]on[ \t]+|professional[ \t]+|working[ \t]+)?(?:experience[ \t]*)?(?:with|in|using|of)?[ \t]*([^.;\n]{0,50})/gi;
  let minYears = 0;
  let m;
  while ((m = yearPhrase.exec(text))) {
    const n = parseInt(m[1], 10);
    const tail = m[2];
    const skillsHere = [...findSkills(tail).keys()];
    if (skillsHere.length && !/^(experience|of experience)/i.test(tail.trim())) {
      for (const s of skillsHere.slice(0, 2)) skillYears[s] = Math.max(skillYears[s] || 0, n);
    }
    if (/experience|industry|professional/i.test(m[0]) || !skillsHere.length) minYears = Math.max(minYears, n);
  }
  if (!minYears && Object.keys(skillYears).length) minYears = Math.max(...Object.values(skillYears));

  const degree = matchDegree(text, true);

  const titleLine = lines.find((l) => ROLE_WORDS.test(l) && l.length < 80) || lines[0] || 'Untitled role';

  return {
    title: titleLine.replace(/^(job title|role|position)\s*[:\-]\s*/i, ''),
    must_have: [...must.keys()],
    any_of: anyOf,
    nice_to_have: [...nice.keys()],
    min_years: minYears,
    skill_years: skillYears,
    degree_required: degree ? degree.label : null,
    degree_rank: degree ? degree.level : 0,
    text,
  };
}
