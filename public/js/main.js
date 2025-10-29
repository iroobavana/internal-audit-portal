// Auto-hide alerts after 5 seconds
document.addEventListener('DOMContentLoaded', function() {
  console.log('Fade transitions loaded!'); // ADD THIS LINE
  
  const links = document.querySelectorAll('a:not([target="_blank"]):not([href^="#"])');
  console.log('Found ' + links.length + ' links'); // ADD THIS LINE TOO
  setTimeout(function() {
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(function(alert) {
      const bsAlert = new bootstrap.Alert(alert);
      bsAlert.close();
    });
  }, 5000);
});

// Confirm delete actions
function confirmDelete(message) {
  return confirm(message || 'Are you sure you want to delete this item?');
}

// Form validation
(function() {
  'use strict';
  const forms = document.querySelectorAll('.needs-validation');
  Array.from(forms).forEach(function(form) {
    form.addEventListener('submit', function(event) {
      if (!form.checkValidity()) {
        event.preventDefault();
        event.stopPropagation();
      }
      form.classList.add('was-validated');
    }, false);
  });
})();
// Page Fade Transitions
document.addEventListener('DOMContentLoaded', function() {
  // Get all internal links
  const links = document.querySelectorAll('a:not([target="_blank"]):not([href^="#"])');
  
  links.forEach(link => {
    link.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      
      // Only apply to internal links (not external URLs)
      if (href && !href.startsWith('http') && !href.startsWith('mailto:')) {
        e.preventDefault();
        
        // Add fade-out class to body
        document.body.classList.add('page-transition');
        
        // Navigate after animation completes
        setTimeout(() => {
          window.location.href = href;
        }, 300); // Match the fadeOut animation duration
      }
    });
  });
});