// Global fetch interceptor: auto-reconnect on 401 using stored auth token
(function() {
  const originalFetch = window.fetch;
  let reconnecting = false;

  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    if (response.status === 401 && !reconnecting && window.location.pathname !== '/') {
      const token = localStorage.getItem('authToken');
      if (token) {
        reconnecting = true;
        try {
          const reconnectRes = await originalFetch('/api/auto-reconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          if (reconnectRes.ok) {
            const data = await reconnectRes.json();
            if (data.authToken) localStorage.setItem('authToken', data.authToken);
            reconnecting = false;
            // Retry the original request now that session is restored
            return originalFetch.apply(this, args);
          }
        } catch (e) {
          // Reconnect failed
        }
        reconnecting = false;
        // Token invalid, clean up and redirect
        localStorage.removeItem('authToken');
      }
      window.location.href = '/';
    }

    return response;
  };
})();
