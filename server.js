const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());

// MySQL Connection Pool (hospital_db)
const pool = mysql.createPool({
  host: '192.168.80.7',
  user: 'Khos', // เปลี่ยนเป็น user ของระบบคุณ
  password: 'KH10866@zjkowfh', // เปลี่ยนเป็นรหัสผ่านของคุณ
  database: 'hospital_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// MySQL Connection Pool (hosoffice - HR Data)
const hosofficePool = mysql.createPool({
  host: '192.168.80.7',
  user: 'Khos',
  password: 'KH10866@zjkowfh',
  database: 'hosoffice',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// API Endpoint to get data
app.get('/api/data', async (req, res) => {
  try {
    const targetDateStr = req.query.date || new Date().toISOString().split('T')[0];
    const targetDateObj = new Date(targetDateStr);
    const targetMonth = targetDateStr.substring(0, 7); // YYYY-MM
    let day = targetDateObj.getDate().toString();
    const dayColumn = `di${day}`;

    const lateMin = parseInt(req.query.lateMin) || 31;
    const workStart = req.query.workStart || '08:00';
    
    // Calculate late threshold time (e.g. 08:00 + 31 mins = 08:31:00)
    const [h, m] = workStart.split(':').map(Number);
    const lateTotalMinutes = h * 60 + m + lateMin;
    const lateH = Math.floor(lateTotalMinutes / 60).toString().padStart(2, '0');
    const lateM = (lateTotalMinutes % 60).toString().padStart(2, '0');
    const lateThresholdTime = `${lateH}:${lateM}:00`;

    // Load schedule mapping
    let shiftMap = {};
    try {
      if (fs.existsSync(SCHEDULE_FILE)) {
        const sched = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
        sched.forEach(s => {
          if (s.emp_id && s.shift) {
            shiftMap[s.emp_id] = s.shift.toLowerCase();
          }
        });
      }
    } catch (e) {
      console.error('Shift load error:', e);
    }

    // 1. Fetch live unified employees summary
    const [employees] = await hosofficePool.query(`
      SELECT 
        p.FINGLE_ID AS id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
        d.HR_DEPARTMENT_NAME AS dept,
        s.HR_STATUS_NAME AS role,
        COALESCE(h.time_in, '') AS \`in\`,
        COALESCE(h.time_out, '') AS \`out\`,
        m.${dayColumn} AS leave_status,
        CASE 
          WHEN m.${dayColumn} IS NOT NULL AND m.${dayColumn} != '' AND m.${dayColumn} NOT REGEXP '^[0-9]{2}:[0-9]{2}' THEN 'leave'
          WHEN h.time_in > ? THEN 'late'
          WHEN h.time_out IS NOT NULL AND h.time_out != h.time_in THEN 'out'
          WHEN h.time_in IS NOT NULL THEN 'in'
          ELSE 'none' END as status,
        '' as shift, 
        '0' as hours, 
        '0' as ot, 
        100 as conf 
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s ON p.HR_STATUS_ID = s.HR_STATUS_ID
      LEFT JOIN (
        SELECT 
          EmployeeID, 
          MIN(AccessTime) as time_in,
          MAX(AccessTime) as time_out
        FROM hikvision 
        WHERE AccessDate = ? 
        GROUP BY EmployeeID
      ) h ON p.FINGLE_ID = h.EmployeeID
      LEFT JOIN service_work_scans_morning m ON p.ID = m.hr_person_id AND m.year_and_month = ?
      WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
      ORDER BY d.HR_DEPARTMENT_ID, p.FINGLE_ID
    `, [lateThresholdTime, targetDateStr, targetMonth]);
    
    // Map shifts
    employees.forEach(e => {
      if (shiftMap[e.id]) e.shift = shiftMap[e.id];
    });
    
    // 2. Fetch realtime live scans from Hikvision (limited to the target date)
    const [liveScans] = await hosofficePool.query(`
      SELECT 
        h.Direction as type,
        COALESCE(h.PersonName, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME)) as name,
        COALESCE(h.PersonGroup, d.HR_DEPARTMENT_NAME) as dept,
        h.AccessTime as time,
        h.DeviceName,
        h.ReaderName,
        h.SkinSurfaceTemperature as temp,
        h.TemperatureStatus as tempStatus,
        CASE 
          WHEN h.Direction = 'in' THEN 'เข้างาน' 
          WHEN h.Direction = 'out' THEN 'ออกงาน' 
          ELSE 'สแกน' END as action,
        h.Direction as subType,
        '' as shift, 
        ROUND(RAND() * (99.9 - 95.0) + 95.0, 1) as conf 
      FROM hikvision h
      LEFT JOIN hr_person p ON h.EmployeeID = p.FINGLE_ID
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      WHERE h.AccessDate = ?
      AND (p.HR_STATUS_ID IN ('01', '02', '03', '04', '09') OR h.PersonName IS NOT NULL)
      ORDER BY h.AccessTime DESC
      LIMIT 30
    `, [targetDateStr]);

    const timelineData = liveScans.map(s => ({
      ...s,
      location: s.DeviceName || s.ReaderName || 'ไม่ทราบจุดสแกน'
    }));
    const scanQueue = timelineData.slice(0, 5); 
    
    // 3. Fetch Service Work / Leave status for the target date
    const dayColumnIn = `di${day}`;
    const dayColumnOut = `do${day}`;

    const [serviceWorkData] = await hosofficePool.query(`
      SELECT 
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) as name,
        d.HR_DEPARTMENT_NAME as dept,
        m.${dayColumnIn} as morning,
        a.${dayColumnOut} as afternoon
      FROM hr_person p
      JOIN service_work_scans_morning m ON p.ID = m.hr_person_id
      JOIN service_work_scans_afternoon a ON p.ID = a.hr_person_id
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      WHERE m.year_and_month = ? AND a.year_and_month = ?
      AND (
        (m.${dayColumnIn} IS NOT NULL AND m.${dayColumnIn} != '' AND m.${dayColumnIn} NOT REGEXP '[0-9]{2}:[0-9]{2}')
        OR
        (a.${dayColumnOut} IS NOT NULL AND a.${dayColumnOut} != '' AND a.${dayColumnOut} NOT REGEXP '[0-9]{2}:[0-9]{2}')
      )
    `, [targetMonth, targetMonth]);

    res.json({ employees, timelineData, scanQueue, serviceWorkData });
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({ employees: [], timelineData: [], scanQueue: [] });
  }
});

// GET Monthly Summary Report aggregated by employees
app.get('/api/report/monthly', async (req, res) => {
  try {
    const { month, year } = req.query;
    const targetMonth = `${year}-${month.toString().padStart(2, '0')}`;
    const workStart = '08:00'; // Default, follow same logic as /api/data if possible
    const lateMin = 31;
    const [h, m] = workStart.split(':').map(Number);
    const lateThreshold = (h * 60 + m + lateMin);
    const lateThresholdTime = `${Math.floor(lateThreshold/60).toString().padStart(2,'0')}:${(lateThreshold%60).toString().padStart(2,'0')}:00`;

    const [monthlyData] = await hosofficePool.query(`
      SELECT 
        p.FINGLE_ID AS id,
        CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
        d.HR_DEPARTMENT_NAME AS dept,
        COUNT(DISTINCT h.AccessDate) as daysWorked,
        SUM(CASE WHEN h.time_in > ? THEN 1 ELSE 0 END) as lateCount,
        SUM(TIMESTAMPDIFF(MINUTE, h.time_in, h.time_out)) / 60 as totalHours
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN (
        SELECT 
          EmployeeID, 
          AccessDate,
          MIN(AccessTime) as time_in,
          MAX(AccessTime) as time_out
        FROM hikvision 
        WHERE AccessDate LIKE ? 
        GROUP BY EmployeeID, AccessDate
      ) h ON p.FINGLE_ID = h.EmployeeID
      WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
      GROUP BY p.FINGLE_ID
      HAVING daysWorked > 0
    `, [lateThresholdTime, `${targetMonth}-%`]);

    res.json({ success: true, report: monthlyData });
  } catch (error) {
    console.error('Monthly Report Error:', error);
    res.status(500).json({ success: false, report: [] });
  }
});

// API Endpoints for Shift Scheduling
const SCHEDULE_FILE = path.join(__dirname, 'data', 'schedule.json');

app.get('/api/schedule', (req, res) => {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error('Error reading schedule.json', err);
    res.status(500).json([]);
  }
});

app.post('/api/schedule', (req, res) => {
  try {
    const { emp_id, shift, date } = req.body;
    let schedule = [];
    if (fs.existsSync(SCHEDULE_FILE)) {
      schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
    }
    
    // update or remove based on both emp_id and date
    schedule = schedule.filter(s => !(s.emp_id === emp_id && s.date === date));
    
    if (shift && shift !== 'EMPTY') {
      schedule.push({ emp_id, shift, date });
    }
    
    // ensure dir
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
      fs.mkdirSync(path.join(__dirname, 'data'));
    }
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf8');
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error writing schedule.json', err);
    res.status(500).json({ error: 'Failed to write' });
  }
});

// API Endpoint to update data (mock)
app.post('/api/data', (req, res) => {
  const newDb = req.body;
  // NOTE: For a real SQL application, the frontend should send partial updates (e.g., POST /api/scan).
  // If the frontend sends the whole db state to save, we'll mock success to avoid overwriting everything expensively.
  console.log('Received payload to update data. (Mocked response)');
  res.json({ success: true, message: 'Data update logic needs specific endpoints' });
});

// API Endpoint to get personnel from hosoffice
app.get('/api/personnel', async (req, res) => {
  try {
    const [personnel] = await hosofficePool.query(`
      SELECT 
        p.ID, p.FINGLE_ID, p.HR_PREFIX_ID, p.HR_FNAME, p.HR_LNAME, p.NICKNAME, 
        p.HR_PHONE, p.HR_EMAIL, p.HR_DEPARTMENT_ID, d.HR_DEPARTMENT_NAME,
        p.HR_POSITION_ID, p.HR_STATUS_ID, s.HR_STATUS_NAME,
        p.HR_STARTWORK_DATE
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s ON s.HR_STATUS_ID = p.HR_STATUS_ID
    `);
    res.json({ personnel });
  } catch (error) {
    console.error('Database query error (hosoffice):', error);
    res.status(500).json({ personnel: [] });
  }
});

// Map new 13 groups
const depts = [
  { id: 'srt', name: 'กลุ่มงานประกันสุขภาพยุทธศาสตร์' },
  { id: 'gen', name: 'กลุ่มงานบริหารทั่วไป' },
  { id: 'pri', name: 'กลุ่มงานบริการด้านปฐมภูมิและองค์รวม' },
  { id: 'pha', name: 'กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค' },
  { id: 'dig', name: 'กลุ่มงานสุขภาพดิจิทัล' },
  { id: 'nur', name: 'กลุ่มงานการพยาบาล' },
  { id: 'den', name: 'กลุ่มงานทันตกรรม' },
  { id: 'medtech', name: 'กลุ่มงานเทคนิคการแพทย์' },
  { id: 'rehab', name: 'กลุ่มงานเวชกรรมฟื้นฟู' },
  { id: 'altmed', name: 'กลุ่มงานการแพทย์แผนไทยและการแพทย์ทางเลือก' },
  { id: 'rad', name: 'กลุ่มงานรังสีวิทยา' },
  { id: 'psy', name: 'กลุ่มงานจิตเวชและยาเสพติด' },
  { id: 'med', name: 'กลุ่มงานการแพทย์' }
];

// Serve frontend pages
const pages = [
  { path: '/', view: 'index' },
  { path: '/attendance', view: 'attendance' },
  { path: '/personnel', view: 'personnel' },
  { path: '/schedule', view: 'schedule' },
  ...depts.map(d => ({ path: `/department/${d.id}`, view: 'department', deptName: d.name })),
  { path: '/report/daily', view: 'daily-report' },
  { path: '/report/monthly', view: 'monthly-report' },
  { path: '/report/hours', view: 'hours-summary' }
];

// Mock user session currently logged in (Can be from DB or JWT later)
const loggedInUser = {
  name: 'นพ. กิตติพันธ์ ใจดี',
  role: 'ผู้อำนวยการโรงพยาบาล',
  initial: 'ก'
};

pages.forEach(p => {
  app.get(p.path, (req, res) => {
    res.render(p.view, { activeRoute: p.path, user: loggedInUser, deptName: p.deptName || '' });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
