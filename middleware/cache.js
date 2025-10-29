// =========================================
// CACHE MIDDLEWARE
// =========================================
// This middleware sets cache headers for all routes
// Eliminates need to set headers in each route
// =========================================

const noCacheMiddleware = (req, res, next) => {
  // Prevent caching of sensitive audit data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

module.exports = { noCacheMiddleware };