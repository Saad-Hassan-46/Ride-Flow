const express = require('express');
const session = require('express-session');
const path = require('path');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware configurations
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session setup for preserving role-based context
app.use(session({
    secret: 'rideflow_super_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 2 } // Active for 2 hours
}));

// API: User Authentication
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    try {
        // Fetch user metadata directly from your USERS table
        const [users] = await pool.query(
            'SELECT user_id, full_name, email, password_hash, role, account_status FROM USERS WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const user = users[0];

        // Ensure the account isn't locked or suspended (important for ratings checks!)
        if (user.account_status === 'Suspended') {
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact Admin.' });
        }

        // Standard direct match for verification
        if (user.password_hash !== password) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        // Save session data
        req.session.userId = user.user_id;
        req.session.userName = user.full_name;
        req.session.role = user.role;

        return res.json({
            success: true,
            role: user.role,
            userName: user.full_name,
            redirectUrl: `/${user.role.toLowerCase()}_dashboard.html`
        });

    } catch (error) {
        console.error('Database connection login error:', error);
        return res.status(500).json({ success: false, message: 'Database query failed.' });
    }
});

// API: Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, message: 'Unable to logout.' });
        res.json({ success: true });
    });
});

// Middleware to protect routes based on User Role
function requireRole(role) {
    return (req, res, next) => {
        if (req.session && req.session.role === role) {
            return next();
        }
        res.status(403).send('<h1>Access Denied: Restricted Area</h1>');
    };
}

// Serve protected HTML dashboards
app.get('/rider_dashboard.html', requireRole('Rider'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'rider_dashboard.html'));
});

app.get('/driver_dashboard.html', requireRole('Driver'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'driver_dashboard.html'));
});

app.get('/admin_dashboard.html', requireRole('Admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_dashboard.html'));
});

// ============================================================
// PHASE 2: RIDER API ROUTES
// ============================================================

// 1. Fetch available locations for the dropdowns
app.get('/api/locations', requireRole('Rider'), async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, address_label, city FROM LOCATIONS ORDER BY city, address_label');
        res.json({ success: true, locations });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Database error fetching locations.' });
    }
});

// 2. Estimate Fare (Calls your Stored Procedure)
app.post('/api/rides/estimate', requireRole('Rider'), async (req, res) => {
    const { pickup_id, dropoff_id } = req.body;
    
    // In a real app, you'd use Google Maps API here. 
    // For this project, we'll simulate a distance (3-15km) and duration (10-40min).
    const distance_km = (Math.random() * 12 + 3).toFixed(2);
    const duration_minutes = Math.floor(Math.random() * 30 + 10);
    const scheduled_time = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
        // Run the stored procedure from Iteration 3
        const connection = await pool.getConnection();
        await connection.query('CALL CalculateFare(?, ?, ?, @fare)', [distance_km, duration_minutes, scheduled_time]);
        const [result] = await connection.query('SELECT @fare AS final_fare');
        connection.release();

        res.json({ 
            success: true, 
            distance_km, 
            duration_minutes, 
            fare: result[0].final_fare 
        });
    } catch (error) {
        console.error("Fare Calc Error:", error);
        res.status(500).json({ success: false, message: 'Failed to calculate fare.' });
    }
});

// 3. Confirm & Book the Ride
app.post('/api/rides/book', requireRole('Rider'), async (req, res) => {
    const { pickup_id, dropoff_id, distance_km, duration_minutes, fare } = req.body;
    const rider_id = req.session.userId;

    try {
        const [result] = await pool.query(`
            INSERT INTO RIDES (rider_id, pickup_location_id, dropoff_location_id, distance_km, duration_minutes, fare, status)
            VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED')
        `, [rider_id, pickup_id, dropoff_id, distance_km, duration_minutes, fare]);

        res.json({ success: true, ride_id: result.insertId });
    } catch (error) {
        console.error("Booking Error:", error);
        res.status(500).json({ success: false, message: 'Failed to book ride.' });
    }
});

// 4. Get Active Ride Status (Queries ActiveRidesView)
app.get('/api/rides/active', requireRole('Rider'), async (req, res) => {
    try {
        const [activeRides] = await pool.query(
            'SELECT * FROM ActiveRidesView WHERE rider_id = ? LIMIT 1', 
            [req.session.userId]
        );
        res.json({ success: true, activeRide: activeRides[0] || null });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 5. Get Ride History (Uses Q1.1 from your SQL basic queries)
app.get('/api/rides/history', requireRole('Rider'), async (req, res) => {
    try {
        const [history] = await pool.query(`
            SELECT 
                r.ride_id, DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') AS ride_date,
                pickup.address_label AS pickup_location, dropoff.address_label AS dropoff_location,
                r.fare, r.status, COALESCE(driver.full_name, 'Unassigned') AS driver_name
            FROM RIDES r
            JOIN LOCATIONS pickup ON r.pickup_location_id = pickup.location_id
            JOIN LOCATIONS dropoff ON r.dropoff_location_id = dropoff.location_id
            LEFT JOIN USERS driver ON r.driver_id = driver.user_id
            WHERE r.rider_id = ?
            ORDER BY r.created_at DESC LIMIT 10
        `, [req.session.userId]);
        res.json({ success: true, history });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ============================================================
// PHASE 3: DRIVER API ROUTES
// ============================================================

// 1. Fetch Driver Metrics & Status
app.get('/api/driver/stats', requireRole('Driver'), async (req, res) => {
    try {
        const [stats] = await pool.query(`
            SELECT 
                d.availability_status, d.total_trips_completed, d.average_rating,
                COALESCE(SUM(r.fare), 0) AS total_earnings
            FROM DRIVERS d
            LEFT JOIN RIDES r ON d.user_id = r.driver_id AND r.status = 'COMPLETED'
            WHERE d.user_id = ?
            GROUP BY d.user_id
        `, [req.session.userId]);
        
        res.json({ success: true, stats: stats[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});

// 2. Toggle Availability (Online / Offline)
app.post('/api/driver/toggle-status', requireRole('Driver'), async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query('UPDATE DRIVERS SET availability_status = ? WHERE user_id = ?', [status, req.session.userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 3. Poll for Incoming Ride Requests
app.get('/api/driver/incoming-rides', requireRole('Driver'), async (req, res) => {
    try {
        // Find the oldest REQUESTED ride. 
        // (In a real app, you'd filter by GPS proximity, but for this DB project, picking the first available is perfect).
        const [requests] = await pool.query(`
            SELECT 
                r.ride_id, r.distance_km, r.duration_minutes, r.fare,
                pickup.address_label AS pickup, dropoff.address_label AS dropoff
            FROM RIDES r
            JOIN LOCATIONS pickup ON r.pickup_location_id = pickup.location_id
            JOIN LOCATIONS dropoff ON r.dropoff_location_id = dropoff.location_id
            WHERE r.status = 'REQUESTED'
            ORDER BY r.created_at ASC LIMIT 1
        `);
        res.json({ success: true, request: requests[0] || null });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 4. Accept a Ride
app.post('/api/driver/accept-ride', requireRole('Driver'), async (req, res) => {
    const { ride_id } = req.body;
    const driver_id = req.session.userId;

    try {
        // Fetch the driver's first registered vehicle
        const [vehicles] = await pool.query('SELECT vehicle_id FROM VEHICLES WHERE driver_id = ? LIMIT 1', [driver_id]);
        const vehicle_id = vehicles[0]?.vehicle_id || null;

        await pool.query(`
            UPDATE RIDES 
            SET status = 'ACCEPTED', driver_id = ?, vehicle_id = ?
            WHERE ride_id = ? AND status = 'REQUESTED'
        `, [driver_id, vehicle_id, ride_id]);
        
        // Put driver 'On Trip'
        await pool.query("UPDATE DRIVERS SET availability_status = 'On Trip' WHERE user_id = ?", [driver_id]);

        res.json({ success: true });
    } catch (error) {
        console.error("Accept Ride Error:", error);
        res.status(500).json({ success: false });
    }
});

// 5. Update Ride Lifecycle Status
// 5. Update Ride Lifecycle Status
app.post('/api/driver/update-ride-status', requireRole('Driver'), async (req, res) => {
    const { ride_id, new_status } = req.body;
    try {
        await pool.query('UPDATE RIDES SET status = ? WHERE ride_id = ?', [new_status, ride_id]);
        
        if(new_status === 'COMPLETED') {
            const [ride] = await pool.query('SELECT fare FROM RIDES WHERE ride_id = ?', [ride_id]);
            await pool.query(`
                INSERT INTO PAYMENTS (ride_id, payment_method, amount, payment_status) 
                VALUES (?, 'CASH', ?, 'Paid')
            `, [ride_id, ride[0].fare]);

            // 🚨 FIX: Explicitly set driver back to Online since the SQL trigger 
            // only fires on UPDATE, not on this INSERT.
            await pool.query("UPDATE DRIVERS SET availability_status = 'Online' WHERE user_id = ?", [req.session.userId]);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error("Update Status Error:", error);
        res.status(500).json({ success: false });
    }
});

// 6. Check Active Driver Trip
app.get('/api/driver/active-trip', requireRole('Driver'), async (req, res) => {
    try {
        const [trip] = await pool.query(`
            SELECT r.ride_id, r.status, r.fare, p.address_label AS pickup, d.address_label AS dropoff
            FROM RIDES r
            JOIN LOCATIONS p ON r.pickup_location_id = p.location_id
            JOIN LOCATIONS d ON r.dropoff_location_id = d.location_id
            WHERE r.driver_id = ? AND r.status IN ('ACCEPTED', 'DRIVER EN ROUTE', 'IN PROGRESS')
            LIMIT 1
        `, [req.session.userId]);
        res.json({ success: true, trip: trip[0] || null });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ============================================================
// PHASE 4: ADMIN API ROUTES
// ============================================================

// 1. High-Level System Metrics Ribbon
app.get('/api/admin/metrics', requireRole('Admin'), async (req, res) => {
    try {
        const [revenue] = await pool.query("SELECT SUM(amount) as total FROM PAYMENTS WHERE payment_status = 'Paid'");
        const [rides] = await pool.query("SELECT COUNT(*) as total FROM RIDES WHERE status = 'COMPLETED'");
        const [drivers] = await pool.query("SELECT COUNT(*) as total FROM DRIVERS WHERE availability_status IN ('Online', 'On Trip')");
        
        res.json({ 
            success: true, 
            revenue: revenue[0].total || 0,
            rides: rides[0].total || 0,
            activeDrivers: drivers[0].total || 0
        });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 2. Report: Revenue by City (Q2.1 - Aggregate + Joins)
app.get('/api/admin/reports/revenue', requireRole('Admin'), async (req, res) => {
    try {
        const [report] = await pool.query(`
            SELECT l.city, COUNT(r.ride_id) AS total_completed_rides, SUM(p.amount) AS total_revenue
            FROM RIDES r
            JOIN PAYMENTS p ON r.ride_id = p.ride_id
            JOIN LOCATIONS l ON r.pickup_location_id = l.location_id
            WHERE r.status = 'COMPLETED' AND p.payment_status = 'Paid'
            GROUP BY l.city ORDER BY total_revenue DESC
        `);
        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 3. Report: Platform Financials (Q3.4 - Commission Breakdown)
app.get('/api/admin/reports/financials', requireRole('Admin'), async (req, res) => {
    try {
        const [report] = await pool.query(`
            SELECT d.user_id, u.full_name, COUNT(r.ride_id) AS total_trips,
            ROUND(SUM(r.fare) * 0.20, 2) AS platform_commission,
            ROUND(SUM(r.fare) * 0.80, 2) AS net_driver_earnings
            FROM RIDES r
            JOIN DRIVERS d ON r.driver_id = d.user_id
            JOIN USERS u ON d.user_id = u.user_id
            WHERE r.status = 'COMPLETED'
            GROUP BY d.user_id, u.full_name
            ORDER BY platform_commission DESC LIMIT 10
        `);
        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 4. Action: Flagged Drivers (Q2.2 - HAVING Clause)
app.get('/api/admin/users/flagged', requireRole('Admin'), async (req, res) => {
    try {
        const [flagged] = await pool.query(`
            SELECT u.user_id, u.full_name, u.account_status, d.license_number, ROUND(AVG(rat.rating_score), 2) AS avg_rating
            FROM DRIVERS d
            JOIN USERS u ON d.user_id = u.user_id
            JOIN RATINGS rat ON d.user_id = rat.rated_user_id
            WHERE rat.rated_by = 'Rider'
            GROUP BY d.user_id, u.full_name, u.account_status, d.license_number
            HAVING AVG(rat.rating_score) < 3.5
            ORDER BY avg_rating ASC
        `);
        res.json({ success: true, flagged });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 5. Action: Suspend User
app.post('/api/admin/users/suspend', requireRole('Admin'), async (req, res) => {
    const { target_user_id } = req.body;
    try {
        await pool.query("UPDATE USERS SET account_status = 'Suspended' WHERE user_id = ?", [target_user_id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Initialize Server
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 RideFlow Server running on port ${PORT}`);
    console.log(`🎨 Design Theme: Bold Charcoal & Neon Green`);
    console.log(`=========================================`);
});