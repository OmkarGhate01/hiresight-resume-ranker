// Skill ontology.
//
// Every canonical skill has a list of aliases (what people actually write on
// resumes), a family it belongs to, and optionally a list of skills it implies.
// Families drive the "adjacency" partial credit: React and Vue are not the same
// thing, but someone who knows one can pick up the other quickly.

const SKILLS = {
  // languages
  'Python':      { family: 'language', aliases: ['python', 'python3', 'py'] },
  'Java':        { family: 'language', aliases: ['java', 'java 8', 'java 11', 'java 17'] },
  'JavaScript':  { family: 'language', aliases: ['javascript', 'js', 'es6', 'ecmascript'] },
  'TypeScript':  { family: 'language', aliases: ['typescript', 'ts'], implies: ['JavaScript'] },
  'C++':         { family: 'language', aliases: ['c++', 'cpp'] },
  'C#':          { family: 'language', aliases: ['c#', 'csharp', 'c sharp'] },
  'Go':          { family: 'language', aliases: ['golang', 'go lang'] },
  'Rust':        { family: 'language', aliases: ['rust'] },
  'R':           { family: 'language', aliases: ['r programming', 'rstudio', 'r language'] },
  'SQL':         { family: 'database', aliases: ['sql', 't-sql', 'pl/sql', 'plsql'] },
  'Kotlin':      { family: 'language', aliases: ['kotlin'] },
  'PHP':         { family: 'language', aliases: ['php', 'laravel'] },

  // frontend
  'React':       { family: 'frontend-framework', aliases: ['react', 'react.js', 'reactjs', 'react js'], implies: ['JavaScript'] },
  'Vue.js':      { family: 'frontend-framework', aliases: ['vue', 'vue.js', 'vuejs', 'nuxt'], implies: ['JavaScript'] },
  'Angular':     { family: 'frontend-framework', aliases: ['angular', 'angularjs', 'angular.js'], implies: ['TypeScript'] },
  'Next.js':     { family: 'frontend-framework', aliases: ['next.js', 'nextjs'], implies: ['React'] },
  'HTML/CSS':    { family: 'frontend', aliases: ['html', 'html5', 'css', 'css3', 'tailwind', 'bootstrap', 'sass'] },

  // backend
  'Node.js':     { family: 'backend-framework', aliases: ['node', 'node.js', 'nodejs', 'express', 'express.js'], implies: ['JavaScript'] },
  'Django':      { family: 'backend-framework', aliases: ['django'], implies: ['Python'] },
  'Flask':       { family: 'backend-framework', aliases: ['flask'], implies: ['Python'] },
  'FastAPI':     { family: 'backend-framework', aliases: ['fastapi', 'fast api'], implies: ['Python'] },
  'Spring Boot': { family: 'backend-framework', aliases: ['spring', 'spring boot', 'springboot'], implies: ['Java'] },
  'REST APIs':   { family: 'backend', aliases: ['rest', 'rest api', 'restful', 'rest apis', 'api development'] },
  'GraphQL':     { family: 'backend', aliases: ['graphql'] },
  'Microservices': { family: 'backend', aliases: ['microservices', 'microservice architecture'] },

  // data stores
  'PostgreSQL':  { family: 'database', aliases: ['postgres', 'postgresql', 'psql'], implies: ['SQL'] },
  'MySQL':       { family: 'database', aliases: ['mysql', 'mariadb'], implies: ['SQL'] },
  'MongoDB':     { family: 'nosql', aliases: ['mongodb', 'mongo'] },
  'Redis':       { family: 'nosql', aliases: ['redis'] },
  'Cassandra':   { family: 'nosql', aliases: ['cassandra'] },
  'Elasticsearch': { family: 'nosql', aliases: ['elasticsearch', 'elastic search', 'opensearch'] },
  'Neo4j':       { family: 'nosql', aliases: ['neo4j', 'graph database'] },

  // cloud
  'AWS':         { family: 'cloud', aliases: ['aws', 'amazon web services', 'ec2', 's3', 'lambda', 'aws lambda'] },
  'Google Cloud': { family: 'cloud', aliases: ['gcp', 'google cloud', 'google cloud platform', 'bigquery', 'gke'] },
  'Azure':       { family: 'cloud', aliases: ['azure', 'microsoft azure'] },

  // devops
  'Docker':      { family: 'devops', aliases: ['docker', 'containers', 'containerization', 'dockerfile'] },
  'Kubernetes':  { family: 'devops', aliases: ['kubernetes', 'k8s', 'aws eks', 'eks', 'aks', 'helm'], implies: ['Docker', 'DevOps'] },
  'DevOps':      { family: 'devops', aliases: ['devops', 'dev ops', 'sre', 'site reliability'] },
  'CI/CD':       { family: 'devops', aliases: ['ci/cd', 'cicd', 'jenkins', 'github actions', 'gitlab ci', 'circleci'] },
  'Terraform':   { family: 'devops', aliases: ['terraform', 'infrastructure as code', 'iac'] },
  'Linux':       { family: 'devops', aliases: ['linux', 'unix', 'bash', 'shell scripting'] },
  'Git':         { family: 'tooling', aliases: ['git', 'github', 'gitlab', 'bitbucket'] },

  // streaming / big data
  'Kafka':       { family: 'data-engineering', aliases: ['kafka', 'apache kafka'] },
  'Spark':       { family: 'data-engineering', aliases: ['spark', 'pyspark', 'apache spark', 'databricks'] },
  'Airflow':     { family: 'data-engineering', aliases: ['airflow', 'apache airflow'] },
  'Hadoop':      { family: 'data-engineering', aliases: ['hadoop', 'hive', 'hdfs'] },
  'ETL':         { family: 'data-engineering', aliases: ['etl', 'elt', 'data pipelines', 'data pipeline'] },

  // ML / DS
  'Machine Learning': { family: 'ml', aliases: ['machine learning', 'ml', 'predictive modeling', 'predictive modelling'] },
  'Deep Learning':    { family: 'ml', aliases: ['deep learning', 'neural networks', 'neural network', 'cnn', 'rnn', 'lstm'], implies: ['Machine Learning'] },
  'PyTorch':     { family: 'ml-framework', aliases: ['pytorch', 'torch'], implies: ['Python', 'Deep Learning'] },
  'TensorFlow':  { family: 'ml-framework', aliases: ['tensorflow', 'keras', 'tf2'], implies: ['Python', 'Deep Learning'] },
  'scikit-learn': { family: 'ml-framework', aliases: ['scikit-learn', 'sklearn', 'scikit learn'], implies: ['Python', 'Machine Learning'] },
  'XGBoost':     { family: 'ml-framework', aliases: ['xgboost', 'lightgbm', 'catboost'], implies: ['Machine Learning'] },
  'NLP':         { family: 'ml', aliases: ['nlp', 'natural language processing', 'text mining', 'named entity recognition', 'ner'], implies: ['Machine Learning'] },
  'Transformers': { family: 'ml', aliases: ['transformers', 'bert', 'roberta', 'hugging face', 'huggingface', 'llm', 'llms', 'gpt'], implies: ['NLP', 'Deep Learning', 'Python'] },
  'Computer Vision': { family: 'ml', aliases: ['computer vision', 'opencv', 'image processing', 'ocr', 'yolo'], implies: ['Machine Learning'] },
  'spaCy':       { family: 'ml-framework', aliases: ['spacy'], implies: ['NLP', 'Python'] },
  'Pandas':      { family: 'data-analysis', aliases: ['pandas', 'numpy', 'scipy'], implies: ['Python'] },
  'Statistics':  { family: 'data-analysis', aliases: ['statistics', 'statistical analysis', 'hypothesis testing', 'a/b testing', 'ab testing', 'regression analysis'] },
  'Data Visualization': { family: 'bi', aliases: ['data visualization', 'data visualisation', 'matplotlib', 'seaborn', 'plotly', 'd3.js'] },
  'Tableau':     { family: 'bi', aliases: ['tableau'] },
  'Power BI':    { family: 'bi', aliases: ['power bi', 'powerbi'] },
  'Excel':       { family: 'bi', aliases: ['excel', 'ms excel', 'advanced excel', 'vlookup', 'pivot tables'] },
  'MLOps':       { family: 'ml', aliases: ['mlops', 'mlflow', 'kubeflow', 'model deployment', 'sagemaker'] },

  // mobile
  'Android':     { family: 'mobile', aliases: ['android', 'android studio'] },
  'iOS':         { family: 'mobile', aliases: ['ios', 'swift', 'swiftui'] },
  'React Native': { family: 'mobile', aliases: ['react native'], implies: ['React'] },
  'Flutter':     { family: 'mobile', aliases: ['flutter', 'dart'] },

  // practices / soft
  'Agile':       { family: 'process', aliases: ['agile', 'scrum', 'kanban', 'jira'] },
  'System Design': { family: 'backend', aliases: ['system design', 'distributed systems', 'scalability', 'high availability'] },
  'Leadership':  { family: 'soft', aliases: ['team lead', 'led a team', 'mentored', 'mentoring', 'leadership', 'managed a team'] },
  'Communication': { family: 'soft', aliases: ['communication', 'stakeholder management', 'presentation skills'] },
};

// How transferable a skill is to another skill in the same family.
// Anything not listed falls back to DEFAULT_ADJACENCY.
const FAMILY_ADJACENCY = {
  'frontend-framework': 0.7,
  'backend-framework': 0.6,
  'ml-framework': 0.75,
  'cloud': 0.7,
  'database': 0.75,
  'nosql': 0.5,
  'language': 0.25,
  'soft': 0,
  'process': 0,
  'mobile': 0.5,
  'bi': 0.6,
  'devops': 0.5,
  'data-engineering': 0.55,
  'ml': 0.5,
};
const DEFAULT_ADJACENCY = 0.35;

// families that are close enough to deserve a smaller cross-family credit
const RELATED_FAMILIES = [
  ['ml', 'ml-framework', 0.45],
  ['database', 'nosql', 0.4],
  ['frontend', 'frontend-framework', 0.4],
  ['backend', 'backend-framework', 0.45],
  ['data-analysis', 'bi', 0.4],
  ['data-engineering', 'database', 0.35],
];

// Build a lookup of alias -> canonical once, longest aliases first so that
// "react native" wins over "react" and "spring boot" over "spring".
const aliasIndex = [];
for (const [name, info] of Object.entries(SKILLS)) {
  aliasIndex.push([name.toLowerCase(), name]);
  for (const a of info.aliases) aliasIndex.push([a.toLowerCase(), name]);
}
aliasIndex.sort((a, b) => b[0].length - a[0].length);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

// Word boundaries don't work for things like "c++" or "c#", so we use our own
// boundary: start/end of string or anything that isn't a letter/digit.
const aliasPatterns = aliasIndex.map(([alias, canonical]) => ({
  alias,
  canonical,
  re: new RegExp(`(^|[^a-z0-9+#])${escapeRe(alias)}(?=$|[^a-z0-9+#])`, 'g'),
}));

// Short aliases that are also normal English words / too ambiguous on their own.
// We only accept these if the original text had them in a "skills-ish" casing.
const AMBIGUOUS = new Set(['go', 'r', 'py', 'ts', 'js', 'ml', 'ner', 'rest', 'spark', 'ios', 'gpt', 'iac', 'sre', 'excel', 'lambda', 'torch', 'swift']);

export function findSkills(text) {
  const lower = ' ' + text.toLowerCase() + ' ';
  const found = new Map(); // canonical -> count
  let masked = lower;

  for (const { alias, canonical, re } of aliasPatterns) {
    re.lastIndex = 0;
    if (!re.test(masked)) continue;
    if (AMBIGUOUS.has(alias) && !looksLikeSkillToken(text, alias)) continue;

    re.lastIndex = 0;
    const hits = masked.match(re) || [];
    found.set(canonical, (found.get(canonical) || 0) + hits.length);
    // blank out what we matched so "react" doesn't match again inside "react native"
    masked = masked.replace(re, (m, pre) => pre + ' '.repeat(m.length - pre.length));
  }
  return found;
}

function looksLikeSkillToken(original, alias) {
  // "Go" / "R" / "ML" written in caps or next to a comma/pipe in a list is a skill;
  // "go" in "go-to person" is not.
  const re = new RegExp(`(^|[\\s,|/•·(])${escapeRe(alias)}(?=[\\s,|/•·)]|$)`, 'gi');
  let m;
  while ((m = re.exec(original))) {
    const token = original.substr(m.index + m[1].length, alias.length);
    if (token === token.toUpperCase()) return true;
    if (alias.length > 1 && token[0] === token[0].toUpperCase() && !/^[.!?]\s*$/.test(original.slice(Math.max(0, m.index - 2), m.index + m[1].length))) return true;
  }
  return false;
}

export function canonicalize(name) {
  const key = name.trim().toLowerCase();
  for (const [alias, canonical] of aliasIndex) if (alias === key) return canonical;
  return null;
}

// Expand a set of explicit skills with whatever they imply (transitively).
export function inferImplied(explicit) {
  const implied = new Set();
  const stack = [...explicit];
  while (stack.length) {
    const s = stack.pop();
    for (const child of SKILLS[s]?.implies || []) {
      if (!explicit.has(child) && !implied.has(child)) {
        implied.add(child);
        stack.push(child);
      }
    }
  }
  return implied;
}

export function familyOf(skill) {
  return SKILLS[skill]?.family || null;
}

// How much credit does having `have` give towards a requirement for `want`?
export function adjacency(want, have) {
  if (want === have) return 1;
  const fw = familyOf(want);
  const fh = familyOf(have);
  if (!fw || !fh) return 0;
  if (fw === fh) return FAMILY_ADJACENCY[fw] ?? DEFAULT_ADJACENCY;
  for (const [a, b, w] of RELATED_FAMILIES) {
    if ((a === fw && b === fh) || (a === fh && b === fw)) return w;
  }
  return 0;
}

export const SOFT_SKILLS = new Set(
  Object.entries(SKILLS).filter(([, v]) => v.family === 'soft' || v.family === 'process').map(([k]) => k)
);

export const ALL_SKILLS = Object.keys(SKILLS);
