const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Database connection setup
const db = new sqlite3.Database('./school.db', (err) => {
    if (err) console.error("Database opening error: " + err.message);
    else console.log("Connected to SQLite database.");
});

// Tables creation
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, roll_no TEXT, class TEXT, parent_name TEXT, phone TEXT, address TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, subject TEXT, phone TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER, amount REAL, status TEXT, date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS marks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER, subject TEXT, marks_obtained REAL, total_marks REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER, date TEXT, status TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teacher_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER, latitude REAL, longitude REAL, photo TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS timetable (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_name TEXT, subject TEXT, teacher_name TEXT, time_slot TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, category TEXT, amount REAL, date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, message TEXT, date TEXT
    )`);
});

// Dashboard Stats API
app.get('/dashboard-stats', (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM students`, (err, row1) => {
        db.get(`SELECT COUNT(*) as count FROM teachers`, (err, row2) => {
            db.get(`SELECT SUM(amount) as total FROM fees WHERE status='Paid'`, (err, row3) => {
                db.get(`SELECT SUM(amount) as total FROM expenses`, (err, row4) => {
                    res.json({
                        totalStudents: row1 ? row1.count : 0,
                        totalTeachers: row2 ? row2.count : 0,
                        totalFees: row3 && row3.total ? row3.total : 0,
                        totalExpenses: row4 && row4.total ? row4.total : 0
                    });
                });
            });
        });
    });
});

// --- Students APIs ---
app.get('/students', (req, res) => {
    const className = req.query.class;
    let query = `SELECT * FROM students`;
    let params = [];
    if (className) {
        query += ` WHERE class = ?`;
        params.push(className);
    }
    db.all(query, params, (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/add-student', (req, res) => {
    const { name, roll_no, class_name, parent_name, phone, address } = req.body;
    db.run(`INSERT INTO students (name, roll_no, class, parent_name, phone, address) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, roll_no, class_name, parent_name, phone, address], function(err) {
            if (err) res.status(500).json({ error: err.message });
            else res.json({ message: "Student added successfully", id: this.lastID });
        });
});

app.put('/update-student/:id', (req, res) => {
    const { name, roll_no, class_name, parent_name, phone, address } = req.body;
    db.run(`UPDATE students SET name = ?, roll_no = ?, class = ?, parent_name = ?, phone = ?, address = ? WHERE id = ?`,
        [name, roll_no, class_name, parent_name, phone, address, req.params.id], function(err) {
            if (err) res.status(500).json({ error: err.message });
            else res.json({ message: "Student updated successfully" });
        });
});

app.delete('/delete-student/:id', (req, res) => {
    db.run(`DELETE FROM students WHERE id = ?`, [req.params.id], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Student deleted" });
    });
});

// --- Teachers APIs ---
app.get('/teachers', (req, res) => {
    db.all(`SELECT * FROM teachers`, [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/add-teacher', (req, res) => {
    const { name, subject, phone } = req.body;
    db.run(`INSERT INTO teachers (name, subject, phone) VALUES (?, ?, ?)`, [name, subject, phone], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Teacher added", id: this.lastID });
    });
});

app.put('/update-teacher/:id', (req, res) => {
    const { name, subject, phone } = req.body;
    db.run(`UPDATE teachers SET name = ?, subject = ?, phone = ? WHERE id = ?`, [name, subject, phone, req.params.id], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Teacher updated" });
    });
});

app.delete('/delete-teacher/:id', (req, res) => {
    db.run(`DELETE FROM teachers WHERE id = ?`, [req.params.id], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Teacher deleted" });
    });
});

// --- Distance Calculation Formula (Haversine) ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

// --- GPS Teacher Attendance API with School Location Restriction ---
app.post('/mark-teacher-attendance', (req, res) => {
    const { teacher_id, latitude, longitude, photo } = req.body;

    // Aapke school ki exact coordinates
    const SCHOOL_LAT = 30.1629886;
    const SCHOOL_LONG = 73.5725527;
    const ALLOWED_DISTANCE = 100; // 100 meters radius

    if (!latitude || !longitude) {
        return res.status(400).json({ error: "Location coordinates required!" });
    }

    const distance = calculateDistance(SCHOOL_LAT, SCHOOL_LONG, parseFloat(latitude), parseFloat(longitude));

    if (distance > ALLOWED_DISTANCE) {
        return res.status(400).json({ 
            error: `Aap school ki location par mojood nahi hain! (${Math.round(distance)} meters door hain, limit 100m hai)` 
        });
    }

    db.run(`INSERT INTO teacher_attendance (teacher_id, latitude, longitude, photo) VALUES (?, ?, ?, ?)`,
        [teacher_id, latitude, longitude, photo], function(err) {
            if (err) res.status(500).json({ error: err.message });
            else res.json({ message: "Teacher attendance & GPS verified successfully!" });
        });
});

// --- Fees APIs ---
app.get('/fees', (req, res) => {
    db.all(`SELECT fees.*, students.name, students.roll_no FROM fees JOIN students ON fees.student_id = students.id`, [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/add-fee', (req, res) => {
    const { student_id, amount, status, date } = req.body;
    db.run(`INSERT INTO fees (student_id, amount, status, date) VALUES (?, ?, ?, ?)`, [student_id, amount, status, date], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Fee added" });
    });
});

app.delete('/delete-fee/:id', (req, res) => {
    db.run(`DELETE FROM fees WHERE id = ?`, [req.params.id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Fee deleted" });
    });
});

// --- Marks & Report Card APIs ---
app.get('/marks', (req, res) => {
    db.all(`SELECT marks.*, students.name, students.roll_no FROM marks JOIN students ON marks.student_id = students.id`, [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/add-marks', (req, res) => {
    const { student_id, subject, marks_obtained, total_marks } = req.body;
    db.run(`INSERT INTO marks (student_id, subject, marks_obtained, total_marks) VALUES (?, ?, ?, ?)`, [student_id, subject, marks_obtained, total_marks], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Marks added" });
    });
});

app.delete('/delete-marks/:id', (req, res) => {
    db.run(`DELETE FROM marks WHERE id = ?`, [req.params.id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Marks deleted" });
    });
});

app.get('/report-card/:student_id', (req, res) => {
    const studentId = req.params.student_id;
    db.get(`SELECT * FROM students WHERE id = ?`, [studentId], (err, student) => {
        if (!student) return res.status(404).json({ error: "Student not found" });
        db.all(`SELECT * FROM marks WHERE student_id = ?`, [studentId], (err, marks) => {
            res.json({ student, marks });
        });
    });
});

// --- Student Attendance APIs ---
app.get('/all-attendance', (req, res) => {
    db.all(`SELECT attendance.*, students.name, students.roll_no FROM attendance JOIN students ON attendance.student_id = students.id`, [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/mark-attendance', (req, res) => {
    const { student_id, date, status } = req.body;
    db.run(`INSERT INTO attendance (student_id, date, status) VALUES (?, ?, ?)`, [student_id, date, status], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Attendance marked" });
    });
});

app.delete('/delete-attendance/:id', (req, res) => {
    db.run(`DELETE FROM attendance WHERE id = ?`, [req.params.id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Attendance deleted" });
    });
});

// --- Timetable APIs ---
app.get('/timetable', (req, res) => {
    db.all(`SELECT * FROM timetable`, [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/add-timetable', (req, res) => {
    const { class_name, subject, teacher_name, time_slot } = req.body;
    db.run(`INSERT INTO timetable (class_name, subject, teacher_name, time_slot) VALUES (?, ?, ?, ?)`, [class_name, subject, teacher_name, time_slot], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Timetable added" });
    });
});

app.delete('/delete-timetable/:id', (req, res) => {
    db.run(`DELETE FROM timetable WHERE id = ?`, [req.params.id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Timetable deleted" });
    });
});

// --- Expenses APIs ---
app.get('/expenses', (req, res) => {
    db.all(`SELECT * FROM expenses`, [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/add-expense', (req, res) => {
    const { title, category, amount, date } = req.body;
    db.run(`INSERT INTO expenses (title, category, amount, date) VALUES (?, ?, ?, ?)`, [title, category, amount, date], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Expense added" });
    });
});

app.delete('/delete-expense/:id', (req, res) => {
    db.run(`DELETE FROM expenses WHERE id = ?`, [req.params.id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Expense deleted" });
    });
});

// --- Announcements APIs ---
app.get('/announcements', (req, res) => {
    db.all(`SELECT * FROM announcements`, [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/announcements', (req, res) => {
    const { title, message, date } = req.body;
    db.run(`INSERT INTO announcements (title, message, date) VALUES (?, ?, ?)`, [title, message, date], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Notice published" });
    });
});

app.delete('/delete-announcement/:id', (req, res) => {
    db.run(`DELETE FROM announcements WHERE id = ?`, [req.params.id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Notice deleted" });
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
