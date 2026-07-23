/* Slide-out contact drawer — vanilla port of the moonwhale.media Vue drawer.
   Handles open/close (+ focus trap, Escape, backdrop), the click-to-reveal
   email card (address assembled here so it never sits in the HTML), Cloudflare
   Turnstile, and the JSON POST to /contact with success / field-error handling. */
(function () {
    'use strict';

    var drawer = document.querySelector('.mwm-drawer');
    var backdrop = document.querySelector('.mwm-backdrop');
    if (!drawer) return;

    var form = document.getElementById('mwm-form');
    var successEl = document.getElementById('mwm-success');
    var formError = document.getElementById('mwm-form-error');
    var submitBtn = document.getElementById('mwm-submit');
    var revealBtn = document.getElementById('mwm-email-reveal');
    var turnstileEl = document.getElementById('mwm-turnstile');

    var siteKey = (document.querySelector('meta[name="turnstile-site-key"]') || {}).content || '';
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

    var previousActive = null;
    var turnstileId = null;
    var turnstileToken = '';

    /* ---- open / close ---- */
    function open() {
        previousActive = document.activeElement;
        document.body.classList.add('mwm-contact-open');
        document.documentElement.style.overflow = 'hidden';
        drawer.setAttribute('aria-hidden', 'false');
        var first = form && form.querySelector('input[name="first_name"]');
        if (first) setTimeout(function () { first.focus(); }, 50);
        renderTurnstileWhenReady();
    }

    function close() {
        document.body.classList.remove('mwm-contact-open');
        document.documentElement.style.overflow = '';
        drawer.setAttribute('aria-hidden', 'true');
        if (previousActive && previousActive.focus) previousActive.focus();
        setTimeout(resetForm, 400);
    }

    function isOpen() {
        return document.body.classList.contains('mwm-contact-open');
    }

    /* ---- email reveal (assemble address client-side) ---- */
    if (revealBtn) {
        revealBtn.addEventListener('click', function () {
            var addr = revealBtn.getAttribute('data-email-user') + '@' + revealBtn.getAttribute('data-email-host');
            var a = document.createElement('a');
            a.className = 'mwm-card';
            a.href = 'mailto:' + addr;
            a.innerHTML =
                '<span class="mwm-card__icon" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></span>' +
                '<span class="mwm-card__body"><span class="mwm-card__title">' + addr + '</span>' +
                '<span class="mwm-card__meta mwm-copied" hidden>Copied to clipboard!</span></span>';
            a.addEventListener('click', function () {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(addr).catch(function () {});
                }
                var m = a.querySelector('.mwm-copied');
                if (m) { m.hidden = false; setTimeout(function () { m.hidden = true; }, 2500); }
            });
            revealBtn.parentNode.replaceChild(a, revealBtn);
        });
    }

    /* ---- Turnstile ---- */
    function renderTurnstile() {
        if (!siteKey || !window.turnstile || !turnstileEl || turnstileId !== null) return;
        turnstileId = window.turnstile.render(turnstileEl, {
            sitekey: siteKey,
            theme: 'dark',
            callback: function (t) { turnstileToken = t; },
            'expired-callback': function () { turnstileToken = ''; },
            'error-callback': function () { turnstileToken = ''; }
        });
    }
    function renderTurnstileWhenReady() {
        if (!siteKey) return;
        if (window.turnstile) { renderTurnstile(); return; }
        var started = Date.now();
        var poll = setInterval(function () {
            if (window.turnstile) { clearInterval(poll); renderTurnstile(); }
            else if (Date.now() - started > 8000) { clearInterval(poll); }
        }, 150);
    }
    function resetTurnstile() {
        turnstileToken = '';
        if (turnstileId !== null && window.turnstile) window.turnstile.reset(turnstileId);
    }

    /* ---- form ---- */
    function clearErrors() {
        if (formError) { formError.hidden = true; formError.textContent = ''; }
        var errs = form ? form.querySelectorAll('.mwm-field__err') : [];
        for (var i = 0; i < errs.length; i++) { errs[i].hidden = true; errs[i].textContent = ''; }
    }

    function resetForm() {
        if (!form) return;
        form.reset();
        clearErrors();
        if (successEl) successEl.hidden = true;
        form.hidden = false;
        if (turnstileId !== null && window.turnstile) { window.turnstile.remove(turnstileId); }
        turnstileId = null;
        turnstileToken = '';
    }

    function showFieldErrors(errors) {
        for (var field in errors) {
            if (!Object.prototype.hasOwnProperty.call(errors, field)) continue;
            var span = form.querySelector('[data-err-for="' + field + '"]');
            if (span) { span.textContent = errors[field][0]; span.hidden = false; }
        }
    }

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            clearErrors();
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending…';

            var payload = {
                first_name: form.first_name.value,
                last_name: form.last_name.value,
                email: form.email.value,
                phone: form.phone.value,
                message: form.message.value,
                website: form.website.value,
                'cf-turnstile-response': turnstileToken
            };

            fetch('/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrf,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(payload)
            }).then(function (res) {
                if (res.status === 422) {
                    return res.json().then(function (data) {
                        if (data.errors) { showFieldErrors(data.errors); setError('Please correct the highlighted fields.'); }
                        else { setError(data.message || 'Verification failed. Please try again.'); }
                        resetTurnstile();
                    });
                } else if (!res.ok) {
                    setError('Something went wrong sending your message. Please try again, or email us directly.');
                    resetTurnstile();
                } else {
                    form.hidden = true;
                    if (successEl) successEl.hidden = false;
                }
            }).catch(function () {
                setError('Network error. Please try again, or email us directly.');
                resetTurnstile();
            }).finally(function () {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit';
            });
        });
    }

    function setError(msg) {
        if (formError) { formError.textContent = msg; formError.hidden = false; }
    }

    /* ---- global bindings ---- */
    document.addEventListener('click', function (e) {
        var opener = e.target.closest('[data-open-contact-drawer]');
        if (opener) { e.preventDefault(); open(); return; }
        if (e.target.closest('[data-mwm-close]')) { e.preventDefault(); close(); }
    });

    document.addEventListener('keydown', function (e) {
        if (!isOpen()) return;
        if (e.key === 'Escape') { close(); return; }
        if (e.key !== 'Tab') return;
        var f = drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1], active = document.activeElement;
        if (e.shiftKey && (active === first || !drawer.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !drawer.contains(active))) { e.preventDefault(); first.focus(); }
    });
})();
