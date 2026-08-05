const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Database connected successfully');
    release();
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration - FIXED
const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'your_super_secret_session_key_change_this_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: false,
    httpOnly: true,
    sameSite: 'lax'
  },
  name: 'quicksoft.sid'
}));

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database initialization
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        role VARCHAR(20) DEFAULT 'cashier',
        status VARCHAR(20) DEFAULT 'active',
        profile_photo TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        account_number VARCHAR(20) UNIQUE NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        gender VARCHAR(10),
        date_of_birth DATE,
        national_id VARCHAR(20) UNIQUE,
        phone VARCHAR(20),
        address TEXT,
        occupation VARCHAR(50),
        status VARCHAR(20) DEFAULT 'active',
        profile_photo TEXT,
        registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS savings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        transaction_type VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        balance DECIMAL(10,2) NOT NULL,
        description TEXT,
        cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
        transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS loans (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        loan_amount DECIMAL(10,2) NOT NULL,
        interest_rate DECIMAL(5,2) NOT NULL,
        interest_amount DECIMAL(10,2) NOT NULL,
        total_payable DECIMAL(10,2) NOT NULL,
        monthly_installment DECIMAL(10,2) NOT NULL,
        repayment_period INTEGER NOT NULL,
        due_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
        loan_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS loan_repayments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        loan_id UUID REFERENCES loans(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        expense_name VARCHAR(100) NOT NULL,
        description TEXT,
        amount DECIMAL(10,2) NOT NULL,
        cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
        expense_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS interest_rates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        repayment_period INTEGER NOT NULL UNIQUE,
        interest_rate DECIMAL(5,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        activity VARCHAR(255) NOT NULL,
        details TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        setting_key VARCHAR(50) UNIQUE NOT NULL,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create or update admin user
    const adminPassword = process.env.ADMIN_PASSWORD || 'TrackDriversSacco2026';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    const adminCheck = await client.query('SELECT * FROM users WHERE username = $1', ['manager']);
    if (adminCheck.rows.length === 0) {
      await client.query(
        'INSERT INTO users (username, password, full_name, role, status) VALUES ($1, $2, $3, $4, $5)',
        ['manager', hashedPassword, 'System Manager', 'manager', 'active']
      );
      console.log('✅ Default admin user created');
    } else {
      await client.query(
        'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE username = $2',
        [hashedPassword, 'manager']
      );
      console.log('✅ Admin password updated');
    }

    const interestCheck = await client.query('SELECT * FROM interest_rates');
    if (interestCheck.rows.length === 0) {
      const defaultRates = [
        [1, 2.0],
        [3, 3.0],
        [6, 6.0],
        [12, 10.0]
      ];
      for (const [period, rate] of defaultRates) {
        await client.query(
          'INSERT INTO interest_rates (repayment_period, interest_rate) VALUES ($1, $2)',
          [period, rate]
        );
      }
      console.log('✅ Default interest rates created');
    }

    console.log('✅ Database initialization complete');
  } catch (error) {
    console.error('Database initialization error:', error);
  } finally {
    client.release();
  }
}

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  console.log('Session check - ID:', req.sessionID);
  console.log('Session data:', req.session);
  
  if (req.session && req.session.userId) {
    return next();
  }
  console.log('Not authenticated, redirecting to login');
  res.redirect('/login');
};

const isManager = (req, res, next) => {
  if (req.session && req.session.userRole === 'manager') {
    return next();
  }
  res.status(403).render('error', { 
    message: 'Access denied. Manager privileges required.',
    user: req.session.user
  });
};

// ============= ROUTES =============

// Home / Login
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt for user:', username);
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      console.log('User not found:', username);
      return res.render('login', { error: 'Invalid username or password' });
    }
    
    const user = result.rows[0];
    console.log('User found:', user.username, 'Role:', user.role);
    
    if (user.status !== 'active') {
      console.log('User account inactive:', username);
      return res.render('login', { error: 'Account is deactivated. Please contact admin.' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Password valid:', validPassword);
    
    if (!validPassword) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    // Set session data
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.userRole = user.role;
    req.session.user = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };

    // Save session
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('login', { error: 'Session error. Please try again.' });
      }
      
      console.log('Login successful for:', username);
      console.log('Session saved:', req.session);
      
      // Log the login
      pool.query(
        'INSERT INTO audit_logs (user_id, username, activity, ip_address) VALUES ($1, $2, $3, $4)',
        [user.id, user.username, 'User logged in', req.ip]
      ).catch(err => console.error('Audit log error:', err));

      // Check if it's an AJAX request
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.json({ success: true, redirect: '/dashboard' });
      }
      
      res.redirect('/dashboard');
    });
  } catch (error) {
    console.error('Login error:', error);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ success: false, error: 'An error occurred during login' });
    }
    res.render('login', { error: 'An error occurred during login' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login');
  });
});

// ============= DASHBOARD =============
app.get('/dashboard', isAuthenticated, async (req, res) => {
  console.log('Dashboard accessed by:', req.session.username);
  try {
    const client = await pool.connect();
    const dashboardData = {};
    
    const results = await Promise.all([
      client.query('SELECT COUNT(*) FROM customers WHERE status = $1', ['active']),
      client.query('SELECT COUNT(*) FROM loans WHERE status = $1', ['active']),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM savings WHERE transaction_type = $1 AND DATE(transaction_date) = CURRENT_DATE', ['deposit']),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM savings WHERE transaction_type = $1 AND DATE(transaction_date) = CURRENT_DATE', ['withdrawal']),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE DATE(expense_date) = CURRENT_DATE'),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM loan_repayments WHERE DATE(payment_date) = CURRENT_DATE'),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM savings WHERE transaction_type = $1', ['deposit']),
      client.query('SELECT COUNT(*) FROM users WHERE role = $1 AND status = $2', ['cashier', 'active'])
    ]);

    dashboardData.activeCustomers = results[0].rows[0].count;
    dashboardData.activeLoans = results[1].rows[0].count;
    dashboardData.todayDeposits = results[2].rows[0].coalesce;
    dashboardData.todayWithdrawals = results[3].rows[0].coalesce;
    dashboardData.todayExpenses = results[4].rows[0].coalesce;
    dashboardData.todayRepayments = results[5].rows[0].coalesce;
    dashboardData.totalSavings = results[6].rows[0].coalesce;
    dashboardData.activeCashiers = results[7].rows[0].count;

    const closingBalance = dashboardData.totalSavings - dashboardData.todayWithdrawals - dashboardData.todayExpenses;
    dashboardData.closingBalance = closingBalance;

    const recentTransactions = await client.query(`
      SELECT s.*, c.full_name 
      FROM savings s 
      JOIN customers c ON s.customer_id = c.id 
      ORDER BY s.created_at DESC 
      LIMIT 10
    `);
    dashboardData.recentTransactions = recentTransactions.rows;

    client.release();
    
    res.render('dashboard', { 
      user: req.session.user,
      dashboard: dashboardData
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', {
      message: 'Error loading dashboard',
      user: req.session.user
    });
  }
});

// ============= CUSTOMERS =============
app.get('/customers', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    res.render('customers', {
      user: req.session.user,
      customers: result.rows
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).render('error', {
      message: 'Error loading customers',
      user: req.session.user
    });
  }
});

app.get('/customers/new', isAuthenticated, (req, res) => {
  res.render('customer_form', {
    user: req.session.user,
    customer: null,
    action: 'create'
  });
});

app.post('/customers', isAuthenticated, async (req, res) => {
  const { full_name, gender, date_of_birth, national_id, phone, address, occupation } = req.body;
  try {
    const timestamp = Date.now().toString().slice(-6);
    const accountNumber = `AC${timestamp}${Math.floor(Math.random() * 100)}`;
    
    await pool.query(
      `INSERT INTO customers 
       (account_number, full_name, gender, date_of_birth, national_id, phone, address, occupation) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [accountNumber, full_name, gender, date_of_birth, national_id, phone, address, occupation]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Customer created', `Customer: ${full_name}`]
    );

    res.redirect('/customers');
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).render('error', {
      message: 'Error creating customer. Please check if National ID is unique.',
      user: req.session.user
    });
  }
});

app.get('/customers/:id/edit', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).render('error', {
        message: 'Customer not found',
        user: req.session.user
      });
    }
    res.render('customer_form', {
      user: req.session.user,
      customer: result.rows[0],
      action: 'edit'
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).render('error', {
      message: 'Error loading customer',
      user: req.session.user
    });
  }
});

app.post('/customers/:id/edit', isAuthenticated, async (req, res) => {
  const { full_name, gender, date_of_birth, national_id, phone, address, occupation, status } = req.body;
  try {
    await pool.query(
      `UPDATE customers 
       SET full_name = $1, gender = $2, date_of_birth = $3, national_id = $4, 
           phone = $5, address = $6, occupation = $7, status = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [full_name, gender, date_of_birth, national_id, phone, address, occupation, status, req.params.id]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Customer updated', `Customer ID: ${req.params.id}`]
    );

    res.redirect('/customers');
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).render('error', {
      message: 'Error updating customer',
      user: req.session.user
    });
  }
});

// ============= SAVINGS =============
app.get('/savings', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.full_name, c.account_number 
      FROM savings s 
      JOIN customers c ON s.customer_id = c.id 
      ORDER BY s.created_at DESC 
      LIMIT 100
    `);
    res.render('savings', {
      user: req.session.user,
      transactions: result.rows
    });
  } catch (error) {
    console.error('Error fetching savings:', error);
    res.status(500).render('error', {
      message: 'Error loading savings records',
      user: req.session.user
    });
  }
});

app.get('/savings/deposit', isAuthenticated, async (req, res) => {
  try {
    const customers = await pool.query('SELECT id, full_name, account_number FROM customers WHERE status = $1 ORDER BY full_name', ['active']);
    res.render('savings_form', {
      user: req.session.user,
      customers: customers.rows,
      type: 'deposit',
      transaction: null
    });
  } catch (error) {
    console.error('Error loading deposit form:', error);
    res.status(500).render('error', {
      message: 'Error loading deposit form',
      user: req.session.user
    });
  }
});

app.get('/savings/withdraw', isAuthenticated, async (req, res) => {
  try {
    const customers = await pool.query('SELECT id, full_name, account_number FROM customers WHERE status = $1 ORDER BY full_name', ['active']);
    res.render('savings_form', {
      user: req.session.user,
      customers: customers.rows,
      type: 'withdrawal',
      transaction: null
    });
  } catch (error) {
    console.error('Error loading withdrawal form:', error);
    res.status(500).render('error', {
      message: 'Error loading withdrawal form',
      user: req.session.user
    });
  }
});

app.post('/savings', isAuthenticated, async (req, res) => {
  const { customer_id, amount, description, type } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const balanceResult = await client.query(
      'SELECT COALESCE(SUM(CASE WHEN transaction_type = $1 THEN amount ELSE -amount END), 0) as balance FROM savings WHERE customer_id = $2',
      ['deposit', customer_id]
    );
    const currentBalance = parseFloat(balanceResult.rows[0].balance) || 0;
    const transactionAmount = parseFloat(amount);
    
    let newBalance;
    if (type === 'deposit') {
      newBalance = currentBalance + transactionAmount;
    } else {
      if (transactionAmount > currentBalance) {
        throw new Error('Insufficient balance');
      }
      newBalance = currentBalance - transactionAmount;
    }

    await client.query(
      `INSERT INTO savings (customer_id, transaction_type, amount, balance, description, cashier_id) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [customer_id, type, transactionAmount, newBalance, description, req.session.userId]
    );

    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, `${type} processed`, `Amount: ${amount}, Customer: ${customer_id}`]
    );

    await client.query('COMMIT');
    res.redirect('/savings');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing transaction:', error);
    res.status(500).render('error', {
      message: error.message || 'Error processing transaction',
      user: req.session.user
    });
  } finally {
    client.release();
  }
});

// ============= LOANS =============
app.get('/loans', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, c.full_name, c.account_number 
      FROM loans l 
      JOIN customers c ON l.customer_id = c.id 
      ORDER BY l.created_at DESC 
      LIMIT 100
    `);
    res.render('loans', {
      user: req.session.user,
      loans: result.rows
    });
  } catch (error) {
    console.error('Error fetching loans:', error);
    res.status(500).render('error', {
      message: 'Error loading loans',
      user: req.session.user
    });
  }
});

app.get('/loans/new', isAuthenticated, async (req, res) => {
  try {
    const customers = await pool.query('SELECT id, full_name, account_number FROM customers WHERE status = $1 ORDER BY full_name', ['active']);
    const rates = await pool.query('SELECT repayment_period, interest_rate FROM interest_rates ORDER BY repayment_period');
    res.render('loan_form', {
      user: req.session.user,
      customers: customers.rows,
      rates: rates.rows,
      loan: null
    });
  } catch (error) {
    console.error('Error loading loan form:', error);
    res.status(500).render('error', {
      message: 'Error loading loan form',
      user: req.session.user
    });
  }
});

app.post('/loans', isAuthenticated, async (req, res) => {
  const { customer_id, loan_amount, repayment_period } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const rateResult = await client.query(
      'SELECT interest_rate FROM interest_rates WHERE repayment_period = $1',
      [repayment_period]
    );
    
    if (rateResult.rows.length === 0) {
      throw new Error('No interest rate configured for this repayment period. Please contact the Manager.');
    }
    
    const interestRate = parseFloat(rateResult.rows[0].interest_rate);
    const amount = parseFloat(loan_amount);
    const interest = (amount * interestRate) / 100;
    const totalPayable = amount + interest;
    const monthlyInstallment = totalPayable / parseInt(repayment_period);
    
    const dueDate = new Date();
    dueDate.setMonth(dueDate.getMonth() + parseInt(repayment_period));
    
    await client.query(
      `INSERT INTO loans 
       (customer_id, loan_amount, interest_rate, interest_amount, total_payable, 
        monthly_installment, repayment_period, due_date, cashier_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [customer_id, amount, interestRate, interest, totalPayable, 
       monthlyInstallment, repayment_period, dueDate, req.session.userId]
    );

    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Loan issued', 
       `Amount: ${amount}, Customer: ${customer_id}, Period: ${repayment_period} months`]
    );

    await client.query('COMMIT');
    res.redirect('/loans');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating loan:', error);
    res.status(500).render('error', {
      message: error.message || 'Error creating loan',
      user: req.session.user
    });
  } finally {
    client.release();
  }
});

app.post('/loans/repay/:id', isAuthenticated, async (req, res) => {
  const { amount } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const loanResult = await client.query('SELECT * FROM loans WHERE id = $1', [req.params.id]);
    if (loanResult.rows.length === 0) {
      throw new Error('Loan not found');
    }
    
    const loan = loanResult.rows[0];
    const repaymentAmount = parseFloat(amount);
    
    await client.query(
      'INSERT INTO loan_repayments (loan_id, customer_id, amount, cashier_id) VALUES ($1, $2, $3, $4)',
      [req.params.id, loan.customer_id, repaymentAmount, req.session.userId]
    );
    
    const totalRepaid = await client.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM loan_repayments WHERE loan_id = $1',
      [req.params.id]
    );
    
    if (parseFloat(totalRepaid.rows[0].total) >= parseFloat(loan.total_payable)) {
      await client.query(
        'UPDATE loans SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['completed', req.params.id]
      );
    }
    
    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Loan repayment', 
       `Amount: ${repaymentAmount}, Loan: ${req.params.id}`]
    );
    
    await client.query('COMMIT');
    res.redirect('/loans');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing repayment:', error);
    res.status(500).render('error', {
      message: error.message || 'Error processing repayment',
      user: req.session.user
    });
  } finally {
    client.release();
  }
});

// ============= EXPENSES =============
app.get('/expenses', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, u.full_name as cashier_name 
      FROM expenses e 
      LEFT JOIN users u ON e.cashier_id = u.id 
      ORDER BY e.created_at DESC 
      LIMIT 100
    `);
    res.render('expenses', {
      user: req.session.user,
      expenses: result.rows
    });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).render('error', {
      message: 'Error loading expenses',
      user: req.session.user
    });
  }
});

app.get('/expenses/new', isAuthenticated, (req, res) => {
  res.render('expense_form', {
    user: req.session.user,
    expense: null
  });
});

app.post('/expenses', isAuthenticated, async (req, res) => {
  const { expense_name, description, amount } = req.body;
  try {
    await pool.query(
      'INSERT INTO expenses (expense_name, description, amount, cashier_id) VALUES ($1, $2, $3, $4)',
      [expense_name, description, parseFloat(amount), req.session.userId]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Expense recorded', `Name: ${expense_name}, Amount: ${amount}`]
    );

    res.redirect('/expenses');
  } catch (error) {
    console.error('Error recording expense:', error);
    res.status(500).render('error', {
      message: 'Error recording expense',
      user: req.session.user
    });
  }
});

// ============= REPORTS =============
app.get('/reports', isAuthenticated, (req, res) => {
  res.render('reports', {
    user: req.session.user
  });
});

app.get('/reports/daily', isAuthenticated, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const client = await pool.connect();
    
    const reportData = {
      date: date,
      deposits: [],
      withdrawals: [],
      loans: [],
      repayments: [],
      expenses: []
    };
    
    const deposits = await client.query(`
      SELECT s.*, c.full_name 
      FROM savings s 
      JOIN customers c ON s.customer_id = c.id 
      WHERE s.transaction_type = 'deposit' AND DATE(s.created_at) = $1
    `, [date]);
    reportData.deposits = deposits.rows;
    
    const withdrawals = await client.query(`
      SELECT s.*, c.full_name 
      FROM savings s 
      JOIN customers c ON s.customer_id = c.id 
      WHERE s.transaction_type = 'withdrawal' AND DATE(s.created_at) = $1
    `, [date]);
    reportData.withdrawals = withdrawals.rows;
    
    const loans = await client.query(`
      SELECT l.*, c.full_name 
      FROM loans l 
      JOIN customers c ON l.customer_id = c.id 
      WHERE DATE(l.created_at) = $1
    `, [date]);
    reportData.loans = loans.rows;
    
    const repayments = await client.query(`
      SELECT lr.*, c.full_name 
      FROM loan_repayments lr 
      JOIN customers c ON lr.customer_id = c.id 
      WHERE DATE(lr.created_at) = $1
    `, [date]);
    reportData.repayments = repayments.rows;
    
    const expenses = await client.query(`
      SELECT e.*, u.full_name as cashier_name 
      FROM expenses e 
      LEFT JOIN users u ON e.cashier_id = u.id 
      WHERE DATE(e.created_at) = $1
    `, [date]);
    reportData.expenses = expenses.rows;
    
    client.release();
    
    res.render('daily_report', {
      user: req.session.user,
      report: reportData
    });
  } catch (error) {
    console.error('Error generating daily report:', error);
    res.status(500).render('error', {
      message: 'Error generating daily report',
      user: req.session.user
    });
  }
});

// ============= USERS MANAGEMENT (Manager Only) =============
app.get('/users', isAuthenticated, isManager, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE role = $1 ORDER BY created_at DESC', ['cashier']);
    res.render('users', {
      user: req.session.user,
      users: result.rows
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).render('error', {
      message: 'Error loading users',
      user: req.session.user
    });
  }
});

app.get('/users/new', isAuthenticated, isManager, (req, res) => {
  res.render('user_form', {
    user: req.session.user,
    user_data: null,
    action: 'create'
  });
});

app.post('/users', isAuthenticated, isManager, async (req, res) => {
  const { username, password, full_name, phone } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password, full_name, phone, role) VALUES ($1, $2, $3, $4, $5)',
      [username, hashedPassword, full_name, phone, 'cashier']
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Cashier created', `Username: ${username}`]
    );

    res.redirect('/users');
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).render('error', {
      message: 'Error creating user. Username may already exist.',
      user: req.session.user
    });
  }
});

app.post('/users/:id/toggle', isAuthenticated, isManager, async (req, res) => {
  try {
    const user = await pool.query('SELECT status FROM users WHERE id = $1', [req.params.id]);
    const newStatus = user.rows[0].status === 'active' ? 'inactive' : 'active';
    
    await pool.query(
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newStatus, req.params.id]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'User status changed', `User: ${req.params.id}, Status: ${newStatus}`]
    );

    res.redirect('/users');
  } catch (error) {
    console.error('Error toggling user status:', error);
    res.status(500).render('error', {
      message: 'Error updating user status',
      user: req.session.user
    });
  }
});

// ============= INTEREST RATES (Manager Only) =============
app.get('/settings/rates', isAuthenticated, isManager, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM interest_rates ORDER BY repayment_period');
    res.render('interest_rates', {
      user: req.session.user,
      rates: result.rows
    });
  } catch (error) {
    console.error('Error fetching interest rates:', error);
    res.status(500).render('error', {
      message: 'Error loading interest rates',
      user: req.session.user
    });
  }
});

app.post('/settings/rates', isAuthenticated, isManager, async (req, res) => {
  const { repayment_period, interest_rate } = req.body;
  try {
    await pool.query(
      'INSERT INTO interest_rates (repayment_period, interest_rate) VALUES ($1, $2) ON CONFLICT (repayment_period) DO UPDATE SET interest_rate = $2, updated_at = CURRENT_TIMESTAMP',
      [parseInt(repayment_period), parseFloat(interest_rate)]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Interest rate updated', `Period: ${repayment_period}, Rate: ${interest_rate}%`]
    );

    res.redirect('/settings/rates');
  } catch (error) {
    console.error('Error updating interest rate:', error);
    res.status(500).render('error', {
      message: 'Error updating interest rate',
      user: req.session.user
    });
  }
});

// ============= AUDIT LOGS (Manager Only) =============
app.get('/audit', isAuthenticated, isManager, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.full_name 
      FROM audit_logs a 
      LEFT JOIN users u ON a.user_id = u.id 
      ORDER BY a.created_at DESC 
      LIMIT 100
    `);
    res.render('audit', {
      user: req.session.user,
      logs: result.rows
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).render('error', {
      message: 'Error loading audit logs',
      user: req.session.user
    });
  }
});

// ============= 404 & ERROR HANDLERS =============
app.use((req, res) => {
  res.status(404).render('error', {
    message: 'Page not found',
    user: req.session.user
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).render('error', {
    message: 'An unexpected error occurred',
    user: req.session.user
  });
});

// ============= START SERVER =============
async function startServer() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`👤 Admin login: manager / ${process.env.ADMIN_PASSWORD || 'TrackDriversSacco2026'}`);
  });
}

startServer().catch(console.error);
