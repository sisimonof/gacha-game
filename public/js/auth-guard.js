// Global fetch interceptor: redirect to login on 401 (session + cookie both expired)
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    if (response.status === 401 && window.location.pathname !== '/') {
      window.location.href = '/';
    }
    return response;
  };
})();
