document.addEventListener('DOMContentLoaded', async () => {
    
    // Init loads
    await loadMetrics();
    await loadRevenueReport();
    await loadFinancialsReport();
    await loadFlaggedDrivers();

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        localStorage.clear();
        window.location.href = '/';
    });

    // -- Fetch Functions --

    async function loadMetrics() {
        const res = await fetch('/api/admin/metrics');
        const data = await res.json();
        if(data.success) {
            document.getElementById('metric-rev').innerText = `Rs. ${data.revenue}`;
            document.getElementById('metric-rides').innerText = data.rides;
            document.getElementById('metric-drivers').innerText = data.activeDrivers;
        }
    }

    async function loadRevenueReport() {
        const res = await fetch('/api/admin/reports/revenue');
        const data = await res.json();
        const tbody = document.getElementById('table-revenue');
        tbody.innerHTML = '';
        if(data.success) {
            data.report.forEach(row => {
                tbody.innerHTML += `<tr>
                    <td><strong>${row.city}</strong></td>
                    <td>${row.total_completed_rides}</td>
                    <td style="color: var(--accent-primary);">Rs. ${row.total_revenue}</td>
                </tr>`;
            });
        }
    }

    async function loadFinancialsReport() {
        const res = await fetch('/api/admin/reports/financials');
        const data = await res.json();
        const tbody = document.getElementById('table-financials');
        tbody.innerHTML = '';
        if(data.success) {
            data.report.forEach(row => {
                tbody.innerHTML += `<tr>
                    <td>${row.full_name}</td>
                    <td>${row.total_trips}</td>
                    <td style="color: #00CCFF;">Rs. ${row.platform_commission}</td>
                    <td style="color: var(--accent-primary);">Rs. ${row.net_driver_earnings}</td>
                </tr>`;
            });
        }
    }

    async function loadFlaggedDrivers() {
        const res = await fetch('/api/admin/users/flagged');
        const data = await res.json();
        const tbody = document.getElementById('table-flagged');
        tbody.innerHTML = '';
        if(data.success) {
            data.flagged.forEach(row => {
                const isSuspended = row.account_status === 'Suspended';
                tbody.innerHTML += `<tr>
                    <td>${row.full_name}</td>
                    <td>${row.license_number}</td>
                    <td style="color: var(--accent-secondary); font-weight: bold;">★ ${row.avg_rating}</td>
                    <td>${row.account_status}</td>
                    <td>
                        <button class="btn-sm" onclick="suspendUser(${row.user_id})" ${isSuspended ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
                            ${isSuspended ? 'Already Suspended' : 'Suspend Account'}
                        </button>
                    </td>
                </tr>`;
            });
        }
    }
});

// Tab Switching Logic (Global function so inline onclick works)
function openTab(tabId) {
    // Remove active class from all tabs and contents
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to clicked tab and corresponding content
    event.currentTarget.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

// Suspend user logic (Global)
async function suspendUser(userId) {
    if(confirm("Are you sure you want to suspend this driver? They will immediately lose access to the platform.")) {
        const res = await fetch('/api/admin/users/suspend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_user_id: userId })
        });
        
        if(res.ok) {
            alert('Driver account suspended.');
            location.reload(); // Quick refresh to update the table state
        }
    }
}