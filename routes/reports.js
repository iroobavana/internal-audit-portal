const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureAuditor } = require('../middleware/auth');

router.get('/:auditId', ensureAuditor, async (req, res) => {
  try {
    // Verify audit belongs to user's organization
    const auditResult = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [req.params.auditId, req.user.organization_id]
    );
    
    if (auditResult.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    res.render('reports/index', { 
      title: 'Reports', 
      auditId: req.params.auditId 
    });
  } catch (error) {
    console.error('Error loading reports:', error);
    req.flash('error_msg', 'Error loading reports');
    res.redirect('/audits');
  }
});

module.exports = router;
