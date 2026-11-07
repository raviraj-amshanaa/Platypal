// Tiny JSON-file "database". Good enough for a hackathon demo: no setup, survives restarts.
// Delete data/db.json (or run `npm run reset`) to go back to the seed data.
const fs = require('fs');
const path = require('path');
const { seed } = require('./seed');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
let db = null;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    db = seed();
    save();
  }
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function getPatient(patientId) {
  return load().patients.find((p) => p.id === patientId);
}

function touch(patient) {
  patient.lastActive = new Date().toISOString();
}

module.exports = { load, save, id, getPatient, touch };
