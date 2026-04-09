require('dotenv').config({ path: __dirname + '/../../.env' });
const mysql = require('mysql2');

// Create a connection POOL — stays alive for the lifetime of the process.
// A pool reuses connections instead of creating a new one per query,
// which is both more efficient and safe for concurrent requests.
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,  // Queue queries when all connections are busy
  connectionLimit:    10,    // Max simultaneous connections
  queueLimit:         0,     // Unlimited queue (0 = no limit)
});

// Verify the pool can actually reach the database on startup.
// Fail fast: if the DB is unreachable, crash immediately with a clear error
// rather than silently serving broken API responses.
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Database pool connection failed:', err.message);
    process.exit(1);
  }
  console.log('Database pool connected successfully.');
  connection.release(); // Return the connection back to the pool
});

module.exports = pool;
