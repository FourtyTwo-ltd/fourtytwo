/* ===== 42 — Lightweight PJAX Navigation =====
   Intercepts clicks on internal page links and swaps document.body's
   content via fetch() instead of a real browser navigation. Because
   the document itself never reloads, audio.js's persistent Audio
   object (and any other top-level JS state) survives every internal
   click untouched — that's what makes background audio genuinely
   continuous across Directory / Clothing / Calendar / Events / About,
   not just "resumes from the same position" but literally the same
   still-playing <audio> element.

   Falls back to a real navigation (window.location.href) if fetch
   fails for any reason, so the site still works with this disabled. */
(function () {
    var PAGES = ['index.html', 'clothing.html', 'calendar.html', 'events.html', 'about.html', 'privacy.html', 'terms.html'];
    var isNavigating = false;

    function isInternalLink(a) {
        if (!a) return false;
        var raw = a.getAttribute('href') || '';
        if (raw === '' || raw.charAt(0) === '#') return false; // in-page / placeholder links
        if (a.target && a.target !== '' && a.target !== '_self') return false;
        if (a.hasAttribute('download')) return false;

        var url;
        try {
            url = new URL(a.href, window.location.href);
        } catch (e) {
            return false;
        }
        if (url.origin !== window.location.origin) return false;

        var last = url.pathname.split('/').pop();
        if (last === '') last = 'index.html';
        return PAGES.indexOf(last) !== -1;
    }

    // Reconciles <link rel="stylesheet"> tags to exactly match the target
    // page: adds what's missing AND removes what the new page doesn't
    // load. Without the removal step, a page-specific stylesheet (e.g.
    // directory.css, which locks body to position:fixed/overflow:hidden
    // for the non-scrolling Directory Gateway) stays linked forever once
    // added, silently breaking scroll on every page navigated to
    // afterward until a hard refresh clears it.
    function syncStylesheets(headDoc) {
        var targetHrefs = Array.prototype.map.call(
            headDoc.querySelectorAll('link[rel="stylesheet"]'),
            function (l) { return l.href; }
        );

        Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]')).forEach(function (link) {
            if (targetHrefs.indexOf(link.href) === -1) {
                link.parentNode.removeChild(link);
            }
        });

        var existingHrefs = Array.prototype.map.call(
            document.querySelectorAll('link[rel="stylesheet"]'),
            function (l) { return l.href; }
        );
        headDoc.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
            if (existingHrefs.indexOf(link.href) === -1) {
                var clone = document.createElement('link');
                clone.rel = 'stylesheet';
                clone.href = link.href;
                document.head.appendChild(clone);
            }
        });
    }

    function runScriptsSequentially(scripts, index, done) {
        if (index >= scripts.length) { done(); return; }
        var old = scripts[index];

        // Never re-run the persistent audio engine, this router itself, or
        // the analytics wrapper — re-executing audio.js would spawn a
        // second Audio object, and re-executing analytics.js would rebind
        // a duplicate click listener on every navigation. pjax calls
        // Analytics42.trackPageview() directly after each swap instead.
        if (old.src && /\/(audio|pjax|analytics)\.js(\?|$)/.test(old.src)) {
            runScriptsSequentially(scripts, index + 1, done);
            return;
        }

        var s = document.createElement('script');
        if (old.src) {
            s.src = old.src;
            s.onload = function () { runScriptsSequentially(scripts, index + 1, done); };
            s.onerror = function () { runScriptsSequentially(scripts, index + 1, done); };
            document.body.appendChild(s);
        } else {
            s.textContent = old.textContent;
            document.body.appendChild(s); // inline scripts execute synchronously on insertion
            runScriptsSequentially(scripts, index + 1, done);
        }
    }

    function swapBody(doc, done) {
        var scripts = Array.prototype.slice.call(doc.body.querySelectorAll('script'));
        scripts.forEach(function (s) { s.parentNode.removeChild(s); });

        // Clear any stateful classes a previous page left on <body>
        // (e.g. Calendar's single-date view) so the new page starts clean.
        document.body.className = '';
        document.body.innerHTML = doc.body.innerHTML;

        runScriptsSequentially(scripts, 0, done);
    }

    function navigate(url, push) {
        if (isNavigating) return;
        isNavigating = true;

        fetch(url, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) throw new Error('pjax fetch failed: ' + res.status);
                return res.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var parsedUrl = new URL(url, window.location.href);

                document.title = doc.title;
                syncStylesheets(doc.head);

                swapBody(doc, function () {
                    if (window.Audio42) window.Audio42.reinitWidgets();
                    if (window.Analytics42) window.Analytics42.trackPageview();

                    if (push) {
                        history.pushState({ pjax: true }, doc.title, url);
                    }

                    if (parsedUrl.hash) {
                        var target = document.getElementById(parsedUrl.hash.slice(1));
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        } else {
                            window.scrollTo(0, 0);
                        }
                    } else {
                        window.scrollTo(0, 0);
                    }

                    isNavigating = false;
                });
            })
            .catch(function () {
                isNavigating = false;
                window.location.href = url; // real navigation fallback
            });
    }

    document.body.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest('a');
        if (!isInternalLink(a)) return;
        if (a.href === window.location.href) return; // same page, no-op

        e.preventDefault();
        navigate(a.href, true);
    });

    window.addEventListener('popstate', function () {
        navigate(window.location.href, false);
    });
})();
