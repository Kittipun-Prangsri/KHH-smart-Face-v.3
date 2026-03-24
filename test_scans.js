const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '192.168.80.7',
  user: 'Khos',
  password: 'KH10866@zjkowfh',
  database: 'hosoffice'
});

async function test() {
  try {
    const [rows] = await pool.query('SELECT * FROM hikvision ORDER BY AccessDate DESC, AccessTime DESC LIMIT 10');
    console.log('Last 10 Scans:');
    console.table(rows);
    process.exit(0);
  } catch (err) {
    console.error('Database error:', err);
    process.exit(1);
  }
}

test();
