const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureHeadOfAudit, ensureAuditor } = require('../middleware/auth');

// List all audits
router.get('/', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const result = await pool.query(`
      SELECT a.*, au.name as auditee_name, u.name as team_leader_name, a.audit_year
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN users u ON a.team_leader_id = u.id
      WHERE a.organization_id = $1
      ORDER BY a.id DESC
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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
  const { audit_name, auditee_id, team_leader_id, start_date, end_date, audit_year, team_members } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert audit
      const auditResult = await client.query(`
        INSERT INTO audits (audit_name, auditee_id, team_leader_id, start_date, end_date, audit_year, created_by, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [audit_name, auditee_id, team_leader_id, start_date, end_date, audit_year, req.user.id, req.user.organization_id]);
      
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const universeResult = await pool.query(`
      SELECT 
        au.*,
        a.name as auditee_name,
        ad.department_name
      FROM audit_universe au
      LEFT JOIN auditees a ON au.auditee_id = a.id
      LEFT JOIN auditee_departments ad ON au.department_id = ad.id
      ORDER BY a.name, ad.department_name, au.audit_area
    `);
    
    // Get list of all auditees for filter
    const auditeesResult = await pool.query(`
      SELECT id, name FROM auditees ORDER BY name
    `);
    
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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
  SELECT au.* FROM audit_universe au
  INNER JOIN auditees a ON au.auditee_id = a.id
  WHERE au.auditee_id = $1 
    AND a.organization_id = $2
  ORDER BY au.audit_area, au.process
`, [audit.auditee_id, req.user.organization_id]);
    
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
      ORDER BY wp.name
    `);
    
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
        SELECT ai.*, ap.conclusion, auv.audit_area
        FROM audit_issues ai
        LEFT JOIN audit_procedures ap ON ai.audit_procedure_id = ap.id
        LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
        LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
        WHERE ai.audit_id = $1
        ORDER BY ai.id DESC
      `, [req.params.id]);
    } catch (issueError) {
      console.log('Audit issues query skipped:', issueError.message);
    }
    
    // FIXED: Match variable names to what workspace.ejs expects
    res.render('audits/workspace', {
      title: 'Audit Workspace',
      audit: audit,
      teamMembers: teamResult.rows,
      universeItems: universeResult.rows || [],
      documents: documentsResult.rows || [],
      riskAssessments: riskResult.rows || [],
      selectedAreas: selectedAreasResult.rows || [],
      procedures: proceduresResult.rows || [],  // CHANGED FROM auditProcedures
      workingPapers: wpResult.rows || [],
      attachedWPs: attachedWPsResult.rows || [],
      issues: issuesResult.rows || []
    });
    
  } catch (error) {
    console.error('Audit workspace error:', error);
    req.flash('error_msg', 'Error loading audit workspace');
    res.redirect('/audits');
  }
});

// Testing Procedures - List view
router.get('/:id/testing-procedures', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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
    
    // Get selected areas from risk assessment
    const foldersResult = await pool.query(`
      SELECT ra.id as risk_assessment_id, auv.audit_area, 
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
    
    // Get all working papers
    const wpResult = await pool.query(`
      SELECT wp.*, 
             (SELECT COUNT(*) FROM working_paper_columns WHERE working_paper_id = wp.id) as column_count
      FROM working_papers wp
      WHERE wp.organization_id = $1
      ORDER BY wp.name
    `, [req.user.organization_id]);
    
    res.render('audits/testing-procedures', {
      title: 'Testing Procedures',
      audit: audit,
      folders: foldersResult.rows,
      workingPapers: wpResult.rows
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading testing procedures');
    res.redirect(`/audits/${req.params.id}`);
  }
});

// Testing Procedures - SINGLE FOLDER VIEW (when you click a folder)
router.get('/:id/testing-procedures/:riskAssessmentId', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const auditId = req.params.id;
    const riskAssessmentId = req.params.riskAssessmentId;
    
    // Get audit info
    const auditResult = await pool.query(`
      SELECT a.*, au.name as auditee_name, u.name as team_leader_name
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      LEFT JOIN users u ON a.team_leader_id = u.id
      WHERE a.id = $1 AND a.organization_id = $2
    `, [auditId, req.user.organization_id]);
    
    if (auditResult.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    const audit = auditResult.rows[0];
    
    // Get risk assessment details for this folder
    const riskResult = await pool.query(`
      SELECT ra.*, auv.audit_area, auv.process, u.name as auditor_name,
             (ra.likelihood * ra.impact) as risk_rating,
             CASE 
               WHEN (ra.likelihood * ra.impact) >= 15 THEN 'High'
               WHEN (ra.likelihood * ra.impact) >= 7 THEN 'Medium'
               ELSE 'Low'
             END as score
      FROM risk_assessment ra
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      WHERE ra.id = $1 AND ra.audit_id = $2
    `, [riskAssessmentId, auditId]);
    
    if (riskResult.rows.length === 0) {
      req.flash('error_msg', 'Risk assessment not found');
      return res.redirect(`/audits/${auditId}`);
    }
    
    const riskAssessment = riskResult.rows[0];
    
    // Get attached working papers for this folder
    const attachedResult = await pool.query(`
      SELECT * FROM testing_procedure_wp 
      WHERE audit_id = $1 AND risk_assessment_id = $2
    `, [auditId, riskAssessmentId]);
    
    // Get all available working papers
    const allWpResult = await pool.query(`
      SELECT wp.id, wp.name, wp.allow_row_insert,
             (SELECT COUNT(*) FROM working_paper_columns WHERE working_paper_id = wp.id) as column_count
      FROM working_papers wp
      ORDER BY wp.name
    `);
    
    // Get full working paper data for attached papers (columns + data)
    const workingPapersWithData = [];
    
    for (const attached of attachedResult.rows) {
      const wpId = attached.working_paper_id;
      
      // Get working paper basic info
      const wpResult = await pool.query(`
        SELECT * FROM working_papers WHERE id = $1
      `, [wpId]);
      
      if (wpResult.rows.length === 0) continue;
      
      const wp = wpResult.rows[0];
      
      // Get columns
      const columnsResult = await pool.query(`
        SELECT * FROM working_paper_columns
        WHERE working_paper_id = $1
        ORDER BY column_order
      `, [wpId]);
      
      // Get data rows
      const dataResult = await pool.query(`
        SELECT * FROM working_paper_data
        WHERE audit_id = $1 AND risk_assessment_id = $2 AND working_paper_id = $3
        ORDER BY row_number
      `, [auditId, riskAssessmentId, wpId]);
      
      // Parse data
      const rows = dataResult.rows.map(row => ({
        id: row.id,
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      }));
      
      workingPapersWithData.push({
        id: wp.id,
        name: wp.name,
        allow_row_insert: wp.allow_row_insert,
        columns: columnsResult.rows,
        rows: rows
      });
    }
    
    res.render('audits/testing-procedures-folder', {
      title: 'Testing Procedures',
      audit: audit,
      folderName: riskAssessment.audit_area,
      riskScore: riskAssessment.score,
      auditorName: riskAssessment.auditor_name,
      riskAssessmentId: riskAssessmentId,
      attachedWPs: attachedResult.rows,
      allWorkingPapers: allWpResult.rows,
      workingPapersWithData: workingPapersWithData,
      user: req.user
    });
    
  } catch (error) {
    console.error('Testing folder error:', error);
    req.flash('error_msg', 'Error loading testing folder');
    res.redirect(`/audits/${req.params.id}`);
  }
});

// Save working paper data
router.post('/:id/testing-procedures/:riskAssessmentId/save-wp/:wpId', ensureAuditor, async (req, res) => {
  try {
    const { id: auditId, riskAssessmentId, wpId } = req.params;
    const { rows } = req.body;
    
    console.log('Saving working paper data:', { auditId, riskAssessmentId, wpId, rows });
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete existing rows for this working paper
      await client.query(`
        DELETE FROM working_paper_data
        WHERE audit_id = $1 AND risk_assessment_id = $2 AND working_paper_id = $3
      `, [auditId, riskAssessmentId, wpId]);
      
      // Insert new rows
      if (rows && typeof rows === 'object') {
        let rowNumber = 1;
        
        // Handle if rows is an object (convert to array)
        const rowsArray = Array.isArray(rows) ? rows : Object.values(rows);
        
        for (const rowData of rowsArray) {
          if (rowData && Object.keys(rowData).length > 0) {
            await client.query(`
              INSERT INTO working_paper_data 
              (audit_id, risk_assessment_id, working_paper_id, row_number, data)
              VALUES ($1, $2, $3, $4, $5)
            `, [auditId, riskAssessmentId, wpId, rowNumber, JSON.stringify(rowData)]);
            
            rowNumber++;
          }
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

// Attach working paper to audit area
router.post('/:id/testing-procedures/:areaId/attach', ensureAuditor, async (req, res) => {
  const { working_paper_id } = req.body;
  
  try {
    await pool.query(`
      INSERT INTO testing_procedure_wp (audit_id, risk_assessment_id, working_paper_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (audit_id, risk_assessment_id, working_paper_id) DO NOTHING
    `, [req.params.id, req.params.areaId, working_paper_id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false });
  }
});

// Detach working paper from audit area
router.post('/:id/testing-procedures/:areaId/detach', ensureAuditor, async (req, res) => {
  const { working_paper_id } = req.body;
  
  try {
    await pool.query(`
      DELETE FROM testing_procedure_wp 
      WHERE audit_id = $1 AND risk_assessment_id = $2 AND working_paper_id = $3
    `, [req.params.id, req.params.areaId, working_paper_id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false });
  }
});

// Save Audit Procedures (Field Work)
router.post('/field-work/:id/save-all', ensureAuditor, async (req, res) => {
  const auditId = req.params.id;
  
  // Verify audit belongs to user's organization
  try {
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Authorization error' });
  }
  
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs');
  
  // Setup multer for file uploads
  const storage = multer.diskStorage({
    destination: function(req, file, cb) {
      const uploadDir = path.join(__dirname, '../uploads/evidence');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });
  
  const upload = multer({ storage: storage }).any();
  
  upload(req, res, async function(err) {
    if (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ success: false, error: 'File upload error' });
    }
    
    try {
      const items = req.body.items || {};
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Process each item
        for (const [index, item] of Object.entries(items)) {
          if (!item || !item.risk_assessment_id) continue;
          
          const riskAssessmentId = item.risk_assessment_id;
          const procedureId = item.procedure_id || null;
          
          // Handle evidence file upload
          let evidenceFile = item.existing_evidence || null;
          const uploadedFile = req.files?.find(f => f.fieldname === `items[${index}][evidence]`);
          if (uploadedFile) {
            evidenceFile = '/uploads/evidence/' + uploadedFile.filename;
          }
          
          // Calculate rating and score
          const likelihood = item.likelihood ? parseInt(item.likelihood) : null;
          const impact = item.impact ? parseInt(item.impact) : null;
          let rating = null;
          let score = null;
          
          if (likelihood && impact) {
            rating = likelihood * impact;
            if (rating >= 15) score = 'High';
            else if (rating >= 7) score = 'Medium';
            else score = 'Low';
          }
          
          if (procedureId && procedureId !== '') {
            // Update existing procedure
            await client.query(`
              UPDATE audit_procedures 
              SET record_of_work = $1, 
                  conclusion = $2, 
                  result = $3, 
                  cause = $4, 
                  evidence_file = $5,
                  likelihood = $6,
                  impact = $7,
                  rating = $8,
                  score = $9,
                  include_in_report = $10
              WHERE id = $11
            `, [
              item.record_of_work || null,
              item.conclusion || null,
              item.result || null,
              item.cause || null,
              evidenceFile,
              likelihood,
              impact,
              rating,
              score,
              item.include_in_report === 'yes', // Convert to boolean
              procedureId
            ]);
          } else {
            // Insert new procedure
            await client.query(`
              INSERT INTO audit_procedures 
              (audit_id, risk_assessment_id, record_of_work, conclusion, result, cause, evidence_file, likelihood, impact, rating, score, include_in_report)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
              auditId,
              riskAssessmentId,
              item.record_of_work || null,
              item.conclusion || null,
              item.result || null,
              item.cause || null,
              evidenceFile,
              likelihood,
              impact,
              rating,
              score,
              item.include_in_report === 'yes' // Convert to boolean
            ]);
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
      console.error('Error saving audit procedures:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

// Get selected areas with fresh risk_assessment IDs (for dynamic updates)
router.get('/:id/get-selected-areas', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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
    
    
    
    res.json({ 
      success: true, 
      selectedAreas: selectedAreasResult.rows 
    });
  } catch (error) {
    console.error('Error fetching selected areas:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get audit procedures data with working papers (for dynamic updates)
router.get('/:id/get-audit-procedures', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    // Get selected areas
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
    
    // Get existing audit procedures
    const proceduresResult = await pool.query(`
      SELECT ap.*, ra.audit_universe_id, auv.audit_area, auv.audit_procedure,
             u.name as auditor_name, wp.name as working_paper_name,
             wp.id as working_paper_id
      FROM audit_procedures ap
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      LEFT JOIN working_papers wp ON ap.working_paper_id = wp.id
      WHERE ap.audit_id = $1
      ORDER BY auv.audit_area
    `, [req.params.id]);
    
    // Get all attached working papers - only from FIRST risk_assessment_id per audit_area
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
    
    res.json({ 
      success: true, 
      selectedAreas: selectedAreasResult.rows,
      procedures: proceduresResult.rows,
      attachedWPs: attachedWPsResult.rows
    });
  } catch (error) {
    console.error('Error fetching audit procedures:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Link working paper to audit procedure
router.post('/:auditId/audit-procedures/:procedureId/link-wp', ensureAuditor, async (req, res) => {
  try {
    const { auditId, procedureId } = req.params;
    const { working_paper_id } = req.body;
    
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    if (!working_paper_id) {
      return res.status(400).json({ success: false, error: 'Working paper ID is required' });
    }
    
    await pool.query(
      'UPDATE audit_procedures SET working_paper_id = $1 WHERE id = $2',
      [working_paper_id, procedureId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error linking working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Unlink working paper from audit procedure
router.post('/:auditId/audit-procedures/:procedureId/unlink-wp', ensureAuditor, async (req, res) => {
  try {
    const { auditId, procedureId } = req.params;
    
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    await pool.query(
      'UPDATE audit_procedures SET working_paper_id = NULL WHERE id = $1',
      [procedureId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error unlinking working paper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// View working paper data (for modal popup in Audit Procedures)
router.get('/:auditId/working-paper-view/:riskAssessmentId/:workingPaperId', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const { auditId, riskAssessmentId, workingPaperId } = req.params;
    
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    
    // Get working paper columns
    const columnsResult = await pool.query(`
      SELECT column_name, column_type, column_order
      FROM working_paper_columns
      WHERE working_paper_id = $1
      ORDER BY column_order
    `, [workingPaperId]);
    
    // Get working paper data rows
    const dataResult = await pool.query(`
      SELECT id, data, row_number
      FROM working_paper_data
      WHERE audit_id = $1 
        AND risk_assessment_id = $2 
        AND working_paper_id = $3
      ORDER BY row_number
    `, [auditId, riskAssessmentId, workingPaperId]);
    
    // Parse data (it's stored as JSON in the database)
    const rows = dataResult.rows.map(row => ({
      id: row.id,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      row_number: row.row_number
    }));
    
    res.json({
      success: true,
      columns: columnsResult.rows,
      rows: rows
    });
    
  } catch (error) {
    console.error('Error fetching working paper view:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Audit calendar view
router.get('/calendar/view', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const result = await pool.query(`
      SELECT a.*, au.name as auditee_name
      FROM audits a
      LEFT JOIN auditees au ON a.auditee_id = au.id
      WHERE a.organization_id = $1
      ORDER BY a.start_date
    `, [req.user.organization_id]);
    
    res.render('audits/calendar', {
      title: 'Audit Calendar',
      audits: result.rows
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading calendar');
    res.redirect('/audits');
  }
});

// ==================== SUBMIT AUDIT ISSUES ROUTES ====================

// Get procedures marked for inclusion in report
router.get('/:id/get-report-procedures', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const auditId = req.params.id;
    
    const proceduresResult = await pool.query(`
      SELECT 
        ap.id as procedure_id,
        ap.record_of_work,
        ap.conclusion,
        ap.result,
        ap.working_paper_id,
        auv.audit_area,
        auv.audit_procedure,
        wp.name as working_paper_name,
        ra.id as risk_assessment_id,
        ai.id as issue_id,
        ai.issue_title,
        ai.criteria,
        ai.condition,
        ai.cause,
        ai.consequence,
        ai.corrective_action,
        ai.corrective_date,
        ai.status
      FROM audit_procedures ap
      LEFT JOIN risk_assessment ra ON ap.risk_assessment_id = ra.id
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN working_papers wp ON ap.working_paper_id = wp.id
      LEFT JOIN audit_issues ai ON ai.audit_procedure_id = ap.id AND ai.audit_id = $1
      WHERE ap.audit_id = $1 
  AND ap.include_in_report = true
  AND ra.is_selected = true
  AND (ai.status IS NULL OR ai.status IN ('draft', 'sent_for_amendment'))
      ORDER BY auv.audit_area, auv.audit_procedure
    `, [auditId]);
    
    res.json({
      success: true,
      procedures: proceduresResult.rows
    });
  } catch (error) {
    console.error('Error fetching report procedures:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get existing draft issue for a procedure
router.get('/:auditId/issues/:procedureId/draft', ensureAuditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const { auditId, procedureId } = req.params;
    
    const issueResult = await pool.query(`
      SELECT * FROM audit_issues
      WHERE audit_id = $1 
        AND audit_procedure_id = $2
        AND status IN ('draft', 'sent_for_amendment')
      LIMIT 1
    `, [auditId, procedureId]);
    
    if (issueResult.rows.length === 0) {
      return res.json({ success: true, issue: null });
    }
    
    res.json({
      success: true,
      issue: issueResult.rows[0]
    });
  } catch (error) {
    console.error('Error fetching draft issue:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Save draft issue
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
          status = 'draft',
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

const aiService = require('../ai-service');

// AI Rephrase Route
router.post('/api/ai-rephrase', async (req, res) => {
  try {
    const { text } = req.body;
    const rephrasedText = await aiService.rephraseText(text);
    res.json({ success: true, rephrasedText });
  } catch (error) {
    console.error('AI Rephrase error:', error);
    res.json({ success: false, error: error.message });
  }
});

// AI Generate Consequence Route
router.post('/api/ai-generate-consequence', async (req, res) => {
  try {
    const { criteria, condition } = req.body;
    const consequence = await aiService.generateConsequence(criteria, condition);
    res.json({ success: true, consequence });
  } catch (error) {
    console.error('AI Generate Consequence error:', error);
    res.json({ success: false, error: error.message });
  }
});
module.exports = router;
