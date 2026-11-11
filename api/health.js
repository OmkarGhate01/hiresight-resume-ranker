import { allowCors } from './_utils.js';
import { ALL_SKILLS } from '../lib/ontology.js';

export default function handler(req, res) {
  allowCors(res);
  res.status(200).json({
    status: 'ok',
    service: 'hiresight',
    version: '1.0.0',
    skills_in_ontology: ALL_SKILLS.length,
    time: new Date().toISOString(),
  });
}
