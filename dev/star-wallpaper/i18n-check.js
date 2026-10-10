// Quick language check, no browser needed (a few seconds):
//   node dev/star-wallpaper/i18n-check.js
// Every js/lang/<code>.js must cover every English text (pt-pt may only override
// pt), use only known keys and keep the pieces that must not be translated;
// language detection must map CasaOS, Wallpaper Engine and browser codes.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = path.join(__dirname, '..', '..', 'star-wallpaper');
const ctx = { navigator: { languages: ['en-US'] }, document: { documentElement: {} } };
ctx.window = ctx;
vm.createContext(ctx);
const run = (f) => vm.runInContext(fs.readFileSync(path.join(ENGINE, f), 'utf8'), ctx, { filename: f });
run('js/settings.js');
run('js/i18n.js');
const S = ctx.Starry;
const LANG_DIR = path.join(ENGINE, 'js', 'lang');
const files = fs.readdirSync(LANG_DIR).filter((f) => f.endsWith('.js'));
files.forEach((f) => run('js/lang/' + f));

// Every English text that has a key
const en = Object.assign({}, S.i18n.MESSAGES);
S.settings.GROUPS.forEach((g) => { en['g.' + g.id] = g.label; if (g.note) en['n.' + g.id] = g.note; });
S.settings.SCHEMA.forEach((s) => {
  en['s.' + s.key] = s.label;
  (s.options || []).forEach((o) => { if (s.key !== 'language' || o[0] === 'auto') en['o.' + s.key + '.' + o[0]] = o[1]; });
});
// Choices that read the same in every language need no translation
const SAME = /^(o\.fpslimit\.(30|60)|o\.screens\.[234]|o\.clockformat\.(24|12))$/;

let fails = 0;
function check(name, ok, info) {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || info === undefined ? '' : '  → ' + JSON.stringify(info)));
}

const dicts = S.i18n.dicts();
const codes = S.settings.LANGUAGES.map((l) => l[0]).filter((c) => c !== 'en');
check('a file for every language in settings.js', codes.every((c) => dicts[c]) && files.length === codes.length,
  { missing: codes.filter((c) => !dicts[c]), files: files.length });

codes.forEach((c) => {
  const d = dicts[c] || {};
  const unknown = Object.keys(d).filter((k) => !(k in en));
  const missing = c === 'pt-pt' ? [] : Object.keys(en).filter((k) => !(k in d) && !SAME.test(k) && !(c === 'pt' && d[k] === undefined && en[k] === 'Normal'));
  // (French keyboards label the Esc key "Échap")
  const keep = [['share.placeholder', /STARRY1:/], ['menu.close', /Esc|Échap/], ['share.copied', /Wallpaper Engine/]]
    .filter(([k, re]) => k in d && !re.test(d[k])).map(([k]) => k);
  const empty = Object.keys(d).filter((k) => typeof d[k] !== 'string' || !d[k].trim());
  check(c + ': complete, known keys, untranslatable parts kept',
    !unknown.length && !missing.length && !keep.length && !empty.length, { unknown, missing, keep, empty });
});

const I = S.i18n;
const cases = {
  en_us: 'en', 'en-GB': 'en', pt_br: 'pt', 'pt-BR': 'pt', pt_pt: 'pt-pt', portuguese: 'pt', zh_cn: 'zh-cn', 'zh-chs': 'zh-cn',
  'zh-Hans': 'zh-cn', zh_tw: 'zh-tw', 'zh-cht': 'zh-tw', 'zh-Hant-HK': 'zh-tw', no_no: 'no', 'nb-no': 'no', nn: 'no',
  ar_sa: 'ar', be_by: 'be', ca_es: 'ca', sl_si: 'sl', sk_sk: 'sk', 'fa-ir': 'en', '': 'en', 'xx-YY': 'en'
};
const wrong = Object.keys(cases).filter((k) => I.detect(k || 'en') !== cases[k]).map((k) => k + '→' + I.detect(k || 'en'));
check('detection of CasaOS, Wallpaper Engine and browser codes', !wrong.length, wrong);

I.setLang('pt-pt');
check('pt-pt overrides pt and falls back to it', I.t('menu.title') === 'Definições' && I.t('s.wavedrag', 'x') === 'Peso das estrelas (deforma a frente)', I.t('menu.title'));
I.setLang('ar');
check('Arabic is right-to-left, the others left-to-right', I.dir() === 'rtl' && (I.setLang('ja'), I.dir() === 'ltr'));
I.setLang('de');
check('a missing key falls back to English', I.t('nope.key', 'English text') === 'English text' && I.t('menu.title') === 'Einstellungen');

// The Wallpaper Engine panel gets every language Wallpaper Engine has a UI for
require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-project.js')], { stdio: 'pipe' });
const project = JSON.parse(fs.readFileSync(path.join(ENGINE, 'project.json'), 'utf8'));
const loc = project.general.localization;
const weCodes = S.settings.LANGUAGES.map((l) => l[3]).filter(Boolean);
const sizes = new Set(Object.values(loc).map((o) => Object.keys(o).length));
check('project.json: ' + weCodes.length + ' Wallpaper Engine locales, same keys in each',
  weCodes.every((c) => loc[c]) && sizes.size === 1, { locales: Object.keys(loc).length, sizes: [...sizes] });
check('project.json: translated headers', loc['de-de'].ui_hdr_stars === '<b>— Sterne —</b>' && loc['ja-jp'].ui_starcount === '数（画面ごと）', loc['de-de'].ui_hdr_stars);

console.log(fails ? fails + ' FAIL' : 'all passed');
process.exit(fails ? 1 : 0);
