const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { ensureAuditor } = require('../middleware/auth');

// List working papers
router.get('/', ensureAuditor, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT wp.*, u.name as created_by_name,
      (SELECT COUNT(*) FROM working_paper_columns WHERE working_paper_id = wp.id) as column_count
      FROM working_papers wp
      LEFT JOIN users u ON wp.created_by = u.id
      WHERE wp.organization_id = $1
      ORDER BY wp.created_at DESC
    `, [req.user.organization_id]);
    
    res.render('working-papers/list', {
      title: 'Working Papers',
      workingPapers: result.rows
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading working papers');
    res.redirect('/dashboard');
  }
});

// AI Generate working paper
router.post('/generate-ai', ensureAuditor, async (req, res) => {
  const { prompt } = req.body;
  
  try {
    // Simple template-based generation (you can replace this with actual AI API later)
    const result = generateWorkingPaper(prompt);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.json({ success: false });
  }
});

function generateWorkingPaper(prompt) {
  const lowerPrompt = prompt.toLowerCase();
  
  // Cash count template
  if (lowerPrompt.includes('cash')) {
    return {
      name: 'Cash Count Working Paper',
      columns: [
        { name: 'Denomination', type: 'select', options: '$100\n$50\n$20\n$10\n$5\n$1\nCoins' },
        { name: 'Quantity', type: 'number' },
        { name: 'Amount', type: 'formula', formula: 'col1 * col2' },
        { name: 'Notes', type: 'text' },
        { name: 'Counted By', type: 'text' },
        { name: 'Date', type: 'date' }
      ]
    };
  }
  
  // Inventory template
  if (lowerPrompt.includes('inventory')) {
    return {
      name: 'Inventory Verification Working Paper',
      columns: [
        { name: 'Item Code', type: 'text' },
        { name: 'Item Description', type: 'text' },
        { name: 'Physical Count', type: 'number' },
        { name: 'System Count', type: 'number' },
        { name: 'Variance', type: 'formula', formula: 'col3 - col4' },
        { name: 'Status', type: 'select', options: 'Match\nVariance\nMissing' },
        { name: 'Location', type: 'text' },
        { name: 'Evidence', type: 'file' }
      ]
    };
  }
  
  // Expense template
  if (lowerPrompt.includes('expense')) {
    return {
      name: 'Expense Verification Working Paper',
      columns: [
        { name: 'Expense Date', type: 'date' },
        { name: 'Vendor', type: 'text' },
        { name: 'Description', type: 'text' },
        { name: 'Amount', type: 'number' },
        { name: 'Category', type: 'select', options: 'Travel\nSupplies\nEquipment\nServices\nOther' },
        { name: 'Receipt Available', type: 'select', options: 'Yes\nNo' },
        { name: 'Approved By', type: 'text' },
        { name: 'Status', type: 'select', options: 'Verified\nPending\nIssue' }
      ]
    };
  }
  
  // Asset template
  if (lowerPrompt.includes('asset')) {
    return {
      name: 'Asset Verification Working Paper',
      columns: [
        { name: 'Asset Tag', type: 'text' },
        { name: 'Asset Description', type: 'text' },
        { name: 'Location', type: 'text' },
        { name: 'Condition', type: 'select', options: 'Good\nFair\nPoor\nDamaged' },
        { name: 'Physical Verified', type: 'select', options: 'Yes\nNo' },
        { name: 'Purchase Date', type: 'date' },
        { name: 'Value', type: 'number' },
        { name: 'Photo', type: 'file' },
        { name: 'Notes', type: 'text' }
      ]
    };
  }
  
  // Default generic template
  return {
    name: 'Custom Working Paper',
    columns: [
      { name: 'Item', type: 'text' },
      { name: 'Description', type: 'text' },
      { name: 'Status', type: 'select', options: 'Completed\nPending\nN/A' },
      { name: 'Notes', type: 'text' },
      { name: 'Date', type: 'date' }
    ]
  };
}

// Create working paper form (Manual Builder)
router.get('/create', ensureAuditor, (req, res) => {
  res.render('working-papers/create', { title: 'Create Working Paper' });
});

// Create working paper POST
router.post('/create', ensureAuditor, async (req, res) => {
  const { name, allow_row_insert, columns } = req.body;
  
  console.log('Creating working paper:', name);
  console.log('Columns received:', columns);
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const wpResult = await client.query(
        'INSERT INTO working_papers (name, allow_row_insert, created_by, organization_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, allow_row_insert === 'true', req.user.id, req.user.organization_id]
      );
      
      const wpId = wpResult.rows[0].id;
      
      if (columns && Array.isArray(columns)) {
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          
          // Process options - split by newlines if it's a string
          let optionsArray = [];
          if (col.options) {
            if (typeof col.options === 'string') {
              optionsArray = col.options.split('\n').map(o => o.trim()).filter(o => o.length > 0);
            } else if (Array.isArray(col.options)) {
              optionsArray = col.options;
            }
          }
          
          await client.query(
            'INSERT INTO working_paper_columns (working_paper_id, column_name, column_type, column_order, options, formula) VALUES ($1, $2, $3, $4, $5, $6)',
            [wpId, col.name, col.type, i, JSON.stringify(optionsArray), col.formula || null]
          );
        }
      }
      
      await client.query('COMMIT');
      req.flash('success_msg', 'Working paper created successfully');
      res.redirect('/working-papers');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error creating working paper:', error);
    req.flash('error_msg', 'Error creating working paper');
    res.redirect('/working-papers/create');
  }
});

// View working paper data (JSON for modal)
router.get('/:id/view-data', ensureAuditor, async (req, res) => {
  try {
    const wpResult = await pool.query(`
      SELECT wp.*, u.name as created_by_name
      FROM working_papers wp
      LEFT JOIN users u ON wp.created_by = u.id
      WHERE wp.id = $1 AND wp.organization_id = $2
    `, [req.params.id, req.user.organization_id]);
    
    if (wpResult.rows.length === 0) {
      return res.status(404).json({ error: 'Working paper not found' });
    }
    
    const columnsResult = await pool.query(
      'SELECT * FROM working_paper_columns WHERE working_paper_id = $1 ORDER BY column_order',
      [req.params.id]
    );
    
    res.json({
      workingPaper: wpResult.rows[0],
      columns: columnsResult.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error loading working paper' });
  }
});

// View working paper
router.get('/:id/view', ensureAuditor, async (req, res) => {
  try {
    const wpResult = await pool.query(`
      SELECT wp.*, u.name as created_by_name
      FROM working_papers wp
      LEFT JOIN users u ON wp.created_by = u.id
      WHERE wp.id = $1 AND wp.organization_id = $2
    `, [req.params.id, req.user.organization_id]);
    
    if (wpResult.rows.length === 0) {
      req.flash('error_msg', 'Working paper not found');
      return res.redirect('/working-papers');
    }
    
    const columnsResult = await pool.query(
      'SELECT * FROM working_paper_columns WHERE working_paper_id = $1 ORDER BY column_order',
      [req.params.id]
    );
    
    res.render('working-papers/view', {
      title: 'View Working Paper',
      workingPaper: wpResult.rows[0],
      columns: columnsResult.rows
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading working paper');
    res.redirect('/working-papers');
  }
});

// Edit working paper form
router.get('/:id/edit', ensureAuditor, async (req, res) => {
  try {
    const wpResult = await pool.query(
      'SELECT * FROM working_papers WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organization_id]
    );
    
    if (wpResult.rows.length === 0) {
      req.flash('error_msg', 'Working paper not found');
      return res.redirect('/working-papers');
    }
    
    const columnsResult = await pool.query(
      'SELECT * FROM working_paper_columns WHERE working_paper_id = $1 ORDER BY column_order',
      [req.params.id]
    );
    
    res.render('working-papers/edit', {
      title: 'Edit Working Paper',
      workingPaper: wpResult.rows[0],
      columns: columnsResult.rows
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading working paper');
    res.redirect('/working-papers');
  }
});

// Update working paper
router.post('/:id/update', ensureAuditor, async (req, res) => {
  const { name, allow_row_insert, columns } = req.body;
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Update working paper
      await client.query(
        'UPDATE working_papers SET name = $1, allow_row_insert = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND organization_id = $4',
        [name, allow_row_insert === 'true', req.params.id, req.user.organization_id]
      );
      
      // Delete old columns
      await client.query(
        'DELETE FROM working_paper_columns WHERE working_paper_id = $1',
        [req.params.id]
      );
      
      // Insert new columns
      if (columns && Array.isArray(columns)) {
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          
          let optionsArray = [];
          if (col.options) {
            if (typeof col.options === 'string') {
              optionsArray = col.options.split('\n').map(o => o.trim()).filter(o => o.length > 0);
            } else if (Array.isArray(col.options)) {
              optionsArray = col.options;
            }
          }
          
          await client.query(
            'INSERT INTO working_paper_columns (working_paper_id, column_name, column_type, column_order, options, formula) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.params.id, col.name, col.type, i, JSON.stringify(optionsArray), col.formula || null]
          );
        }
      }
      
      await client.query('COMMIT');
      req.flash('success_msg', 'Working paper updated successfully');
      res.redirect('/working-papers');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error updating working paper:', error);
    req.flash('error_msg', 'Error updating working paper');
    res.redirect(`/working-papers/${req.params.id}/edit`);
  }
});

// Delete working paper
router.post('/:id/delete', ensureAuditor, async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete columns first
      await client.query(
        'DELETE FROM working_paper_columns WHERE working_paper_id = $1',
        [req.params.id]
      );
      
      // Delete working paper
      await client.query(
        'DELETE FROM working_papers WHERE id = $1 AND organization_id = $2',
        [req.params.id, req.user.organization_id]
      );
      
      await client.query('COMMIT');
      req.flash('success_msg', 'Working paper deleted successfully');
      res.json({ success: true });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error deleting working paper:', error);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
