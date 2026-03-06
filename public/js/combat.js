// combat.js — Hub page, minimal logic
async function checkAuth() {
  const res = await fetch('/api/me');
  if (!res.ok) window.location.href = '/';
}
checkAuth();
