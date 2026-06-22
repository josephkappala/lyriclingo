// LyricLingo — Contact page

const form       = document.getElementById('contact-form');
const submitBtn  = document.getElementById('cf-submit-btn');
const errorEl    = document.getElementById('cf-error');
const successEl  = document.getElementById('cf-success');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name    = document.getElementById('cf-name').value.trim();
  const email   = document.getElementById('cf-email').value.trim();
  const subject = document.getElementById('cf-subject').value;
  const message = document.getElementById('cf-message').value.trim();

  // Simple client-side validation
  if (!name || !email || !message) {
    showError('Please fill in all required fields.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('Please enter a valid email address.');
    return;
  }

  hideStates();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';

  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, subject, message }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Something went wrong. Please try again.');
    }

    // Success
    form.reset();
    successEl.style.display = 'flex';
    successEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Message`;
  }
});

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'flex';
  successEl.style.display = 'none';
}

function hideStates() {
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';
}
