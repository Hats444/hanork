'use strict';

/** Shared HTML escaping for admin dashboard (XSS P0-1). */
(function (global) {
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return esc(s).replace(/'/g, '&#39;');
  }

  function escUrl(u) {
    const s = String(u ?? '');
    return /^https?:\/\//i.test(s) ? esc(s) : '';
  }

  function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)dashboard_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function csrfHeaders(headers = {}) {
    const token = getCsrfToken();
    if (!token) return headers;
    return { ...headers, 'X-CSRF-Token': token };
  }

  global.HanorkAdminUtils = { esc, escAttr, escUrl, getCsrfToken, csrfHeaders };
})(typeof window !== 'undefined' ? window : global);
