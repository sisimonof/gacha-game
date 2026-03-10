// Global fetch interceptor: redirect to login on 401 instead of showing raw JSON
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    if (response.status === 401) {
      // Avoid redirect loop on login page
      if (window.location.pathname !== '/') {
        window.location.href = '/';
      }
    }
    return response;
  };
})();
