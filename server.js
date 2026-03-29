const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
  secret: 'khh-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Global RBAC Switch
const RBAC_ENABLED = true; // เปิดระบบสิทธิ์แล้ว

// Middleware to check authentication
const checkAuth = (req, res, next) => {
  if (req.session.user) {
    res.locals.user = req.session.user; // Make user data available in EJS
    res.locals.RBAC_ENABLED = RBAC_ENABLED; // Expose to EJS views
    next();
  } else {
    res.redirect('/login');
  }
};

// Middleware to check admin role (strict Admin only)
const checkAdmin = (req, res, next) => {
  if (!RBAC_ENABLED) return next();
  
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.send(`<script>alert('พื้นที่เฉพาะผู้ดูแลระบบเท่านั้น'); window.location.href='/';</script>`);
  }
};

// Auth Routes
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
      const user = rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.user = { id: user.id, username: user.username, fullname: user.fullname, role: user.role ? user.role.toLowerCase() : 'staff' };
        return res.redirect('/');
      }
    }
    res.render('login', { error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'เกิดข้อผิดพลาดของระบบ' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// MySQL Connection Pool (hospital_db)
const pool = mysql.createPool({
  host: '192.168.80.7',
  user: 'Khos', // เปลี่ยนเป็น user ของระบบคุณ
  password: 'KH10866@zjkowfh', // เปลี่ยนเป็นรหัสผ่านของคุณ
  database: 'hospital_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// MySQL Connection Pool (hosoffice - HR Data)
const hosofficePool = mysql.createPool({
  host: '192.168.80.7',
  user: 'Khos',
  password: 'KH10866@zjkowfh',
  database: 'hosoffice',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// API Endpoint to get data
app.get('/api/data', checkAuth, async (req, res) => {
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
app.get('/api/report/monthly', checkAuth, async (req, res) => {
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

app.get('/api/schedule', checkAuth, (req, res) => {
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

app.post('/api/schedule', checkAuth, checkAdmin, (req, res) => {
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

// API Endpoint: Save full monthly nurse schedule
const MONTHLY_SCHEDULE_DIR = path.join(__dirname, 'data', 'monthly_schedules');

app.post('/api/schedule/save', checkAuth, (req, res) => {
  try {
    const { year, month, schedule } = req.body;
    if (!year || !month || !schedule) {
      return res.status(400).json({ error: 'Missing year, month or schedule payload' });
    }
    // Ensure directory exists
    if (!fs.existsSync(MONTHLY_SCHEDULE_DIR)) {
      fs.mkdirSync(MONTHLY_SCHEDULE_DIR, { recursive: true });
    }
    const filename = path.join(MONTHLY_SCHEDULE_DIR, `schedule_${year}_${String(month).padStart(2,'0')}.json`);
    const payload  = { year, month, savedAt: new Date().toISOString(), schedule };
    fs.writeFileSync(filename, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[Schedule] Saved: ${filename}`);
    res.json({ success: true, file: filename });
  } catch (err) {
    console.error('Error saving monthly schedule:', err);
    res.status(500).json({ error: 'Failed to save schedule' });
  }
});

// API Endpoint: Read saved monthly nurse schedule
app.get('/api/schedule/load', checkAuth, (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'Missing year/month' });
    const filename = path.join(MONTHLY_SCHEDULE_DIR, `schedule_${year}_${String(month).padStart(2,'0')}.json`);
    if (fs.existsSync(filename)) {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      res.json({ success: true, data });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

// API Endpoint: Get per-staff schedule + attendance + leave for a given month
// GET /api/schedule/staff/:id/:yearMonth  (yearMonth = YYYY-MM)
app.get('/api/schedule/staff/:id/:yearMonth', checkAuth, async (req, res) => {
  try {
    const { id, yearMonth } = req.params;
    const [year, month] = yearMonth.split('-').map(Number);
    if (!year || !month) return res.status(400).json({ error: 'Invalid yearMonth' });

    const targetMonth = yearMonth; // 'YYYY-MM'
    const daysInMonth = new Date(year, month, 0).getDate();

    // ── 1. Shifts from monthly_schedules JSON ──
    const shifts = [];
    const schedFile = path.join(MONTHLY_SCHEDULE_DIR, `schedule_${year}_${String(month).padStart(2,'0')}.json`);
    if (fs.existsSync(schedFile)) {
      const savedSched = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
      const empSched   = (savedSched.schedule || {})[id] || {};
      Object.entries(empSched).forEach(([day, shift]) => {
        if (shift && shift !== 'OFF') {
          shifts.push({ day: parseInt(day), shift });
        }
      });
    } else {
      // Fallback: use the old schedule.json (per-date entries)
      if (fs.existsSync(SCHEDULE_FILE)) {
        const old = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
        old.filter(s => s.emp_id === id && s.date && s.date.startsWith(targetMonth))
           .forEach(s => {
             const day = parseInt(s.date.split('-')[2]);
             shifts.push({ day, shift: s.shift });
           });
      }
    }

    // ── 2. Attendance times from Hikvision (all days in this month) ──
    let times = [];
    try {
      const [rows] = await hosofficePool.query(`
        SELECT
          DAY(AccessDate)        AS day,
          MIN(AccessTime)        AS time_in,
          MAX(AccessTime)        AS time_out
        FROM hikvision
        WHERE EmployeeID = ?
          AND AccessDate LIKE ?
        GROUP BY DAY(AccessDate)
        ORDER BY day
      `, [id, `${targetMonth}-%`]);
      times = rows.map(r => ({ day: r.day, time_in: r.time_in, time_out: r.time_out }));
    } catch (dbErr) {
      console.warn('[schedule/staff] hikvision query failed:', dbErr.message);
    }

    // ── 3. Leave days from service_work_scans_morning ──
    let leaves = [];
    try {
      // Fetch the person's internal ID first
      const [personRows] = await hosofficePool.query(
        `SELECT p.ID FROM hr_person p WHERE p.FINGLE_ID = ? LIMIT 1`, [id]
      );
      if (personRows.length > 0) {
        const personId = personRows[0].ID;
        // Build dynamic column list for all days in month
        const dayNums = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        // Query morning service_work row for this person & month
        const [mRows] = await hosofficePool.query(
          `SELECT * FROM service_work_scans_morning WHERE hr_person_id = ? AND year_and_month = ? LIMIT 1`,
          [personId, targetMonth]
        );
        if (mRows.length > 0) {
          const row = mRows[0];
          dayNums.forEach(d => {
            const col  = `di${d}`;
            const val  = row[col];
            // A non-null, non-time value means leave
            if (val && typeof val === 'string' && val.trim() !== '' && !/^\d{2}:\d{2}/.test(val)) {
              leaves.push({ day: d, reason: val });
            }
          });
        }
      }
    } catch (leaveErr) {
      console.warn('[schedule/staff] leave query failed:', leaveErr.message);
    }

    res.json({ success: true, staffId: id, yearMonth, shifts, times, leaves });
  } catch (err) {
    console.error('Error in /api/schedule/staff:', err);
    res.status(500).json({ error: 'Failed to load staff schedule', shifts: [], times: [], leaves: [] });
  }
});

// API Endpoint to update staff details (REAL implementation)
app.post('/api/staff/update', checkAuth, async (req, res) => {
  const { id, nickname, phone, email } = req.body;
  
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing staff ID' });
  }

  try {
    // Update MySQL hosoffice.hr_person
    const [result] = await hosofficePool.query(
      `UPDATE hr_person SET NICKNAME = ?, HR_PHONE = ?, HR_EMAIL = ? WHERE FINGLE_ID = ?`,
      [nickname || null, phone || null, email || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Personnel not found.' });
    }

    console.log(`Updated personnel info for ID ${id}: Nickname=${nickname}, Phone=${phone}, Email=${email}`);
    res.json({ success: true, message: 'อัปเดตข้อมูลบุคลากรเรียบร้อยแล้ว' });

  } catch (error) {
    console.error('Error updating personnel:', error);
    res.status(500).json({ success: false, message: 'Database update failed.' });
  }
});

// API Endpoint to get personnel from hosoffice
app.get('/api/personnel', checkAuth, async (req, res) => {
  try {
    const [personnel] = await hosofficePool.query(`
      SELECT 
        p.ID, p.FINGLE_ID, p.HR_PREFIX_ID, p.HR_FNAME, p.HR_LNAME, p.NICKNAME, 
        p.HR_PHONE, p.HR_EMAIL, p.HR_DEPARTMENT_ID, d.HR_DEPARTMENT_NAME,
        p.HR_POSITION_ID, p.HR_STATUS_ID, s.HR_STATUS_NAME,
        p.HR_STARTWORK_DATE, p.HR_CID
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

// API Endpoint: Get single personnel record by FINGLE_ID
app.get('/api/personnel/:fingleId', checkAuth, async (req, res) => {
  try {
    const { fingleId } = req.params;
    const [rows] = await hosofficePool.query(`
      SELECT
        p.ID, p.FINGLE_ID, p.HR_PREFIX_ID,
        p.HR_FNAME, p.HR_LNAME, p.NICKNAME,
        p.HR_PHONE, p.HR_EMAIL,
        d.HR_DEPARTMENT_NAME,
        s.HR_STATUS_NAME,
        p.HR_STARTWORK_DATE,
        p.HR_CID
      FROM hr_person p
      LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
      LEFT JOIN hr_status s     ON s.HR_STATUS_ID = p.HR_STATUS_ID
      WHERE p.FINGLE_ID = ?
      LIMIT 1
    `, [fingleId]);

    if (rows.length === 0) {
      return res.status(404).json({ person: null, message: 'Not found' });
    }
    res.json({ person: rows[0] });
  } catch (error) {
    console.error('GET /api/personnel/:fingleId error:', error);
    res.status(500).json({ person: null });
  }
});

// API Endpoint: 7-day attendance history for one employee
// GET /api/attendance/history/:fingleId
app.get('/api/attendance/history/:fingleId', checkAuth, async (req, res) => {
  try {
    const { fingleId } = req.params;
    const workStart = req.query.workStart || '08:00'; // e.g. "08:30" for late threshold

    // Build last-7-days date range
    const today = new Date();
    const history = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD

      let check_in  = '-';
      let check_out = '-';
      let status    = 'absent';

      try {
        const [rows] = await hosofficePool.query(`
          SELECT
            DATE_FORMAT(MIN(AccessTime), '%H:%i') AS time_in,
            DATE_FORMAT(MAX(AccessTime), '%H:%i') AS time_out
          FROM hikvision
          WHERE EmployeeID = ? AND AccessDate = ?
        `, [fingleId, dateStr]);

        if (rows.length > 0 && rows[0].time_in) {
          check_in  = rows[0].time_in;
          check_out = rows[0].time_out || '-';

          // Determine status
          const [lh, lm] = workStart.split(':').map(Number);
          const [ih, im] = check_in.split(':').map(Number);
          const lateBy   = (ih * 60 + im) - (lh * 60 + lm);
          status = lateBy > 5 ? 'late' : 'normal';
        }

        // Check if leave — scan serviceWorkData table
        try {
          const day = d.getDate();
          const ym  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const [pRows] = await hosofficePool.query(
            `SELECT p.ID FROM hr_person p WHERE p.FINGLE_ID = ? LIMIT 1`, [fingleId]
          );
          if (pRows.length > 0) {
            const [swRows] = await hosofficePool.query(
              `SELECT \`di${day}\` AS dayval FROM service_work_scans_morning
               WHERE hr_person_id = ? AND year_and_month = ? LIMIT 1`,
              [pRows[0].ID, ym]
            );
            if (swRows.length > 0 && swRows[0].dayval && !/^\d{2}:\d{2}/.test(swRows[0].dayval)) {
              status    = 'leave';
              check_in  = '-';
              check_out = '-';
            }
          }
        } catch { /* leave check failed silently */ }

      } catch { /* hikvision query failed for this day */ }

      history.push({ date: dateStr, check_in, check_out, status });
    }

    res.json({ success: true, staff_id: fingleId, history });
  } catch (err) {
    console.error('GET /api/attendance/history error:', err);
    res.status(500).json({ history: [] });
  }
});

// Admin API - User Management
app.get('/api/users', checkAuth, checkAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username, fullname, role, created_at FROM users');
    res.json({ users: rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', checkAuth, checkAdmin, async (req, res) => {
  const { id, username, password, fullname, role } = req.body;
  try {
    if (id) {
      if (password) {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET username=?, password=?, fullname=?, role=? WHERE id=?', 
          [username, hashed, fullname, role, id]);
      } else {
        await pool.query('UPDATE users SET username=?, fullname=?, role=? WHERE id=?', 
          [username, fullname, role, id]);
      }
      res.json({ success: true, message: 'User updated successfully' });
    } else {
      const hashed = await bcrypt.hash(password || '123456', 10);
      await pool.query('INSERT INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)', 
        [username, hashed, fullname, role]);
      res.json({ success: true, message: 'User created successfully' });
    }
  } catch (error) {
    console.error('Error saving user:', error);
    res.status(500).json({ error: 'Failed to save user' });
  }
});

app.delete('/api/users/:id', checkAuth, checkAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
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
  { path: '/scheduling', view: 'scheduling' },
  { path: '/reports', view: 'reports' },
  ...depts.map(d => ({ path: `/department/${d.id}`, view: 'department', deptName: d.name })),
  { path: '/report/daily', view: 'daily-report' },
  { path: '/report/monthly', view: 'monthly-report' },
  { path: '/report/hours', view: 'hours-summary' },
  { path: '/admin/users', view: 'users' },
  { path: '/admin/permissions', view: 'permissions' }
];

// Mock user session currently logged in (Can be from DB or JWT later)
const loggedInUser = {
  name: 'นพ. กิตติพันธ์ ใจดี',
  role: 'ผู้อำนวยการโรงพยาบาล',
  initial: 'ก'
};

pages.forEach(p => {
  const adminPaths = ['/attendance', '/personnel', '/scheduling', '/reports', '/report/daily', '/report/monthly', '/report/hours', '/admin/users', '/admin/permissions', '/permissions'];
  const isDept = p.path.startsWith('/department/');

  if (adminPaths.includes(p.path) || isDept) {
    app.get(p.path, checkAuth, checkAdmin, (req, res) => {
      res.render(p.view, { activeRoute: p.path, deptName: p.deptName || '' });
    });
  } else {
    app.get(p.path, checkAuth, (req, res) => {
      res.render(p.view, { activeRoute: p.path, deptName: p.deptName || '' });
    });
  }
});

// Helper function to initialize DB and Start Server
async function startServer() {
  try {
    // 1. Initialize DB Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        fullname VARCHAR(100),
        role ENUM('super', 'manager', 'staff', 'user', 'admin') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Ensure existing table is UTF-8
    await pool.query(`ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // 2. Add default admin if not exists
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', ['admin']);
    if (existing.length === 0) {
      const hashed = await bcrypt.hash('root1234', 10);
      await pool.query('INSERT INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)', 
        ['admin', hashed, 'Hospital Admin', 'admin']);
    }

    // 3. Add default user if not exists
    const [existingUser] = await pool.query('SELECT id FROM users WHERE username = ?', ['staff']);
    if (existingUser.length === 0) {
      const hashed = await bcrypt.hash('staff1234', 10);
      await pool.query('INSERT INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)', 
        ['staff', hashed, 'Standard Staff', 'user']);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running at http://localhost:${PORT}`);
      console.log('Login available:');
      console.log('Admin: admin / root1234');
      console.log('User: staff / staff1234');
    });
  } catch (err) {
    console.error('Initialization error:', err);
    process.exit(1);
  }
}

startServer();
