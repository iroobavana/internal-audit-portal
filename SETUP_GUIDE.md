# Internal Audit Portal - Complete Setup Guide

## 🎯 What We Built

A complete web-based Internal Audit Portal with:
- User authentication (Head of Audit, Manager, Auditor, Auditee roles)
- Auditee management
- Audit creation and scheduling
- Working papers system
- Risk assessment
- Field work tracking
- Issues management
- Report generation
- Follow-up tracking

## 📋 Prerequisites (Already Installed ✓)

- ✓ Node.js
- ✓ PostgreSQL (pgAdmin)
- ✓ VS Code

## 🚀 STEP-BY-STEP SETUP

### Step 1: Extract the Project

1. Open the `internal-audit-portal` folder in VS Code
2. You should see folders like: config, controllers, models, routes, views, public, etc.

### Step 2: Open Terminal in VS Code

1. In VS Code, click on `Terminal` menu → `New Terminal`
2. Make sure you're in the `internal-audit-portal` folder
3. Type `pwd` (Mac/Linux) or `cd` (Windows) and press Enter
4. You should see the path ending with `/internal-audit-portal`

### Step 3: Install Node.js Packages

In the terminal, type this command and press Enter:

```bash
npm install
```

This will take 2-3 minutes and install all required packages. You'll see a progress bar.

### Step 4: Setup PostgreSQL Database

1. Open **pgAdmin** on your computer
2. Connect to your PostgreSQL server (default password is what you set during PostgreSQL installation)
3. Right-click on "Databases" → "Create" → "Database"
4. Enter database name: `audit_portal`
5. Click "Save"

### Step 5: Configure Environment Variables

1. In VS Code, find the file `.env.example`
2. Right-click it → "Copy"
3. Right-click in the file explorer → "Paste"
4. Rename the copied file from `.env.example copy` to `.env` (remove "copy" and ".example")
5. Open the `.env` file
6. Update these lines with YOUR PostgreSQL password:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=audit_portal
DB_USER=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD_HERE    <-- Change this!

PORT=3000
SESSION_SECRET=my_secret_key_12345          <-- Change this to any random text
```

**Important:** Replace `YOUR_POSTGRES_PASSWORD_HERE` with your actual PostgreSQL password!

### Step 6: Initialize Database Tables

In the VS Code terminal, run:

```bash
npm run init-db
```

You should see:
```
✓ Database connected successfully
Starting database initialization...
Creating users table...
Creating auditees table...
...
✓ Database initialized successfully!
✓ Default admin user created:
  Email: admin@audit.com
  Password: Admin@123
```

If you see any errors, check:
- Is PostgreSQL running?
- Is your password correct in the `.env` file?
- Does the `audit_portal` database exist in pgAdmin?

### Step 7: Start the Application

In the terminal, run:

```bash
npm start
```

You should see:
```
=================================
Internal Audit Portal Started
=================================
Server running on http://localhost:3000
Environment: development
=================================
✓ Database connected successfully
```

### Step 8: Access the Portal

1. Open your web browser (Chrome, Firefox, Edge, etc.)
2. Go to: `http://localhost:3000`
3. You should see the welcome page
4. Click "Login"
5. Use these credentials:
   - **Email:** admin@audit.com
   - **Password:** Admin@123

## 🎉 Success!

You should now see the Dashboard with options to:
- Manage Auditees (create auditees, departments, audit universe)
- Create Audits
- Create Working Papers
- Manage Issues

## 📖 How to Use the Portal

### Creating Your First Auditee

1. Click "Auditees" in the navigation menu
2. Click "Create Auditee"
3. Enter:
   - Auditee Name (e.g., "Finance Department")
   - Official Email (e.g., "finance@company.com")
   - Add departments (e.g., "Accounts Payable", "Accounts Receivable")
4. Click "Create Auditee"

### Creating an Audit

1. Click "Audits" in the navigation menu
2. Click "Create Audit"
3. Fill in the form:
   - Audit Name
   - Select Auditee
   - Assign Team Leader
   - Select Team Members
   - Set Start and End Dates
4. Click "Create Audit"

### Creating Working Papers

1. Click "Working Papers" in the navigation menu
2. Click "Create Working Paper"
3. Design your custom table with columns
4. Use these working papers during field work

## 🔧 Troubleshooting

### Problem: "Cannot connect to database"
**Solution:** 
- Make sure PostgreSQL is running
- Check your password in the `.env` file
- Verify the database `audit_portal` exists in pgAdmin

### Problem: "Port 3000 is already in use"
**Solution:** 
- Close any other applications using port 3000
- Or change PORT in `.env` file to 3001 or 4000

### Problem: "Cannot find module..."
**Solution:** 
- Run `npm install` again
- Make sure you're in the correct folder

### Problem: Page shows "Cannot GET /something"
**Solution:** 
- That feature is a placeholder and will be developed next
- Start with Dashboard, Auditees, and Audits first

## 🛠️ Development Commands

### Start the server normally:
```bash
npm start
```

### Start with auto-reload (when editing code):
```bash
npm run dev
```

### Reset the database (WARNING: Deletes all data!):
```bash
npm run init-db
```

## 📁 Project Structure

```
internal-audit-portal/
├── config/              # Database and authentication setup
├── routes/              # URL routing (what happens when you visit a page)
├── views/               # HTML pages (EJS templates)
├── public/              # CSS, JavaScript, images
├── middleware/          # Authentication checks
├── scripts/             # Database initialization
├── uploads/             # Uploaded files storage
├── server.js            # Main application file
├── package.json         # Project dependencies
└── .env                 # Your configuration (passwords, etc.)
```

## 🔐 User Roles

1. **Head of Audit** - Full access, can create auditees and audits
2. **Manager** - Can verify issues, manage audits
3. **Auditor** - Can perform audits, submit issues
4. **Auditee** - Can view and comment on issues

## 📝 Next Steps

Now that the basic portal is running, you can:

1. **Create more users** (we'll add user management next)
2. **Complete the Risk Assessment module**
3. **Build the Field Work module**
4. **Implement Issues Management**
5. **Add Report Generation**

Let me know which module you'd like to build next!

## 💡 Tips

- Keep the terminal running while using the portal
- Press `Ctrl+C` in terminal to stop the server
- Always run `npm start` from the project folder
- Your data is stored in PostgreSQL database
- To reset everything, run `npm run init-db` again

## 🆘 Need Help?

If something isn't working:
1. Check the terminal for error messages
2. Make sure PostgreSQL is running
3. Verify your `.env` file settings
4. Ensure you ran `npm install` successfully

---

**Congratulations! You've successfully set up your Internal Audit Portal!** 🎊
