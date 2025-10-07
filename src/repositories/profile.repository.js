// repositories/profile.repository.js
// CRUD helpers for profile table
const pool = require('../db');

async function getByDomain(domain) {
  const [rows] = await pool.execute('SELECT * FROM profile WHERE domain = ? LIMIT 1', [domain]);
  return rows && rows[0] ? rows[0] : null;
}

async function insertProfile(p) {
  const sql = `
    INSERT INTO profile (
      email, domain, country, region, location, size, managers_beyond_ceo, type, years_operating, top_line_revenue, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    p.email,
    p.domain,
    p.country,
    p.region,
    p.location,
    p.size,
    p.managers_beyond_ceo != null ? p.managers_beyond_ceo : null,
    p.type,
    p.years_operating,
    p.top_line_revenue != null ? p.top_line_revenue : null,
    p.last_updated || new Date()
  ];
  const [res] = await pool.execute(sql, params);
  return res.insertId || null;
}

async function updateByDomain(domain, p) {
  const sql = `
    UPDATE profile
       SET email = ?, country = ?, region = ?, location = ?, size = ?, managers_beyond_ceo = ?, type = ?, years_operating = ?, top_line_revenue = ?, last_updated = ?
     WHERE domain = ?
  `;
  const params = [
    p.email,
    p.country,
    p.region,
    p.location,
    p.size,
    p.managers_beyond_ceo != null ? p.managers_beyond_ceo : null,
    p.type,
    p.years_operating,
    p.top_line_revenue != null ? p.top_line_revenue : null,
    p.last_updated || new Date(),
    domain
  ];
  const [res] = await pool.execute(sql, params);
  return res.affectedRows > 0;
}

async function getByEmail(email) {
  const [rows] = await pool.execute('SELECT * FROM profile WHERE email = ? LIMIT 1', [email]);
  return rows && rows[0] ? rows[0] : null;
}

module.exports = { getByDomain, insertProfile, updateByDomain, getByEmail };


