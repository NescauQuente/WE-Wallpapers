#!/usr/bin/env node
/*
 * Generates the Wallpaper Engine project.json from js/settings.js.
 * Usage:  node tools/build-project.js
 *
 * Property texts are localization keys ("ui_…"). The generated
 * general.localization block holds every language of js/lang/ that Wallpaper
 * Engine has a UI for; it picks the one matching its UI language and falls
 * back to English.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('../js/settings.js');

// The language files register themselves through Plexus.i18n.add
const dicts = {};
global.Plexus = { i18n: { add: (code, dict) => { dicts[code] = Object.assign(dicts[code] || {}, dict); } } };
const LANG_DIR = path.join(__dirname, '..', 'js', 'lang');
fs.readdirSync(LANG_DIR).filter((f) => f.endsWith('.js')).forEach((f) => require(path.join(LANG_DIR, f)));
const FALLBACK = { 'pt-pt': 'pt' };

// Translation of a dictionary key, along the same fallback chain as i18n.js
function tr(lang, key, en) {
  for (let c = lang; c; c = FALLBACK[c]) if (dicts[c] && dicts[c][key] !== undefined) return dicts[c][key];
  return en;
}

const strings = {};   // ui key → { key: dictionary key, en: English text, wrap: [before, after] }

function slug(v) {
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Registers a translatable text and returns its ui key
function text(uiKey, key, en, wrap) {
  strings[uiKey] = { key, en, wrap: wrap || ['', ''] };
  return uiKey;
}

function decimals(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function toWE(s, order) {
  const p = { order, text: text('ui_' + s.key, 's.' + s.key, s.label), type: s.type };
  if (s.cond) p.condition = S.condToWE(s.cond);

  if (s.type === 'slider') {
    const d = decimals(s.step);
    Object.assign(p, { min: s.min, max: s.max, step: s.step, value: s.def, editable: true });
    if (d > 0) Object.assign(p, { fraction: true, precision: d });
  } else if (s.type === 'combo') {
    p.options = s.options.map(([value, label]) => ({
      label: text('ui_' + s.key + '_' + slug(value), 'o.' + s.key + '.' + value, label),
      value
    }));
    p.value = s.def;
  } else {
    p.value = s.def;
  }
  return p;
}

const properties = {
  schemecolor: {
    order: 0,
    text: 'ui_browse_properties_scheme_color',
    type: 'color',
    value: S.BY_KEY.nodecolor.def
  }
};

let order = 1;
S.GROUPS.forEach((g) => {
  const items = S.SCHEMA.filter((s) => s.group === g.id && s.we !== false);
  if (!items.length) return;
  properties['hdr_' + g.id] = {
    order: order++,
    text: text('ui_hdr_' + g.id, 'g.' + g.id, g.label, ['<b>— ', ' —</b>']),
    type: 'text'
  };
  if (g.note) {
    properties['note_' + g.id] = {
      order: order++,
      text: text('ui_note_' + g.id, 'n.' + g.id, g.note, ['<i>', '</i>']),
      type: 'text'
    };
  }
  items.forEach((s) => { properties[s.key] = toWE(s, order++); });
});

const localization = {};
S.LANGUAGES.forEach(([lang, , , locale]) => {
  if (!locale) return;
  localization[locale] = {};
  Object.keys(strings).sort().forEach((uiKey) => {
    const st = strings[uiKey];
    localization[locale][uiKey] = st.wrap[0] + tr(lang, st.key, st.en) + st.wrap[1];
  });
});

const project = {
  contentrating: 'Everyone',
  description: 'A living 3D network: glowing nodes drifting in depth, connections and triangles ' +
    'that form and fade, signals racing along them in chain reactions, shapes the network ' +
    'assembles into, a singularity under your mouse, ready-made themes, a clock and full ' +
    'audio reactivity.',
  file: 'index.html',
  general: {
    localization,
    properties,
    supportsaudioprocessing: true
  },
  preview: 'preview.jpg',
  tags: ['Abstract', 'Technology'],
  title: 'Neural Plexus',
  type: 'web',
  visibility: 'private'
};

const out = path.join(__dirname, '..', 'project.json');
fs.writeFileSync(out, JSON.stringify(project, null, '\t') + '\n');
console.log('project.json generated: ' + Object.keys(properties).length + ' properties, ' +
  Object.keys(strings).length + ' localized strings × ' + Object.keys(localization).length + ' locales');
