const mysql = require('mysql2');

// Database connection set karna
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      // XAMPP ka default user 'root' hota hai
    password: '',      // XAMPP ka default password khali hota hai
    database: 'school_db'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected to XAMPP MySQL Database successfully!');
});

module.exports = db;