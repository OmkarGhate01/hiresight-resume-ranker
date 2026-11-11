// "Blind audition" step: strip things that identify a person or hint at their
// age, gender, religion or caste before anything gets scored.
//
// This is intentionally conservative. It is fine if we redact a little too much
// (the score barely moves); it is not fine if a name or a birth date leaks into
// the text the ranker looks at.

const PERSONAL_FIELDS = /^(date of birth|dob|d\.o\.b|age|gender|sex|marital status|nationality|religion|caste|category|father'?s name|mother'?s name|husband'?s name|passport( no\.?)?|languages known)\s*[:\-–]/i;

const ADDRESS_HINTS = /\b(road|rd\.|street|st\.|nagar|colony|apartment|apt\.?|flat no|sector|lane|chowk|society|near|opp\.|behind|taluka|district|dist\.)\b|\b\d{6}\b|\b\d{5}(-\d{4})?\b/i;

// Club / association names that tend to carry gender, religion, caste or
// ethnicity. The match becomes a neutral "University Association".
const IDENTITY_GROUP = /\b(fraternity|sorority|women'?s|men'?s|girls'?|boys'?|ladies|hindu|muslim|islamic|christian|catholic|sikh|jain|buddhist|jewish|brahmin|maratha|dalit|tamil|telugu|marathi|bengali|gujarati|punjabi|kannada|malayali|black|african|hispanic|latin[oax]|asian|lgbtq?\+?|queer|pride)\b[^,.;\n]{0,40}?\b(association|society|club|union|council|chapter|sangh|mandal|samaj|forum|network|collective|group)\b/gi;

const PRONOUNS = [
  [/\b(he|she)\b/gi, 'they'],
  [/\b(him|her)\b(?=\s+(team|role|work|own|colleagues))/gi, 'their'],
  [/\b(his|hers)\b/gi, 'their'],
  [/\b(himself|herself)\b/gi, 'themselves'],
  [/\b(mr|mrs|ms|miss)\.?\s+(?=[A-Z])/g, ''],
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redact(text, contact = {}) {
  const log = [];
  let out = text;

  const replace = (re, token, label) => {
    out = out.replace(re, (...args) => {
      log.push(label);
      return typeof token === 'function' ? token(...args) : token;
    });
  };

  // personal details block, very common on Indian resumes
  out = out
    .split('\n')
    .filter((line) => {
      if (PERSONAL_FIELDS.test(line.trim())) {
        log.push('personal detail line');
        return false;
      }
      return true;
    })
    .join('\n');

  replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]', 'email');
  replace(/(https?:\/\/)?(www\.)?(linkedin|github|gitlab|behance|dribbble)\.com\/[^\s,|]+/gi, '[PROFILE_LINK]', 'profile link');
  replace(/(\+?\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s-]?\d{3,5}(?:[\s-]?\d{2,5})?/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[PHONE]' : m), 'phone');

  if (contact.name) {
    const parts = contact.name.split(/\s+/).filter((p) => p.length > 2);
    replace(new RegExp(escapeRe(contact.name), 'gi'), '[CANDIDATE]', 'name');
    for (const p of parts) replace(new RegExp(`\\b${escapeRe(p)}\\b`, 'gi'), '[CANDIDATE]', 'name');
  }

  // address-looking lines in the first few lines of the resume
  const lines = out.split('\n');
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (ADDRESS_HINTS.test(lines[i]) && !/[•]/.test(lines[i]) && lines[i].length < 140) {
      lines[i] = '[ADDRESS]';
      log.push('address');
    }
  }
  out = lines.join('\n');

  // graduation years: drop four-digit years that sit on a degree/school line
  out = out
    .split('\n')
    .map((line) => {
      if (/\b(b\.?\s?tech|b\.?e\b|bachelor|master|m\.?\s?tech|mba|mca|bsc|msc|b\.?com|degree|university|college|school|institute|ssc|hsc|10th|12th|class of|graduat)/i.test(line)) {
        return line.replace(/\b(19[5-9]\d|20[0-4]\d)\b/g, () => {
          log.push('graduation year');
          return '[YEAR]';
        });
      }
      return line;
    })
    .join('\n');

  replace(IDENTITY_GROUP, 'University Association', 'identity-linked group');
  for (const [re, to] of PRONOUNS) replace(re, (m) => matchCase(m, to), 'gendered word');

  const summary = log.reduce((acc, k) => ((acc[k] = (acc[k] || 0) + 1), acc), {});
  return { text: out, summary };
}

function matchCase(src, to) {
  if (!to) return to;
  return src[0] === src[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
}
