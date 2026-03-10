import { pool } from './server/db.ts';

async function setup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thrive_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      monthly_income NUMERIC,
      onboarding_complete BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS thrive_plaid_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES thrive_users(id),
      access_token TEXT NOT NULL,
      item_id TEXT NOT NULL,
      institution_name TEXT
    );

    CREATE TABLE IF NOT EXISTS thrive_accounts (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES thrive_users(id),
      name TEXT NOT NULL,
      institution TEXT,
      type TEXT,
      balance NUMERIC DEFAULT 0,
      color TEXT DEFAULT '#00D4A0',
      plaid_account_id TEXT,
      last_updated TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS thrive_transactions (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES thrive_users(id),
      account_id TEXT,
      date TEXT,
      description TEXT,
      amount NUMERIC,
      category TEXT DEFAULT 'Other',
      merchant TEXT,
      plaid_transaction_id TEXT
    );

    CREATE TABLE IF NOT EXISTS thrive_user_budgets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES thrive_users(id),
      category TEXT NOT NULL,
      limit_amount NUMERIC,
      UNIQUE(user_id, category)
    );
  `);
  console.log('All tables created!');
  await pool.end();
}

setup().catch(console.error);
