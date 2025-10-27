const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureAuditor } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Configure file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10485760 } // 10MB limit
});

// View field work for an audit
router.get('/:auditId', ensureAuditor, async (req, res) => {
  try {
    // Get audit details
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
    
    // Get selected areas from risk assessment
    const selectedAreasResult = await pool.query(`
      SELECT ra.*, auv.audit_area, auv.process, auv.audit_procedure,
             u.name as auditor_name
      FROM risk_assessment ra
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      WHERE ra.audit_id = $1 AND ra.is_selected = true
      ORDER BY auv.audit_area
    `, [req.params.auditId]);
    
    // Get existing procedures
    const proceduresResult = await pool.query(`
      SELECT * FROM audit_procedures WHERE audit_id = $1
    `, [req.params.auditId]);
    
    // Get working papers
    const workingPapersResult = await pool.query(`
      SELECT id, name FROM working_papers WHERE organization_id = $1 ORDER BY name
    `, [req.user.organization_id]);
    
    res.render('field-work/index', {
      title: 'Field Work',
      audit: audit,
      selectedAreas: selectedAreasResult.rows,
      procedures: proceduresResult.rows,
      workingPapers: workingPapersResult.rows
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading field work');
    res.redirect('/audits');
  }
});

// View testing procedures for a specific audit area (when clicking folder)
router.get('/:auditId/:areaId', ensureAuditor, async (req, res) => {
  try {
    // Get audit details
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
    
    // Get the specific audit area details
    const areaResult = await pool.query(`
      SELECT ra.*, auv.audit_area, auv.process, auv.audit_procedure,
             u.name as auditor_name
      FROM risk_assessment ra
      LEFT JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      LEFT JOIN users u ON ra.assigned_auditor_id = u.id
      WHERE ra.id = $1 AND ra.audit_id = $2
    `, [req.params.areaId, req.params.auditId]);
    
    if (areaResult.rows.length === 0) {
      req.flash('error_msg', 'Audit area not found');
      return res.redirect(`/audits/${req.params.auditId}/workspace`);
    }
    
    const area = areaResult.rows[0];
    
    // Get all working papers
    const workingPapersResult = await pool.query(`
      SELECT wp.*, 
             (SELECT COUNT(*) FROM working_paper_columns WHERE working_paper_id = wp.id) as column_count
      FROM working_papers wp
      WHERE wp.organization_id = $1
      ORDER BY wp.name
    `, [req.user.organization_id]);
    
    // Get attached working papers for this area
    const attachedPapersResult = await pool.query(`
      SELECT awp.*, wp.name as wp_name
      FROM area_working_papers awp
      JOIN working_papers wp ON awp.working_paper_id = wp.id
      WHERE awp.risk_assessment_id = $1
      ORDER BY awp.created_at
    `, [req.params.areaId]);
    
    res.render('testing-procedures/area', {
      title: 'Testing Procedures',
      audit: audit,
      area: area,
      workingPapers: workingPapersResult.rows,
      attachedPapers: attachedPapersResult.rows
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading testing procedures');
    res.redirect('/audits');
  }
});

// Attach working paper to audit area
router.post('/:auditId/:areaId/attach', ensureAuditor, async (req, res) => {
  const { working_paper_id } = req.body;
  
  try {
    // Check if already attached
    const existing = await pool.query(
      'SELECT id FROM area_working_papers WHERE risk_assessment_id = $1 AND working_paper_id = $2',
      [req.params.areaId, working_paper_id]
    );
    
    if (existing.rows.length > 0) {
      req.flash('error_msg', 'Working paper already attached to this area');
    } else {
      await pool.query(
        'INSERT INTO area_working_papers (risk_assessment_id, working_paper_id) VALUES ($1, $2)',
        [req.params.areaId, working_paper_id]
      );
      req.flash('success_msg', 'Working paper attached successfully');
    }
    
    res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}`);
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error attaching working paper');
    res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}`);
  }
});

// Remove working paper from audit area
router.post('/:auditId/:areaId/detach/:attachmentId', ensureAuditor, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM area_working_papers WHERE id = $1',
      [req.params.attachmentId]
    );
    req.flash('success_msg', 'Working paper removed successfully');
    res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}`);
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error removing working paper');
    res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}`);
  }
});

// View/Fill working paper data for an area
router.get('/:auditId/:areaId/fill/:attachmentId', ensureAuditor, async (req, res) => {
  try {
    // Get the attachment details
    const attachmentResult = await pool.query(`
      SELECT awp.*, wp.name as wp_name, wp.allow_row_insert,
             ra.audit_id, auv.audit_area
      FROM area_working_papers awp
      JOIN working_papers wp ON awp.working_paper_id = wp.id
      JOIN risk_assessment ra ON awp.risk_assessment_id = ra.id
      JOIN audit_universe auv ON ra.audit_universe_id = auv.id
      WHERE awp.id = $1
    `, [req.params.attachmentId]);
    
    if (attachmentResult.rows.length === 0) {
      req.flash('error_msg', 'Attachment not found');
      return res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}`);
    }
    
    const attachment = attachmentResult.rows[0];
    
    // Get working paper columns
    const columnsResult = await pool.query(
      'SELECT * FROM working_paper_columns WHERE working_paper_id = $1 ORDER BY column_order',
      [attachment.working_paper_id]
    );
    
    // Get existing data for this attachment
    const dataResult = await pool.query(
      'SELECT * FROM working_paper_data WHERE area_working_paper_id = $1 ORDER BY row_order',
      [req.params.attachmentId]
    );
    
    res.render('testing-procedures/fill', {
      title: 'Fill Working Paper',
      attachment: attachment,
      columns: columnsResult.rows,
      data: dataResult.rows,
      auditId: req.params.auditId,
      areaId: req.params.areaId
    });
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading working paper');
    res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}`);
  }
});

// Save working paper data
router.post('/:auditId/:areaId/fill/:attachmentId', ensureAuditor, upload.any(), async (req, res) => {
  const { rows } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete existing data for this attachment
      await client.query(
        'DELETE FROM working_paper_data WHERE area_working_paper_id = $1',
        [req.params.attachmentId]
      );
      
      // Insert new data
      if (rows && Array.isArray(rows)) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          
          await client.query(
            'INSERT INTO working_paper_data (area_working_paper_id, row_order, data) VALUES ($1, $2, $3)',
            [req.params.attachmentId, i, JSON.stringify(row)]
          );
        }
      }
      
      await client.query('COMMIT');
      req.flash('success_msg', 'Working paper data saved successfully');
      res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error saving working paper data');
    res.redirect(`/testing-procedures/${req.params.auditId}/${req.params.areaId}/fill/${req.params.attachmentId}`);
  }
});

// Save all procedures (table submission)
router.post('/:auditId/save-all', ensureAuditor, upload.any(), async (req, res) => {
  const { items } = req.body;
  
  try {
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [req.params.auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    // Ensure record_of_work column exists
    await pool.query(`
      ALTER TABLE audit_procedures ADD COLUMN IF NOT EXISTS record_of_work TEXT
    `);
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      if (items && Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          if (!item.risk_assessment_id) continue;
          
          // Check if procedure exists
          const existing = await client.query(
            'SELECT id FROM audit_procedures WHERE audit_id = $1 AND risk_assessment_id = $2',
            [req.params.auditId, item.risk_assessment_id]
          );
          
          // Handle file upload for this item
          const evidenceFile = req.files?.find(f => f.fieldname === `evidence_${i}`);
          
          if (existing.rows.length > 0) {
            // Update existing
            await client.query(`
              UPDATE audit_procedures 
              SET record_of_work = $1, conclusion = $2, result = $3, cause = $4,
                  evidence_file = COALESCE($5, evidence_file),
                  working_paper_id = $6,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $7
            `, [
              item.record_of_work || null,
              item.conclusion || null,
              item.result || null,
              item.cause || null,
              evidenceFile ? evidenceFile.filename : null,
              item.working_paper_id || null,
              existing.rows[0].id
            ]);
          } else {
            // Insert new
            await client.query(`
              INSERT INTO audit_procedures 
              (audit_id, risk_assessment_id, record_of_work, conclusion, result, cause, 
               evidence_file, working_paper_id)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
              req.params.auditId,
              item.risk_assessment_id,
              item.record_of_work || null,
              item.conclusion || null,
              item.result || null,
              item.cause || null,
              evidenceFile ? evidenceFile.filename : null,
              item.working_paper_id || null
            ]);
          }
        }
      }
      
      await client.query('COMMIT');
      req.flash('success_msg', 'All procedures saved successfully');
      res.redirect(`/field-work/${req.params.auditId}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error saving procedures');
    res.redirect(`/field-work/${req.params.auditId}`);
  }
});

module.exports = router;
