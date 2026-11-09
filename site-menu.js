// The site menu, on every page of this fork: the front page, the editor, the
// map editor, the gallery, the docs, setup, the command line, GitHub.
//
// One list of links, placed three ways, because the pages are three kinds:
//
//   <script src="…/site-menu.js" data-mode="bootstrap">   upstream's docs and
//       gallery, which already have a Bootstrap navbar: the links go into it.
//   <script src="…/site-menu.js" data-mode="dropdown">    the editor and the
//       map editor, full-window apps laid out under their own toolbar: a small
//       menu button goes into the element marked data-site-menu.
//   <script src="…/site-menu.js" data-mode="bar">         any other page: the
//       same bar the front page has, at the top.
//
// Links are worked out from where this script lives, so the same tag works at
// any depth and on the published site. The front page and doc/setup.html carry
// the bar as plain HTML so they work without scripts; keep their links in step
// with LINKS below.

(function () {
    'use strict';

    const script = document.currentScript;
    if (!script) return;
    const root = new URL('.', script.src);
    const mode = script.dataset.mode || 'bar';

    const LINKS = [
        { label: 'PuzzleScript Next', href: 'index.html', brand: true },
        { label: 'Editor', href: 'src/editor.html' },
        { label: 'Map editor', href: 'puzzlescript-map-editor/web/index.html' },
        { label: 'Gallery', href: 'src/Gallery/index.html' },
        { label: 'Docs', href: 'src/Documentation/documentation.html', section: 'src/Documentation/' },
        { label: 'Setup', href: 'doc/setup.html' },
        { label: 'Command line', href: 'index.html#commandline', end: true },
        { label: 'GitHub', href: 'https://github.com/fortress-rhythm/PuzzleScriptNext', end: true, external: true },
    ].map(link => Object.assign({}, link, { url: new URL(link.href, root) }));

    const here = new URL(location.href);
    const isHere = (link) => {
        if (link.external || link.url.hash) return false;
        if (link.section) return here.pathname.startsWith(new URL(link.section, root).pathname);
        const path = here.pathname.replace(/\/$/, '/index.html');
        return path === link.url.pathname;
    };

    function anchor(link, className) {
        const a = document.createElement('a');
        a.href = link.url.href;
        a.textContent = link.label;
        if (className) a.className = className;
        if (isHere(link)) { a.classList.add('here'); a.setAttribute('aria-current', 'page'); }
        if (link.external) a.rel = 'noopener';
        return a;
    }

    const CSS = `
.psn-sitemenu-bar { position: sticky; top: 0; z-index: 1000; background: rgba(18,19,26,0.94);
  border-bottom: 1px solid #2e3242; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.psn-sitemenu-bar nav { max-width: 960px; margin: 0 auto; padding: 0 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.psn-sitemenu-bar a { display: inline-block; padding: 11px 10px; color: #8b90a4; text-decoration: none; border-bottom: 2px solid transparent; }
.psn-sitemenu-bar a:hover { color: #e6e8f0; }
.psn-sitemenu-bar a.here { color: #e6e8f0; border-bottom-color: #6ea8fe; }
.psn-sitemenu-bar a.brand { color: #e6e8f0; font-weight: 600; padding-left: 0; margin-right: 8px; }
.psn-sitemenu-bar .spacer { flex: 1 1 auto; }
@media (max-width: 640px) { .psn-sitemenu-bar nav { padding: 0 16px; } .psn-sitemenu-bar .spacer { display: none; } }

.psn-sitemenu-drop { position: relative; display: inline-block; vertical-align: middle; z-index: 1000;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.psn-sitemenu-drop > button { font: inherit; font-size: 15px; line-height: 1; color: #e6e8f0; background: #21242f;
  border: 1px solid #2e3242; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.psn-sitemenu-drop > button:hover, .psn-sitemenu-drop > button[aria-expanded="true"] { border-color: #6ea8fe; }
.psn-sitemenu-drop .panel { position: fixed; z-index: 2147483000; min-width: 180px; padding: 4px;
  background: #1a1c25; border: 1px solid #2e3242; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
.psn-sitemenu-drop .panel[hidden] { display: none; }
.psn-sitemenu-drop .panel a { display: block; padding: 6px 10px; border-radius: 5px; color: #c9cde0; text-decoration: none; white-space: nowrap; }
.psn-sitemenu-drop .panel a:hover, .psn-sitemenu-drop .panel a:focus { background: #21242f; color: #fff; outline: none; }
.psn-sitemenu-drop .panel a.here { color: #fff; box-shadow: inset 2px 0 0 #6ea8fe; }
.psn-sitemenu-drop .panel a.brand { font-weight: 600; color: #fff; }
.psn-sitemenu-drop .panel hr { border: 0; border-top: 1px solid #2e3242; margin: 4px 2px; }
`;

    function addStyle() {
        if (document.getElementById('psn-sitemenu-style')) return;
        const style = document.createElement('style');
        style.id = 'psn-sitemenu-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    // The front page's bar, for pages that have nothing of their own.
    function bar() {
        addStyle();
        const wrap = document.createElement('div');
        wrap.className = 'psn-sitemenu-bar';
        const nav = document.createElement('nav');
        nav.setAttribute('aria-label', 'Site');
        for (const link of LINKS) {
            if (link.end && !nav.querySelector('.spacer')) {
                const spacer = document.createElement('span');
                spacer.className = 'spacer';
                nav.appendChild(spacer);
            }
            nav.appendChild(anchor(link, link.brand ? 'brand' : ''));
        }
        wrap.appendChild(nav);
        document.body.insertBefore(wrap, document.body.firstChild);
    }

    // A menu button, for the apps. Opens on click, closes on Escape, on a
    // click elsewhere, or on choosing a link.
    function dropdown() {
        addStyle();
        const mount = document.querySelector('[data-site-menu]');
        const wrap = document.createElement('span');
        wrap.className = 'psn-sitemenu-drop';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '☰';
        button.title = 'PuzzleScript Next: the other pages';
        button.setAttribute('aria-haspopup', 'true');
        button.setAttribute('aria-expanded', 'false');
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.hidden = true;
        for (const link of LINKS) {
            if (link.end && !panel.querySelector('hr')) panel.appendChild(document.createElement('hr'));
            panel.appendChild(anchor(link, link.brand ? 'brand' : ''));
        }
        // The panel is fixed to the viewport, placed under the button when it
        // opens: the editor's toolbar clips anything that overflows it.
        const setOpen = (open) => {
            if (open) {
                const r = button.getBoundingClientRect();
                panel.style.top = `${Math.round(r.bottom + 4)}px`;
                panel.style.left = `${Math.max(4, Math.round(r.left))}px`;
            }
            panel.hidden = !open;
            button.setAttribute('aria-expanded', String(open));
        };
        window.addEventListener('resize', () => setOpen(false));
        button.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });
        document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
        wrap.addEventListener('keydown', (e) => {
            // Keep the app's own shortcuts from seeing keys meant for the menu.
            e.stopPropagation();
            if (e.key === 'Escape') { setOpen(false); button.focus(); }
        });
        wrap.appendChild(button);
        wrap.appendChild(panel);
        if (mount) mount.appendChild(wrap);
        else {
            wrap.style.position = 'fixed';
            wrap.style.top = '6px';
            wrap.style.left = '6px';
            document.body.appendChild(wrap);
        }
    }

    // Upstream's Bootstrap navbar: our links go in its left-hand list, and
    // any of its own links that go to the same place are dropped.
    function bootstrap() {
        const container = document.querySelector('.navbar .container');
        if (!container) { bar(); return; }
        let collapse = container.querySelector('.navbar-collapse');
        if (!collapse) {
            collapse = document.createElement('div');
            collapse.className = 'collapse navbar-collapse';
            container.appendChild(collapse);
        }
        let left = collapse.querySelector('ul.nav.navbar-nav:not(.navbar-right)');
        if (!left) {
            left = document.createElement('ul');
            left.className = 'nav navbar-nav';
            collapse.insertBefore(left, collapse.firstChild);
        }
        let right = collapse.querySelector('ul.nav.navbar-nav.navbar-right');
        if (!right) {
            right = document.createElement('ul');
            right.className = 'nav navbar-nav navbar-right';
            collapse.appendChild(right);
        }
        const ours = new Set(LINKS.map(l => l.url.href.replace(/#.*$/, '')));
        for (const a of collapse.querySelectorAll('a[href]')) {
            if (ours.has(a.href.replace(/#.*$/, '')) && a.closest('li')) a.closest('li').remove();
        }
        left.replaceChildren();
        for (const link of LINKS) {
            if (link.brand) continue;           // the navbar has its own brand
            const li = document.createElement('li');
            const a = anchor(link);
            if (a.classList.contains('here')) li.className = 'active';
            li.appendChild(a);
            (link.end ? right : left).appendChild(li);
        }
        // "Home" on these pages meant the front page; keep that link, by name.
        const home = document.createElement('li');
        home.appendChild(anchor(Object.assign({}, LINKS[0], { label: 'Home' })));
        left.insertBefore(home, left.firstChild);
    }

    const run = { bar, dropdown, bootstrap }[mode] || bar;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
})();
