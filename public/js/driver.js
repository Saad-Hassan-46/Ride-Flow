document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup UI
    const userName = localStorage.getItem('userName') || 'Driver';
    document.getElementById('user-greeting').innerText = `Captain ${userName}`;

    let currentStatus = 'Offline';
    let pollInterval = null;
    let currentRideId = null;

    // 2. Init
    await loadStats();
    await checkActiveTrip();

    // 3. Event Listeners
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('status-toggle').addEventListener('click', toggleStatus);
    document.getElementById('btn-accept').addEventListener('click', acceptRide);
    
    // Lifecycle Buttons
    document.getElementById('btn-enroute').addEventListener('click', () => updateRideStatus('DRIVER EN ROUTE'));
    document.getElementById('btn-inprogress').addEventListener('click', () => updateRideStatus('IN PROGRESS'));
    document.getElementById('btn-completed').addEventListener('click', () => updateRideStatus('COMPLETED'));

    // -- Functions --

    async function loadStats() {
        const res = await fetch('/api/driver/stats');
        const data = await res.json();
        if(data.success && data.stats) {
            document.getElementById('stat-earnings').innerText = `Rs. ${data.stats.total_earnings}`;
            document.getElementById('stat-trips').innerText = data.stats.total_trips_completed;
            document.getElementById('stat-rating').innerText = `★ ${data.stats.average_rating}`;
            
            // Only update toggle if we aren't overriding it locally during a trip
            if(data.stats.availability_status !== 'On Trip') {
                setStatusUI(data.stats.availability_status);
            }
        }
    }

    async function toggleStatus() {
        if (currentStatus === 'On Trip') return; // Cannot toggle while driving
        
        const newStatus = currentStatus === 'Offline' ? 'Online' : 'Offline';
        const res = await fetch('/api/driver/toggle-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });

        if(res.ok) {
            setStatusUI(newStatus);
        }
    }

    function setStatusUI(status) {
        currentStatus = status;
        const btn = document.getElementById('status-toggle');
        
        // Reset classes
        btn.className = '';
        
        if(status === 'Online') {
            btn.classList.add('btn-online');
            btn.innerText = '🟢 ONLINE - FINDING RIDES...';
            startPolling();
        } else if (status === 'Offline') {
            btn.classList.add('btn-offline');
            btn.innerText = '🔴 OFFLINE';
            stopPolling();
            document.getElementById('request-card').style.display = 'none';
        } else if (status === 'On Trip') {
            btn.classList.add('btn-ontrip');
            btn.innerText = '🚕 ON TRIP';
            stopPolling();
        }
    }

    // Polling System
    function startPolling() {
        if(pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(checkForRequests, 5000); // Check every 5 seconds
    }

    function stopPolling() {
        if(pollInterval) clearInterval(pollInterval);
    }

    async function checkForRequests() {
        if(currentStatus !== 'Online') return;

        const res = await fetch('/api/driver/incoming-rides');
        const data = await res.json();

        const reqCard = document.getElementById('request-card');
        if(data.success && data.request) {
            currentRideId = data.request.ride_id;
            document.getElementById('req-route').innerText = `${data.request.pickup} ➔ ${data.request.dropoff}`;
            document.getElementById('req-details').innerText = `${data.request.distance_km} km • ${data.request.duration_minutes} mins • Rs. ${data.request.fare}`;
            reqCard.style.display = 'block';
        } else {
            reqCard.style.display = 'none';
        }
    }

    async function acceptRide() {
        if(!currentRideId) return;

        const res = await fetch('/api/driver/accept-ride', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ride_id: currentRideId })
        });

        if(res.ok) {
            document.getElementById('request-card').style.display = 'none';
            setStatusUI('On Trip');
            await checkActiveTrip();
        }
    }

    async function checkActiveTrip() {
        const res = await fetch('/api/driver/active-trip');
        const data = await res.json();
        
        const activeCard = document.getElementById('active-trip-card');
        
        if(data.success && data.trip) {
            currentRideId = data.trip.ride_id;
            setStatusUI('On Trip');
            activeCard.style.display = 'block';
            
            document.getElementById('trip-status').innerText = data.trip.status;
            document.getElementById('trip-route').innerText = `${data.trip.pickup} ➔ ${data.trip.dropoff}`;
            document.getElementById('trip-fare').innerText = data.trip.fare;

            // Button visibility logic based on state
            document.getElementById('btn-enroute').style.display = data.trip.status === 'ACCEPTED' ? 'block' : 'none';
            document.getElementById('btn-inprogress').style.display = data.trip.status === 'DRIVER EN ROUTE' ? 'block' : 'none';
            document.getElementById('btn-completed').style.display = data.trip.status === 'IN PROGRESS' ? 'block' : 'none';

        } else {
            activeCard.style.display = 'none';
            
            // 🚨 FIX: If they were on a trip and it's gone, they just successfully finished it. 
            // Put the UI back online and start listening for the next rider immediately!
            if(currentStatus === 'On Trip') {
                setStatusUI('Online'); 
            }
            await loadStats(); // Refresh earnings!
        }
    }

    async function updateRideStatus(new_status) {
        if(!currentRideId) return;

        await fetch('/api/driver/update-ride-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ride_id: currentRideId, new_status })
        });

        await checkActiveTrip();
    }

    async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        localStorage.clear();
        window.location.href = '/';
    }
});