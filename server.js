const express = require('express');
const session = require('express-session');
const passport = require('passport');
const flash = require('connect-flash');
const path = require('path');
const methodOverride = require('method-override');
require('dotenv').config();
const app = express();
// Passport config
require('./config/passport')(passport);
// EJS template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Body parser middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Method override for PUT and DELETE requests
app.use(methodOverride('_method'));
// Static folder
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Express session
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
  })
);
// Passport middleware
app.use(passport.initialize());
app.use(passport.session());
// Connect flash
app.use(flash());
// Global variables
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.user = req.user || null;
  next();
});
// Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/auditees', require('./routes/auditees'));
app.use('/audits', require('./routes/audits'));
app.use('/working-papers', require('./routes/workingPapers'));
app.use('/risk-assessment', require('./routes/riskAssessment'));
app.use('/field-work', require('./routes/fieldWork'));
app.use('/testing-procedures', require('./routes/fieldWork')); // Add this line for testing procedures
app.use('/issues', require('./routes/issues'));
app.use('/auditee', require('./routes/auditee'));
app.use('/reports', require('./routes/reports'));
// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Error',
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});
// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404',
    message: 'Page not found',
    error: {}
  });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('=================================');
  console.log('Internal Audit Portal Started');
  console.log('=================================');
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('=================================');
});
