const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureAuthenticated } = require('../middleware/auth');

// Welcome page
router.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('welcome', { title: 'Welcome' });
});

// Dashboard - With organization-filtered stats
router.get('/dashboard', ensureAuthenticated, async (req, res) => {
  try {
    let stats = {
      totalAudits: 0,
      activeAudits: 0,
      completedAudits: 0,
      pendingIssues: 0
    };
    let recentAudits = [];
    
    // Only get stats for non-system-admin users
    if (req.user.role !== 'system_admin' && req.user.organization_id) {
      // Get audit counts
      const auditsCount = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
        FROM audits
        WHERE organization_id = $1
      `, [req.user.organization_id]);
      
      if (auditsCount.rows.length > 0) {
        stats.totalAudits = parseInt(auditsCount.rows[0].total) || 0;
        stats.activeAudits = parseInt(auditsCount.rows[0].active) || 0;
        stats.completedAudits = parseInt(auditsCount.rows[0].completed) || 0;
      }
      
      // Get pending issues count (for auditors/managers)
      if (['auditor', 'manager', 'head_of_audit'].includes(req.user.role)) {
        const issuesCount = await pool.query(`
          SELECT COUNT(*) as pending
          FROM audit_issues ai
          LEFT JOIN audits a ON ai.audit_id = a.id
          WHERE ai.status = 'sent_for_verify'
            AND a.organization_id = $1
        `, [req.user.organization_id]);
        
        if (issuesCount.rows.length > 0) {
          stats.pendingIssues = parseInt(issuesCount.rows[0].pending) || 0;
        }
      }
      
      // Get recent audits
      const recentResult = await pool.query(`
        SELECT a.*, au.name as auditee_name, u.name as team_leader_name
        FROM audits a
        LEFT JOIN auditees au ON a.auditee_id = au.id
        LEFT JOIN users u ON a.team_leader_id = u.id
        WHERE a.organization_id = $1
        ORDER BY a.created_at DESC
        LIMIT 5
      `, [req.user.organization_id]);
      
      recentAudits = recentResult.rows;
    }
    
    res.render('dashboard', {
      title: 'Dashboard',
      user: req.user,
      stats: stats,
      recentAudits: recentAudits
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    // Fallback to simple dashboard on error
    res.render('dashboard', {
      title: 'Dashboard',
      user: req.user,
      stats: {
        totalAudits: 0,
        activeAudits: 0,
        completedAudits: 0,
        pendingIssues: 0
      },
      recentAudits: []
    });
  }
});

module.exports = router;
