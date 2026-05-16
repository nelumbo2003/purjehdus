const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Varmista data-hakemisto
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'purjehdus.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Alusta tietokanta
db.exec(`
  CREATE TABLE IF NOT EXISTS sailors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS boats (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS results (
    race_index INTEGER NOT NULL,
    sailor_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (race_index, sailor_id),
    FOREIGN KEY (sailor_id) REFERENCES sailors(id)
  );
`);

// Oletuspurjehtijat
const SAILOR_IDS = ['A','B','C','D','E','F','G','H','I','J'];
const existing = db.prepare('SELECT COUNT(*) as c FROM sailors').get();
if (existing.c === 0) {
  const ins = db.prepare('INSERT INTO sailors (id, name) VALUES (?, ?)');
  SAILOR_IDS.forEach(id => ins.run(id, id));
}

// Oletusveneet
const existingBoats = db.prepare('SELECT COUNT(*) as c FROM boats').get();
if (existingBoats.c === 0) {
  const ins = db.prepare('INSERT INTO boats (id, name) VALUES (?, ?)');
  [1,2,3,4].forEach(id => ins.run(id, `Vene ${id}`));
}

// Optimoitu aikataulu (Python-algoritmista)
const SCHEDULE = [
  {1:'G',2:'J',3:'I',4:'A'},
  {1:'H',2:'E',3:'C',4:'G'},
  {1:'B',2:'A',3:'E',4:'F'},
  {1:'D',2:'I',3:'B',4:'C'},
  {1:'J',2:'G',3:'F',4:'D'},
  {1:'I',2:'F',3:'A',4:'H'},
  {1:'E',2:'H',3:'D',4:'J'},
  {1:'F',2:'C',3:'J',4:'B'},
  {1:'G',2:'B',3:'H',4:'I'},
  {1:'C',2:'D',3:'A',4:'E'},
  {1:'C',2:'E',3:'J',4:'I'},
  {1:'A',2:'F',3:'G',4:'D'},
  {1:'A',2:'B',3:'C',4:'H'},
  {1:'I',2:'D',3:'B',4:'E'},
  {1:'F',2:'H',3:'D',4:'J'},
  {1:'B',2:'G',3:'E',4:'F'},
  {1:'D',2:'A',3:'G',4:'C'},
  {1:'H',2:'J',3:'B',4:'A'},
  {1:'C',2:'I',3:'F',4:'H'},
  {1:'E',2:'J',3:'I',4:'G'},
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API ---

// Purjehtijat
app.get('/api/sailors', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM sailors ORDER BY id').all());
});

app.put('/api/sailors', (req, res) => {
  const sailors = req.body;
  if (!Array.isArray(sailors)) return res.status(400).json({ error: 'Array expected' });
  const upd = db.prepare('UPDATE sailors SET name = ? WHERE id = ?');
  const tx = db.transaction(() => {
    sailors.forEach(s => upd.run(s.name, s.id));
  });
  tx();
  res.json({ ok: true });
});

// Veneet
app.get('/api/boats', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM boats ORDER BY id').all());
});

app.put('/api/boats', (req, res) => {
  const boats = req.body;
  if (!Array.isArray(boats)) return res.status(400).json({ error: 'Array expected' });
  const upd = db.prepare('UPDATE boats SET name = ? WHERE id = ?');
  const tx = db.transaction(() => {
    boats.forEach(b => upd.run(b.name, b.id));
  });
  tx();
  res.json({ ok: true });
});

// Aikataulu
app.get('/api/schedule', (req, res) => {
  res.json(SCHEDULE);
});

// Tulokset
app.get('/api/results', (req, res) => {
  const rows = db.prepare('SELECT race_index, sailor_id, position FROM results').all();
  const out = {};
  rows.forEach(r => {
    if (!out[r.race_index]) out[r.race_index] = {};
    out[r.race_index][r.sailor_id] = r.position;
  });
  res.json(out);
});

app.put('/api/results/:raceIndex', (req, res) => {
  const raceIndex = parseInt(req.params.raceIndex);
  if (isNaN(raceIndex) || raceIndex < 0 || raceIndex >= 20) {
    return res.status(400).json({ error: 'Invalid race index' });
  }
  const positions = req.body;
  if (!positions || typeof positions !== 'object') {
    return res.status(400).json({ error: 'Object expected' });
  }

  // Validoi: täsmälleen 4 purjehtijaa, sijoitukset 1-4
  const entries = Object.entries(positions);
  if (entries.length !== 4) return res.status(400).json({ error: '4 sailors required' });
  const posValues = entries.map(e => e[1]).sort();
  if (JSON.stringify(posValues) !== '[1,2,3,4]') {
    return res.status(400).json({ error: 'Positions must be 1,2,3,4' });
  }

  const del = db.prepare('DELETE FROM results WHERE race_index = ?');
  const ins = db.prepare('INSERT INTO results (race_index, sailor_id, position) VALUES (?, ?, ?)');
  const tx = db.transaction(() => {
    del.run(raceIndex);
    entries.forEach(([sailor, pos]) => ins.run(raceIndex, sailor, pos));
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/results/:raceIndex', (req, res) => {
  const raceIndex = parseInt(req.params.raceIndex);
  db.prepare('DELETE FROM results WHERE race_index = ?').run(raceIndex);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Purjehdus running on port ${PORT}`);
});
