const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureAuditor, ensureManagerOrHead } = require('../middleware/auth');

router.get('/', ensureAuditor, (req, res) => {
  res.render('issues/index', { title: 'Issues' });
});

router.get('/verify', ensureManagerOrHead, async (req, res) => {
  try {
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        a.audit_name,
        a.id as audit_id,
        EXTRACT(YEAR FROM a.start_date) as audit_year,
        au.name as auditee_name,
        ap.conclusion,
        ap.likelihood,
        ap.impact,
        ap.issue_rating,
        ap.score,
        auv.audit_area,
        wp.name as working_paper_name,
        u.name as submitted_by_name
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN working_papers wp ON ap.working_paper_id = wp.id
      LEFT JOIN users u ON ai.submitted_by = u.id
      WHERE ai.status = 'sent_for_verify' AND a.organization_id = $1
      ORDER BY ai.submitted_at DESC
    `, [req.user.organization_id]);
    
    res.render('issues/verify', {
      title: 'Verify Audit Issues',
      issues: issuesResult.rows
    });
  } catch (error) {
    console.error('Error loading verify issues:', error);
    req.flash('error_msg', 'Error loading issues');
    res.redirect('/dashboard');
  }
});

// Get filtered issues by status
router.get('/verify/:status', ensureManagerOrHead, async (req, res) => {
  try {
    const status = req.params.status;
    let whereClause = '';
    
    if (status === 'pending') {
      whereClause = "ai.status = 'sent_for_verify'";
    } else if (status === 'approved') {
      whereClause = "ai.status = 'approved'";
    } else if (status === 'amendment') {
      whereClause = "ai.status = 'sent_for_amendment'";
    } else if (status === 'removed') {
      whereClause = "ai.status = 'removed'";
    } else {
      whereClause = "ai.status = 'sent_for_verify'";
    }
    
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        a.audit_name,
        a.id as audit_id,
        EXTRACT(YEAR FROM a.start_date) as audit_year,
        au.name as auditee_name,
        ap.conclusion,
        ap.likelihood,
        ap.impact,
        ap.issue_rating,
        ap.score,
        auv.audit_area,
        wp.name as working_paper_name,
        u.name as submitted_by_name,
        v.name as verified_by_name
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN working_papers wp ON ap.working_paper_id = wp.id
      LEFT JOIN users u ON ai.submitted_by = u.id
      LEFT JOIN users v ON ai.verified_by = v.id
      WHERE ${whereClause} AND a.organization_id = $1
      ORDER BY ai.verified_at DESC NULLS LAST, ai.submitted_at DESC
    `, [req.user.organization_id]);
    
    res.json({
      success: true,
      issues: issuesResult.rows
    });
  } catch (error) {
    console.error('Error loading filtered issues:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// IMPORTANT: Comment routes MUST come BEFORE /:id routes
// Add general comment
router.post('/comments', ensureManagerOrHead, async (req, res) => {
  try {
    const { issue_id, comment } = req.body;
    
    console.log('Adding comment:', { issue_id, comment, userId: req.user.id });
    
    await pool.query(`
      INSERT INTO issue_comments (issue_id, comment, commented_by, commented_at)
      VALUES ($1, $2, $3, NOW())
    `, [issue_id, comment, req.user.id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add inline comment
router.post('/comments/inline', ensureManagerOrHead, async (req, res) => {
  try {
    const { issue_id, field_name, selected_text, comment } = req.body;
    
    console.log('Adding inline comment:', { issue_id, field_name, selected_text, comment, userId: req.user.id });
    
    await pool.query(`
      INSERT INTO issue_comments (issue_id, field_name, selected_text, comment, commented_by, commented_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [issue_id, field_name, selected_text, comment, req.user.id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding inline comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Approve issue
router.post('/:issueId/approve', ensureManagerOrHead, async (req, res) => {
  try {
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET status = 'approved',
          verified_by = $1,
          verified_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [req.user.id, req.params.issueId]);
    
    res.json({ success: true, message: 'Issue approved successfully' });
  } catch (error) {
    console.error('Error approving issue:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send for amendment
router.post('/:issueId/send-for-amendment', ensureManagerOrHead, async (req, res) => {
  try {
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET status = 'sent_for_amendment',
          verified_by = $1,
          verified_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [req.user.id, req.params.issueId]);
    
    res.json({ success: true, message: 'Issue sent for amendment' });
  } catch (error) {
    console.error('Error sending for amendment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove issue
router.post('/:issueId/remove', ensureManagerOrHead, async (req, res) => {
  try {
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET status = 'removed',
          verified_by = $1,
          verified_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [req.user.id, req.params.issueId]);
    
    res.json({ success: true, message: 'Issue removed' });
  } catch (error) {
    console.error('Error removing issue:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get issue details
router.get('/:id/details', ensureAuditor, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ai.*, a.audit_name, au.name as auditee_name, 
       u.name as submitted_by_name,
       auv.audit_area, wp.name as working_paper_name,
       ap.likelihood, ap.impact, ap.issue_rating, ap.score,
       ap.working_paper_id, ra.id as risk_assessment_id
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN users u ON ai.submitted_by = u.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN working_papers wp ON ap.working_paper_id = wp.id
      WHERE ai.id = $1
    `, [req.params.id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error loading issue details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get comments
router.get('/:id/comments', ensureManagerOrHead, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ic.*, u.name as commented_by
      FROM issue_comments ic
      LEFT JOIN users u ON ic.commented_by = u.id
      WHERE ic.issue_id = $1
      ORDER BY ic.commented_at DESC
    `, [req.params.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error loading comments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get management comments for an audit
router.get('/management-comments/:auditId', ensureAuditor, async (req, res) => {
  try {
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        auv.audit_area,
        a.audit_name,
        au.name as auditee_name
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      WHERE ai.audit_id = $1 AND ai.status = 'approved' AND a.organization_id = $2
      ORDER BY ai.verified_at DESC
    `, [req.params.auditId, req.user.organization_id]);
    
    // Get comments for each issue - only count comments AFTER last sent date
    const issues = await Promise.all(
      issuesResult.rows.map(async (issue) => {
        const commentsResult = await pool.query(`
          SELECT mc.*, u.name as commented_by_name
          FROM management_comments mc
          LEFT JOIN users u ON mc.commented_by = u.id
          WHERE mc.audit_issue_id = $1
          ORDER BY mc.created_at DESC
        `, [issue.id]);
        
        // Count auditor responses (each resend adds one)
        const resendCount = commentsResult.rows.filter(c => c.is_auditor_response).length;
        
        // Filter out old comments (before last sent) and auditor responses for counting
        const recentComments = commentsResult.rows.filter(c => 
          !c.is_auditor_response && 
          (!issue.sent_for_commenting_at || new Date(c.created_at) > new Date(issue.sent_for_commenting_at))
        );
        
        return {
          ...issue,
          comments: commentsResult.rows,
          recent_comment_count: recentComments.length,
          resend_count: resendCount
        };
      })
    );
    
    res.json({ success: true, issues });
  } catch (error) {
    console.error('Error loading management comments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Management Comment Actions
router.post('/:issueId/include-in-report', ensureAuditor, async (req, res) => {
  try {
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET include_in_report = true
      WHERE id = $1
    `, [req.params.issueId]);
    
    res.json({ success: true, message: 'Issue included in report' });
  } catch (error) {
    console.error('Error including in report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:issueId/exclude-from-report', ensureAuditor, async (req, res) => {
  try {
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET include_in_report = false
      WHERE id = $1
    `, [req.params.issueId]);
    
    res.json({ success: true, message: 'Issue excluded from report' });
  } catch (error) {
    console.error('Error excluding from report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:issueId/resend-for-comment', ensureAuditor, async (req, res) => {
  try {
    const { comment, due_date } = req.body;
    
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    if (!due_date) {
      return res.status(400).json({ success: false, error: 'Due date is required' });
    }
    
    // Keep status as 'approved', update due date AND sent_for_commenting_at timestamp
    await pool.query(`
      UPDATE audit_issues 
      SET sent_for_commenting = true,
          comment_due_date = $1,
          sent_for_commenting_at = NOW()
      WHERE id = $2
    `, [due_date, req.params.issueId]);
    
    if (comment) {
      await pool.query(`
        INSERT INTO management_comments (audit_issue_id, comment, commented_by, created_at, is_auditor_response)
        VALUES ($1, $2, $3, NOW(), true)
      `, [req.params.issueId, comment, req.user.id]);
    }
    
    res.json({ success: true, message: 'Issue resent for comment' });
  } catch (error) {
    console.error('Error resending for comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get issues for finalize report
router.get('/finalize-report/:auditId', ensureAuditor, async (req, res) => {
  try {
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        auv.audit_area,
        a.audit_name,
        au.name as auditee_name,
        ap.score
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      WHERE ai.audit_id = $1 
        AND ai.status = 'approved' 
        AND ai.include_in_report = true
        AND a.organization_id = $2
      ORDER BY auv.audit_area, ai.issue_title
    `, [req.params.auditId, req.user.organization_id]);
    
    res.json({ success: true, issues: issuesResult.rows });
  } catch (error) {
    console.error('Error loading finalize report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save corrective date
router.post('/:issueId/corrective-date', ensureAuditor, async (req, res) => {
  try {
    const { corrective_date } = req.body;
    
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET corrective_date = $1
      WHERE id = $2
    `, [corrective_date, req.params.issueId]);
    
    res.json({ success: true, message: 'Corrective date saved' });
  } catch (error) {
    console.error('Error saving corrective date:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate report
router.get('/generate-report/:auditId', ensureAuditor, async (req, res) => {
  try {
    const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');
    const fs = require('fs');
    const path = require('path');
    
    // Get audit details
    const auditResult = await pool.query(`
      SELECT a.*, au.name as auditee_name, EXTRACT(YEAR FROM a.start_date) as audit_year
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      WHERE a.id = $1
    `, [req.params.auditId]);
    
    if (auditResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    const audit = auditResult.rows[0];
    
    // Get issues marked for report
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        auv.audit_area,
        ap.conclusion,
        ap.score
      FROM audit_issues ai
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      WHERE ai.audit_id = $1 
        AND ai.status = 'approved' 
        AND ai.include_in_report = true
      ORDER BY auv.audit_area, ap.score DESC, ai.issue_title
    `, [req.params.auditId]);
    
    const issues = issuesResult.rows;
    
    if (issues.length === 0) {
      return res.status(400).json({ success: false, error: 'No issues to include in report' });
    }
    
    // Create document sections
    const docSections = [
      // Title
      new Paragraph({
        text: "INTERNAL AUDIT REPORT",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),
      
      new Paragraph({
        text: audit.audit_name,
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      }),
      
      new Paragraph({
        text: audit.auditee_name,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),
      
      new Paragraph({
        text: `Audit Year: ${audit.audit_year}`,
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 }
      }),
      
      // Executive Summary
      new Paragraph({
        text: "EXECUTIVE SUMMARY",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      
      new Paragraph({
        text: `This report presents the findings from the internal audit of ${audit.auditee_name} conducted for the period ${new Date(audit.start_date).toLocaleDateString()} to ${new Date(audit.finish_date).toLocaleDateString()}. The audit identified ${issues.length} issue(s) requiring management attention.`,
        spacing: { after: 400 }
      }),
      
      // Summary table
      new Paragraph({
        text: "Summary of Findings:",
        spacing: { before: 200, after: 200 },
        bold: true
      })
    ];
    
    // Count issues by rating
    const highCount = issues.filter(i => i.score === 'High').length;
    const mediumCount = issues.filter(i => i.score === 'Medium').length;
    const lowCount = issues.filter(i => i.score === 'Low').length;
    
    docSections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: "Risk Rating", bold: true })] }),
              new TableCell({ children: [new Paragraph({ text: "Count", bold: true })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("High")] }),
              new TableCell({ children: [new Paragraph(highCount.toString())] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("Medium")] }),
              new TableCell({ children: [new Paragraph(mediumCount.toString())] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("Low")] }),
              new TableCell({ children: [new Paragraph(lowCount.toString())] })
            ]
          })
        ]
      }),
      
      new Paragraph({ text: "", spacing: { after: 600 } }),
      
      // Detailed Findings
      new Paragraph({
        text: "DETAILED FINDINGS",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 400 }
      })
    );
    
    // Add each issue
    issues.forEach((issue, index) => {
      docSections.push(
        new Paragraph({
          text: `${index + 1}. ${issue.issue_title}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 }
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Audit Area: ", bold: true }),
            new TextRun(issue.audit_area || 'N/A')
          ],
          spacing: { after: 100 }
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Risk Rating: ", bold: true }),
            new TextRun(issue.score || 'N/A')
          ],
          spacing: { after: 200 }
        }),
        
        new Paragraph({
          text: "Criteria:",
          bold: true,
          spacing: { after: 100 }
        }),
        new Paragraph({
          text: issue.criteria || 'N/A',
          spacing: { after: 200 }
        }),
        
        new Paragraph({
          text: "Condition:",
          bold: true,
          spacing: { after: 100 }
        }),
        new Paragraph({
          text: issue.condition || 'N/A',
          spacing: { after: 200 }
        }),
        
        new Paragraph({
          text: "Cause:",
          bold: true,
          spacing: { after: 100 }
        }),
        new Paragraph({
          text: issue.cause || 'N/A',
          spacing: { after: 200 }
        }),
        
        new Paragraph({
          text: "Consequence:",
          bold: true,
          spacing: { after: 100 }
        }),
        new Paragraph({
          text: issue.consequence || 'N/A',
          spacing: { after: 200 }
        }),
        
        new Paragraph({
          text: "Recommendation:",
          bold: true,
          spacing: { after: 100 }
        }),
        new Paragraph({
          text: issue.corrective_action || 'N/A',
          spacing: { after: 200 }
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Target Completion Date: ", bold: true }),
            new TextRun(issue.corrective_date ? new Date(issue.corrective_date).toLocaleDateString() : 'N/A')
          ],
          spacing: { after: 400 }
        })
      );
    });
    
    // Create document
    const doc = new Document({
      sections: [{
        properties: {},
        children: docSections
      }]
    });
    
    // Generate filename
    const filename = `Audit_Report_${audit.audit_name.replace(/\s+/g, '_')}_${Date.now()}.docx`;
    const filepath = path.join(__dirname, '../uploads/reports', filename);
    
    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write file
    const buffer = await require('docx').Packer.toBuffer(doc);
    fs.writeFileSync(filepath, buffer);
    
    // Send file
    res.download(filepath, filename, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
      }
      // Delete file after download
      setTimeout(() => {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }, 60000); // Delete after 1 minute
    });
    
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Get follow-up issues
router.get('/followup-issues/:auditId', ensureAuditor, async (req, res) => {
  try {
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        auv.audit_area,
        ap.score
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      WHERE ai.audit_id = $1 
        AND ai.status = 'approved' 
        AND ai.include_in_report = true
        AND a.organization_id = $2
      ORDER BY ai.followup_due_date ASC, ai.issue_title
    `, [req.params.auditId, req.user.organization_id]);
    
    res.json({ success: true, issues: issuesResult.rows });
  } catch (error) {
    console.error('Error loading follow-up issues:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send for follow-up
router.post('/:issueId/send-for-followup', ensureAuditor, async (req, res) => {
  try {
    const { due_date } = req.body;
    
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    if (!due_date) {
      return res.status(400).json({ success: false, error: 'Due date is required' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET sent_for_followup = true,
          followup_due_date = $1,
          sent_for_followup_at = NOW()
      WHERE id = $2
    `, [due_date, req.params.issueId]);
    
    res.json({ success: true, message: 'Sent for follow-up successfully' });
  } catch (error) {
    console.error('Error sending for follow-up:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resend for follow-up
router.post('/:issueId/resend-followup', ensureAuditor, async (req, res) => {
  try {
    const { due_date, message } = req.body;
    
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    if (!due_date) {
      return res.status(400).json({ success: false, error: 'Due date is required' });
    }
    
    // Reset followup_responded to false and update due date
    await pool.query(`
      UPDATE audit_issues 
      SET followup_responded = false,
          followup_response = NULL,
          followup_evidence_path = NULL,
          followup_due_date = $1,
          sent_for_followup_at = NOW()
      WHERE id = $2
    `, [due_date, req.params.issueId]);
    
    // Increment resend count in history
    await pool.query(`
      UPDATE followup_responses 
      SET resend_count = resend_count + 1
      WHERE audit_issue_id = $1
    `, [req.params.issueId]);
    
    // If message provided, save it (optional: you could create a followup_messages table)
    // For now, we'll skip storing the message
    
    res.json({ success: true, message: 'Resent for follow-up successfully' });
  } catch (error) {
    console.error('Error resending for follow-up:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark follow-up as resolved
router.post('/:issueId/resolve-followup', ensureAuditor, async (req, res) => {
  try {
    // Verify issue belongs to user's organization
    const checkResult = await pool.query(`
      SELECT ai.id FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      WHERE ai.id = $1 AND a.organization_id = $2
    `, [req.params.issueId, req.user.organization_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    await pool.query(`
      UPDATE audit_issues 
      SET followup_resolved = true,
          followup_resolved_at = NOW()
      WHERE id = $1
    `, [req.params.issueId]);
    
    res.json({ success: true, message: 'Issue marked as resolved' });
  } catch (error) {
    console.error('Error marking as resolved:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get follow-up response history
router.get('/:issueId/followup-history', ensureAuditor, async (req, res) => {
  try {
    const historyResult = await pool.query(`
      SELECT 
        fr.*,
        u.name as responded_by_name
      FROM followup_responses fr
      LEFT JOIN users u ON fr.responded_by = u.id
      WHERE fr.audit_issue_id = $1
      ORDER BY fr.responded_at DESC
    `, [req.params.issueId]);
    
    res.json({ success: true, history: historyResult.rows });
  } catch (error) {
    console.error('Error loading history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Issues Register - View all approved issues included in reports
router.get('/issues-register', ensureAuditor, async (req, res) => {
  try {
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        a.audit_name,
        EXTRACT(YEAR FROM a.start_date) as audit_year,
        au.name as auditee_name,
        auv.audit_area,
        ap.score,
        COALESCE(ap.issue_rating, ap.likelihood * ap.impact) as issue_rating,
        u.name as submitted_by_name
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ai.submitted_by = u.id
      WHERE ai.status = 'approved' 
        AND ai.include_in_report = true
        AND a.organization_id = $1
      ORDER BY ai.created_at DESC
    `, [req.user.organization_id]);
    
    // Get list of auditees for filter
    const auditeesResult = await pool.query(`
      SELECT DISTINCT au.id, au.name 
      FROM auditees au
      INNER JOIN audits a ON au.id = a.auditee_id
      INNER JOIN audit_issues ai ON a.id = ai.audit_id
      WHERE ai.status = 'approved' AND ai.include_in_report = true
        AND au.organization_id = $1
      ORDER BY au.name
    `, [req.user.organization_id]);
    
    // Get list of audits for filter
    const auditsResult = await pool.query(`
      SELECT DISTINCT a.id, a.audit_name 
      FROM audits a
      INNER JOIN audit_issues ai ON a.id = ai.audit_id
      WHERE ai.status = 'approved' AND ai.include_in_report = true
        AND a.organization_id = $1
      ORDER BY a.audit_name
    `, [req.user.organization_id]);
    
    res.render('issues-register', {
      title: 'Issues Register',
      issues: issuesResult.rows,
      auditees: auditeesResult.rows,
      audits: auditsResult.rows,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading issues register:', error);
    req.flash('error_msg', 'Error loading issues register');
    res.redirect('/dashboard');
  }
});
// Follow-up Tracker - View all issues with follow-up status
router.get('/follow-up-tracker', ensureAuditor, async (req, res) => {
  try {
    const issuesResult = await pool.query(`
      SELECT 
        ai.*,
        a.audit_name,
        EXTRACT(YEAR FROM a.start_date) as audit_year,
        au.name as auditee_name,
        auv.audit_area,
        ap.score,
        COALESCE(ap.issue_rating, ap.likelihood * ap.impact) as issue_rating,
        ap.likelihood,
        ap.impact,
        u.name as submitted_by_name,
        'unresolved' as resolution_status
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ai.submitted_by = u.id
      WHERE ai.status = 'approved' 
        AND ai.include_in_report = true
        AND a.organization_id = $1
      ORDER BY ai.created_at DESC
    `, [req.user.organization_id]);
    
    res.render('follow-up-tracker', {
      title: 'Follow-up Tracker',
      issues: issuesResult.rows,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading follow-up tracker:', error);
    req.flash('error_msg', 'Error loading follow-up tracker');
    res.redirect('/dashboard');
  }
});
module.exports = router;


