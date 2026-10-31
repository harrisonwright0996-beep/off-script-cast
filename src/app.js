// Starts the app: opens storage, loads what is saved, and shows the right screen.
import { openStore } from './store.js';
import { withDefaults } from './settings.js';
import { indexModel } from './items.js';
import { newState } from './state.js';
import { buildPlan } from './plan.js';
import { fitFactor } from './memory.js';
import { dayKey, addDays } from './dates.js';
import { h, button, clear, screen, focusHeading, settled } from './ui/dom.js';
import { showInstall, needsInstall } from './ui/install.js';
import { showUnlock } from './ui/unlock.js';
import { showCheckin } from './ui/checkin.js';
import { showMore, showStage } from './ui/stage.js';
import { showSprint } from './ui/sprint.js';
import { showScene, showScenes, showReader } from './ui/scenes.js';
import { showSettings, wipePhone } from './ui/settings.js';
import { showWalk } from './ui/walk.js';
import { showChoose } from './ui/choose.js';
import { showStartAgain } from './ui/again.js';
import { showBadges } from './ui/badges.js';
import { PEEK_GAP, learntPercent } from './cast/proof.js';
import { addSeconds, cleanStreak, creditFor, noteSlips } from './cast/streak.js';
import { ENDS } from './cast/config.js';

const EVENT_DAYS = 9; // the plan looks back this far
const DB = 'off-script-cast';

// The show is over: nothing of it stays on the phone.
async function showEnded(ctx) {
  await wipePhone(ctx);
  Object.assign(ctx, { model: null, index: null, states: new Map(), events: [], manifest: null, keys: null, member: null });
  ctx.root.append(screen({ title: 'Off Script', body: [h('p', { class: 'lead' }, 'The show is over, so your lines have been removed from this phone. Well done.')] }));
}

const SCREENS = { install: showInstall, unlock: showUnlock, checkin: showCheckin, today: showStage, more: showMore, badges: showBadges, scene: showScene, sprint: showSprint, scenes: showScenes, reader: showReader, settings: showSettings, walk: showWalk, choose: showChoose, again: showStartAgain, ended: showEnded };

export function applyLook(s) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty('--scale', String(s.textSize / 100));
  root.style.setProperty('--lh', String(s.lineSpacing));
  const spacing = { normal: ['0', '0'], wide: ['0.05em', '0.12em'], wider: ['0.1em', '0.24em'] }[s.letterSpacing] || ['0', '0'];
  root.style.setProperty('--ls', spacing[0]);
  root.style.setProperty('--ws', spacing[1]);
}

let store = null; // kept outside boot, so a phone that cannot start can still be cleared

async function boot() {
  store = await openStore();
  const ctx = {
    store,
    root: document.getElementById('app'),
    settings: withDefaults(await store.get('settings')),
    model: null,
    index: null,
    states: new Map(),
    events: [],
    eventsFrom: null,
    manifest: (await store.get('manifest')) || null,
    keys: (await store.get('keys')) || null,
    member: (await store.get('member')) || null,
    update: false, // a new version has taken over: it shows at the next Your lines
    cleanup: null,
    nav: 0,
    fit: { k: 1, n: 0 }, // his forgetting curve factor, refitted when a sprint or walk starts
    peeks: (await store.get('peeks')) || {}, // when each line was last put on show
    streak: cleanStreak(await store.get('streak')), // minutes practised, badges (cast/streak.js)

    // These lines have just been on show, so typing them for a while proves nothing (cast/proof.js).
    peek(ids) {
      const now = Date.now();
      for (const [id, at] of Object.entries(ctx.peeks)) if (now - at >= PEEK_GAP) delete ctx.peeks[id];
      for (const id of ids) ctx.peeks[id] = now;
      store.set('peeks', { ...ctx.peeks }).catch(() => {});
    },
    peeked: (id) => Date.now() - (ctx.peeks[id] || 0) < PEEK_GAP,

    getState: (id) => ctx.states.get(id) || newState(id),
    today: () => dayKey(),

    plan() {
      const now = Date.now();
      return buildPlan({ model: ctx.model, index: ctx.index, getState: ctx.getState, events: ctx.events, settings: ctx.settings, today: dayKey(new Date(now)), now, fit: ctx.fit });
    },

    refit() {
      ctx.fit = fitFactor(ctx.events);
    },

    async refreshEvents() {
      const from = addDays(ctx.today(), -EVENT_DAYS);
      if (ctx.eventsFrom === from) return;
      ctx.events = await store.eventsSince(from);
      ctx.eventsFrom = from;
      ctx.refit();
    },

    async setModel(model, meta) {
      ctx.model = model;
      ctx.index = indexModel(model);
      await store.set('script', model);
      await store.set('scriptMeta', meta);
      await ctx.settleSeen(); // a sprint saved for other words is not carried on (it keeps their hash)
    },

    // The % has moved for a reason that is not a slip (a new script, Start again, a backup), so the
    // next Your lines has no dip to explain.
    async settleSeen() {
      const seen = await store.get('seen');
      if (seen) await store.set('seen', { ...seen, percent: learntPercent(ctx.model, ctx.getState) });
    },

    async saveAnswer(rec) {
      rec.event.key = await store.saveAnswer(rec.event, rec.state);
      ctx.states.set(rec.state.id, rec.state);
      ctx.events.push(rec.event);
      rec.credit = creditFor(rec.event, ctx.index.byId.get(rec.event.id)?.words ?? 0);
      addSeconds(ctx.streak, rec.event.day, rec.credit);
      noteSlips(ctx.streak, rec.event.prev, rec.state);
      await ctx.saveStreak();
    },

    async undoAnswer(rec) {
      await store.undo(rec.event.key, rec.event.prev);
      ctx.states.set(rec.event.id, rec.event.prev);
      ctx.events = ctx.events.filter((e) => e !== rec.event);
      addSeconds(ctx.streak, rec.event.day, -(rec.credit || 0));
      await ctx.saveStreak();
    },

    saveStreak: () => store.set('streak', ctx.streak).catch(() => {}), // never holds up an answer
    practiceToday: () => ctx.streak.days[ctx.today()] || 0,

    // Back to not started: these lines (every line when ids is null) lose their progress and answers.
    async startAgain(ids = null) {
      await store.clearProgress(ids);
      const gone = ids && new Set(ids);
      ctx.states = gone ? new Map([...ctx.states].filter(([id]) => !gone.has(id))) : new Map();
      ctx.events = gone ? ctx.events.filter((e) => !gone.has(e.id)) : [];
      ctx.refit();
      await ctx.settleSeen();
    },

    async saveSettings(patch) {
      Object.assign(ctx.settings, patch);
      applyLook(ctx.settings);
      await store.set('settings', { ...ctx.settings });
    },

    async go(name, params = {}) {
      ctx.nav += 1; // a screen still drawing can tell it has been left
      if (ctx.cleanup) ctx.cleanup();
      ctx.cleanup = null;
      if (ctx.model && name !== 'install' && name !== 'unlock') await ctx.refreshEvents();
      clear(ctx.root);
      const result = await SCREENS[name](ctx, params);
      if (typeof result === 'function') ctx.cleanup = result;
      window.scrollTo(0, 0);
      focusHeading(ctx.root);
    },

  };
  window.offScript = ctx; // handy when testing; holds nothing that leaves the phone

  applyLook(ctx.settings);
  registerServiceWorker(ctx);
  if (ctx.today() > ENDS) return ctx.go('ended');

  const model = await store.get('script');
  if (model) {
    ctx.model = model;
    ctx.index = indexModel(model);
    for (const s of await store.allStates()) ctx.states.set(s.id, s);
  }

  if (needsInstall(!!model)) return ctx.go('install');
  return ctx.go(model ? 'today' : 'unlock');
}

function registerServiceWorker(ctx) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // The first to take charge of a page is not an update, only what comes after it.
  let charged = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (charged) {
      ctx.update = true;
      document.dispatchEvent(new CustomEvent('offscript:update'));
    }
    charged = true;
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

// What is on the phone may be why it cannot start, so this must work with no help from it.
async function removeAndRestart() {
  try {
    store = store || (await openStore());
    await wipePhone({ store, keys: await store.get('keys') });
  } catch {
    try {
      indexedDB.deleteDatabase(DB);
      localStorage.clear();
    } catch {
      // nothing can be stored here: nothing to clear
    }
  }
  location.reload();
}

function couldNotStart(root) {
  const draw = (title, body, footer) => {
    clear(root).append(screen({ title, body, footer }));
    focusHeading(root);
  };
  const sure = () =>
    draw('Remove everything?', [h('p', { class: 'lead' }, 'This deletes your lines, your progress and the audio from this phone. You would need the company code to get them back.')], [
      button('Keep everything', () => location.reload(), { class: 'btn primary' }),
      button('Remove everything', settled(removeAndRestart)),
    ]);
  draw('Off Script could not start', [h('p', { class: 'lead' }, 'Close it and open it again. If this keeps happening, your phone may be short of space.'), h('p', {}, 'Still stuck? Removing everything from this phone can fix it.')], [button('Remove everything', settled(sure))]);
}

boot().catch((err) => {
  window.offScript = window.offScript || {}; // it has started, so the watchdog stays quiet (boot.js)
  const root = document.getElementById('app');
  // Some browsers and private modes refuse storage: installing is often the way out.
  if (needsInstall()) showInstall({ root, model: null, go: () => couldNotStart(root) });
  else couldNotStart(root);
  console.error(err);
});
