/* ===== 42 — Lightweight PJAX Navigation =====
   Intercepts clicks on internal page links and swaps document.body's
   content via fetch() instead of a real browser navigation. Because
   the document itself never reloads, audio.js's persistent Audio
   object (and any other top-level JS state) survives every internal
   click untouched — that's what makes background audio genuinely
   continuous across Directory / Clothing / Calendar / Events / About,
   not just "resumes from the same position" but literally the same
   still-playing <audio> element.

   A brief full-screen loader (solid background + logo) covers every
   navigation. It isn't there to be fast — it's there so the swap
   never becomes visible mid-flight: the previous version of this
   file swapped in the new body before the new page's stylesheets had
   actually finished downloading, so for a beat the browser rendered
   the new markup in default unstyled black-serif-on-white. The loader
   now stays up until every new stylesheet has fired load/error AND
   the new page's scripts have run, so what's revealed underneath it
   is always fully styled.

   Falls back to a real navigation (window.location.href) if fetch
   fails for any reason, so the site still works with this disabled. */
(function () {
    var PAGES = ['index.html', 'clothing.html', 'calendar.html', 'events.html', 'about.html', 'contact.html', 'privacy.html', 'terms.html'];
    var isNavigating = false;
    var MIN_LOADER_MS = 350;
    var loaderEl = null;

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

    // Built with inline styles (not a CSS class) and attached to <html>
    // rather than <body> — it must render correctly even before any
    // page-specific stylesheet has loaded, and it must survive
    // swapBody() replacing document.body.innerHTML wholesale.
    function getLoader() {
        if (loaderEl) return loaderEl;

        loaderEl = document.createElement('div');
        loaderEl.setAttribute('aria-hidden', 'true');
        loaderEl.style.cssText =
            'position:fixed;inset:0;z-index:2147483647;' +
            'background:#0D0D0E;display:flex;align-items:center;justify-content:center;' +
            'opacity:0;pointer-events:none;transition:opacity 0.25s ease;';

        var img = document.createElement('img');
        img.src = 'assets/42logowhite.png';
        img.alt = '';
        img.style.cssText = 'width:64px;height:auto;opacity:0.92;';
        loaderEl.appendChild(img);

        document.documentElement.appendChild(loaderEl);
        return loaderEl;
    }

    function showLoader() {
        var el = getLoader();
        el.style.pointerEvents = 'auto';
        requestAnimationFrame(function () { el.style.opacity = '1'; });
    }

    function hideLoader() {
        if (!loaderEl) return;
        loaderEl.style.opacity = '0';
        loaderEl.style.pointerEvents = 'none';
    }

    // Reconciles <link rel="stylesheet"> tags to exactly match the target
    // page (adds what's missing, removes what the new page doesn't load —
    // without the removal step a page-specific stylesheet like
    // directory.css, which locks body to position:fixed/overflow:hidden
    // for the non-scrolling Directory Gateway, stays linked forever and
    // silently breaks scroll on every later page). Returns a Promise that
    // resolves once every newly-added stylesheet has actually loaded (or
    // failed), so callers can wait for real styling to be in place.
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

        var loadPromises = [];
        headDoc.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
            if (existingHrefs.indexOf(link.href) === -1) {
                var clone = document.createElement('link');
                clone.rel = 'stylesheet';
                clone.href = link.href;
                loadPromises.push(new Promise(function (resolve) {
                    clone.onload = resolve;
                    clone.onerror = resolve; // never let a broken stylesheet hang navigation
                }));
                document.head.appendChild(clone);
            }
        });

        return Promise.all(loadPromises);
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

    // Waits for every <img> currently in the document to finish loading
    // (or fail) before resolving, capped at a timeout so one slow or
    // broken image can never hold the loader up indefinitely — the goal
    // is "don't reveal a page that's still visibly popping images in,"
    // not "wait forever."
    function waitForImages(timeoutMs) {
        var imgs = Array.prototype.filter.call(document.querySelectorAll('img'), function (img) {
            return !img.complete;
        });
        if (!imgs.length) return Promise.resolve();

        var loadPromise = Promise.all(imgs.map(function (img) {
            return new Promise(function (resolve) {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
            });
        }));

        var timeoutPromise = new Promise(function (resolve) {
            setTimeout(resolve, timeoutMs);
        });

        return Promise.race([loadPromise, timeoutPromise]);
    }

    function swapBody(doc) {
        return new Promise(function (resolve) {
            var scripts = Array.prototype.slice.call(doc.body.querySelectorAll('script'));
            scripts.forEach(function (s) { s.parentNode.removeChild(s); });

            // Clear any stateful classes a previous page left on <body>
            // (e.g. Calendar's single-date view) so the new page starts clean.
            document.body.className = '';
            document.body.innerHTML = doc.body.innerHTML;

            runScriptsSequentially(scripts, 0, resolve);
        });
    }

    function navigate(url, push) {
        if (isNavigating) return;
        isNavigating = true;
        showLoader();
        var shownAt = Date.now();

        fetch(url, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) throw new Error('pjax fetch failed: ' + res.status);
                return res.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var parsedUrl = new URL(url, window.location.href);
                document.title = doc.title;

                return syncStylesheets(doc.head)
                    .then(function () { return swapBody(doc); })
                    .then(function () {
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

                        // Everything is in place behind the loader (styles,
                        // scripts, DOM, scroll position) — hold it a little
                        // longer only for images still fetching, capped so a
                        // slow one can't strand the visitor on a black screen.
                        return waitForImages(1800);
                    })
                    .then(function () {
                        var remaining = Math.max(0, MIN_LOADER_MS - (Date.now() - shownAt));
                        setTimeout(function () {
                            hideLoader();
                            isNavigating = false;
                        }, remaining);
                    });
            })
            .catch(function () {
                hideLoader();
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
