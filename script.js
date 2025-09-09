// Mobile nav toggle
const navToggle = document.querySelector('.nav-toggle');
const navList = document.getElementById('nav-list');
if (navToggle && navList) {
  navToggle.addEventListener('click', () => {
    const open = navList.classList.toggle('show');
    navToggle.setAttribute('aria-expanded', String(open));
  });
}

// Smooth scrolling for same-page anchors
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const href = a.getAttribute('href');
    if (!href || href === '#' || href.length < 2) return;
    const el = document.querySelector(href);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.pushState(null, '', href);
      navList?.classList.remove('show');
      navToggle?.setAttribute('aria-expanded', 'false');
    }
  });
});

// Subtle on-view reveal animation
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal');
        observer.unobserve(entry.target);
      }
    }
  },
  { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
);

document.querySelectorAll('.bulleted li, .numbered li, .install-code, .shot').forEach((el) => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  el.style.transition = 'opacity .5s ease, transform .5s ease';
  observer.observe(el);
});

document.addEventListener('animationstart', () => {
  // no-op: placeholder for future progressive enhancements
});
