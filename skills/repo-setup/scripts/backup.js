#!/usr/bin/env node
/**
 * Backup and restore for /repo-setup.
 *
 *   node backup.js save <folder> <file...>   copy the files into <folder>/<timestamp>/
 *   node backup.js restore <backup folder>   copy them back to where they came from
 *
 * Copies get a ".bak" suffix: a CLAUDE.md or .claude/rules/ file inside the
 * repo would otherwise be loaded by Claude Code as live instructions.
 */

const fs = require('node:fs');
const path = require('node:path');

const SUFFIX = '.bak';
const MANIFEST = 'manifest.json';

function stamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

function save(root, folder, files, now = new Date()) {
  if (!files.length) throw new Error('No files to back up.');
  const rels = files.map((f) => {
    const rel = path.relative(root, path.resolve(root, f));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Not inside ${root}: ${f}`);
    if (!fs.statSync(path.join(root, rel)).isFile()) throw new Error(`Not a file: ${f}`);
    return rel;
  });

  const dir = path.join(path.resolve(root, folder), stamp(now));
  if (fs.existsSync(dir)) throw new Error(`Backup folder already exists: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  // Keeps the backup out of git without touching the repo's own .gitignore.
  fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');

  const entries = [...new Set(rels)].map((rel) => {
    const target = path.join(dir, rel + SUFFIX);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, rel), target);
    const bytes = fs.statSync(path.join(root, rel)).size;
    if (fs.statSync(target).size !== bytes) throw new Error(`Copy of ${rel} is incomplete.`);
    return { path: rel.split(path.sep).join('/'), bytes };
  });

  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ root, created: now.toISOString(), files: entries }, null, 2) + '\n');
  return { dir, files: entries };
}

function restore(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  for (const { path: rel } of manifest.files) {
    const target = path.join(manifest.root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(dir, rel + SUFFIX), target);
  }
  return manifest;
}

function main([command, target, ...files]) {
  if (command === 'save' && target) {
    const { dir, files: saved } = save(process.cwd(), target, files);
    console.log(`Backed up ${saved.length} file(s) to ${dir}`);
    for (const f of saved) console.log(`  ${f.path} (${f.bytes} bytes)`);
    console.log(`Restore with: node "${__filename}" restore "${dir}"`);
  } else if (command === 'restore' && target) {
    const manifest = restore(path.resolve(target));
    console.log(`Restored ${manifest.files.length} file(s) to ${manifest.root}`);
    console.log('Files created after the backup are left in place.');
  } else {
    console.error('Usage: backup.js save <folder> <file...> | backup.js restore <backup folder>');
    process.exit(2);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { save, restore, stamp };
