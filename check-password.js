const bcrypt = require('bcryptjs');
const pool = require('./config/database');

async function checkPassword() {
  try {
    const result = await pool.query(
      'SELECT email, password FROM users WHERE email = $1',
      ['admin@audit.com']
    );
    
    if (result.rows.length === 0) {
      console.log('User not found!');
      process.exit(1);
    }
    
    const user = result.rows[0];
    console.log('Testing passwords for:', user.email);
    console.log('Hash in database:', user.password.substring(0, 30) + '...');
    console.log('\n--- Testing Passwords ---\n');
    
    const tests = ['admin123', 'Admin123', 'Admin@123', 'admin@123', 'ADMIN123'];
    
    for (const p of tests) {
      const match = await bcrypt.compare(p, user.password);
      console.log(`Password: "${p}" - ${match ? '✅ MATCH!' : '❌ no'}`);
      if (match) {
        console.log(`\n🎉 FOUND IT! The correct password is: "${p}"\n`);
      }
    }
    
    console.log('\n--- Generating New Hash ---\n');
    
    // Generate new hash for Admin@123
    bcrypt.hash('Admin@123', 10, (err, hash) => {
      if (err) {
        console.error('Error:', err);
        process.exit(1);
      } else {
        console.log('New hash for password "Admin@123":');
        console.log(hash);
        console.log('\nCopy and run this SQL in pgAdmin:\n');
        console.log(`UPDATE users SET password = '${hash}' WHERE email = 'admin@audit.com';`);
        console.log('\n');
        process.exit(0);
      }
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkPassword();