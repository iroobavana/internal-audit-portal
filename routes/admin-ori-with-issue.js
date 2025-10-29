const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const { ensureSystemAdmin } = require('../middleware/auth');

// System Admin Dashboard
router.get('/dashboard', ensureSystemAdmin, async (req, res) => {
  try {
    const orgsResult = await pool.query('SELECT COUNT(*) FROM organizations');
    const usersResult = await pool.query('SELECT COUNT(*) FROM users WHERE role != \'system_admin\'');
    
    res.render('admin/dashboard', {
      title: 'System Admin Dashboard',
      orgsCount: orgsResult.rows[0].count,
      usersCount: usersResult.rows[0].count,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading admin dashboard:', error);
    req.flash('error_msg', 'Error loading dashboard');
    res.redirect('/');
  }
});

// Organizations Management
router.get('/organizations', ensureSystemAdmin, async (req, res) => {
  try {
    const orgsResult = await pool.query(`
      SELECT o.*, 
        (SELECT COUNT(*) FROM users WHERE organization_id = o.id) as user_count,
        (SELECT COUNT(*) FROM auditees WHERE organization_id = o.id) as auditee_count
      FROM organizations o
      ORDER BY o.created_at DESC
    `);
    
    res.render('admin/organizations', {
      title: 'Manage Organizations',
      organizations: orgsResult.rows,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading organizations:', error);
    req.flash('error_msg', 'Error loading organizations');
    res.redirect('/admin/dashboard');
  }
});

// Create Organization
router.post('/organizations', ensureSystemAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    
    await pool.query(
      'INSERT INTO organizations (name) VALUES ($1)',
      [name]
    );
    
    req.flash('success_msg', 'Organization created successfully');
    res.redirect('/admin/organizations');
  } catch (error) {
    console.error('Error creating organization:', error);
    req.flash('error_msg', 'Error creating organization');
    res.redirect('/admin/organizations');
  }
});

// Users Management
router.get('/users', ensureSystemAdmin, async (req, res) => {
  try {
    const usersResult = await pool.query(`
      SELECT u.*, o.name as organization_name
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.role != 'system_admin'
      ORDER BY u.created_at DESC
    `);
    
    const orgsResult = await pool.query('SELECT * FROM organizations ORDER BY name');
    
    res.render('admin/users', {
      title: 'Manage Users',
      users: usersResult.rows,
      organizations: orgsResult.rows,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading users:', error);
    req.flash('error_msg', 'Error loading users');
    res.redirect('/admin/dashboard');
  }
});

// Create User
router.post('/users', ensureSystemAdmin, async (req, res) => {
  try {
    const { name, email, password, role, organization_id } = req.body;
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await pool.query(
      'INSERT INTO users (name, email, password, role, organization_id) VALUES ($1, $2, $3, $4, $5)',
      [name, email, hashedPassword, role, organization_id]
    );
    
    req.flash('success_msg', 'User created successfully');
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error creating user:', error);
    req.flash('error_msg', 'Error creating user');
    res.redirect('/admin/users');
  }
});

module.exports = router;