const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { forwardAuthenticated } = require('../middleware/auth');

// Login page
router.get('/login', forwardAuthenticated, (req, res) => {
  res.render('login', { title: 'Login' });
});

// Login handle
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error_msg', info.message || 'Login failed');
      return res.redirect('/auth/login');
    }
    
    req.logIn(user, (err) => {
      if (err) return next(err);
      
      // Redirect based on role
      if (user.role === 'auditee') {
        return res.redirect('/auditee/comments');
      } else {
        return res.redirect('/dashboard');
      }
    });
  })(req, res, next);
});

// Logout handle
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.flash('success_msg', 'You are logged out');
    res.redirect('/auth/login');
  });
});

module.exports = router;
