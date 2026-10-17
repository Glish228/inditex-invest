// ─── AUTH ADMIN ───────────────────────────────────────────
function checkAdminAuth() {
  const admin = localStorage.getItem('inditex_admin');
  if (!admin) {
    window.location.href = 'login.html';
    return;
  }
}

function adminLogout() {
  if (confirm('Voulez-vous vous déconnecter ?')) {
    localStorage.removeItem('inditex_admin');
    window.location.href = 'login.html';
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

document.addEventListener('click', function(e) {
  const sidebar = document.getElementById('sidebar');
  const menuBtn = document.querySelector('.menu-btn');
  if (sidebar && menuBtn) {
    if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  }
});

// ─── UTILITAIRES ADMIN ────────────────────────────────────
function showAdminAlert(elId, msg, type = 'danger') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className   = `alert alert-${type} show`;
  setTimeout(() => el.classList.remove('show'), 4000);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  });
}