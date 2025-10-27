const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendCredentialsEmail(to, name, password) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const loginUrl = appUrl + '/auth/login';
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: to,
    subject: 'Internal Audit Portal - Login Credentials',
    html: '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<div style="background: #3b82f6; padding: 20px; text-align: center;">' +
      '<h1 style="color: white; margin: 0;">Internal Audit Portal</h1>' +
      '</div>' +
      '<div style="padding: 30px; background: #f8fafc;">' +
      '<h2 style="color: #0f172a;">Welcome ' + name + '!</h2>' +
      '<p style="color: #64748b; font-size: 16px;">Your account has been created. Use these credentials to login:</p>' +
      '<div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">' +
      '<p style="margin: 10px 0;"><strong>Email:</strong> ' + to + '</p>' +
      '<p style="margin: 10px 0;"><strong>Password:</strong> <span style="color: #ef4444; font-family: monospace; font-size: 18px;">' + password + '</span></p>' +
      '</div>' +
      '<a href="' + loginUrl + '" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 10px;">Login Now</a>' +
      '<p style="color: #94a3b8; font-size: 14px; margin-top: 30px;">Please change your password after first login.</p>' +
      '</div>' +
      '<div style="background: #1e293b; padding: 15px; text-align: center;">' +
      '<p style="color: #94a3b8; margin: 0; font-size: 12px;">Internal Audit Portal - Automated Email</p>' +
      '</div>' +
      '</div>'
  };

  return transporter.sendMail(mailOptions);
}

module.exports = { sendCredentialsEmail };
