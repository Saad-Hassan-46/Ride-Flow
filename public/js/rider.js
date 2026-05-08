document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup UI
    const userName = localStorage.getItem('userName') || 'Rider';
    document.getElementById('user-greeting').innerText = `Welcome, ${userName}`;

    let currentEstimate = null; // Store estimate data globally

    // 2. Fetch Data on Load
    await loadLocations();
    await checkActiveRide();
    await loadHistory();

    // 3. Event Listeners
    document.getElementById('btn-estimate').addEventListener('click', getEstimate);
    document.getElementById('booking-form').addEventListener('submit', bookRide);
    document.getElementById('logout-btn').addEventListener('click', logout);

    // -- Functions --

    async function loadLocations() {
        const res = await fetch('/api/locations');
        const data = await res.json();
        if(data.success) {
            const pickup = document.getElementById('pickup-select');
            const dropoff = document.getElementById('dropoff-select');
            
            pickup.innerHTML = '<option value="">Select Pickup...</option>';
            dropoff.innerHTML = '<option value="">Select Destination...</option>';
            
            data.locations.forEach(loc => {
                const opt = `<option value="${loc.location_id}">${loc.address_label} (${loc.city})</option>`;
                pickup.innerHTML += opt;
                dropoff.innerHTML += opt;
            });
        }
    }

    async function getEstimate() {
        const pickup_id = document.getElementById('pickup-select').value;
        const dropoff_id = document.getElementById('dropoff-select').value;

        if(!pickup_id || !dropoff_id) {
            alert('Please select both locations first.');
            return;
        }
        if(pickup_id === dropoff_id) {
            alert('Pickup and drop-off cannot be the same.');
            return;
        }

        const res = await fetch('/api/rides/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pickup_id, dropoff_id })
        });
        const data = await res.json();

        if(data.success) {
            currentEstimate = data; // Save for booking
            
            document.getElementById('display-fare').innerText = data.fare;
            document.getElementById('display-metrics').innerText = `${data.distance_km} km • ${data.duration_minutes} mins`;
            
            document.getElementById('estimate-result').style.display = 'block';
            document.getElementById('btn-estimate').style.display = 'none';
            document.getElementById('btn-book').style.display = 'block';
        }
    }

    async function bookRide(e) {
        e.preventDefault();
        if(!currentEstimate) return;

        const pickup_id = document.getElementById('pickup-select').value;
        const dropoff_id = document.getElementById('dropoff-select').value;

        const res = await fetch('/api/rides/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pickup_id, dropoff_id,
                distance_km: currentEstimate.distance_km,
                duration_minutes: currentEstimate.duration_minutes,
                fare: currentEstimate.fare
            })
        });

        const data = await res.json();
        if(data.success) {
            alert('Ride Requested Successfully! Waiting for a driver.');
            // Reset form
            document.getElementById('estimate-result').style.display = 'none';
            document.getElementById('btn-estimate').style.display = 'block';
            document.getElementById('btn-book').style.display = 'none';
            document.getElementById('booking-form').reset();
            currentEstimate = null;
            
            // Refresh dashboard
            await checkActiveRide();
            await loadHistory();
        }
    }

    async function checkActiveRide() {
        const res = await fetch('/api/rides/active');
        const data = await res.json();
        const activeCard = document.getElementById('active-ride-card');
        
        if(data.success && data.activeRide) {
            activeCard.style.display = 'block';
            document.getElementById('active-status').innerText = data.activeRide.ride_status;
            document.getElementById('active-driver').innerText = data.activeRide.driver_name || 'Pending...';
            document.getElementById('active-vehicle').innerText = data.activeRide.vehicle || 'Pending...';
            document.getElementById('active-fare').innerText = data.activeRide.fare;
        } else {
            activeCard.style.display = 'none';
        }
    }

    async function loadHistory() {
        const res = await fetch('/api/rides/history');
        const data = await res.json();
        const tbody = document.getElementById('history-table-body');
        tbody.innerHTML = '';

        if(data.success) {
            data.history.forEach(ride => {
                const statusClass = ride.status === 'COMPLETED' ? 'status-completed' : '';
                tbody.innerHTML += `
                    <tr>
                        <td>${ride.ride_date}</td>
                        <td>${ride.pickup_location} → ${ride.dropoff_location}</td>
                        <td>${ride.driver_name}</td>
                        <td>Rs. ${ride.fare}</td>
                        <td><span class="status-badge ${statusClass}">${ride.status}</span></td>
                    </tr>
                `;
            });
        }
    }

    async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        localStorage.clear();
        window.location.href = '/';
    }
});