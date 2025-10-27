const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const { ensureHeadOfAudit } = require('../middleware/auth');
const { sendCredentialsEmail } = require('../config/email');

// Generate random password
function generatePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const specialChars = '@#$';
  let password = 'Audit' + new Date().getFullYear() + '@';
  for (let i = 0; i < 4; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// List all auditees
router.get('/', ensureHeadOfAudit, async (req, res) => {
  console.log('=== DEBUG ===');
  console.log('User ID:', req.user.id);
  console.log('User Name:', req.user.name);
  console.log('User Organization ID:', req.user.organization_id);
  console.log('=============');
  try {
    const result = await pool.query(`
      SELECT a.*, COUNT(DISTINCT d.id) as department_count
      FROM auditees a
      LEFT JOIN auditee_departments d ON a.id = d.auditee_id
      WHERE a.organization_id = $1
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `, [req.user.organization_id]);
    
    res.render('auditees/list', {
      title: 'Auditees',
      auditees: result.rows
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading auditees');
    res.redirect('/dashboard');
  }
});

// Create auditee form
router.get('/create', ensureHeadOfAudit, (req, res) => {
  res.render('auditees/create', { title: 'Create Auditee' });
});

// Create auditee POST
router.post('/create', ensureHeadOfAudit, async (req, res) => {
  const { name, official_email, departments } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if email already exists
      const emailCheck = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [official_email]
      );
      
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.json({
          success: false,
          error: 'Email already exists in the system'
        });
      }
      
      // Generate password
      const plainPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      
      // Create user account for auditee
      const userResult = await client.query(
        'INSERT INTO users (name, email, password, role, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [name, official_email, hashedPassword, 'auditee', req.user.organization_id]
      );
      
      const userId = userResult.rows[0].id;
      
      // Insert auditee
      const auditeeResult = await client.query(
        'INSERT INTO auditees (name, official_email, created_by, user_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [name, official_email, req.user.id, userId, req.user.organization_id]
      );
      
      const auditeeId = auditeeResult.rows[0].id;
      
      // Insert departments if provided
      if (departments) {
        const deptArray = Array.isArray(departments) ? departments : [departments];
        
        for (const dept of deptArray) {
          if (dept && dept.trim() && dept.trim().length > 0) {
            await client.query(
              'INSERT INTO auditee_departments (auditee_id, department_name) VALUES ($1, $2)',
              [auditeeId, dept.trim()]
            );
          }
        }
      }
      
      await client.query('COMMIT');
      
      // Return credentials as JSON for modal display
      res.json({
        success: true,
        credentials: {
          email: official_email,
          password: plainPassword,
          name: name
        }
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Create auditee error:', error);
    res.json({
      success: false,
      error: 'Error creating auditee'
    });
  }
});

// View auditee details
router.get('/:id', ensureHeadOfAudit, async (req, res) => {
  try {
    const auditeeResult = await pool.query(
      'SELECT * FROM auditees WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organization_id]
    );
    
    if (auditeeResult.rows.length === 0) {
      req.flash('error_msg', 'Auditee not found');
      return res.redirect('/auditees');
    }
    
    const departmentsResult = await pool.query(
      'SELECT * FROM auditee_departments WHERE auditee_id = $1 ORDER BY department_name',
      [req.params.id]
    );
    
    res.render('auditees/view', {
      title: 'Auditee Details',
      auditee: auditeeResult.rows[0],
      departments: departmentsResult.rows
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading auditee details');
    res.redirect('/auditees');
  }
});

// Edit auditee form
router.get('/:id/edit', ensureHeadOfAudit, async (req, res) => {
  try {
    const auditeeResult = await pool.query(
      'SELECT * FROM auditees WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organization_id]
    );
    
    if (auditeeResult.rows.length === 0) {
      req.flash('error_msg', 'Auditee not found');
      return res.redirect('/auditees');
    }
    
    const departmentsResult = await pool.query(
      'SELECT * FROM auditee_departments WHERE auditee_id = $1',
      [req.params.id]
    );
    
    res.render('auditees/edit', {
      title: 'Edit Auditee',
      auditee: auditeeResult.rows[0],
      departments: departmentsResult.rows
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading auditee');
    res.redirect('/auditees');
  }
});

// Update auditee
router.put('/:id', ensureHeadOfAudit, async (req, res) => {
  const { name, official_email, departments } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Update auditee
      await client.query(
        'UPDATE auditees SET name = $1, official_email = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND organization_id = $4',
        [name, official_email, req.params.id, req.user.organization_id]
      );
      
      // Delete existing departments
      await client.query('DELETE FROM auditee_departments WHERE auditee_id = $1', [req.params.id]);
      
      // Insert new departments
      if (departments) {
        const deptArray = Array.isArray(departments) ? departments : [departments];
        
        for (const dept of deptArray) {
          if (dept && dept.trim() && dept.trim().length > 0) {
            await client.query(
              'INSERT INTO auditee_departments (auditee_id, department_name) VALUES ($1, $2)',
              [req.params.id, dept.trim()]
            );
          }
        }
      }
      
      await client.query('COMMIT');
      req.flash('success_msg', 'Auditee updated successfully');
      res.redirect(`/auditees/${req.params.id}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error updating auditee');
    res.redirect(`/auditees/${req.params.id}/edit`);
  }
});

// Delete auditee
router.delete('/:id', ensureHeadOfAudit, async (req, res) => {
  try {
    await pool.query('DELETE FROM auditees WHERE id = $1 AND organization_id = $2', [req.params.id, req.user.organization_id]);
    req.flash('success_msg', 'Auditee deleted successfully');
    res.redirect('/auditees');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error deleting auditee');
    res.redirect('/auditees');
  }
});

// Audit Universe for an auditee
router.get('/:id/audit-universe', ensureHeadOfAudit, async (req, res) => {
  try {
    const auditeeResult = await pool.query(
      'SELECT * FROM auditees WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organization_id]
    );
    
    if (auditeeResult.rows.length === 0) {
      req.flash('error_msg', 'Auditee not found');
      return res.redirect('/auditees');
    }
    
    const universeResult = await pool.query(`
      SELECT au.*, ad.department_name, a.name as auditee_name
      FROM audit_universe au
      LEFT JOIN auditee_departments ad ON au.department_id = ad.id
      LEFT JOIN auditees a ON au.auditee_id = a.id
      WHERE au.auditee_id = $1
      ORDER BY ad.department_name, au.audit_area
    `, [req.params.id]);
    
    const departmentsResult = await pool.query(
      'SELECT * FROM auditee_departments WHERE auditee_id = $1',
      [req.params.id]
    );
    
    res.render('auditees/audit-universe', {
      title: 'Audit Universe',
      auditee: auditeeResult.rows[0],
      universe: universeResult.rows,
      departments: departmentsResult.rows
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading audit universe');
    res.redirect('/auditees');
  }
});

// Add audit universe entry
router.post('/:id/audit-universe', ensureHeadOfAudit, async (req, res) => {
  const { department_id, audit_area, process, inherent_risk, control_measure, audit_procedure } = req.body;
  
  try {
    await pool.query(`
      INSERT INTO audit_universe 
      (auditee_id, department_id, audit_area, process, inherent_risk, control_measure, audit_procedure)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [req.params.id, department_id, audit_area, process, inherent_risk, control_measure, audit_procedure]);
    
    req.flash('success_msg', 'Audit universe entry added');
    res.redirect(`/auditees/${req.params.id}/audit-universe`);
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error adding audit universe entry');
    res.redirect(`/auditees/${req.params.id}/audit-universe`);
  }
});

// Send credentials email
router.post('/send-credentials', ensureHeadOfAudit, async (req, res) => {
  const { email, name, password } = req.body;
  
  try {
    await sendCredentialsEmail(email, name, password);
    res.json({ success: true });
  } catch (error) {
    console.error('Email error:', error);
    res.json({ success: false, error: 'Failed to send email' });
  }
});

module.exports = router;
