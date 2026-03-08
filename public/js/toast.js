// toast.js — Global toast notification system
(function() {
  // Create container
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('toast-container')) {
      const c = document.createElement('div');
      c.id = 'toast-container';
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    initToastSocket();
  });

  const TYPES = {
    success:     { icon: '✓', cls: 'toast--success' },
    info:        { icon: 'ℹ', cls: 'toast--info' },
    warning:     { icon: '!', cls: 'toast--warning' },
    achievement: { icon: '★', cls: 'toast--achievement' },
    error:       { icon: '✗', cls: 'toast--error' },
    friend:      { icon: '👥', cls: 'toast--info' },
    chat:        { icon: '💬', cls: 'toast--info' }
  };

  window.showToast = function(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    const container = document.getElementById('toast-container');
    if (!container) return;
    const config = TYPES[type] || TYPES.info;

    const toast = document.createElement('div');
    toast.className = 'toast ' + config.cls;
    toast.innerHTML =
      '<span class="toast-icon">' + config.icon + '</span>' +
      '<span class="toast-message">' + message + '</span>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  function initToastSocket() {
    if (typeof io === 'undefined') return;

    // Delay to let page-specific sockets initialize first
    setTimeout(() => {
      if (window._toastSocket) return;

      let sock;
      if (window.pvpSocket) {
        sock = window.pvpSocket;
      } else {
        sock = io();
        window._toastSocket = sock;
      }

      sock.on('notification', function(data) {
        showToast(data.message, data.type || 'info');
      });
      sock.on('achievement:unlocked', function(data) {
        showToast('Succes debloque: ' + data.label + ' ' + (data.icon || ''), 'achievement', 6000);
      });
      sock.on('quest:completed', function(data) {
        showToast('Quete terminee: ' + data.label, 'success', 5000);
      });
    }, 500);
  }
})();
