'use strict';

/** Ornamentos Necropolis — caveira, lâminas, correntes, etc. */
(function (global) {
  const HREF = '/assets/necropolis-glyphs.svg';
  const GLYPHS = ['skull', 'blades', 'chain', 'crown', 'rose', 'moon', 'chalice', 'wings'];

  function svgUse(id, className) {
    const cls = className ? ` class="${className}"` : '';
    return `<svg${cls} aria-hidden="true" viewBox="0 0 64 64"><use href="${HREF}#glyph-${id}"/></svg>`;
  }

  function thumbGlyph(productId) {
    const n = Math.abs(parseInt(productId, 10) || 0);
    const id = GLYPHS[n % GLYPHS.length];
    return `<div class="pc-thumb pc-thumb-glyph glyph-${id}">${svgUse(id)}</div>`;
  }

  function decorateGtitles() {
    document.querySelectorAll('.gtitle').forEach((el, i) => {
      if (el.dataset.gothicDone) return;
      el.dataset.gothicDone = '1';
      const label = (el.textContent || '').trim();
      const g = GLYPHS[i % GLYPHS.length];
      el.innerHTML = svgUse(g, 'gt-glyph') + label + svgUse('corner', 'gt-glyph gt-glyph-end');
    });
  }

  function decorateCards() {
    document.querySelectorAll('.card:not(.has-corners)').forEach((card) => {
      card.classList.add('has-corners', 'card-gothic');
      card.insertAdjacentHTML(
        'afterbegin',
        `<div class="card-corners">${svgUse('corner', 'cc-tl')}${svgUse('corner', 'cc-br')}</div>`
      );
    });
    document.querySelectorAll('.kc:not(.has-corners)').forEach((kc) => {
      kc.classList.add('has-corners', 'card-gothic');
      kc.insertAdjacentHTML(
        'afterbegin',
        `<div class="card-corners">${svgUse('corner', 'cc-tl')}${svgUse('corner', 'cc-br')}</div>`
      );
    });
  }

  function decorateModal() {
    const panel = document.querySelector('#prod-modal .modal-panel');
    if (!panel || panel.querySelector('.modal-glyph')) return;
    panel.insertAdjacentHTML('afterbegin', svgUse('skull', 'modal-glyph'));
  }

  function init() {
    decorateGtitles();
    decorateCards();
    decorateModal();
  }

  global.NecropolisGlyphs = {
    HREF,
    GLYPHS,
    svgUse,
    thumbGlyph,
    decorateGtitles,
    decorateCards,
    decorateModal,
    init,
  };
})(window);
