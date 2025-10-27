# Internal Audit Portal

A comprehensive audit management system for managing audits, auditees, working papers, and generating reports.

## Prerequisites
- Node.js (already installed ✓)
- PostgreSQL (already installed ✓)
- VS Code (already installed ✓)

## Setup Instructions

### Step 1: Install Dependencies
Open VS Code terminal in this folder and run:
```bash
npm install
```

### Step 2: Setup Database
1. Open pgAdmin
2. Create a new database called "audit_portal"
3. Copy the `.env.example` file to `.env`
4. Update the database credentials in `.env` file

### Step 3: Initialize Database Tables
```bash
npm run init-db
```

### Step 4: Start the Server
```bash
npm start
```

The portal will be available at: http://localhost:3000

## Default Admin Login
- Email: admin@audit.com
- Password: Admin@123

## Project Structure
```
internal-audit-portal/
├── config/           # Configuration files
├── controllers/      # Business logic
├── models/          # Database models
├── routes/          # API routes
├── views/           # HTML pages
├── public/          # Static files (CSS, JS, images)
├── uploads/         # Uploaded files
├── middleware/      # Authentication & validation
└── server.js        # Main application file
```

## Features
1. Audit Management
2. Auditee Management
3. Working Papers (customizable tables)
4. Risk Assessment
5. Field Work & Testing
6. Report Generation
7. Follow-up Tracking
8. Issue Management
