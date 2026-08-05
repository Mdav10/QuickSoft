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

// Session configuration
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
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: false,
    httpOnly: true,
    sameSite: 'lax'
  },
  name: 'quicksoft.sid'
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helper functions
app.locals.getCurrentTime = function() {
  return new Date().toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false 
  });
};

app.locals.getCurrentDate = function() {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

// Database initialization
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    
    // Drop and recreate daily_cash table with correct columns
    await client.query('DROP TABLE IF EXISTS daily_cash CASCADE');
    
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
      CREATE TABLE IF NOT EXISTS savings_plans (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        plan_name VARCHAR(50) NOT NULL,
        duration_months INTEGER NOT NULL,
        interest_rate DECIMAL(5,2) NOT NULL,
        total_deposits DECIMAL(15,2) DEFAULT 0,
        total_interest DECIMAL(15,2) DEFAULT 0,
        maturity_amount DECIMAL(15,2) DEFAULT 0,
        start_date DATE DEFAULT CURRENT_DATE,
        maturity_date DATE,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS savings_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        savings_plan_id UUID REFERENCES savings_plans(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        transaction_type VARCHAR(20) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        balance DECIMAL(15,2) NOT NULL,
        description TEXT,
        cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
        transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        transaction_type VARCHAR(20) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        balance DECIMAL(15,2) NOT NULL,
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
        loan_amount DECIMAL(15,2) NOT NULL,
        interest_rate DECIMAL(5,2) NOT NULL,
        interest_amount DECIMAL(15,2) NOT NULL,
        total_payable DECIMAL(15,2) NOT NULL,
        monthly_installment DECIMAL(15,2) NOT NULL,
        repayment_period INTEGER NOT NULL,
        due_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        paid_amount DECIMAL(15,2) DEFAULT 0,
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
        amount DECIMAL(15,2) NOT NULL,
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
        amount DECIMAL(15,2) NOT NULL,
        cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
        expense_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_cash (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
        opening_balance DECIMAL(15,2) DEFAULT 0,
        total_deposits DECIMAL(15,2) DEFAULT 0,
        total_withdrawals DECIMAL(15,2) DEFAULT 0,
        total_savings_deposits DECIMAL(15,2) DEFAULT 0,
        total_loan_repayments DECIMAL(15,2) DEFAULT 0,
        total_expenses DECIMAL(15,2) DEFAULT 0,
        closing_balance DECIMAL(15,2) DEFAULT 0,
        date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS savings_interest_rates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        duration_months INTEGER NOT NULL UNIQUE,
        interest_rate DECIMAL(5,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS loan_interest_rates (
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

    // Create default admin user
    const adminPassword = process.env.ADMIN_PASSWORD || 'TrackDriversSacco2026';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    const adminCheck = await client.query('SELECT * FROM users WHERE username = $1', ['manager']);
    if (adminCheck.rows.length === 0) {
      await client.query(
        'INSERT INTO users (username, password, full_name, role, status) VALUES ($1, $2, $3, $4, $5)',
        ['manager', hashedPassword, 'System Manager', 'manager', 'active']
      );
      console.log('✅ Default admin user created');
    }

    // Insert default savings interest rates
    const savingsRatesCheck = await client.query('SELECT * FROM savings_interest_rates');
    if (savingsRatesCheck.rows.length === 0) {
      const defaultRates = [
        [1, 3.0],
        [3, 5.0],
        [6, 8.0],
        [12, 10.0]
      ];
      for (const [months, rate] of defaultRates) {
        await client.query(
          'INSERT INTO savings_interest_rates (duration_months, interest_rate) VALUES ($1, $2)',
          [months, rate]
        );
      }
      console.log('✅ Default savings interest rates created');
    }

    const loanRatesCheck = await client.query('SELECT * FROM loan_interest_rates');
    if (loanRatesCheck.rows.length === 0) {
      const defaultRates = [
        [1, 2.0],
        [3, 3.0],
        [6, 6.0],
        [12, 10.0]
      ];
      for (const [months, rate] of defaultRates) {
        await client.query(
          'INSERT INTO loan_interest_rates (repayment_period, interest_rate) VALUES ($1, $2)',
          [months, rate]
        );
      }
      console.log('✅ Default loan interest rates created');
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
  if (req.session && req.session.userId) {
    return next();
  }
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

// ============= Helper function to get opening cash (shared) =============
async function getOpeningCash(client, date) {
  // Get the opening cash for today (shared across all users)
  const result = await client.query(
    'SELECT opening_balance FROM daily_cash WHERE date = $1 ORDER BY created_at DESC LIMIT 1',
    [date]
  );
  
  if (result.rows.length > 0) {
    return parseFloat(result.rows[0].opening_balance) || 0;
  }
  
  // If no opening cash for today, check yesterday's closing balance
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  const yesterdayResult = await client.query(
    'SELECT closing_balance FROM daily_cash WHERE date = $1 ORDER BY created_at DESC LIMIT 1',
    [yesterdayStr]
  );
  
  if (yesterdayResult.rows.length > 0) {
    return parseFloat(yesterdayResult.rows[0].closing_balance) || 0;
  }
  
  return 0;
}

// ============= Helper function to update daily cash =============
async function updateDailyCash(cashierId, transactionType, amount, client) {
  const today = new Date().toISOString().split('T')[0];
  
  // Get the shared opening balance for today
  const openingBalance = await getOpeningCash(client, today);
  
  // Get or create cash record for this cashier
  let cashResult = await client.query(
    'SELECT * FROM daily_cash WHERE date = $1 AND cashier_id = $2',
    [today, cashierId]
  );
  
  let cashRecord;
  if (cashResult.rows.length === 0) {
    const newCash = await client.query(
      'INSERT INTO daily_cash (cashier_id, date, opening_balance) VALUES ($1, $2, $3) RETURNING *',
      [cashierId, today, openingBalance]
    );
    cashRecord = newCash.rows[0];
  } else {
    cashRecord = cashResult.rows[0];
    // Update opening balance to shared value if different
    if (parseFloat(cashRecord.opening_balance) !== openingBalance) {
      await client.query(
        'UPDATE daily_cash SET opening_balance = $1 WHERE date = $2 AND cashier_id = $3',
        [openingBalance, today, cashierId]
      );
      cashRecord.opening_balance = openingBalance;
    }
  }
  
  let totalDeposits = parseFloat(cashRecord.total_deposits) || 0;
  let totalWithdrawals = parseFloat(cashRecord.total_withdrawals) || 0;
  let totalSavingsDeposits = parseFloat(cashRecord.total_savings_deposits) || 0;
  let totalLoanRepayments = parseFloat(cashRecord.total_loan_repayments) || 0;
  let totalExpenses = parseFloat(cashRecord.total_expenses) || 0;
  
  switch(transactionType) {
    case 'deposit':
      totalDeposits += parseFloat(amount);
      break;
    case 'withdrawal':
      totalWithdrawals += parseFloat(amount);
      break;
    case 'savings_deposit':
      totalSavingsDeposits += parseFloat(amount);
      break;
    case 'loan_repayment':
      totalLoanRepayments += parseFloat(amount);
      break;
    case 'expense':
      totalExpenses += parseFloat(amount);
      break;
  }
  
  const closingBalance = openingBalance + totalDeposits + totalSavingsDeposits + totalLoanRepayments - totalWithdrawals - totalExpenses;
  
  await client.query(
    `UPDATE daily_cash 
     SET total_deposits = $1, total_withdrawals = $2, total_savings_deposits = $3,
         total_loan_repayments = $4, total_expenses = $5, closing_balance = $6,
         updated_at = CURRENT_TIMESTAMP
     WHERE date = $7 AND cashier_id = $8`,
    [totalDeposits, totalWithdrawals, totalSavingsDeposits, totalLoanRepayments, 
     totalExpenses, closingBalance, today, cashierId]
  );
  
  return closingBalance;
}

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
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.render('login', { error: 'Invalid username or password' });
    }
    
    const user = result.rows[0];
    if (user.status !== 'active') {
      return res.render('login', { error: 'Account is deactivated. Please contact admin.' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.userRole = user.role;
    req.session.user = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('login', { error: 'Session error. Please try again.' });
      }
      
      pool.query(
        'INSERT INTO audit_logs (user_id, username, activity, ip_address) VALUES ($1, $2, $3, $4)',
        [user.id, user.username, 'User logged in', req.ip]
      ).catch(err => console.error('Audit log error:', err));

      res.redirect('/dashboard');
    });
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'An error occurred during login' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/login');
  });
});

// ============= DASHBOARD =============
app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const client = await pool.connect();
    const dashboardData = {};
    
    const today = new Date().toISOString().split('T')[0];
    
    // Get shared opening cash for today
    const openingCash = await getOpeningCash(client, today);
    
    // Get cashier's daily cash record
    const cashResult = await client.query(
      'SELECT * FROM daily_cash WHERE date = $1 AND cashier_id = $2',
      [today, req.session.userId]
    );
    
    if (cashResult.rows.length === 0) {
      await client.query(
        'INSERT INTO daily_cash (cashier_id, date, opening_balance) VALUES ($1, $2, $3)',
        [req.session.userId, today, openingCash]
      );
    }
    
    // Get statistics
    const results = await Promise.all([
      client.query('SELECT COUNT(*) FROM customers WHERE status = $1', ['active']),
      client.query('SELECT COUNT(*) FROM loans WHERE status = $1', ['active']),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM daily_transactions WHERE transaction_type = $1 AND DATE(transaction_date) = CURRENT_DATE', ['deposit']),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM daily_transactions WHERE transaction_type = $1 AND DATE(transaction_date) = CURRENT_DATE', ['withdrawal']),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM savings_transactions WHERE DATE(transaction_date) = CURRENT_DATE'),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE DATE(expense_date) = CURRENT_DATE'),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM loan_repayments WHERE DATE(payment_date) = CURRENT_DATE'),
      client.query('SELECT COUNT(*) FROM users WHERE role = $1 AND status = $2', ['cashier', 'active'])
    ]);

    dashboardData.activeCustomers = results[0].rows[0].count;
    dashboardData.activeLoans = results[1].rows[0].count;
    dashboardData.todayDeposits = results[2].rows[0].coalesce;
    dashboardData.todayWithdrawals = results[3].rows[0].coalesce;
    dashboardData.todaySavings = results[4].rows[0].coalesce;
    dashboardData.todayExpenses = results[5].rows[0].coalesce;
    dashboardData.todayRepayments = results[6].rows[0].coalesce;
    dashboardData.activeCashiers = results[7].rows[0].count;
    dashboardData.openingCash = openingCash;

    const closingCash = openingCash + dashboardData.todayDeposits + dashboardData.todaySavings + dashboardData.todayRepayments - dashboardData.todayWithdrawals - dashboardData.todayExpenses;
    dashboardData.closingCash = closingCash;

    // Update daily cash for this cashier
    await client.query(
      `UPDATE daily_cash 
       SET total_deposits = $1, total_withdrawals = $2, total_savings_deposits = $3,
           total_expenses = $4, total_loan_repayments = $5, closing_balance = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE date = $7 AND cashier_id = $8`,
      [dashboardData.todayDeposits, dashboardData.todayWithdrawals, dashboardData.todaySavings,
       dashboardData.todayExpenses, dashboardData.todayRepayments, 
       closingCash, today, req.session.userId]
    );

    // Get members
    const members = await client.query(`
      SELECT 
        c.*,
        COALESCE(
          (SELECT balance FROM daily_transactions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1),
          0
        ) as balance
      FROM customers c 
      WHERE c.status = 'active'
      ORDER BY c.created_at DESC 
      LIMIT 10
    `);
    dashboardData.members = members.rows;

    const recentTransactions = await client.query(`
      SELECT 'daily' as source, d.*, c.full_name 
      FROM daily_transactions d
      JOIN customers c ON d.customer_id = c.id 
      ORDER BY d.created_at DESC 
      LIMIT 10
    `);
    dashboardData.recentTransactions = recentTransactions.rows;

    client.release();
    
    res.render('dashboard', { 
      user: req.session.user,
      dashboard: dashboardData,
      currentTime: new Date()
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', {
      message: 'Error loading dashboard',
      user: req.session.user
    });
  }
});

// ============= OPENING CASH =============
app.post('/cash/opening', isAuthenticated, async (req, res) => {
  const { opening_balance } = req.body;
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Update opening cash for ALL cashiers for today
    await client.query(
      'UPDATE daily_cash SET opening_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE date = $2',
      [parseFloat(opening_balance), today]
    );
    
    // Also insert for any cashier who doesn't have a record yet
    const cashiers = await client.query(
      'SELECT id FROM users WHERE role = $1 AND status = $2',
      ['cashier', 'active']
    );
    
    for (const cashier of cashiers.rows) {
      await client.query(
        `INSERT INTO daily_cash (cashier_id, date, opening_balance) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (id) DO NOTHING`,
        [cashier.id, today, parseFloat(opening_balance)]
      );
    }
    
    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Opening cash set', `Amount: ${opening_balance}`]
    );
    
    client.release();
    res.redirect('/dashboard');
  } catch (error) {
    client.release();
    console.error('Error setting opening cash:', error);
    res.status(500).render('error', {
      message: 'Error setting opening cash',
      user: req.session.user
    });
  }
});

// ============= DAILY TRANSACTIONS =============
app.get('/transactions/deposit', isAuthenticated, async (req, res) => {
  try {
    const customers = await pool.query('SELECT id, full_name, account_number FROM customers WHERE status = $1 ORDER BY full_name', ['active']);
    res.render('daily_deposit', {
      user: req.session.user,
      customers: customers.rows
    });
  } catch (error) {
    console.error('Error loading deposit form:', error);
    res.status(500).render('error', {
      message: 'Error loading deposit form',
      user: req.session.user
    });
  }
});

app.post('/transactions/deposit', isAuthenticated, async (req, res) => {
  const { customer_id, amount, description } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const balanceResult = await client.query(
      'SELECT COALESCE(SUM(CASE WHEN transaction_type = $1 THEN amount ELSE -amount END), 0) as balance FROM daily_transactions WHERE customer_id = $2',
      ['deposit', customer_id]
    );
    const currentBalance = parseFloat(balanceResult.rows[0].balance) || 0;
    const depositAmount = parseFloat(amount);
    const newBalance = currentBalance + depositAmount;
    
    await client.query(
      `INSERT INTO daily_transactions (customer_id, transaction_type, amount, balance, description, cashier_id) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [customer_id, 'deposit', depositAmount, newBalance, description || 'Cash deposit', req.session.userId]
    );
    
    await updateDailyCash(req.session.userId, 'deposit', depositAmount, client);
    
    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Deposit processed', `Amount: ${amount}, Customer: ${customer_id}`]
    );
    
    await client.query('COMMIT');
    res.redirect('/transactions');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing deposit:', error);
    res.status(500).render('error', {
      message: error.message || 'Error processing deposit',
      user: req.session.user
    });
  } finally {
    client.release();
  }
});

app.get('/transactions/withdraw', isAuthenticated, async (req, res) => {
  try {
    const customers = await pool.query('SELECT id, full_name, account_number FROM customers WHERE status = $1 ORDER BY full_name', ['active']);
    res.render('daily_withdraw', {
      user: req.session.user,
      customers: customers.rows
    });
  } catch (error) {
    console.error('Error loading withdrawal form:', error);
    res.status(500).render('error', {
      message: 'Error loading withdrawal form',
      user: req.session.user
    });
  }
});

app.post('/transactions/withdraw', isAuthenticated, async (req, res) => {
  const { customer_id, amount, description } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const balanceResult = await client.query(
      'SELECT COALESCE(SUM(CASE WHEN transaction_type = $1 THEN amount ELSE -amount END), 0) as balance FROM daily_transactions WHERE customer_id = $2',
      ['deposit', customer_id]
    );
    const currentBalance = parseFloat(balanceResult.rows[0].balance) || 0;
    const withdrawAmount = parseFloat(amount);
    
    if (withdrawAmount > currentBalance) {
      throw new Error('Insufficient balance');
    }
    
    const newBalance = currentBalance - withdrawAmount;
    
    await client.query(
      `INSERT INTO daily_transactions (customer_id, transaction_type, amount, balance, description, cashier_id) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [customer_id, 'withdrawal', withdrawAmount, newBalance, description || 'Cash withdrawal', req.session.userId]
    );
    
    await updateDailyCash(req.session.userId, 'withdrawal', withdrawAmount, client);
    
    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Withdrawal processed', `Amount: ${amount}, Customer: ${customer_id}`]
    );
    
    await client.query('COMMIT');
    res.redirect('/transactions');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing withdrawal:', error);
    res.status(500).render('error', {
      message: error.message || 'Error processing withdrawal',
      user: req.session.user
    });
  } finally {
    client.release();
  }
});

app.get('/transactions', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, c.full_name, c.account_number 
      FROM daily_transactions d
      JOIN customers c ON d.customer_id = c.id 
      ORDER BY d.created_at DESC 
      LIMIT 100
    `);
    res.render('daily_transactions', {
      user: req.session.user,
      transactions: result.rows
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).render('error', {
      message: 'Error loading transactions',
      user: req.session.user
    });
  }
});

// ============= SAVINGS PLANS =============
app.get('/savings/plans', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sp.*, c.full_name, c.account_number,
        COALESCE(
          (SELECT balance FROM savings_transactions WHERE savings_plan_id = sp.id ORDER BY created_at DESC LIMIT 1),
          0
        ) as current_balance
      FROM savings_plans sp
      JOIN customers c ON sp.customer_id = c.id
      ORDER BY sp.created_at DESC
      LIMIT 100
    `);
    res.render('savings_plans', {
      user: req.session.user,
      plans: result.rows
    });
  } catch (error) {
    console.error('Error fetching savings plans:', error);
    res.status(500).render('error', {
      message: 'Error loading savings plans',
      user: req.session.user
    });
  }
});

app.get('/savings/plans/new', isAuthenticated, async (req, res) => {
  try {
    const customers = await pool.query('SELECT id, full_name, account_number FROM customers WHERE status = $1 ORDER BY full_name', ['active']);
    const rates = await pool.query('SELECT duration_months, interest_rate FROM savings_interest_rates ORDER BY duration_months');
    res.render('savings_plan_form', {
      user: req.session.user,
      customers: customers.rows,
      rates: rates.rows,
      plan: null
    });
  } catch (error) {
    console.error('Error loading savings plan form:', error);
    res.status(500).render('error', {
      message: 'Error loading savings plan form',
      user: req.session.user
    });
  }
});

app.post('/savings/plans', isAuthenticated, async (req, res) => {
  const { customer_id, duration_months, amount } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const rateResult = await client.query(
      'SELECT interest_rate FROM savings_interest_rates WHERE duration_months = $1',
      [parseInt(duration_months)]
    );
    
    if (rateResult.rows.length === 0) {
      throw new Error('No interest rate configured for this duration');
    }
    
    const interestRate = parseFloat(rateResult.rows[0].interest_rate);
    const depositAmount = parseFloat(amount);
    const totalInterest = (depositAmount * interestRate) / 100;
    const maturityAmount = depositAmount + totalInterest;
    
    const planResult = await client.query(
      `INSERT INTO savings_plans 
       (customer_id, plan_name, duration_months, interest_rate, total_deposits, total_interest, maturity_amount, start_date, maturity_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [
        customer_id, 
        `${duration_months} Month Savings Plan`, 
        parseInt(duration_months), 
        interestRate, 
        depositAmount, 
        totalInterest, 
        maturityAmount,
        new Date(),
        new Date(new Date().setMonth(new Date().getMonth() + parseInt(duration_months)))
      ]
    );
    
    await client.query(
      `INSERT INTO savings_transactions (savings_plan_id, customer_id, transaction_type, amount, balance, description, cashier_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [planResult.rows[0].id, customer_id, 'deposit', depositAmount, depositAmount, 'Initial savings deposit', req.session.userId]
    );
    
    await updateDailyCash(req.session.userId, 'savings_deposit', depositAmount, client);
    
    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Savings plan created', 
       `Customer: ${customer_id}, Amount: ${depositAmount}, Duration: ${duration_months} months`]
    );
    
    await client.query('COMMIT');
    res.redirect('/savings/plans');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating savings plan:', error);
    res.status(500).render('error', {
      message: error.message || 'Error creating savings plan',
      user: req.session.user
    });
  } finally {
    client.release();
  }
});

app.get('/savings/deposit', isAuthenticated, async (req, res) => {
  try {
    const customers = await pool.query(
      'SELECT id, full_name, account_number FROM customers WHERE status = $1 ORDER BY full_name', 
      ['active']
    );
    const customerId = req.query.customer_id;
    res.render('savings_deposit', {
      user: req.session.user,
      customers: customers.rows,
      customer_id: customerId || null
    });
  } catch (error) {
    console.error('Error loading savings deposit form:', error);
    res.status(500).render('error', {
      message: 'Error loading deposit form',
      user: req.session.user
    });
  }
});

app.post('/savings/deposit', isAuthenticated, async (req, res) => {
  const { customer_id, amount, description, plan_id } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let savingsPlanId = plan_id;
    
    if (!savingsPlanId) {
      const rateResult = await client.query(
        'SELECT interest_rate FROM savings_interest_rates WHERE duration_months = $1',
        [1]
      );
      
      const interestRate = parseFloat(rateResult.rows[0].interest_rate) || 3.0;
      const depositAmount = parseFloat(amount);
      const totalInterest = (depositAmount * interestRate) / 100;
      const maturityAmount = depositAmount + totalInterest;
      
      const planResult = await client.query(
        `INSERT INTO savings_plans 
         (customer_id, plan_name, duration_months, interest_rate, total_deposits, total_interest, maturity_amount, start_date, maturity_date) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [
          customer_id, 
          'Savings Plan', 
          1, 
          interestRate, 
          depositAmount, 
          totalInterest, 
          maturityAmount,
          new Date(),
          new Date(new Date().setMonth(new Date().getMonth() + 1))
        ]
      );
      savingsPlanId = planResult.rows[0].id;
    } else {
      const planCheck = await client.query('SELECT * FROM savings_plans WHERE id = $1', [plan_id]);
      if (planCheck.rows.length === 0) {
        throw new Error('Savings plan not found');
      }
      
      const plan = planCheck.rows[0];
      const newTotal = parseFloat(plan.total_deposits) + parseFloat(amount);
      const newInterest = (newTotal * parseFloat(plan.interest_rate)) / 100;
      const newMaturity = newTotal + newInterest;
      
      await client.query(
        `UPDATE savings_plans 
         SET total_deposits = $1, total_interest = $2, maturity_amount = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [newTotal, newInterest, newMaturity, plan_id]
      );
    }
    
    const balanceResult = await client.query(
      'SELECT COALESCE(SUM(CASE WHEN transaction_type = $1 THEN amount ELSE -amount END), 0) as balance FROM savings_transactions WHERE savings_plan_id = $2',
      ['deposit', savingsPlanId]
    );
    const currentBalance = parseFloat(balanceResult.rows[0].balance) || 0;
    const depositAmount = parseFloat(amount);
    const newBalance = currentBalance + depositAmount;
    
    await client.query(
      `INSERT INTO savings_transactions (savings_plan_id, customer_id, transaction_type, amount, balance, description, cashier_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [savingsPlanId, customer_id, 'deposit', depositAmount, newBalance, description || 'Savings deposit', req.session.userId]
    );
    
    await updateDailyCash(req.session.userId, 'savings_deposit', depositAmount, client);
    
    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Savings deposit', 
       `Customer: ${customer_id}, Amount: ${amount}`]
    );
    
    await client.query('COMMIT');
    res.redirect('/savings/plans');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing savings deposit:', error);
    res.status(500).render('error', {
      message: error.message || 'Error processing deposit',
      user: req.session.user
    });
  } finally {
    client.release();
  }
});

// ============= CUSTOMERS =============
app.get('/customers', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, 
        COALESCE(
          (SELECT balance FROM daily_transactions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1),
          0
        ) as balance
      FROM customers c 
      ORDER BY c.created_at DESC
    `);
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

// ============= DELETE CUSTOMER =============
app.post('/customers/:id/delete', isAuthenticated, isManager, async (req, res) => {
  try {
    const checkResult = await pool.query(
      'SELECT COUNT(*) FROM daily_transactions WHERE customer_id = $1',
      [req.params.id]
    );
    
    if (parseInt(checkResult.rows[0].count) > 0) {
      await pool.query(
        'UPDATE customers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['inactive', req.params.id]
      );
      await pool.query(
        'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
        [req.session.userId, req.session.username, 'Customer deactivated', `Customer ID: ${req.params.id}`]
      );
    } else {
      await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
      await pool.query(
        'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
        [req.session.userId, req.session.username, 'Customer deleted', `Customer ID: ${req.params.id}`]
      );
    }
    
    res.redirect('/customers');
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).render('error', {
      message: 'Error deleting customer',
      user: req.session.user
    });
  }
});

// ============= DELETE CASHIER =============
app.post('/users/:id/delete', isAuthenticated, isManager, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (userResult.rows.length === 0) {
      return res.status(404).render('error', {
        message: 'User not found',
        user: req.session.user
      });
    }
    
    const user = userResult.rows[0];
    if (user.role === 'manager') {
      return res.status(403).render('error', {
        message: 'Cannot delete manager account',
        user: req.session.user
      });
    }
    
    await pool.query(
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['inactive', req.params.id]
    );
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Cashier deactivated', `User: ${user.username}`]
    );
    
    res.redirect('/users');
  } catch (error) {
    console.error('Error deleting cashier:', error);
    res.status(500).render('error', {
      message: 'Error deleting cashier',
      user: req.session.user
    });
  }
});

// ============= DELETE LOAN =============
app.post('/loans/:id/delete', isAuthenticated, isManager, async (req, res) => {
  try {
    const checkResult = await pool.query(
      'SELECT COUNT(*) FROM loan_repayments WHERE loan_id = $1',
      [req.params.id]
    );
    
    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).render('error', {
        message: 'Cannot delete loan with repayments. Mark as completed instead.',
        user: req.session.user
      });
    }
    
    await pool.query('DELETE FROM loans WHERE id = $1', [req.params.id]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Loan deleted', `Loan ID: ${req.params.id}`]
    );
    
    res.redirect('/loans');
  } catch (error) {
    console.error('Error deleting loan:', error);
    res.status(500).render('error', {
      message: 'Error deleting loan',
      user: req.session.user
    });
  }
});

// ============= DELETE EXPENSE (Fixed) =============
app.post('/expenses/:id/delete', isAuthenticated, isManager, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get expense details before deleting
    const expenseResult = await client.query(
      'SELECT * FROM expenses WHERE id = $1',
      [req.params.id]
    );
    
    if (expenseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).render('error', {
        message: 'Expense not found',
        user: req.session.user
      });
    }
    
    const expense = expenseResult.rows[0];
    const expenseAmount = parseFloat(expense.amount);
    const expenseDate = expense.expense_date || new Date();
    const expenseDateStr = new Date(expenseDate).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    
    // Only adjust cash if expense is from today
    if (expenseDateStr === today) {
      // Get current cash record for this cashier
      const cashResult = await client.query(
        'SELECT * FROM daily_cash WHERE date = $1 AND cashier_id = $2',
        [today, req.session.userId]
      );
      
      if (cashResult.rows.length > 0) {
        const cash = cashResult.rows[0];
        const currentExpenses = parseFloat(cash.total_expenses) || 0;
        const newExpenses = Math.max(0, currentExpenses - expenseAmount);
        
        // Recalculate closing balance
        const openingBalance = parseFloat(cash.opening_balance) || 0;
        const totalDeposits = parseFloat(cash.total_deposits) || 0;
        const totalWithdrawals = parseFloat(cash.total_withdrawals) || 0;
        const totalSavingsDeposits = parseFloat(cash.total_savings_deposits) || 0;
        const totalLoanRepayments = parseFloat(cash.total_loan_repayments) || 0;
        const newClosingBalance = openingBalance + totalDeposits + totalSavingsDeposits + totalLoanRepayments - totalWithdrawals - newExpenses;
        
        await client.query(
          `UPDATE daily_cash 
           SET total_expenses = $1, closing_balance = $2, updated_at = CURRENT_TIMESTAMP 
           WHERE date = $3 AND cashier_id = $4`,
          [newExpenses, newClosingBalance, today, req.session.userId]
        );
      }
    }
    
    // Delete the expense
    await client.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    
    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Expense deleted', 
       `Name: ${expense.expense_name}, Amount: ${expenseAmount}`]
    );
    
    await client.query('COMMIT');
    client.release();
    res.redirect('/expenses');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('Error deleting expense:', error);
    res.status(500).render('error', {
      message: 'Error deleting expense',
      user: req.session.user
    });
  }
});

// ============= DELETE SAVINGS PLAN =============
app.post('/savings/plans/:id/delete', isAuthenticated, isManager, async (req, res) => {
  try {
    const checkResult = await pool.query(
      'SELECT COUNT(*) FROM savings_transactions WHERE savings_plan_id = $1',
      [req.params.id]
    );
    
    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).render('error', {
        message: 'Cannot delete savings plan with transactions. Deactivate instead.',
        user: req.session.user
      });
    }
    
    await pool.query('DELETE FROM savings_plans WHERE id = $1', [req.params.id]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Savings plan deleted', `Plan ID: ${req.params.id}`]
    );
    
    res.redirect('/savings/plans');
  } catch (error) {
    console.error('Error deleting savings plan:', error);
    res.status(500).render('error', {
      message: 'Error deleting savings plan',
      user: req.session.user
    });
  }
});

// ============= CUSTOMER PROFILE =============
app.get('/customers/:id/profile', isAuthenticated, async (req, res) => {
  try {
    const client = await pool.connect();
    
    const memberResult = await client.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (memberResult.rows.length === 0) {
      client.release();
      return res.status(404).render('error', {
        message: 'Member not found',
        user: req.session.user
      });
    }
    
    const member = memberResult.rows[0];
    
    const dailyResult = await client.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'withdrawal' THEN amount ELSE 0 END), 0) as total_withdrawals,
        COALESCE(
          (SELECT balance FROM daily_transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1),
          0
        ) as current_balance
      FROM daily_transactions 
      WHERE customer_id = $1
    `, [req.params.id]);
    
    const recentDaily = await client.query(`
      SELECT * FROM daily_transactions 
      WHERE customer_id = $1 
      ORDER BY created_at DESC 
      LIMIT 5
    `, [req.params.id]);
    
    const savingsPlans = await client.query(`
      SELECT * FROM savings_plans 
      WHERE customer_id = $1 
      ORDER BY created_at DESC
    `, [req.params.id]);
    
    const loansResult = await client.query(`
      SELECT * FROM loans 
      WHERE customer_id = $1 
      ORDER BY created_at DESC
    `, [req.params.id]);
    
    client.release();
    
    const memberData = {
      ...member,
      totalDeposits: dailyResult.rows[0].total_deposits || 0,
      totalWithdrawals: dailyResult.rows[0].total_withdrawals || 0,
      currentBalance: dailyResult.rows[0].current_balance || 0,
      recentDaily: recentDaily.rows,
      savingsPlans: savingsPlans.rows,
      loans: loansResult.rows
    };
    
    res.render('member_profile', {
      user: req.session.user,
      member: memberData
    });
  } catch (error) {
    console.error('Error fetching member profile:', error);
    res.status(500).render('error', {
      message: 'Error loading member profile',
      user: req.session.user
    });
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
    const rates = await pool.query('SELECT repayment_period, interest_rate FROM loan_interest_rates ORDER BY repayment_period');
    const customerId = req.query.customer_id;
    res.render('loan_form', {
      user: req.session.user,
      customers: customers.rows,
      rates: rates.rows,
      loan: customerId ? { customer_id: customerId } : null
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
      'SELECT interest_rate FROM loan_interest_rates WHERE repayment_period = $1',
      [repayment_period]
    );
    
    if (rateResult.rows.length === 0) {
      throw new Error('No interest rate configured for this repayment period');
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
    const currentPaid = parseFloat(loan.paid_amount) || 0;
    const newPaid = currentPaid + repaymentAmount;
    
    await client.query(
      'INSERT INTO loan_repayments (loan_id, customer_id, amount, cashier_id) VALUES ($1, $2, $3, $4)',
      [req.params.id, loan.customer_id, repaymentAmount, req.session.userId]
    );
    
    await client.query(
      'UPDATE loans SET paid_amount = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPaid, req.params.id]
    );
    
    if (newPaid >= parseFloat(loan.total_payable)) {
      await client.query(
        'UPDATE loans SET status = $1, paid_amount = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['completed', loan.total_payable, req.params.id]
      );
    }
    
    await updateDailyCash(req.session.userId, 'loan_repayment', repaymentAmount, client);
    
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
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    await client.query(
      'INSERT INTO expenses (expense_name, description, amount, cashier_id) VALUES ($1, $2, $3, $4)',
      [expense_name, description, parseFloat(amount), req.session.userId]
    );
    
    await updateDailyCash(req.session.userId, 'expense', parseFloat(amount), client);

    await client.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Expense recorded', `Name: ${expense_name}, Amount: ${amount}`]
    );

    await client.query('COMMIT');
    res.redirect('/expenses');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error recording expense:', error);
    res.status(500).render('error', {
      message: 'Error recording expense',
      user: req.session.user
    });
  } finally {
    client.release();
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
      savings: [],
      loans: [],
      repayments: [],
      expenses: []
    };
    
    const deposits = await client.query(`
      SELECT d.*, c.full_name 
      FROM daily_transactions d
      JOIN customers c ON d.customer_id = c.id 
      WHERE d.transaction_type = 'deposit' AND DATE(d.created_at) = $1
    `, [date]);
    reportData.deposits = deposits.rows;
    
    const withdrawals = await client.query(`
      SELECT d.*, c.full_name 
      FROM daily_transactions d
      JOIN customers c ON d.customer_id = c.id 
      WHERE d.transaction_type = 'withdrawal' AND DATE(d.created_at) = $1
    `, [date]);
    reportData.withdrawals = withdrawals.rows;
    
    const savings = await client.query(`
      SELECT s.*, c.full_name 
      FROM savings_transactions s
      JOIN customers c ON s.customer_id = c.id 
      WHERE DATE(s.created_at) = $1
    `, [date]);
    reportData.savings = savings.rows;
    
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
      report: reportData,
      currentTime: new Date()
    });
  } catch (error) {
    console.error('Error generating daily report:', error);
    res.status(500).render('error', {
      message: 'Error generating daily report',
      user: req.session.user
    });
  }
});

// ============= USERS MANAGEMENT =============
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

// ============= SETTINGS =============
app.get('/settings/rates', isAuthenticated, isManager, async (req, res) => {
  try {
    const savingsRates = await pool.query('SELECT * FROM savings_interest_rates ORDER BY duration_months');
    const loanRates = await pool.query('SELECT * FROM loan_interest_rates ORDER BY repayment_period');
    res.render('settings_rates', {
      user: req.session.user,
      savingsRates: savingsRates.rows,
      loanRates: loanRates.rows
    });
  } catch (error) {
    console.error('Error fetching rates:', error);
    res.status(500).render('error', {
      message: 'Error loading rates',
      user: req.session.user
    });
  }
});

app.post('/settings/savings-rate', isAuthenticated, isManager, async (req, res) => {
  const { duration_months, interest_rate } = req.body;
  try {
    await pool.query(
      'INSERT INTO savings_interest_rates (duration_months, interest_rate) VALUES ($1, $2) ON CONFLICT (duration_months) DO UPDATE SET interest_rate = $2, updated_at = CURRENT_TIMESTAMP',
      [parseInt(duration_months), parseFloat(interest_rate)]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Savings interest rate updated', 
       `Duration: ${duration_months} months, Rate: ${interest_rate}%`]
    );

    res.redirect('/settings/rates');
  } catch (error) {
    console.error('Error updating savings rate:', error);
    res.status(500).render('error', {
      message: 'Error updating savings rate',
      user: req.session.user
    });
  }
});

app.post('/settings/loan-rate', isAuthenticated, isManager, async (req, res) => {
  const { repayment_period, interest_rate } = req.body;
  try {
    await pool.query(
      'INSERT INTO loan_interest_rates (repayment_period, interest_rate) VALUES ($1, $2) ON CONFLICT (repayment_period) DO UPDATE SET interest_rate = $2, updated_at = CURRENT_TIMESTAMP',
      [parseInt(repayment_period), parseFloat(interest_rate)]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, username, activity, details) VALUES ($1, $2, $3, $4)',
      [req.session.userId, req.session.username, 'Loan interest rate updated', 
       `Period: ${repayment_period} months, Rate: ${interest_rate}%`]
    );

    res.redirect('/settings/rates');
  } catch (error) {
    console.error('Error updating loan rate:', error);
    res.status(500).render('error', {
      message: 'Error updating loan rate',
      user: req.session.user
    });
  }
});

// ============= AUDIT LOGS =============
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
