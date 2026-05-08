const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',       // Change this if you deploy to a cloud DB for the 5 bonus marks!
    user: 'root',            // Replace with your MySQL username
    password: 'saad123', // Replace with your MySQL password
    database: 'rideflow',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;