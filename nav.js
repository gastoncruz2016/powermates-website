/* ═══════════════════════════════════════════════════════════════════════════
   POWERMATES — Shared Navigation Script
   Handles: hamburger toggle, dropdown behavior, scroll state, reveal animations
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Mobile hamburger toggle ────────────────────────────────────────────
  const btn = document.querySelector('.hamburger');
  const nav = document.querySelector('.nav-links');

  if (btn && nav) {
    btn.addEventListener('click', function () {
      btn.classList.toggle('open');
      nav.classList.toggle('open');
      document.body.classList.toggle('nav-open');
    });
  }

  // Close mobile menu when clicking a link
  if (nav) {
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        if (btn) btn.classList.remove('open');
        nav.classList.remove('open');
        document.body.classList.remove('nav-open');
      });
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav && nav.classList.contains('open')) {
      btn.classList.remove('open');
      nav.classList.remove('open');
      document.body.classList.remove('nav-open');
    }
  });

  // ── Nav scroll state ───────────────────────────────────────────────────
  const navEl = document.querySelector('nav');
  if (navEl) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 60) {
        navEl.classList.add('scrolled');
      } else {
        navEl.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  // ── Mobile dropdown toggles ────────────────────────────────────────────
  if (window.innerWidth < 768) {
    document.querySelectorAll('.nav-dropdown-trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function (e) {
        if (window.innerWidth < 768) {
          e.preventDefault();
          var dropdown = this.parentElement.querySelector('.nav-dropdown');
          if (dropdown) {
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
          }
        }
      });
    });
  }

  // ── Scroll reveal (IntersectionObserver) ───────────────────────────────
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach(function (el) {
    io.observe(el);
  });

  // ── FAQ accordion ─────────────────────────────────────────────────────
  document.querySelectorAll('.faq-question').forEach(function (q) {
    q.addEventListener('click', function () {
      var item = this.closest('.faq-item');
      var answer = item.querySelector('.faq-answer');
      var isOpen = item.classList.contains('open');

      // Close all others
      document.querySelectorAll('.faq-item.open').forEach(function (openItem) {
        openItem.classList.remove('open');
        var a = openItem.querySelector('.faq-answer');
        if (a) a.style.display = 'none';
      });

      if (!isOpen) {
        item.classList.add('open');
        if (answer) answer.style.display = 'block';
      }
    });
  });

  // ── Active nav link highlight ─────────────────────────────────────────
  var currentPath = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === '/')) {
      a.classList.add('active');
    }
  });
})();
