const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const pool = require('./database');

module.exports = function(passport) {
  // Local Strategy
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const result = await pool.query(
          'SELECT * FROM users WHERE email = $1',
          [email]
        );

        if (result.rows.length === 0) {
          return done(null, false, { message: 'Email not registered' });
        }

        const user = result.rows[0];

        // Match password
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
          return done(null, user);
        } else {
          return done(null, false, { message: 'Incorrect password' });
        }
      } catch (error) {
        return done(error);
      }
    })
  );

  // Serialize user
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user
  passport.deserializeUser(async (id, done) => {
    try {
      const result = await pool.query(
        'SELECT id, name, email, role, organization_id FROM users WHERE id = $1',
        [id]
      );
      done(null, result.rows[0]);
    } catch (error) {
      done(error);
    }
  });
};
