#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const tasksDir = path.join(__dirname, '..', 'tasks');
const outputFile = path.join(__dirname, '..', 'public', 'tasks.json');

const REQUIRED_FIELDS = ['title', 'schedule'];
const VALID_SCHEDULE_TYPES = ['weekly', 'monthly'];

function validate(task, filename) {
  for (const field of REQUIRED_FIELDS) {
    if (!task[field]) {
      console.warn(`[SKIP] ${filename}: missing required field "${field}"`);
      return false;
    }
  }
  if (!VALID_SCHEDULE_TYPES.includes(task.schedule.type)) {
    console.warn(`[SKIP] ${filename}: invalid schedule.type "${task.schedule.type}". Must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`);
    return false;
  }
  if (task.schedule.type === 'weekly' && !task.schedule.weekday) {
    console.warn(`[SKIP] ${filename}: weekly schedule requires "weekday"`);
    return false;
  }
  if (task.schedule.type === 'monthly' && !task.schedule.day) {
    console.warn(`[SKIP] ${filename}: monthly schedule requires "day"`);
    return false;
  }
  if (task.schedule.interval > 1 && !task.schedule.anchor_date) {
    console.warn(`[WARN] ${filename}: interval > 1 without anchor_date — results may be unpredictable`);
  }
  return true;
}

const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
const tasks = [];

for (const file of files) {
  const filepath = path.join(tasksDir, file);
  let task;
  try {
    task = yaml.load(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.warn(`[SKIP] ${file}: invalid YAML — ${e.message}`);
    continue;
  }
  if (!task || typeof task !== 'object') {
    console.warn(`[SKIP] ${file}: empty or non-object YAML`);
    continue;
  }
  if (validate(task, file)) {
    tasks.push(task);
  }
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(tasks, null, 2));
console.log(`Built ${tasks.length} task(s) → ${outputFile}`);

// Copy src/ into public/src/
const srcDir = path.join(__dirname, '..', 'src');
const publicSrcDir = path.join(__dirname, '..', 'public', 'src');
fs.mkdirSync(publicSrcDir, { recursive: true });
for (const file of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, file), path.join(publicSrcDir, file));
}
console.log(`Copied src/ → public/src/`);
