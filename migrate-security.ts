import { pool } from './server/db.ts';

async function migrate() {
  console.log('Running security migrations...');

  // Create plaid sessions table for single-use session tokens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thrive_plaid_sessions (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES thrive_users(id) ON DELETE CASCADE,
      link_token TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_plaid_sessions_token ON thrive_plaid_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_plaid_sessions_expires ON thrive_plaid_sessions(expires_at);
  `);
  console.log('✓ thrive_plaid_sessions table created');

  // Add ON DELETE CASCADE to all foreign keys for account deletion compliance
  await pool.query(`
    DO $$
    BEGIN
      -- Add cascade deletes for PIPEDA compliance (right to deletion)
      ALTER TABLE thrive_accounts DROP CONSTRAINT IF EXISTS thrive_accounts_user_id_fkey;
      ALTER TABLE thrive_accounts ADD CONSTRAINT thrive_accounts_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES thrive_users(id) ON DELETE CASCADE;

      ALTER TABLE thrive_transactions DROP CONSTRAINT IF EXISTS thrive_transactions_user_id_fkey;
      ALTER TABLE thrive_transactions ADD CONSTRAINT thrive_transactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES thrive_users(id) ON DELETE CASCADE;

      ALTER TABLE thrive_user_budgets DROP CONSTRAINT IF EXISTS thrive_user_budgets_user_id_fkey;
      ALTER TABLE thrive_user_budgets ADD CONSTRAINT thrive_user_budgets_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES thrive_users(id) ON DELETE CASCADE;

      ALTER TABLE thrive_plaid_items DROP CONSTRAINT IF EXISTS thrive_plaid_items_user_id_fkey;
      ALTER TABLE thrive_plaid_items ADD CONSTRAINT thrive_plaid_items_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES thrive_users(id) ON DELETE CASCADE;
    END $$;
  `);
  console.log('✓ CASCADE delete constraints added');

  // Clean up expired sessions (run periodically)
  await pool.query(`
    DELETE FROM thrive_plaid_sessions WHERE expires_at < NOW();
  `);
  console.log('✓ Expired sessions cleaned up');

  console.log('\n✅ All security migrations complete.');
  console.log('\n⚠️  IMPORTANT: You must now re-encrypt existing Plaid access tokens.');
  console.log('   Run: npx tsx -r dotenv/config encrypt-existing-tokens.ts');

  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
