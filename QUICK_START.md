# 🚀 QUICK START - Internal Audit Portal

## ⚡ Super Fast Setup (5 Minutes!)

### Step 1: Open the Project
1. Extract the `internal-audit-portal` folder to your computer
2. Open the folder in VS Code

### Step 2: Install Everything
Open VS Code terminal (Terminal → New Terminal) and run:
```bash
npm install
```

### Step 3: Setup Database
1. Open pgAdmin
2. Create database: `audit_portal`
3. Copy `.env.example` to `.env`
4. Edit `.env` and change `DB_PASSWORD` to your PostgreSQL password

### Step 4: Initialize Database
In terminal:
```bash
npm run init-db
```

### Step 5: Start!
```bash
npm start
```

### Step 6: Login
Open browser: http://localhost:3000

Login with:
- Email: **admin@audit.com**
- Password: **Admin@123**

## ✅ What's Working Now

✓ User login and authentication
✓ Dashboard with role-based access
✓ Create and manage Auditees
✓ Add departments to Auditees
✓ Create Audit Universe (audit areas, processes, controls)
✓ Create and schedule Audits
✓ Assign team leaders and team members
✓ View audit calendar
✓ Create working papers
✓ Professional UI with Bootstrap

## 🔧 What's Next to Build

The following modules are ready for implementation:
- Risk Assessment (calculate risk ratings)
- Field Work & Testing Procedures
- Audit Procedures with pass/fail results
- Issues Management (submit, review, approve)
- Management Comments
- Report Generation (Word documents)
- Follow-up Tracker

## 📂 What You Got

```
internal-audit-portal/
├── SETUP_GUIDE.md          ← Detailed instructions
├── README.md               ← Project overview
├── package.json            ← Node.js dependencies
├── server.js               ← Main application
├── .env.example            ← Configuration template
│
├── config/                 ← Database & auth setup
├── routes/                 ← Page routing
├── views/                  ← HTML pages (EJS)
├── public/                 ← CSS, JavaScript
├── middleware/             ← Security & permissions
└── scripts/                ← Database initialization
```

## 🎯 How to Use

### Create Your First Auditee
1. Click "Auditees" in menu
2. Click "Create Auditee"
3. Enter name, email, departments
4. Click "Create"

### Add Audit Universe
1. Go to Auditees list
2. Click grid icon on an auditee
3. Fill in audit areas, processes, controls
4. Click "Add Entry"

### Create an Audit
1. Click "Audits" in menu
2. Click "Create Audit"
3. Select auditee, team, dates
4. Click "Create"

## ⚠️ Important Notes

- Keep terminal running while using the portal
- Press Ctrl+C to stop the server
- All data is saved in PostgreSQL
- To reset database: `npm run init-db` (WARNING: Deletes all data!)

## 🆘 Quick Troubleshooting

**Can't connect to database?**
→ Check PostgreSQL is running
→ Verify password in `.env` file
→ Confirm database exists in pgAdmin

**Port 3000 in use?**
→ Change PORT in `.env` to 3001

**Module not found?**
→ Run `npm install` again

## 📞 Need Help?

Check SETUP_GUIDE.md for detailed instructions!

---

**You're all set! Start by creating your first auditee!** 🎉
