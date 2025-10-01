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
  const [rows] = await pool.execute('SELECT id FROM actions WHERE email = ? AND category_code = ? AND action_type = ? LIMIT 1', [email, categoryCode, 'category']);
  return rows && rows[0] ? rows[0].id : null;
}

// getNextOrderForEmail: compute next list_order for an email
async function getNextOrderForEmail(email, conn) {
  const connection = conn || pool;
  const [rows] = await connection.execute('SELECT COALESCE(MAX(list_order), 0) + 1 AS next_order FROM actions WHERE email = ?', [email]);
  return rows && rows[0] ? Number(rows[0].next_order) : 1;
}

// insertAction: inserts and returns insertId
async function insertAction({ email, categoryCode, stage, listOrder, addedBy, actionStatus }, conn) {
  const connection = conn || pool;
  const [result] = await connection.execute(
    'INSERT INTO actions (email, action_type, category_code, question_code, stage, list_order, added_by, action_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [email, 'category', categoryCode, null, stage, listOrder, addedBy || 'Manually added', actionStatus || 'Active']
  );
  return result.insertId;
}

// createAction: transactional create with duplicate handling
async function createAction({ email, categoryId, stage, actionType, questionCode, categoryCode, addedBy, actionStatus }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const at = (actionType || 'category').toLowerCase();
    let id;
    if (at === 'question') {
      const qCode = (questionCode || '').trim();
      if (!qCode) {
        const err = new Error('question_code is required');
        err.status = 400;
        throw err;
      }
      const qStage = Number(stage);
      if (!Number.isInteger(qStage)) {
        const err = new Error('stage must be an integer for question action');
        err.status = 400;
        throw err;
      }
      const [qRows] = await connection.execute('SELECT 1 FROM questions WHERE question_code = ? LIMIT 1', [qCode]);
      if (!qRows || !qRows[0]) {
        const err = new Error('unknown question_code');
        err.status = 400;
        throw err;
      }
      // Debug log
      console.log('[actions] createAction(question) incoming', { email, qCode, qStage, categoryId, categoryCode });
      const [dupQ] = await connection.execute('SELECT id, action_type, category_code, question_code, stage FROM actions WHERE email = ? AND question_code = ? AND stage = ? LIMIT 1', [email, qCode, qStage]);
      if (dupQ && dupQ[0]) {
        console.log('[actions] duplicate question action found', dupQ[0]);
      }
      if (dupQ && dupQ[0]) {
        const err = new Error('Action already added');
        err.status = 409;
        throw err;
      }
      // If categoryId was provided, derive categoryCode to display category title on next page
      let derivedCategoryCode = null;
      if (categoryCode) {
        derivedCategoryCode = categoryCode;
      } else if (categoryId) {
        derivedCategoryCode = await getCategoryCodeById(categoryId);
      }
      const listOrder = await getNextOrderForEmail(email, connection);
      const [res] = await connection.execute(
        'INSERT INTO actions (email, action_type, category_code, question_code, stage, list_order, added_by, action_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [email, 'question', derivedCategoryCode, qCode, qStage, listOrder, addedBy || 'Manually added', actionStatus || 'Active']
      );
      id = res.insertId;
      await connection.commit();
      return { id, email, action_type: 'question', category_code: derivedCategoryCode, question_code: qCode, stage: qStage, list_order: listOrder };
    } else {
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
      const [res] = await connection.execute(
        'INSERT INTO actions (email, action_type, category_code, question_code, stage, list_order, added_by, action_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [email, 'category', categoryCode, null, stage, listOrder, addedBy || 'Manually added', actionStatus || 'Active']
      );
      id = res.insertId;
      await connection.commit();
      return { id, email, action_type: 'category', category_code: categoryCode, stage, list_order: listOrder };
    }
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      console.error('[actions] ER_DUP_ENTRY on insert action', e && e.sqlMessage ? e.sqlMessage : e);
    } else {
      console.error('[actions] createAction error', e);
    }
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
    `SELECT a.id, a.email, a.action_type, a.category_code, a.question_code, a.stage, a.list_order, a.added_by, a.action_status, a.owner_email, a.owner_acknowledged, a.postpone_date, a.notes, c.title AS category_title
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

// setActionOwnerEmail: updates owner_email for an action
async function setActionOwnerEmail(actionId, ownerEmail) {
  const [res] = await pool.execute('UPDATE actions SET owner_email = ? WHERE id = ?', [ownerEmail, actionId]);
  return res.affectedRows > 0;
}

module.exports.setActionOwnerEmail = setActionOwnerEmail;

// updateActionStatusAndPostpone: set action_status and postpone_date
async function updateActionStatusAndPostpone(actionId, status, postponeDate) {
  const [res] = await pool.execute('UPDATE actions SET action_status = ?, postpone_date = ? WHERE id = ?', [status, postponeDate, actionId]);
  return res.affectedRows > 0;
}

module.exports.updateActionStatusAndPostpone = updateActionStatusAndPostpone;

// setActionOwnerAcknowledged: updates owner_acknowledged flag for an action
async function setActionOwnerAcknowledged(actionId, acknowledged) {
  const val = acknowledged ? 1 : 0;
  const [res] = await pool.execute('UPDATE actions SET owner_acknowledged = ? WHERE id = ?', [val, actionId]);
  return res.affectedRows > 0;
}

module.exports.setActionOwnerAcknowledged = setActionOwnerAcknowledged;

// setActionNotes: updates notes for an action
async function setActionNotes(actionId, notes) {
  const [res] = await pool.execute('UPDATE actions SET notes = ? WHERE id = ?', [notes, actionId]);
  return res.affectedRows > 0;
}

module.exports.setActionNotes = setActionNotes;

// setActionStatus: updates action_status for an action
async function setActionStatus(actionId, actionStatus) {
  const [res] = await pool.execute('UPDATE actions SET action_status = ? WHERE id = ?', [actionStatus, actionId]);
  return res.affectedRows > 0;
}

module.exports.setActionStatus = setActionStatus;

