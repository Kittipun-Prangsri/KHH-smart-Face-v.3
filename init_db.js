const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  host: '192.168.80.7',
  user: 'Khos', // เปลี่ยนเป็น user ของคุณ
  password: 'KH10866@zjkowfh', // เปลี่ยนเป็น password ของคุณ
};

async function initDB() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    console.log('Connected to MySQL server.');

    await connection.query('CREATE DATABASE IF NOT EXISTS hospital_db COLLATE utf8mb4_unicode_ci');
    console.log('Database hospital_db created or already exists.');

    await connection.query('USE hospital_db');

    // Create tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        dept VARCHAR(255),
        role VARCHAR(255),
        shift VARCHAR(50),
        status VARCHAR(50),
        time_in VARCHAR(20),
        time_out VARCHAR(20),
        hours VARCHAR(50),
        ot VARCHAR(50),
        conf FLOAT
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS timelineData (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(50),
        name VARCHAR(255),
        shift VARCHAR(50),
        time VARCHAR(20),
        dept VARCHAR(255),
        action VARCHAR(255)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS scanQueue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        dept VARCHAR(255),
        shift VARCHAR(50),
        conf FLOAT,
        type VARCHAR(50)
      )
    `);
    console.log('Tables created successfully.');

    // Seed data from db.json
    const dbPath = path.join(__dirname, 'db.json');
    if (fs.existsSync(dbPath)) {
      const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

      console.log('Inserting employees...');
      for (const emp of data.employees) {
        await connection.query(
          'INSERT IGNORE INTO employees (id, name, dept, role, shift, status, time_in, time_out, hours, ot, conf) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [emp.id, emp.name, emp.dept, emp.role, emp.shift, emp.status, emp.in, emp.out, emp.hours, emp.ot, emp.conf]
        );
      }

      console.log('Inserting timelineData...');
      await connection.query('TRUNCATE TABLE timelineData'); // Ensure fresh insert if re-run
      for (const t of data.timelineData) {
        await connection.query(
          'INSERT INTO timelineData (type, name, shift, time, dept, action) VALUES (?, ?, ?, ?, ?, ?)',
          [t.type, t.name, t.shift, t.time, t.dept, t.action]
        );
      }

      console.log('Inserting scanQueue...');
      await connection.query('TRUNCATE TABLE scanQueue');
      for (const s of data.scanQueue) {
        await connection.query(
          'INSERT INTO scanQueue (name, dept, shift, conf, type) VALUES (?, ?, ?, ?, ?)',
          [s.name, s.dept, s.shift, s.conf, s.type]
        );
      }

      console.log('Data seeded from db.json successfully!');
    } else {
      console.log('db.json not found, skipping data seed.');
    }

    await connection.end();
    console.log('Database initialization completed.');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

initDB();
