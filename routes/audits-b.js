const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureHeadOfAudit, ensureAuditor } = require('../middleware/auth');

// List all audits
router.get('/', ensureAuditor, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, au.name as auditee_name, u.name as team_leader_name
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN users u ON a.team_leader_id = u.id
      WHERE a.organization_id = $1
      ORDER BY a.start_date DESC
    `, [req.user.organization_id]);
    
    res.render('audits/list', {
      title: 'Audits',
      audits: result.rows
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading audits');
    res.redirect('/dashboard');
  }
});

// Create audit form
router.get('/create', ensureHeadOfAudit, async (req, res) => {
  try {
    const auditeesResult = await pool.query('SELECT * FROM auditees WHERE organization_id = $1 ORDER BY name', [req.user.organization_id]);
    const auditorsResult = await pool.query(
      "SELECT * FROM users WHERE role IN ('auditor', 'manager', 'head_of_audit') AND organization_id = $1 ORDER BY name",
      [req.user.organization_id]
    );
    
    res.render('audits/create', {
      title: 'Create Audit',
      auditees: auditeesResult.rows,
      auditors: auditorsResult.rows
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading form');
    res.redirect('/audits');
  }
});

// Create audit POST
router.post('/create', ensureHeadOfAudit, async (req, res) => {
  const { audit_name, auditee_id, team_leader_id, start_date, end_date, team_members } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert audit
      const auditResult = await client.query(`
        INSERT INTO audits (audit_name, auditee_id, team_leader_id, start_date, end_date, created_by, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [audit_name, auditee_id, team_leader_id, start_date, end_date, req.user.id, req.user.organization_id]);
      
      const auditId = auditResult.rows[0].id;
      
      // Add team members
      if (team_members && Array.isArray(team_members)) {
        for (const memberId of team_members) {
          await client.query(
            'INSERT INTO audit_team (audit_id, user_id) VALUES ($1, $2)',
            [auditId, memberId]
          );
        }
      }
      
      // Add team leader to team
      await client.query(
        'INSERT INTO audit_team (audit_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [auditId, team_leader_id]
      );
      
      await client.query('COMMIT');
      req.flash('success_msg', 'Audit created successfully');
      res.redirect('/audits');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error creating audit');
    res.redirect('/audits/create');
  }
});
// Edit audit form
router.get('/:id/edit', ensureHeadOfAudit, async (req, res) => {
  try {
    const auditId = req.params.id;
    
    // Get audit details
    const auditResult = await pool.query(`
      SELECT * FROM audits WHERE id = $1 AND organization_id = $2
    `, [auditId, req.user.organization_id]);
    
    if (auditResult.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    const audit = auditResult.rows[0];
    
    // Get auditees
    const auditeesResult = await pool.query('SELECT * FROM auditees WHERE organization_id = $1 ORDER BY name', [req.user.organization_id]);
    
    // Get auditors
    const auditorsResult = await pool.query(
      "SELECT * FROM users WHERE role IN ('auditor', 'manager', 'head_of_audit') AND organization_id = $1 ORDER BY name",
      [req.user.organization_id]
    );
    
    // Get current team members
    const teamMembersResult = await pool.query(
      'SELECT user_id FROM audit_team WHERE audit_id = $1',
      [auditId]
    );
    const currentTeamMembers = teamMembersResult.rows.map(row => row.user_id);
    
    res.render('audits/edit', {
      title: 'Edit Audit',
      audit: audit,
      auditees: auditeesResult.rows,
      auditors: auditorsResult.rows,
      currentTeamMembers: currentTeamMembers
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading audit');
    res.redirect('/audits');
  }
});

// Update audit POST
router.post('/:id/edit', ensureHeadOfAudit, async (req, res) => {
  const auditId = req.params.id;
  const { audit_name, auditee_id, team_leader_id, start_date, end_date, audit_year, team_members } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Verify audit belongs to organization
      const checkResult = await client.query(
        'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
        [auditId, req.user.organization_id]
      );
      
      if (checkResult.rows.length === 0) {
        throw new Error('Audit not found');
      }
      
      // Update audit
      await client.query(`
        UPDATE audits 
        SET audit_name = $1, auditee_id = $2, team_leader_id = $3, 
            start_date = $4, end_date = $5, audit_year = $6
        WHERE id = $7 AND organization_id = $8
      `, [audit_name, auditee_id, team_leader_id, start_date, end_date, audit_year, auditId, req.user.organization_id]);
      
      // Delete existing team members
      await client.query('DELETE FROM audit_team WHERE audit_id = $1', [auditId]);
      
      // Add updated team members
      if (team_members && Array.isArray(team_members)) {
        for (const memberId of team_members) {
          await client.query(
            'INSERT INTO audit_team (audit_id, user_id) VALUES ($1, $2)',
            [auditId, memberId]
          );
        }
      }
      
      // Add team leader to team if not already included
      await client.query(
        'INSERT INTO audit_team (audit_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [auditId, team_leader_id]
      );
      
      await client.query('COMMIT');
      
      req.flash('success_msg', 'Audit updated successfully');
      res.redirect('/audits');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error updating audit');
    res.redirect(`/audits/${auditId}/edit`);
  }
});

// Delete audit POST
router.post('/:id/delete', ensureHeadOfAudit, async (req, res) => {
  const auditId = req.params.id;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Verify audit belongs to organization
      const checkResult = await client.query(
        'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
        [auditId, req.user.organization_id]
      );
      
      if (checkResult.rows.length === 0) {
        throw new Error('Audit not found');
      }
      
      // Delete team members
      await client.query('DELETE FROM audit_team WHERE audit_id = $1', [auditId]);
      
      // Delete audit
      await client.query('DELETE FROM audits WHERE id = $1 AND organization_id = $2', [auditId, req.user.organization_id]);
      
      await client.query('COMMIT');
      
      req.flash('success_msg', 'Audit deleted successfully');
      res.redirect('/audits');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error deleting audit');
    res.redirect('/audits');
  }
});
// View all audit universe entries
router.get('/audit-universe-all', async (req, res) => {
  try {
    const universeResult = await pool.query(`
      SELECT 
        au.*,
        a.name as auditee_name,
        ad.department_name
      FROM audit_universe au
      LEFT JOIN auditees a ON au.auditee_id = a.id
      LEFT JOIN auditee_departments ad ON au.department_id = ad.id
      WHERE a.organization_id = $1
      ORDER BY a.name, ad.department_name, au.audit_area
    `, [req.user.organization_id]);
    
    // Get list of all auditees for filter
    const auditeesResult = await pool.query(`
      SELECT id, name FROM auditees WHERE organization_id = $1 ORDER BY name
    `, [req.user.organization_id]);
    
    res.render('audits/audit-universe-all', {
      title: 'Audit Universe',
      universe: universeResult.rows,
      auditees: auditeesResult.rows,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading audit universe:', error);
    req.flash('error_msg', 'Error loading audit universe');
    res.redirect('/dashboard');
  }
});

// View audit details - FIXED VARIABLE NAMES
router.get('/:id', ensureAuditor, async (req, res) => {
  try {
    const auditResult = await pool.query(`
      SELECT a.*, au.name as auditee_name, u.name as team_leader_name
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN users u ON a.team_leader_id = u.id
      WHERE a.id = $1 AND a.organization_id = $2
    `, [req.params.id, req.user.organization_id]);
    
    if (auditResult.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    const audit = auditResult.rows[0];
    
    // Get team members
    const teamResult = await pool.query(`
      SELECT u.id, u.name, u.email, u.role
      FROM audit_team at
      JOIN users u ON at.user_id = u.id
      WHERE at.audit_id = $1
    `, [req.params.id]);
    
    // Get audit universe items for this auditee
    const universeResult = await pool.query(`
      SELECT * FROM audit_universe 
      WHERE auditee_id = $1 
      ORDER BY audit_area, process
    `, [audit.auditee_id]);
    
    // Get document library (if exists)
    let documentsResult = { rows: [] };
    try {
      documentsResult = await pool.query(`
        SELECT * FROM document_library
        WHERE audit_id = $1
        ORDER BY id DESC
      `, [req.params.id]);
    } catch (docError) {
      console.log('Document library query skipped:', docError.message);
    }
    
    // Get risk assessments for this audit
    const riskResult = await pool.query(`
      SELECT ra.*, auv.audit_area, auv.process, u.name as auditor_name
      FROM risk_assessment ra
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      WHERE ra.audit_id = $1
      ORDER BY ra.likelihood * ra.impact DESC
    `, [req.params.id]);
    
    // Get selected areas (for Testing Procedures and Audit Procedures)
    const selectedAreasResult = await pool.query(`
      SELECT ra.*, auv.audit_area, auv.process, auv.audit_procedure,
             (ra.likelihood * ra.impact) as risk_rating,
             CASE 
               WHEN (ra.likelihood * ra.impact) >= 15 THEN 'High'
               WHEN (ra.likelihood * ra.impact) >= 7 THEN 'Medium'
               ELSE 'Low'
             END as score,
             u.name as auditor_name
      FROM risk_assessment ra
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      WHERE ra.audit_id = $1 AND ra.is_selected = true
      ORDER BY auv.audit_area
    `, [req.params.id]);
    
    // Generate icons for each selected area
    for (const area of selectedAreasResult.rows) {
      area.icon = await getIconForAuditArea(area.audit_area);
    }
    
    // Get audit procedures - RENAMED TO MATCH TEMPLATE
    const proceduresResult = await pool.query(`
      SELECT ap.*, ra.audit_universe_id, auv.audit_area, auv.audit_procedure,
             u.name as auditor_name, wp.name as working_paper_name
      FROM audit_procedures ap
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      LEFT JOIN working_papers wp ON ap.working_paper_id = wp.id
      WHERE ap.audit_id = $1
      ORDER BY auv.audit_area
    `, [req.params.id]);
    
    // Get working papers
    const wpResult = await pool.query(`
      SELECT wp.*, 
             (SELECT COUNT(*) FROM working_paper_columns WHERE working_paper_id = wp.id) as column_count
      FROM working_papers wp
      WHERE wp.organization_id = $1
      ORDER BY wp.name
    `, [req.user.organization_id]);
    
    // Get attached working papers - only from FIRST risk_assessment_id per audit_area
    // This matches Testing Procedures folder creation logic (one folder per unique audit_area)
    const attachedWPsResult = await pool.query(`
      WITH first_risk_ids AS (
        SELECT DISTINCT ON (auv.audit_area) 
               ra.id as risk_assessment_id,
               auv.audit_area
        FROM risk_assessment ra
        LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
        WHERE ra.audit_id = $1 AND ra.is_selected = true
        ORDER BY auv.audit_area, ra.id
      )
      SELECT tpw.risk_assessment_id, tpw.working_paper_id, 
             wp.name as working_paper_name, fri.audit_area
      FROM testing_procedure_wp tpw
      INNER JOIN first_risk_ids fri ON tpw.risk_assessment_id = fri.risk_assessment_id
      LEFT JOIN working_papers wp ON tpw.working_paper_id = wp.id
      WHERE tpw.audit_id = $1
    `, [req.params.id]);
    
    // Get audit issues (if exists)
    let issuesResult = { rows: [] };
    try {
      issuesResult = await pool.query(`
        SELECT ai.*, 
               auv.audit_area, 
               auv.process as audit_objective,
               ap.record_of_work,
               ap.conclusion,
               ap.evidence,
               ap.result,
               ap.cause as ap_cause,
               (ap.likelihood * ap.impact) as issue_rating,
               CASE 
                 WHEN (ap.likelihood * ap.impact) >= 15 THEN 'High'
                 WHEN (ap.likelihood * ap.impact) >= 7 THEN 'Medium'
                 ELSE 'Low'
               END as score,
               wp.name as working_paper_name,
               u.name as submitted_by_name,
               mc.comment as management_comment,
               mc.auditee_response,
               mc.attachment_path,
               mc.commented_at,
               mc.comment_status
        FROM audit_issues ai
        LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
        LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
        LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
        LEFT JOIN working_papers wp ON ap.working_paper_id = wp.id
        LEFT JOIN users u ON ai.submitted_by = u.id
        LEFT JOIN management_comments mc ON ai.id = mc.audit_issue_id
        WHERE ai.audit_id = $1
        ORDER BY ai.created_at DESC
      `, [req.params.id]);
    } catch (issueError) {
      console.log('Audit issues query skipped:', issueError.message);
    }
    
    res.render('audits/workspace', {
      title: `Audit: ${audit.audit_name}`,
      audit: audit,
      teamMembers: teamResult.rows,
      universeItems: universeResult.rows,
      documents: documentsResult.rows,
      riskAssessments: riskResult.rows,
      selectedAreas: selectedAreasResult.rows,
      procedures: proceduresResult.rows,
      workingPapers: wpResult.rows,
      attachedWPs: attachedWPsResult.rows,
      issues: issuesResult.rows,
      user: req.user
    });
    
  } catch (error) {
    console.error('Error loading audit:', error);
    req.flash('error_msg', 'Error loading audit details');
    res.redirect('/audits');
  }
});

// Testing Procedures Overview - Shows all folders
router.get('/:auditId/testing-procedures', ensureAuditor, async (req, res) => {
  try {
    // Get audit details with organization check
    const auditResult = await pool.query(`
      SELECT a.*, au.name as auditee_name, u.name as team_leader_name
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN users u ON a.team_leader_id = u.id
      WHERE a.id = $1 AND a.organization_id = $2
    `, [req.params.auditId, req.user.organization_id]);
    
    if (auditResult.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    const audit = auditResult.rows[0];
    
    // Get all selected audit areas (folders)
    const areasResult = await pool.query(`
      SELECT ra.*, auv.audit_area, auv.process,
             CASE 
               WHEN (ra.likelihood * ra.impact) >= 15 THEN 'High'
               WHEN (ra.likelihood * ra.impact) >= 7 THEN 'Medium'
               ELSE 'Low'
             END as score,
             u.name as auditor_name
      FROM risk_assessment ra
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      WHERE ra.audit_id = $1 AND ra.is_selected = true
      ORDER BY auv.audit_area
    `, [req.params.auditId]);
    
    // Get all working papers for organization
    const wpResult = await pool.query(`
      SELECT wp.id, wp.name, wp.allow_row_insert,
             (SELECT COUNT(*) FROM working_paper_columns WHERE working_paper_id = wp.id) as column_count
      FROM working_papers wp
      WHERE wp.organization_id = $1
      ORDER BY wp.name
    `, [req.user.organization_id]);
    
    // Get all attached working papers
    const attachedResult = await pool.query(`
      SELECT tpw.*, wp.name as working_paper_name
      FROM testing_procedure_wp tpw
      LEFT JOIN working_papers wp ON tpw.working_paper_id = wp.id
      WHERE tpw.audit_id = $1
    `, [req.params.auditId]);
    
    res.render('audits/testing-procedures', {
      title: 'Testing Procedures',
      audit: audit,
      auditAreas: areasResult.rows,
      workingPapers: wpResult.rows,
      attachedWPs: attachedResult.rows,
      selectedFolderId: req.query.folder || null
    });
    
  } catch (error) {
    console.error('Error loading testing procedures:', error);
    req.flash('error_msg', 'Error loading testing procedures');
    res.redirect(`/audits/${req.params.auditId}/workspace`);
  }
});

// Testing Procedures Folder - Full Page View
router.get('/:auditId/testing-procedures/:riskAssessmentId', ensureAuditor, async (req, res) => {
  try {
    // Get audit details with organization check
    const auditResult = await pool.query(`
      SELECT a.*, au.name as auditee_name
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      WHERE a.id = $1 AND a.organization_id = $2
    `, [req.params.auditId, req.user.organization_id]);
    
    if (auditResult.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    const audit = auditResult.rows[0];
    
    // Get risk assessment (folder) details
    const riskResult = await pool.query(`
      SELECT ra.*, auv.audit_area, auv.process, auv.control_measure,
             CASE 
               WHEN (ra.likelihood * ra.impact) >= 15 THEN 'High'
               WHEN (ra.likelihood * ra.impact) >= 7 THEN 'Medium'
               ELSE 'Low'
             END as risk_level,
             u.name as auditor_name
      FROM risk_assessment ra
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      WHERE ra.id = $1 AND ra.audit_id = $2
    `, [req.params.riskAssessmentId, req.params.auditId]);
    
    if (riskResult.rows.length === 0) {
      req.flash('error_msg', 'Testing procedure folder not found');
      return res.redirect(`/audits/${req.params.auditId}/workspace`);
    }
    
    const folder = riskResult.rows[0];
    
    // Get all working papers from organization
    const allWPResult = await pool.query(`
      SELECT wp.id, wp.name, wp.allow_row_insert,
             (SELECT COUNT(*) FROM working_paper_columns WHERE working_paper_id = wp.id) as column_count
      FROM working_papers wp
      WHERE wp.organization_id = $1
      ORDER BY wp.name
    `, [req.user.organization_id]);
    
    // Get attached working papers with their columns and data
    const attachedResult = await pool.query(`
      SELECT tpw.working_paper_id, wp.name, wp.allow_row_insert
      FROM testing_procedure_wp tpw
      LEFT JOIN working_papers wp ON tpw.working_paper_id = wp.id
      WHERE tpw.audit_id = $1 AND tpw.risk_assessment_id = $2
      ORDER BY tpw.created_at
    `, [req.params.auditId, req.params.riskAssessmentId]);
    
    // Get columns and data for each attached working paper
    const attachedWPs = await Promise.all(
      attachedResult.rows.map(async (wp) => {
        // Get columns
        const columnsResult = await pool.query(`
          SELECT * FROM working_paper_columns
          WHERE working_paper_id = $1
          ORDER BY column_order
        `, [wp.working_paper_id]);
        
        // Get existing data
        const dataResult = await pool.query(`
          SELECT * FROM testing_procedure_data
          WHERE audit_id = $1 AND risk_assessment_id = $2 AND working_paper_id = $3
          ORDER BY row_order
        `, [req.params.auditId, req.params.riskAssessmentId, wp.working_paper_id]);
        
  return {
  id: wp.working_paper_id,
  working_paper_id: wp.working_paper_id,
  name: wp.name,
  allow_row_insert: wp.allow_row_insert,
  columns: columnsResult.rows,
  rows: dataResult.rows
};
      })
    );
    
    res.render('audits/testing-procedures-folder', {
  title: 'Testing Procedures',
  audit: audit,
  folder: folder,
  folderName: folder.audit_area,
  riskScore: folder.risk_level,
  auditorName: folder.auditor_name,
  riskAssessmentId: req.params.riskAssessmentId,
  allWorkingPapers: allWPResult.rows,
  attachedWPs: attachedWPs,
  workingPapersWithData: attachedWPs
});
    
  } catch (error) {
    console.error('Error loading testing procedures folder:', error);
    req.flash('error_msg', 'Error loading testing procedures');
    res.redirect(`/audits/${req.params.auditId}/workspace`);
  }
});

// Attach working paper to testing procedure folder
router.post('/:auditId/testing-procedures/:riskAssessmentId/attach', ensureAuditor, async (req, res) => {
  const { working_paper_id } = req.body;
  
  try {
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [req.params.auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    await pool.query(`
      INSERT INTO testing_procedure_wp (audit_id, risk_assessment_id, working_paper_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (audit_id, risk_assessment_id, working_paper_id) DO NOTHING
    `, [req.params.auditId, req.params.riskAssessmentId, working_paper_id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error attaching working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detach working paper from testing procedure folder
router.post('/:auditId/testing-procedures/:riskAssessmentId/detach', ensureAuditor, async (req, res) => {
  const { working_paper_id } = req.body;
  
  try {
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [req.params.auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    await pool.query(`
      DELETE FROM testing_procedure_wp 
      WHERE audit_id = $1 AND risk_assessment_id = $2 AND working_paper_id = $3
    `, [req.params.auditId, req.params.riskAssessmentId, working_paper_id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error detaching working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save working paper data in testing procedure folder
router.post('/:auditId/testing-procedures/:riskAssessmentId/save-wp/:wpId', ensureAuditor, async (req, res) => {
  const { rows } = req.body;
  
  try {
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [req.params.auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete existing data for this working paper in this folder
      await client.query(`
        DELETE FROM testing_procedure_data
        WHERE audit_id = $1 AND risk_assessment_id = $2 AND working_paper_id = $3
      `, [req.params.auditId, req.params.riskAssessmentId, req.params.wpId]);
      
      // Insert new data
      if (rows && Object.keys(rows).length > 0) {
        let rowIndex = 0;
        for (const rowKey in rows) {
          const rowData = rows[rowKey];
          await client.query(`
            INSERT INTO testing_procedure_data 
            (audit_id, risk_assessment_id, working_paper_id, row_order, data)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            req.params.auditId,
            req.params.riskAssessmentId,
            req.params.wpId,
            rowIndex,
            JSON.stringify(rowData)
          ]);
          rowIndex++;
        }
      }
      
      await client.query('COMMIT');
      res.json({ success: true });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error saving working paper data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Edit audit
router.get('/:id/edit', ensureHeadOfAudit, async (req, res) => {
  try {
    const auditResult = await pool.query(`
      SELECT * FROM audits WHERE id = $1 AND organization_id = $2
    `, [req.params.id, req.user.organization_id]);
    
    if (auditResult.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    const teamResult = await pool.query(`
      SELECT user_id FROM audit_team WHERE audit_id = $1
    `, [req.params.id]);
    
    const auditeesResult = await pool.query('SELECT * FROM auditees WHERE organization_id = $1 ORDER BY name', [req.user.organization_id]);
    const auditorsResult = await pool.query(
      "SELECT * FROM users WHERE role IN ('auditor', 'manager', 'head_of_audit') AND organization_id = $1 ORDER BY name",
      [req.user.organization_id]
    );
    
    res.render('audits/edit', {
      title: 'Edit Audit',
      audit: auditResult.rows[0],
      teamMembers: teamResult.rows.map(t => t.user_id),
      auditees: auditeesResult.rows,
      auditors: auditorsResult.rows
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading audit');
    res.redirect('/audits');
  }
});

// Update audit
router.post('/:id/update', ensureHeadOfAudit, async (req, res) => {
  const { audit_name, auditee_id, team_leader_id, start_date, end_date, team_members } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Update audit
      await client.query(`
        UPDATE audits 
        SET audit_name = $1, auditee_id = $2, team_leader_id = $3, 
            start_date = $4, end_date = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND organization_id = $7
      `, [audit_name, auditee_id, team_leader_id, start_date, end_date, req.params.id, req.user.organization_id]);
      
      // Delete existing team members
      await client.query('DELETE FROM audit_team WHERE audit_id = $1', [req.params.id]);
      
      // Add new team members
      if (team_members && Array.isArray(team_members)) {
        for (const memberId of team_members) {
          await client.query(
            'INSERT INTO audit_team (audit_id, user_id) VALUES ($1, $2)',
            [req.params.id, memberId]
          );
        }
      }
      
      // Ensure team leader is in team
      await client.query(
        'INSERT INTO audit_team (audit_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, team_leader_id]
      );
      
      await client.query('COMMIT');
      req.flash('success_msg', 'Audit updated successfully');
      res.redirect(`/audits/${req.params.id}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error updating audit');
    res.redirect(`/audits/${req.params.id}/edit`);
  }
});

// Delete audit
router.delete('/:id', ensureHeadOfAudit, async (req, res) => {
  try {
    await pool.query('DELETE FROM audits WHERE id = $1 AND organization_id = $2', [req.params.id, req.user.organization_id]);
    req.flash('success_msg', 'Audit deleted successfully');
    res.redirect('/audits');
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error deleting audit');
    res.redirect('/audits');
  }
});

// Upload document to library
router.post('/:id/upload-document', ensureAuditor, async (req, res) => {
  const multer = require('multer');
  const path = require('path');
  
  const storage = multer.diskStorage({
    destination: './uploads/documents/',
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });
  
  const upload = multer({ storage: storage }).single('document');
  
  upload(req, res, async (err) => {
    if (err) {
      return res.json({ success: false, error: 'Upload failed' });
    }
    
    try {
      const { document_name } = req.body;
      const filePath = req.file.path;
      
      await pool.query(`
        INSERT INTO document_library (audit_id, document_name, file_path, uploaded_by)
        VALUES ($1, $2, $3, $4)
      `, [req.params.id, document_name, filePath, req.user.id]);
      
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.json({ success: false, error: 'Database error' });
    }
  });
});

// Save risk assessment
router.post('/:id/risk-assessment', ensureAuditor, async (req, res) => {
  const { assessments } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const assessment of assessments) {
        const { universe_id, likelihood, impact, is_selected, assigned_auditor } = assessment;
        
        const risk_rating = likelihood * impact;
        let score = 'Low';
        if (risk_rating >= 15) score = 'High';
        else if (risk_rating >= 7) score = 'Medium';
        
        // Check if exists
        const existing = await client.query(
          'SELECT id FROM risk_assessment WHERE audit_id = $1 AND audit_universe_id = $2',
          [req.params.id, universe_id]
        );
        
        if (existing.rows.length > 0) {
          // Update
          await client.query(`
            UPDATE risk_assessment 
            SET likelihood = $1, impact = $2, risk_rating = $3, score = $4, 
                is_selected = $5, assigned_auditor_id = $6, updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
          `, [likelihood, impact, risk_rating, score, is_selected, assigned_auditor || null, existing.rows[0].id]);
        } else {
          // Insert
          await client.query(`
            INSERT INTO risk_assessment 
            (audit_id, audit_universe_id, likelihood, impact, risk_rating, score, is_selected, assigned_auditor_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [req.params.id, universe_id, likelihood, impact, risk_rating, score, is_selected, assigned_auditor || null]);
        }
      }
      
      await client.query('COMMIT');
      res.json({ success: true });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error saving risk assessment:', error);
    res.json({ success: false, error: error.message });
  }
});

// Attach working paper to testing procedure
router.post('/:auditId/testing-procedure/attach-wp', ensureAuditor, async (req, res) => {
  const { risk_assessment_id, working_paper_id } = req.body;
  const { auditId } = req.params;
  
  try {
    await pool.query(`
      INSERT INTO testing_procedure_wp (audit_id, risk_assessment_id, working_paper_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (audit_id, risk_assessment_id, working_paper_id) DO NOTHING
    `, [auditId, risk_assessment_id, working_paper_id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error attaching working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detach working paper from testing procedure
router.post('/:auditId/testing-procedure/detach-wp', ensureAuditor, async (req, res) => {
  const { risk_assessment_id, working_paper_id } = req.body;
  const { auditId } = req.params;
  
  try {
    await pool.query(`
      DELETE FROM testing_procedure_wp 
      WHERE audit_id = $1 AND risk_assessment_id = $2 AND working_paper_id = $3
    `, [auditId, risk_assessment_id, working_paper_id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error detaching working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get working paper data for filling
router.get('/:auditId/working-paper/:wpId/data', ensureAuditor, async (req, res) => {
  try {
    const { auditId, wpId } = req.params;
    
    // Get working paper structure
    const wpResult = await pool.query(`
      SELECT * FROM working_papers WHERE id = $1 AND organization_id = $2
    `, [wpId, req.user.organization_id]);
    
    if (wpResult.rows.length === 0) {
      return res.status(404).json({ error: 'Working paper not found' });
    }
    
    const columnsResult = await pool.query(`
      SELECT * FROM working_paper_columns 
      WHERE working_paper_id = $1 
      ORDER BY column_order
    `, [wpId]);
    
    // Get filled data for this audit
    const dataResult = await pool.query(`
      SELECT * FROM working_paper_data 
      WHERE audit_id = $1 AND working_paper_id = $2 
      ORDER BY row_number
    `, [auditId, wpId]);
    
    res.json({
      workingPaper: wpResult.rows[0],
      columns: columnsResult.rows,
      data: dataResult.rows
    });
  } catch (error) {
    console.error('Error loading working paper data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save working paper data
router.post('/:auditId/working-paper/:wpId/save-data', ensureAuditor, async (req, res) => {
  try {
    const { auditId, wpId } = req.params;
    const { rows } = req.body;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete existing data for this working paper in this audit
      await client.query(`
        DELETE FROM working_paper_data 
        WHERE audit_id = $1 AND working_paper_id = $2
      `, [auditId, wpId]);
      
      // Insert new data
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        await client.query(`
          INSERT INTO working_paper_data 
          (audit_id, working_paper_id, row_number, row_data)
          VALUES ($1, $2, $3, $4)
        `, [auditId, wpId, i, JSON.stringify(row)]);
      }
      
      await client.query('COMMIT');
      res.json({ success: true, message: 'Working paper data saved successfully' });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error saving working paper data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save audit procedure
router.post('/:auditId/audit-procedure/save', ensureAuditor, async (req, res) => {
  try {
    const { auditId } = req.params;
    const {
      risk_assessment_id,
      audit_area,
      audit_objective,
      record_of_work,
      conclusion,
      result,
      cause,
      likelihood,
      impact,
      include_in_report,
      working_paper_id
    } = req.body;
    
    // Check if exists
    const existing = await pool.query(`
      SELECT id FROM audit_procedures 
      WHERE audit_id = $1 AND risk_assessment_id = $2
    `, [auditId, risk_assessment_id]);
    
    const issue_rating = (likelihood && impact) ? likelihood * impact : null;
    let score = null;
    if (issue_rating) {
      if (issue_rating >= 15) score = 'High';
      else if (issue_rating >= 7) score = 'Medium';
      else score = 'Low';
    }
    
    if (existing.rows.length > 0) {
      // Update
      await pool.query(`
        UPDATE audit_procedures SET
          audit_area = $1,
          audit_objective = $2,
          record_of_work = $3,
          conclusion = $4,
          result = $5,
          cause = $6,
          likelihood = $7,
          impact = $8,
          issue_rating = $9,
          score = $10,
          include_in_report = $11,
          working_paper_id = $12,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $13
      `, [
        audit_area,
        audit_objective,
        record_of_work,
        conclusion,
        result,
        cause,
        likelihood || null,
        impact || null,
        issue_rating,
        score,
        include_in_report === 'true',
        working_paper_id || null,
        existing.rows[0].id
      ]);
    } else {
      // Insert
      await pool.query(`
        INSERT INTO audit_procedures (
          audit_id,
          risk_assessment_id,
          audit_area,
          audit_objective,
          record_of_work,
          conclusion,
          result,
          cause,
          likelihood,
          impact,
          issue_rating,
          score,
          include_in_report,
          working_paper_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        auditId,
        risk_assessment_id,
        audit_area,
        audit_objective,
        record_of_work,
        conclusion,
        result,
        cause,
        likelihood || null,
        impact || null,
        issue_rating,
        score,
        include_in_report === 'true',
        working_paper_id || null
      ]);
    }
    
    res.json({ success: true, message: 'Audit procedure saved successfully' });
  } catch (error) {
    console.error('Error saving audit procedure:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// Link working paper to audit procedure
router.post('/:auditId/audit-procedures/:procedureId/link-wp', ensureAuditor, async (req, res) => {
  try {
    const { working_paper_id } = req.body;
    
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [req.params.auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    await pool.query(`
      UPDATE audit_procedures 
      SET working_paper_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND audit_id = $3
    `, [working_paper_id, req.params.procedureId, req.params.auditId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error linking working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Upload evidence file
router.post('/:auditId/audit-procedure/upload-evidence', ensureAuditor, async (req, res) => {
  const multer = require('multer');
  const path = require('path');
  
  const storage = multer.diskStorage({
    destination: './uploads/evidence/',
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });
  
  const upload = multer({ storage: storage }).single('evidence');
  
  upload(req, res, async (err) => {
    if (err) {
      return res.json({ success: false, error: 'Upload failed' });
    }
    
    try {
      const { risk_assessment_id } = req.body;
      const { auditId } = req.params;
      const filePath = req.file.path;
      
      await pool.query(`
        UPDATE audit_procedures 
        SET evidence = $1
        WHERE audit_id = $2 AND risk_assessment_id = $3
      `, [filePath, auditId, risk_assessment_id]);
      
      res.json({ success: true, filePath: filePath });
    } catch (error) {
      console.error(error);
      res.json({ success: false, error: 'Database error' });
    }
  });
});

// ==================== SUBMIT AUDIT ISSUES ROUTES ====================

// Get issue draft or existing issue
router.get('/:auditId/issues/:procedureId', ensureAuditor, async (req, res) => {
  try {
    const { auditId, procedureId } = req.params;
    
    const result = await pool.query(`
      SELECT * FROM audit_issues
      WHERE audit_id = $1 AND audit_procedure_id = $2
    `, [auditId, procedureId]);
    
    if (result.rows.length > 0) {
      res.json({ success: true, issue: result.rows[0] });
    } else {
      res.json({ success: true, issue: null });
    }
  } catch (error) {
    console.error('Error fetching issue:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Save issue draft
router.post('/:auditId/issues/:procedureId/save-draft', ensureAuditor, async (req, res) => {
  try {
    const { auditId, procedureId } = req.params;
    const {
      issue_title,
      criteria,
      condition,
      cause,
      consequence,
      corrective_action,
      corrective_date
    } = req.body;
    
    // Check if draft already exists
    const existingResult = await pool.query(`
      SELECT id FROM audit_issues
      WHERE audit_id = $1 AND audit_procedure_id = $2
        AND status IN ('draft', 'sent_for_amendment')
    `, [auditId, procedureId]);
    
    if (existingResult.rows.length > 0) {
      // Update existing draft
      await pool.query(`
        UPDATE audit_issues SET
          issue_title = $1,
          criteria = $2,
          condition = $3,
          cause = $4,
          consequence = $5,
          corrective_action = $6,
          corrective_date = $7,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
      `, [
        issue_title,
        criteria,
        condition,
        cause,
        consequence,
        corrective_action,
        corrective_date,
        existingResult.rows[0].id
      ]);
      
      res.json({ success: true, message: 'Draft updated successfully' });
    } else {
      // Create new draft
      await pool.query(`
        INSERT INTO audit_issues (
          audit_id,
          audit_procedure_id,
          issue_title,
          criteria,
          condition,
          cause,
          consequence,
          corrective_action,
          corrective_date,
          status,
          submitted_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10)
      `, [
        auditId,
        procedureId,
        issue_title,
        criteria,
        condition,
        cause,
        consequence,
        corrective_action,
        corrective_date,
        req.user.id
      ]);
      
      res.json({ success: true, message: 'Draft saved successfully' });
    }
  } catch (error) {
    console.error('Error saving draft issue:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send issue for verification
router.post('/:auditId/issues/:procedureId/send-for-verify', ensureAuditor, async (req, res) => {
  try {
    const { auditId, procedureId } = req.params;
    const {
      issue_title,
      criteria,
      condition,
      cause,
      consequence,
      corrective_action,
      corrective_date
    } = req.body;
    
    // Check if draft exists
    const existingResult = await pool.query(`
      SELECT id FROM audit_issues
      WHERE audit_id = $1 AND audit_procedure_id = $2
        AND status IN ('draft', 'sent_for_amendment')
    `, [auditId, procedureId]);
    
    if (existingResult.rows.length > 0) {
      // Update existing draft and send for verification
      await pool.query(`
        UPDATE audit_issues SET
          issue_title = $1,
          criteria = $2,
          condition = $3,
          cause = $4,
          consequence = $5,
          corrective_action = $6,
          corrective_date = $7,
          status = 'sent_for_verify',
          submitted_at = CURRENT_TIMESTAMP,
          submitted_by = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
      `, [
        issue_title,
        criteria,
        condition,
        cause,
        consequence,
        corrective_action,
        corrective_date,
        req.user.id,
        existingResult.rows[0].id
      ]);
    } else {
      // Create new issue and send for verification
      await pool.query(`
        INSERT INTO audit_issues (
          audit_id,
          audit_procedure_id,
          issue_title,
          criteria,
          condition,
          cause,
          consequence,
          corrective_action,
          corrective_date,
          status,
          submitted_by,
          submitted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sent_for_verify', $10, CURRENT_TIMESTAMP)
      `, [
        auditId,
        procedureId,
        issue_title,
        criteria,
        condition,
        cause,
        consequence,
        corrective_action,
        corrective_date,
        req.user.id
      ]);
    }
    
    res.json({ success: true, message: 'Issue sent for verification successfully' });
  } catch (error) {
    console.error('Error sending issue for verification:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== END SUBMIT AUDIT ISSUES ROUTES ====================

// ==================== SEND FOR COMMENTING ROUTES ====================

// Send issue for commenting
router.post('/issues/:issueId/send-for-commenting', ensureAuditor, async (req, res) => {
  try {
    const { due_date } = req.body;
    const { issueId } = req.params;
    
    await pool.query(`
      UPDATE audit_issues 
      SET sent_for_commenting = true,
          comment_due_date = $1,
          sent_for_commenting_at = NOW()
      WHERE id = $2
    `, [due_date, issueId]);
    
    res.json({ success: true, message: 'Issue sent for commenting' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send email notification
router.post('/issues/:issueId/send-email-notification', ensureAuditor, async (req, res) => {
  try {
    const { due_date } = req.body;
    const { issueId } = req.params;
    
    // Get issue and auditee details
    const issueResult = await pool.query(`
      SELECT ai.*, a.audit_name, au.name as auditee_name, au.email as auditee_email
      FROM audit_issues ai
      LEFT JOIN audits a ON ai.audit_id = a.id
      LEFT JOIN auditees au ON a.auditee_id = au.id
      WHERE ai.id = $1
    `, [issueId]);
    
    if (issueResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Issue not found' });
    }
    
    const issue = issueResult.rows[0];
    
    // Get auditee user email
    const auditeeUserResult = await pool.query(`
      SELECT u.email 
      FROM users u
      INNER JOIN auditees au ON au.user_id = u.id
      INNER JOIN audits a ON a.auditee_id = au.id
      WHERE a.id = (SELECT audit_id FROM audit_issues WHERE id = $1)
    `, [issueId]);
    
    if (auditeeUserResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Auditee email not found' });
    }
    
    const auditeeEmail = auditeeUserResult.rows[0].email;
    
    // Send email using nodemailer
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransporter({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: auditeeEmail,
      subject: `Action Required: Comment on Audit Issue - ${issue.issue_title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Audit Issue - Management Comment Required</h2>
          <p>Dear ${issue.auditee_name},</p>
          <p>You have been requested to provide management comments on the following audit issue:</p>
          
          <div style="background: #f8fafc; padding: 20px; border-left: 4px solid #3b82f6; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0f172a;">${issue.issue_title}</h3>
            <p><strong>Audit:</strong> ${issue.audit_name}</p>
            <p><strong>Due Date:</strong> ${new Date(due_date).toLocaleDateString()}</p>
          </div>
          
          <p>Please login to the Internal Audit Portal to review the details and provide your comments before the due date.</p>
          
          <p>
            <a href="${req.protocol}://${req.get('host')}/auth/login" 
               style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Login to Portal
            </a>
          </p>
          
          <p style="color: #64748b; font-size: 14px; margin-top: 30px;">
            This is an automated message from the Internal Audit Portal.
          </p>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ success: false, error: 'Failed to send email: ' + error.message });
  }
});

// ==================== END SEND FOR COMMENTING ROUTES ====================

// View working paper from audit procedures
router.get('/:auditId/working-paper-view/:riskAssessmentId/:wpId', ensureAuditor, async (req, res) => {
  try {
    const { auditId, wpId } = req.params;
    
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    // Get working paper details
    const wpResult = await pool.query(`
      SELECT wp.*, 
             (SELECT json_agg(wpc ORDER BY wpc.column_order) 
              FROM working_paper_columns wpc 
              WHERE wpc.working_paper_id = wp.id) as columns
      FROM working_papers wp
      WHERE wp.id = $1 AND wp.organization_id = $2
    `, [wpId, req.user.organization_id]);
    
    if (wpResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Working paper not found' });
    }
    
    const wp = wpResult.rows[0];
    
    // Get all data for this working paper across all testing procedures
    const dataResult = await pool.query(`
      SELECT * FROM testing_procedure_data
      WHERE working_paper_id = $1 AND audit_id = $2
      ORDER BY row_order
    `, [wpId, auditId]);
    
    res.json({
      success: true,
      workingPaper: {
        id: wp.id,
        name: wp.name,
        columns: wp.columns || [],
        rows: dataResult.rows
      }
    });
    
  } catch (error) {
    console.error('Error loading working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save all audit procedures
router.post('/:auditId/field-work/save-all', ensureAuditor, async (req, res) => {
  try {
    const { auditId } = req.params;
    const { procedures } = req.body;
    
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    // Save each procedure
    for (const proc of procedures) {
      const issue_rating = (proc.likelihood && proc.impact) ? proc.likelihood * proc.impact : null;
      let score = null;
      if (issue_rating) {
        if (issue_rating >= 15) score = 'High';
        else if (issue_rating >= 7) score = 'Medium';
        else score = 'Low';
      }
      
      // Check if exists
      const existing = await pool.query(`
        SELECT id FROM audit_procedures 
        WHERE audit_id = $1 AND risk_assessment_id = $2
      `, [auditId, proc.risk_assessment_id]);
      
      if (existing.rows.length > 0) {
        // Update
        await pool.query(`
          UPDATE audit_procedures SET
            audit_area = $1,
            audit_objective = $2,
            record_of_work = $3,
            conclusion = $4,
            result = $5,
            cause = $6,
            likelihood = $7,
            impact = $8,
            issue_rating = $9,
            score = $10,
            include_in_report = $11,
            working_paper_id = $12,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $13
        `, [
          proc.audit_area,
          proc.audit_objective,
          proc.record_of_work,
          proc.conclusion,
          proc.result,
          proc.cause,
          proc.likelihood || null,
          proc.impact || null,
          issue_rating,
          score,
          proc.include_in_report === true || proc.include_in_report === 'true',
          proc.working_paper_id || null,
          existing.rows[0].id
        ]);
      } else {
        // Insert
        await pool.query(`
          INSERT INTO audit_procedures (
            audit_id,
            risk_assessment_id,
            audit_area,
            audit_objective,
            record_of_work,
            conclusion,
            result,
            cause,
            likelihood,
            impact,
            issue_rating,
            score,
            include_in_report,
            working_paper_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          auditId,
          proc.risk_assessment_id,
          proc.audit_area,
          proc.audit_objective,
          proc.record_of_work,
          proc.conclusion,
          proc.result,
          proc.cause,
          proc.likelihood || null,
          proc.impact || null,
          issue_rating,
          score,
          proc.include_in_report === true || proc.include_in_report === 'true',
          proc.working_paper_id || null
        ]);
      }
    }
    
    res.json({ success: true, message: 'All procedures saved successfully' });
  } catch (error) {
    console.error('Error saving procedures:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// View all audit universe entries
module.exports = router;
