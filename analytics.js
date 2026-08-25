/* ===== 42 — Analytics Wrapper =====
   Thin, provider-agnostic tracking layer. GA_MEASUREMENT_ID is left
   blank on purpose: no real ID exists yet, and this file must never
   ship a placeholder/fake ID or any secret key. Until a real
   measurement ID is set here, track() just no-ops (with a console
   note on localhost) instead of loading a live third-party script.

   Loaded once per real page load — like audio.js/pjax.js, it's on
   pjax.js's re-execution skip-list, so it survives internal
   navigation without rebinding duplicate click listeners. pjax.js
   calls window.Analytics42.trackPageview() after each swap instead. */
(function () {
    var GA_MEASUREMENT_ID = ''; // e.g. 'G-XXXXXXXXXX' — set before going live.
    var gtagLoaded = false;

    function loadGtag() {
        if (gtagLoaded || !GA_MEASUREMENT_ID) return;
        gtagLoaded = true;
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', GA_MEASUREMENT_ID);
    }

    function track(eventName, params) {
        params = params || {};
        if (GA_MEASUREMENT_ID) {
            loadGtag();
            if (window.gtag) window.gtag('event', eventName, params);
        } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.info('[analytics]', eventName, params);
        }
    }

    function trackPageview() {
        track('page_view', {
            page_path: window.location.pathname,
            page_title: document.title
        });
    }

    // Delegated CTA / booking-link tracking — bound once on document.body
    // so it works across every pjax-swapped page without rebinding.
    document.body.addEventListener('click', function (e) {
        var a = e.target.closest('a');
        if (!a) return;
        var href = a.getAttribute('href') || '';

        if (a.matches('.ev-hero-cta, .ev-card-cta, .cal-featured-cta, .cal-simple-cta')) {
            track('cta_get_tickets', { link_text: a.textContent.trim(), page_path: window.location.pathname });
        } else if (a.matches('.ev-card-book-btn')) {
            track('table_booking_click', {
                method: href.indexOf('tel:') === 0 ? 'call' : 'email',
                page_path: window.location.pathname
            });
        } else if (href.indexOf('tel:') === 0) {
            track('phone_click', { page_path: window.location.pathname });
        } else if (href.indexOf('mailto:') === 0) {
            track('email_click', { page_path: window.location.pathname });
        }

        var listRow = a.closest('.cal-simple-row');
        if (listRow) {
            track('calendar_list_interaction', {
                event_name: (listRow.querySelector('.cal-simple-name') || {}).textContent || '',
                page_path: window.location.pathname
            });
        }
    });

    window.Analytics42 = { track: track, trackPageview: trackPageview };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', trackPageview);
    } else {
        trackPageview();
    }
})();
