document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorAlert = document.getElementById('error-alert');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Hide previous errors
        errorAlert.style.display = 'none';
        errorAlert.innerText = '';

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success) {
                // Store user session key local reference if needed, then route
                localStorage.setItem('userName', data.userName);
                localStorage.setItem('role', data.role);
                window.location.href = data.redirectUrl;
            } else {
                // Show errors matching the database logic (e.g. account suspension)
                errorAlert.innerText = data.message || 'Login failed.';
                errorAlert.style.display = 'block';
            }
        } catch (error) {
            console.error('Authentication Error:', error);
            errorAlert.innerText = 'Network error. Please try again.';
            errorAlert.style.display = 'block';
        }
    });
});