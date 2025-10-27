const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureAuditor } = require('../middleware/auth');
const multer = require('multer');

// Configure multer same as Field Work
const upload = multer();

// Save risk assessment - MATCHES FIELD WORK PATTERN
router.post('/:auditId/save', ensureAuditor, upload.any(), async (req, res) => {
  console.log('=== RISK ASSESSMENT SAVE ===');
  console.log('Body type:', typeof req.body);
  console.log('Body keys:', Object.keys(req.body));
  console.log('Raw body:', JSON.stringify(req.body, null, 2));
  
  const { items } = req.body;
  
  console.log('Items type:', typeof items);
  console.log('Items is array?:', Array.isArray(items));
  console.log('Items is object?:', items && typeof items === 'object');
  
  if (!items) {
    console.error('❌ NO ITEMS IN REQUEST');
    req.flash('error_msg', 'No data received');
    return res.redirect(`/audits/${req.params.auditId}`);
  }
  
  try {
    // Verify audit belongs to user's organization
    const auditCheck = await pool.query(
      'SELECT id FROM audits WHERE id = $1 AND organization_id = $2',
      [req.params.auditId, req.user.organization_id]
    );
    
    if (auditCheck.rows.length === 0) {
      console.error('❌ AUDIT NOT FOUND OR ACCESS DENIED');
      req.flash('error_msg', 'Audit not found');
      return res.redirect('/audits');
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get existing risk assessments
      const existing = await client.query(
        'SELECT id, audit_universe_id FROM risk_assessment WHERE audit_id = $1',
        [req.params.auditId]
      );
      
      const existingMap = new Map();
      existing.rows.forEach(row => {
        existingMap.set(row.audit_universe_id, row.id);
      });
      
      console.log('Existing risk assessments:', existingMap.size);
      
      // Convert items to array (handle both object and array formats)
      let itemsArray;
      if (Array.isArray(items)) {
        itemsArray = items;
      } else if (typeof items === 'object') {
        itemsArray = Object.values(items);
      } else {
        throw new Error('Invalid items format');
      }
      
      console.log(`Processing ${itemsArray.length} items`);
      
      const processedUniverseIds = new Set();
      
      for (let i = 0; i < itemsArray.length; i++) {
        const item = itemsArray[i];
        
        if (!item.universe_id) {
          console.log(`Skipping item ${i}: no universe_id`);
          continue;
        }
        
        const universeId = parseInt(item.universe_id);
        const likelihood = parseInt(item.likelihood) || 0;
        const impact = parseInt(item.impact) || 0;
        
        // Checkbox handling: only present when checked
        const isSelected = !!(item.is_selected);
        
        const assignedAuditorId = item.assigned_auditor_id ? parseInt(item.assigned_auditor_id) : null;
        
        console.log(`Item ${i}:`, {
          universe_id: universeId,
          likelihood,
          impact,
          is_selected: isSelected,
          assigned_auditor_id: assignedAuditorId
        });
        
        processedUniverseIds.add(universeId);
        
        if (existingMap.has(universeId)) {
          // Update existing
          await client.query(`
            UPDATE risk_assessment 
            SET likelihood = $1, 
                impact = $2, 
                is_selected = $3, 
                assigned_auditor_id = $4,
                updated_at = NOW()
            WHERE id = $5
          `, [
            likelihood,
            impact,
            isSelected,
            assignedAuditorId,
            existingMap.get(universeId)
          ]);
          console.log(`✓ Updated universe_id ${universeId}: selected=${isSelected}`);
        } else {
          // Insert new
          await client.query(`
            INSERT INTO risk_assessment 
            (audit_id, audit_universe_id, likelihood, impact, is_selected, assigned_auditor_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          `, [
            req.params.auditId,
            universeId,
            likelihood,
            impact,
            isSelected,
            assignedAuditorId
          ]);
          console.log(`✓ Inserted universe_id ${universeId}: selected=${isSelected}`);
        }
      }
      
      console.log(`✅ Processed ${processedUniverseIds.size} items`);
      
      // Delete unused risk assessments (not referenced in audit_procedures)
      for (const [universeId, riskId] of existingMap.entries()) {
        if (!processedUniverseIds.has(universeId)) {
          const procedureCheck = await client.query(
            'SELECT id FROM audit_procedures WHERE risk_assessment_id = $1',
            [riskId]
          );
          
          if (procedureCheck.rows.length === 0) {
            await client.query('DELETE FROM risk_assessment WHERE id = $1', [riskId]);
            console.log(`🗑 Deleted unused universe_id ${universeId}`);
          }
        }
      }
      
      await client.query('COMMIT');
      console.log('✅✅✅ RISK ASSESSMENT SAVED SUCCESSFULLY! ✅✅✅');
      req.flash('success_msg', 'Risk assessment saved successfully');
      res.redirect(`/audits/${req.params.auditId}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Save error:', error);
    req.flash('error_msg', 'Error saving risk assessment: ' + error.message);
    res.redirect(`/audits/${req.params.auditId}`);
  }
});

module.exports = router;
