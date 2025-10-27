const pool = require('../config/database');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Starting database initialization...');
    
    // Start transaction
    await client.query('BEGIN');

    // Drop existing tables (in reverse order of dependencies)
    console.log('Dropping existing tables...');
    await client.query(`
      DROP TABLE IF EXISTS follow_up_tracker CASCADE;
      DROP TABLE IF EXISTS issue_register CASCADE;
      DROP TABLE IF EXISTS management_comments CASCADE;
      DROP TABLE IF EXISTS audit_issues CASCADE;
      DROP TABLE IF EXISTS audit_procedures CASCADE;
      DROP TABLE IF EXISTS working_paper_data CASCADE;
      DROP TABLE IF EXISTS working_paper_columns CASCADE;
      DROP TABLE IF EXISTS working_papers CASCADE;
      DROP TABLE IF EXISTS risk_assessment CASCADE;
      DROP TABLE IF EXISTS audit_universe CASCADE;
      DROP TABLE IF EXISTS audit_team CASCADE;
      DROP TABLE IF EXISTS audits CASCADE;
      DROP TABLE IF EXISTS auditee_departments CASCADE;
      DROP TABLE IF EXISTS auditees CASCADE;
      DROP TABLE IF EXISTS document_library CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TYPE IF EXISTS user_role CASCADE;
      DROP TYPE IF EXISTS issue_status CASCADE;
      DROP TYPE IF EXISTS column_type CASCADE;
    `);

    // Create ENUM types
    console.log('Creating ENUM types...');
    await client.query(`
      CREATE TYPE user_role AS ENUM ('head_of_audit', 'manager', 'auditor', 'auditee');
      CREATE TYPE issue_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'in_progress', 'completed', 'removed');
      CREATE TYPE column_type AS ENUM ('text', 'number', 'date', 'select', 'multiselect', 'file', 'url', 'formula');
    `);

    // Users table
    console.log('Creating users table...');
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role user_role NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Auditees table
    console.log('Creating auditees table...');
    await client.query(`
      CREATE TABLE auditees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        official_email VARCHAR(255) NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Auditee departments table
    await client.query(`
      CREATE TABLE auditee_departments (
        id SERIAL PRIMARY KEY,
        auditee_id INTEGER REFERENCES auditees(id) ON DELETE CASCADE,
        department_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audit Universe table
    console.log('Creating audit_universe table...');
    await client.query(`
      CREATE TABLE audit_universe (
        id SERIAL PRIMARY KEY,
        auditee_id INTEGER REFERENCES auditees(id) ON DELETE CASCADE,
        department_id INTEGER REFERENCES auditee_departments(id) ON DELETE CASCADE,
        audit_area VARCHAR(255),
        process TEXT,
        inherent_risk VARCHAR(100),
        control_measure TEXT,
        audit_procedure TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audits table
    console.log('Creating audits table...');
    await client.query(`
      CREATE TABLE audits (
        id SERIAL PRIMARY KEY,
        auditee_id INTEGER REFERENCES auditees(id),
        audit_name VARCHAR(255) NOT NULL,
        team_leader_id INTEGER REFERENCES users(id),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'scheduled',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audit Team table
    await client.query(`
      CREATE TABLE audit_team (
        id SERIAL PRIMARY KEY,
        audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Working Papers table
    console.log('Creating working_papers table...');
    await client.query(`
      CREATE TABLE working_papers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        allow_row_insert BOOLEAN DEFAULT true,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Working Paper Columns table
    await client.query(`
      CREATE TABLE working_paper_columns (
        id SERIAL PRIMARY KEY,
        working_paper_id INTEGER REFERENCES working_papers(id) ON DELETE CASCADE,
        column_name VARCHAR(255) NOT NULL,
        column_type column_type NOT NULL,
        column_order INTEGER NOT NULL,
        options JSONB,
        formula TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Working Paper Data table
    await client.query(`
      CREATE TABLE working_paper_data (
        id SERIAL PRIMARY KEY,
        working_paper_id INTEGER REFERENCES working_papers(id) ON DELETE CASCADE,
        audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
        audit_area VARCHAR(255),
        row_number INTEGER NOT NULL,
        column_values JSONB NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Risk Assessment table
    console.log('Creating risk_assessment table...');
    await client.query(`
      CREATE TABLE risk_assessment (
        id SERIAL PRIMARY KEY,
        audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
        audit_universe_id INTEGER REFERENCES audit_universe(id),
        likelihood INTEGER CHECK (likelihood >= 1 AND likelihood <= 5),
        impact INTEGER CHECK (impact >= 1 AND impact <= 5),
        risk_rating INTEGER GENERATED ALWAYS AS (likelihood * impact) STORED,
        score VARCHAR(10) GENERATED ALWAYS AS (
          CASE 
            WHEN likelihood * impact BETWEEN 1 AND 6 THEN 'Low'
            WHEN likelihood * impact BETWEEN 7 AND 14 THEN 'Medium'
            WHEN likelihood * impact BETWEEN 15 AND 25 THEN 'High'
          END
        ) STORED,
        is_selected BOOLEAN DEFAULT false,
        assigned_auditor_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audit Procedures table
    console.log('Creating audit_procedures table...');
    await client.query(`
      CREATE TABLE audit_procedures (
        id SERIAL PRIMARY KEY,
        audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
        risk_assessment_id INTEGER REFERENCES risk_assessment(id),
        conclusion TEXT,
        result VARCHAR(10) CHECK (result IN ('pass', 'fail')),
        cause TEXT,
        evidence_file VARCHAR(500),
        likelihood INTEGER CHECK (likelihood >= 1 AND likelihood <= 5),
        impact INTEGER CHECK (impact >= 1 AND impact <= 5),
        issue_rating INTEGER,
        score VARCHAR(10),
        include_in_report BOOLEAN DEFAULT false,
        working_paper_id INTEGER REFERENCES working_papers(id),
        assigned_auditor_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audit Issues table
    console.log('Creating audit_issues table...');
    await client.query(`
      CREATE TABLE audit_issues (
        id SERIAL PRIMARY KEY,
        audit_procedure_id INTEGER REFERENCES audit_procedures(id) ON DELETE CASCADE,
        audit_id INTEGER REFERENCES audits(id),
        issue_title VARCHAR(500) NOT NULL,
        criteria TEXT,
        condition TEXT,
        cause TEXT,
        consequence TEXT,
        corrective_action TEXT,
        corrective_date DATE,
        status issue_status DEFAULT 'draft',
        submitted_by INTEGER REFERENCES users(id),
        reviewed_by INTEGER REFERENCES users(id),
        removed_by INTEGER REFERENCES users(id),
        removal_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Management Comments table
    await client.query(`
      CREATE TABLE management_comments (
        id SERIAL PRIMARY KEY,
        audit_issue_id INTEGER REFERENCES audit_issues(id) ON DELETE CASCADE,
        comment TEXT NOT NULL,
        commented_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Issue Register table
    await client.query(`
      CREATE TABLE issue_register (
        id SERIAL PRIMARY KEY,
        audit_issue_id INTEGER REFERENCES audit_issues(id),
        include_in_report BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Follow-up Tracker table
    await client.query(`
      CREATE TABLE follow_up_tracker (
        id SERIAL PRIMARY KEY,
        audit_issue_id INTEGER REFERENCES audit_issues(id),
        follow_up_status VARCHAR(50),
        follow_up_date DATE,
        evidence_file VARCHAR(500),
        notes TEXT,
        updated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Document Library table
    await client.query(`
      CREATE TABLE document_library (
        id SERIAL PRIMARY KEY,
        audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
        document_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for better performance
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX idx_auditees_email ON auditees(official_email);
      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_audits_dates ON audits(start_date, end_date);
      CREATE INDEX idx_audit_team_audit ON audit_team(audit_id);
      CREATE INDEX idx_risk_assessment_audit ON risk_assessment(audit_id);
      CREATE INDEX idx_audit_procedures_audit ON audit_procedures(audit_id);
      CREATE INDEX idx_audit_issues_audit ON audit_issues(audit_id);
    `);

    // Insert default admin user
    console.log('Creating default admin user...');
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ('Admin User', 'admin@audit.com', $1, 'head_of_audit');
    `, [hashedPassword]);

    // Commit transaction
    await client.query('COMMIT');
    
    console.log('✓ Database initialized successfully!');
    console.log('✓ Default admin user created:');
    console.log('  Email: admin@audit.com');
    console.log('  Password: Admin@123');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('✗ Error initializing database:', error);
    throw error;
  } finally {
    client.release();
    pool.end();
  }
}

// Run the initialization
initDatabase()
  .then(() => {
    console.log('Database setup complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Database setup failed:', error);
    process.exit(1);
  });
