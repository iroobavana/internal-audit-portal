const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureAuditee } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/management-comments');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'comment-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.get('/comments', ensureAuditee, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get auditee's audits with approved issues that are sent for commenting
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        a.audit_name,
        EXTRACT(YEAR FROM a.start_date) as audit_year,
        auv.audit_area,
        au.name as auditee_name
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      WHERE au.user_id = $1 
        AND ai.status = 'approved'
        AND ai.sent_for_commenting = true
        AND a.organization_id = $2
      ORDER BY ai.comment_due_date ASC
    `, [req.user.id, req.user.organization_id]);
    
    // Get comments for each issue and calculate remaining days
    const issues = await Promise.all(
      issuesResult.rows.map(async (issue) => {
        const commentsResult = await pool.query(`
          SELECT mc.*, u.name as commented_by_name
          FROM management_comments mc
          LEFT JOIN users u ON mc.commented_by = u.id
          WHERE mc.audit_issue_id = $1
          ORDER BY mc.created_at DESC
        `, [issue.id]);
        
        // Check if auditee has commented AFTER last sent date
        const auditeeHasCommented = commentsResult.rows.some(
          c => c.commented_by === req.user.id && 
               !c.is_auditor_response && 
               (!issue.sent_for_commenting_at || new Date(c.created_at) > new Date(issue.sent_for_commenting_at))
        );
        
        // Calculate remaining days
        const dueDate = new Date(issue.comment_due_date);
        dueDate.setHours(0, 0, 0, 0);
        const remainingDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        const isPastDue = remainingDays < 0;
        
        return {
          ...issue,
          comments: commentsResult.rows,
          has_auditee_comment: auditeeHasCommented,
          remaining_days: remainingDays,
          is_past_due: isPastDue
        };
      })
    );
    
    // Separate into pending, overdue, and commented
    const pendingIssues = issues.filter(i => !i.has_auditee_comment && !i.is_past_due);
    const overdueIssues = issues.filter(i => !i.has_auditee_comment && i.is_past_due);
    const commentedIssues = issues.filter(i => i.has_auditee_comment);
    
    // Get follow-up issues
    const followupResult = await pool.query(`
      SELECT 
        ai.*,
        a.audit_name,
        EXTRACT(YEAR FROM a.start_date) as audit_year,
        auv.audit_area,
        au.name as auditee_name
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      WHERE au.user_id = $1 
        AND ai.status = 'approved'
        AND ai.sent_for_followup = true
        AND a.organization_id = $2
      ORDER BY ai.followup_due_date ASC
    `, [req.user.id, req.user.organization_id]);
    
    // Calculate remaining days for follow-up issues
    const followupIssues = followupResult.rows.map(issue => {
      const dueDate = new Date(issue.followup_due_date);
      dueDate.setHours(0, 0, 0, 0);
      const remainingDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      const isPastDue = remainingDays < 0;
      
      return {
        ...issue,
        remaining_days: remainingDays,
        is_past_due: isPastDue
      };
    });
    
    // Separate into pending and responded
    const pendingFollowups = followupIssues.filter(i => !i.followup_responded);
    const respondedFollowups = followupIssues.filter(i => i.followup_responded);
    
    res.render('auditee/comments', {
      title: 'Audit Issues - Management Comments',
      pendingIssues: pendingIssues,
      overdueIssues: overdueIssues,
      commentedIssues: commentedIssues,
      pendingFollowups: pendingFollowups,
      respondedFollowups: respondedFollowups,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading auditee comments:', error);
    res.status(500).send('Error loading comments');
  }
});

// Add comment with file attachment
router.post('/comments/:issueId', ensureAuditee, upload.single('attachment'), async (req, res) => {
  try {
    const { comment } = req.body;
    
    // Verify issue belongs to auditee's organization
    const issueResult = await pool.query(`
      SELECT ai.comment_due_date, a.organization_id, au.user_id
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      WHERE ai.id = $1 AND au.user_id = $2 AND a.organization_id = $3
    `, [req.params.issueId, req.user.id, req.user.organization_id]);
    
    if (issueResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    const dueDate = new Date(issueResult.rows[0].comment_due_date);
    dueDate.setHours(23, 59, 59, 999);
    const now = new Date();
    
    if (now > dueDate) {
      return res.status(400).json({ success: false, error: 'Comment period has expired. Contact auditor to resend.' });
    }
    
    const attachmentPath = req.file ? '/uploads/management-comments/' + req.file.filename : null;
    
    await pool.query(`
      INSERT INTO management_comments (audit_issue_id, comment, commented_by, created_at, attachment_path)
      VALUES ($1, $2, $3, NOW(), $4)
    `, [req.params.issueId, comment, req.user.id, attachmentPath]);
    
    res.json({ success: true, message: 'Comment added successfully' });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit follow-up response
router.post('/followup/:issueId', ensureAuditee, upload.single('evidence'), async (req, res) => {
  try {
    const { response } = req.body;
    
    // Verify issue belongs to auditee's organization
    const issueResult = await pool.query(`
      SELECT ai.followup_due_date, a.organization_id, au.user_id
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      WHERE ai.id = $1 AND au.user_id = $2 AND a.organization_id = $3
    `, [req.params.issueId, req.user.id, req.user.organization_id]);
    
    if (issueResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    const dueDate = new Date(issueResult.rows[0].followup_due_date);
    dueDate.setHours(23, 59, 59, 999);
    const now = new Date();
    
    if (now > dueDate) {
      return res.status(400).json({ success: false, error: 'Follow-up period has expired. Contact auditor.' });
    }
    
    const evidencePath = req.file ? '/uploads/management-comments/' + req.file.filename : null;
    
    // Save to followup_responses history table
    await pool.query(`
      INSERT INTO followup_responses (audit_issue_id, response, evidence_path, responded_by, responded_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [req.params.issueId, response, evidencePath, req.user.id]);
    
    // Update audit_issues status
    await pool.query(`
      UPDATE audit_issues
      SET followup_responded = true,
          followup_response = $1,
          followup_evidence_path = $2,
          followup_responded_at = NOW()
      WHERE id = $3
    `, [response, evidencePath, req.params.issueId]);
    
    res.json({ success: true, message: 'Follow-up response submitted successfully' });
  } catch (error) {
    console.error('Error submitting follow-up:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
