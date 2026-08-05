// Touch feedback for buttons and interactive elements
document.addEventListener('DOMContentLoaded', function() {
  // Add touch feedback to buttons
  const buttons = document.querySelectorAll('.btn, .quick-action, .nav-item, .stat-card');
  buttons.forEach(button => {
    button.addEventListener('touchstart', function() {
      this.style.opacity = '0.7';
    });
    button.addEventListener('touchend', function() {
      this.style.opacity = '1';
    });
    button.addEventListener('touchcancel', function() {
      this.style.opacity = '1';
    });
  });

  // Auto-dismiss alerts after 5 seconds
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(alert => {
    setTimeout(() => {
      alert.style.transition = 'opacity 0.5s';
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 500);
    }, 5000);
  });

  // Form validation enhancement
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      const required = this.querySelectorAll('[required]');
      let valid = true;
      required.forEach(field => {
        if (!field.value.trim()) {
          field.style.borderColor = '#dc3545';
          valid = false;
        } else {
          field.style.borderColor = '';
        }
      });
      if (!valid) {
        e.preventDefault();
        alert('Please fill in all required fields.');
      }
    });
  });

  // Number input formatting for better mobile experience
  const numberInputs = document.querySelectorAll('input[type="number"]');
  numberInputs.forEach(input => {
    input.addEventListener('blur', function() {
      if (this.value) {
        const num = parseFloat(this.value);
        if (!isNaN(num)) {
          this.value = Math.round(num);
        }
      }
    });
  });

  // Save scroll position when navigating
  const navLinks = document.querySelectorAll('.nav-item, .quick-action');
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      sessionStorage.setItem('scrollPos', window.scrollY);
    });
  });

  // Restore scroll position
  if (sessionStorage.getItem('scrollPos')) {
    setTimeout(() => {
      window.scrollTo(0, parseInt(sessionStorage.getItem('scrollPos')));
      sessionStorage.removeItem('scrollPos');
    }, 100);
  }

  // PWA Installation prompt
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show install button if needed
    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
      installBtn.style.display = 'block';
      installBtn.addEventListener('click', () => {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('User accepted the install prompt');
          }
          deferredPrompt = null;
        });
      });
    }
  });

  // Network status indicator
  window.addEventListener('online', () => {
    const indicator = document.getElementById('networkStatus');
    if (indicator) {
      indicator.textContent = '🟢 Online';
      indicator.style.color = '#28a745';
    }
  });

  window.addEventListener('offline', () => {
    const indicator = document.getElementById('networkStatus');
    if (indicator) {
      indicator.textContent = '🔴 Offline';
      indicator.style.color = '#dc3545';
    }
  });

  console.log('BUKUYA Cooperative System loaded successfully!');
});
