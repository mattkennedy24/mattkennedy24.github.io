/*
	mattkennedy24.github.io — site behaviour (vanilla JS, no dependencies).
	Everything here is progressive enhancement: with JS off, the content is
	all visible and the form still posts normally.
*/
(function () {
	'use strict';

	var doc = document;
	var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function qs(sel, ctx) { return (ctx || doc).querySelector(sel); }
	function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

	/* Mobile menu ---------------------------------------------------------- */
	var toggle = qs('.nav-toggle');
	var nav = qs('#site-nav');
	if (toggle && nav) {
		var setMenu = function (open) {
			nav.classList.toggle('is-open', open);
			toggle.setAttribute('aria-expanded', String(open));
			toggle.textContent = open ? 'Close' : 'Menu';
		};
		toggle.addEventListener('click', function () { setMenu(!nav.classList.contains('is-open')); });
		qsa('a', nav).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
		doc.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); }
		});
	}

	/* Scroll reveal + figure animation ------------------------------------- */
	var revealEls = qsa('.reveal');
	if ('IntersectionObserver' in window && !reduceMotion) {
		var revealObserver = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					entry.target.classList.add('in');
					revealObserver.unobserve(entry.target);
				}
			});
		}, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
		revealEls.forEach(function (el) { revealObserver.observe(el); });
	} else {
		revealEls.forEach(function (el) { el.classList.add('in'); });
	}

	/* Current section in the nav ------------------------------------------- */
	var navLinks = qsa('.nav-list a[href^="#"]');
	if (navLinks.length && 'IntersectionObserver' in window) {
		var sections = navLinks
			.map(function (a) { return qs(a.getAttribute('href')); })
			.filter(Boolean);
		var currentObserver = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (!entry.isIntersecting) { return; }
				navLinks.forEach(function (a) {
					if (a.getAttribute('href') === '#' + entry.target.id) { a.setAttribute('aria-current', 'true'); }
					else { a.removeAttribute('aria-current'); }
				});
			});
		}, { rootMargin: '-45% 0px -50% 0px' });
		sections.forEach(function (s) { currentObserver.observe(s); });

		// Back at the very top (the hero has no nav link): clear the highlight
		var hero = qs('#top');
		if (hero) {
			new IntersectionObserver(function (entries) {
				if (entries[0].isIntersecting) { navLinks.forEach(function (a) { a.removeAttribute('aria-current'); }); }
			}, { rootMargin: '-45% 0px -50% 0px' }).observe(hero);
		}
	}

	/* Videos: honour reduced-motion (no autoplay) -------------------------- */
	if (reduceMotion) {
		qsa('video[autoplay]').forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); });
	}

	/* Ask GM: prefill the contact message ---------------------------------- */
	qsa('[data-prefill]').forEach(function (link) {
		link.addEventListener('click', function () {
			var message = qs('#message');
			if (message && !message.value.trim()) { message.value = link.getAttribute('data-prefill'); }
			window.setTimeout(function () {
				var name = qs('#name');
				if (name) { name.focus({ preventScroll: true }); }
			}, reduceMotion ? 0 : 900);
		});
	});

	/* Contact form: send in the background, answer in place ---------------- */
	var form = qs('#contact-form');
	if (form && window.fetch && window.FormData) {
		var status = qs('#form-status');
		var button = qs('button[type="submit"]', form);
		var say = function (text, state) {
			status.textContent = text;
			status.setAttribute('data-state', state);
		};
		form.addEventListener('submit', function (e) {
			if (!form.checkValidity()) { return; }   // let the browser show its own validation
			e.preventDefault();
			button.disabled = true;
			say('Sending…', 'busy');
			fetch(form.action, {
				method: 'POST',
				body: new FormData(form),
				headers: { 'Accept': 'application/json' }
			}).then(function (res) {
				if (res.ok) {
					form.reset();
					say('Thanks! Your message is on its way.', 'ok');
				} else {
					throw new Error('bad status');
				}
			}).catch(function () {
				say('Something went wrong sending that. Please try again in a moment, or message me on LinkedIn.', 'error');
			}).then(function () {
				button.disabled = false;
			});
		});
	}

	/* Travel carousel ------------------------------------------------------- */
	var carousel = qs('.carousel');
	if (carousel) {
		var slides = qsa('.slide', carousel);
		var dots = qsa('.dot', carousel);
		var caption = qs('.carousel__caption', carousel);
		var counter = qs('.carousel__count', carousel);
		var playBtn = qs('[data-carousel="play"]', carousel);
		var interval = parseInt(carousel.getAttribute('data-interval'), 10) || 4500;
		var index = 0;
		var timer = null;
		var userPaused = reduceMotion;   // never auto-advance for people who asked for less motion
		var hovering = false;

		var show = function (i) {
			index = (i + slides.length) % slides.length;
			slides.forEach(function (s, n) {
				var on = n === index;
				s.classList.toggle('is-active', on);
				s.setAttribute('aria-hidden', String(!on));
			});
			dots.forEach(function (d, n) {
				if (n === index) { d.setAttribute('aria-current', 'true'); } else { d.removeAttribute('aria-current'); }
			});
			caption.textContent = slides[index].getAttribute('data-caption');
			counter.textContent = (index + 1) + ' of ' + slides.length;
		};

		var stop = function () { if (timer) { window.clearInterval(timer); timer = null; } };
		var start = function () {
			stop();
			if (!userPaused && !hovering && !doc.hidden) {
				timer = window.setInterval(function () { show(index + 1); }, interval);
			}
		};
		var setPlayLabel = function () {
			playBtn.textContent = userPaused ? '▶' : '❚❚';
			playBtn.setAttribute('aria-label', userPaused ? 'Play slideshow' : 'Pause slideshow');
			carousel.setAttribute('aria-live', userPaused ? 'polite' : 'off');
		};

		qs('[data-carousel="prev"]', carousel).addEventListener('click', function () { show(index - 1); start(); });
		qs('[data-carousel="next"]', carousel).addEventListener('click', function () { show(index + 1); start(); });
		playBtn.addEventListener('click', function () { userPaused = !userPaused; setPlayLabel(); start(); });
		dots.forEach(function (d, n) { d.addEventListener('click', function () { show(n); start(); }); });

		carousel.addEventListener('mouseenter', function () { hovering = true; stop(); });
		carousel.addEventListener('mouseleave', function () { hovering = false; start(); });
		carousel.addEventListener('focusin', function () { hovering = true; stop(); });
		carousel.addEventListener('focusout', function () { hovering = false; start(); });
		doc.addEventListener('visibilitychange', start);

		carousel.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowLeft') { show(index - 1); start(); }
			else if (e.key === 'ArrowRight') { show(index + 1); start(); }
		});

		// Swipe
		var stage = qs('.carousel__stage', carousel);
		var startX = null;
		stage.addEventListener('pointerdown', function (e) { startX = e.clientX; });
		stage.addEventListener('pointerup', function (e) {
			if (startX === null) { return; }
			var dx = e.clientX - startX;
			startX = null;
			if (Math.abs(dx) > 40) { show(index + (dx < 0 ? 1 : -1)); start(); }
		});
		stage.addEventListener('pointercancel', function () { startX = null; });

		show(0);
		setPlayLabel();
		start();
	}

	/* Performance review viewer -------------------------------------------- */
	var viewer = qs('.viewer');
	if (viewer) {
		var pages = JSON.parse(viewer.getAttribute('data-pages'));
		var img = qs('.viewer__page img', viewer);
		var prev = qs('[data-viewer="prev"]', viewer);
		var next = qs('[data-viewer="next"]', viewer);
		var count = qs('.viewer__count', viewer);
		var page = 0;
		var render = function () {
			img.src = pages[page];
			img.alt = 'Performance review, page ' + (page + 1) + ' of ' + pages.length;
			count.textContent = 'Page ' + (page + 1) + ' of ' + pages.length;
			prev.disabled = page === 0;
			next.disabled = page === pages.length - 1;
		};
		prev.addEventListener('click', function () { if (page > 0) { page--; render(); } });
		next.addEventListener('click', function () { if (page < pages.length - 1) { page++; render(); } });
		doc.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowLeft' && page > 0) { page--; render(); }
			else if (e.key === 'ArrowRight' && page < pages.length - 1) { page++; render(); }
		});
		render();
	}

	/* Internship: load the YouTube demo only when asked (faster, more private) */
	var demoBtn = qs('[data-demo]');
	if (demoBtn) {
		demoBtn.addEventListener('click', function () {
			var holder = qs('#demo-frame');
			var iframe = doc.createElement('iframe');
			iframe.src = 'https://www.youtube-nocookie.com/embed/' + demoBtn.getAttribute('data-demo') + '?autoplay=1&rel=0';
			iframe.title = 'Demo of the UWIN recordings validation page';
			iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
			iframe.allowFullscreen = true;
			holder.appendChild(iframe);
			holder.hidden = false;
			demoBtn.hidden = true;
		});
	}
})();
