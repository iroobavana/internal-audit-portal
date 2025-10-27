// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash('error_msg', 'Please log in to access this page');
  res.redirect('/login');
}

// Middleware to ensure user has specific role
function ensureRole(...roles) {
  return (req, res, next) => {
    if (req.isAuthenticated() && roles.includes(req.user.role)) {
      return next();
    }
    req.flash('error_msg', 'You do not have permission to access this page');
    res.redirect('/dashboard');
  };
}

// Middleware to check if user is Head of Audit
function ensureHeadOfAudit(req, res, next) {
  return ensureRole('head_of_audit')(req, res, next);
}

// Middleware to check if user is Manager or Head of Audit
function ensureManagerOrHead(req, res, next) {
  return ensureRole('head_of_audit', 'manager')(req, res, next);
}

// Middleware to check if user is Auditor, Manager, or Head
function ensureAuditor(req, res, next) {
  return ensureRole('head_of_audit', 'manager', 'auditor')(req, res, next);
}

// Middleware to forward authenticated users away from auth pages
function forwardAuthenticated(req, res, next) {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect('/dashboard');
}

// Middleware to check if user is Auditee
function ensureAuditee(req, res, next) {
  return ensureRole('auditee')(req, res, next);
}
// Middleware to check if user is System Admin
function ensureSystemAdmin(req, res, next) {
  return ensureRole('system_admin')(req, res, next);
}
module.exports = {
  ensureAuthenticated,
  ensureRole,
  ensureHeadOfAudit,
  ensureManagerOrHead,
  ensureAuditor,
  ensureAuditee,
  ensureSystemAdmin,
  forwardAuthenticated
};