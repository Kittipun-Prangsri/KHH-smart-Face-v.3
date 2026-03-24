const mysql = require('mysql2/promise');

const dbConfigHosoffice = {
  host: '192.168.80.7',
  user: 'Khos',
  password: 'KH10866@zjkowfh',
  database: 'hosoffice',
};

const dbConfigHospital = {
  host: '192.168.80.7',
  user: 'Khos',
  password: 'KH10866@zjkowfh',
  database: 'hospital_db',
};

async function syncHikvisionData() {
  let hosConn, hospConn;
  try {
    console.log('🔗 Connecting to databases...');
    hosConn = await mysql.createConnection(dbConfigHosoffice);
    hospConn = await mysql.createConnection(dbConfigHospital);

    // 1. นำเข้าและอัปเดตข้อมูลพนักงานทั้งหมด (Employees Master)
    // ดึง EmployeeID และชื่อ, แผนก ล่าสุดจากตาราง hikvision
    console.log('🔄 Fetching unique employees from Hikvision logs...');
    const [employees] = await hosConn.query(`
      SELECT 
        EmployeeID as id, 
        MAX(PersonName) as name, 
        MAX(PersonGroup) as dept
      FROM hikvision 
      WHERE EmployeeID IS NOT NULL AND EmployeeID != ''
      GROUP BY EmployeeID
    `);

    console.log(`Found ${employees.length} unique employees. Updating hospital_db.employees...`);

    for (const emp of employees) {
      // ใช้ INSERT ... ON DUPLICATE KEY UPDATE สำหรับ MySQL
      // ถ้าไม่มีคอลัมน์ไหนในนี้ ให้ปรับแก้ให้ตรงกับที่ table คุณมี (เช่น role, shift ปล่อยว่างไปก่อนได้)
      await hospConn.query(`
        INSERT INTO employees (id, name, dept) 
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          name = VALUES(name), 
          dept = VALUES(dept)
      `, [emp.id, emp.name, emp.dept]);
    }

    // 2. ดึงข้อมูลเวลาเข้า-ออกงานของ "วันนี้" เพื่อมาอัปเดต Status, time_in, time_out
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    console.log(`⏱️ Fetching today's (${today}) access logs...`);

    const [todayLogs] = await hosConn.query(`
      SELECT 
        EmployeeID as id,
        MIN(CASE WHEN Direction = 'in' THEN AccessTime END) as time_in,
        MAX(CASE WHEN Direction = 'out' THEN AccessTime END) as time_out
      FROM hikvision
      WHERE AccessDate = ?
      GROUP BY EmployeeID
    `, [today]);

    for (const log of todayLogs) {
      // วิเคราะห์สถานะคร่าวๆ ถ้ามี time_in คือ "เข้างาน" ถ้ามี time_out ด้วยอาจจะ "ออกงาน"
      let status = '—';
      if (log.time_in && !log.time_out) status = 'เข้างาน';
      if (log.time_in && log.time_out) status = 'ออกงาน';

      await hospConn.query(`
        UPDATE employees 
        SET 
          time_in = ?, 
          time_out = ?, 
          status = ?
        WHERE id = ?
      `, [log.time_in, log.time_out, status, log.id]);
    }

    console.log(`✅ Sync completed successfully! Updated attendance for ${todayLogs.length} staffs today.`);

  } catch (error) {
    console.error('❌ Error syncing data:', error);
  } finally {
    if (hosConn) await hosConn.end();
    if (hospConn) await hospConn.end();
  }
}

syncHikvisionData();
