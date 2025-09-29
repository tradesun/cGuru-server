// repositories/actions.repository.js
// Creates Next Step actions with basic race-safety using a unique constraint.
const pool = require('../db');

// getCategoryCodeById: returns code for a given category id
async function getCategoryCodeById(categoryId) {
  const [rows] = await pool.execute('SELECT code FROM categories WHERE id = ? LIMIT 1', [categoryId]);
  return rows && rows[0] ? rows[0].code : null;
}

// findActionByEmailAndCode: returns existing action id if present
async function findActionByEmailAndCode(email, categoryCode) {
  const [rows] = await pool.execute('SELECT id FROM actions WHERE email = ? AND category_code = ? LIMIT 1', [email, categoryCode]);
  return rows && rows[0] ? rows[0].id : null;
}

// getNextOrderForEmail: compute next list_order for an email
async function getNextOrderForEmail(email, conn) {
  const connection = conn || pool;
  const [rows] = await connection.execute('SELECT COALESCE(MAX(list_order), 0) + 1 AS next_order FROM actions WHERE email = ?', [email]);
  return rows && rows[0] ? Number(rows[0].next_order) : 1;
}

// insertAction: inserts and returns insertId
async function insertAction({ email, categoryCode, stage, listOrder }, conn) {
  const connection = conn || pool;
  const [result] = await connection.execute(
    'INSERT INTO actions (email, category_code, stage, list_order) VALUES (?, ?, ?, ?)',
    [email, categoryCode, stage, listOrder]
  );
  return result.insertId;
}

// createAction: transactional create with duplicate handling
async function createAction({ email, categoryId, stage }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const categoryCode = await getCategoryCodeById(categoryId);
    if (!categoryCode) {
      const err = new Error('unknown category_id');
      err.status = 400;
      throw err;
    }

    const existingId = await findActionByEmailAndCode(email, categoryCode);
    if (existingId) {
      const err = new Error('Action already added');
      err.status = 409;
      throw err;
    }

    const listOrder = await getNextOrderForEmail(email, connection);
    const id = await insertAction({ email, categoryCode, stage, listOrder }, connection);

    await connection.commit();
    return { id, email, categoryCode, stage, list_order: listOrder };
  } catch (e) {
    try { await connection.rollback(); } catch (_) {}
    // Map duplicate key to 409 if unique index exists
    if (e && e.code === 'ER_DUP_ENTRY') {
      const err = new Error('Action already added');
      err.status = 409;
      throw err;
    }
    if (e && e.status) throw e;
    throw e;
  } finally {
    connection.release();
  }
}

module.exports = {
  getCategoryCodeById,
  findActionByEmailAndCode,
  getNextOrderForEmail,
  insertAction,
  createAction
};

// getActionsByEmail: list actions for an email ordered by list_order then id
async function getActionsByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT a.id, a.email, a.category_code, a.stage, a.list_order, c.title AS category_title
     FROM actions a
     LEFT JOIN categories c ON c.code = (a.category_code COLLATE utf16_general_ci)
     WHERE a.email = ?
     ORDER BY a.list_order ASC, a.id ASC`,
    [email]
  );
  return rows;
}

module.exports.getActionsByEmail = getActionsByEmail;

// reorderActions: transactionally update list_order for a set of actions scoped by email
async function reorderActions(email, updates) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const u of updates) {
      const [res] = await connection.execute(
        'UPDATE actions SET list_order = ? WHERE id = ? AND email = ?',
        [u.order, u.action_id, email]
      );
      if (res.affectedRows === 0) {
        const err = new Error('action not found for email');
        err.status = 400;
        throw err;
      }
    }

    await connection.commit();
    return { updated: updates.length };
  } catch (e) {
    try { await connection.rollback(); } catch (_) {}
    if (e && e.status) throw e;
    throw e;
  } finally {
    connection.release();
  }
}

module.exports.reorderActions = reorderActions;

// removeActionById: deletes a single action by id
async function removeActionById(actionId) {
  const [res] = await pool.execute('DELETE FROM actions WHERE id = ?', [actionId]);
  return res.affectedRows > 0;
}

module.exports.removeActionById = removeActionById;


