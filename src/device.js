// Which device and browser this is, and so which install steps it needs. Pure, so every kind can
// be tested from a user agent.
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Snapchat|Twitter|LinkedInApp|MicroMessenger|Pinterest|WhatsApp|Teams|GSA\//;
// Android browsers built on Chrome: they say Chrome in their user agent, but do not have Chrome's menu.
const OTHER_ANDROID = /SamsungBrowser|Firefox|OPR\/|OPT\/|EdgA|MiuiBrowser|Mint Browser|HuaweiBrowser|HeyTapBrowser|OppoBrowser|VivoBrowser|UCBrowser|YaBrowser|DuckDuckGo|Silk|Vivaldi/;

export function detect({ ua = '', platform = '', touch = 0, standalone = false } = {}) {
  if (standalone) return 'standalone';
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);
  const android = /Android/.test(ua);
  // On iPhone every real browser says Safari/; an app showing a page inside itself does not.
  if ((ios || android) && (IN_APP.test(ua) || (android && /; wv\)/.test(ua)) || (ios && !/Safari\//.test(ua)))) return 'in-app';
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo/.test(ua) ? 'ios-other' : 'ios-safari';
  if (android) return OTHER_ANDROID.test(ua) || !/Chrome/.test(ua) ? 'android-other' : 'android-chrome';
  return 'desktop';
}

// Where Safari keeps Share. Each version moves it: behind the lines left of the address bar from 27,
// behind three dots right of it in 26, and on the bar before that.
export function safariMenu(ua) {
  const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
  return version >= 27 ? 'lines' : version === 26 ? 'dots' : 'share';
}

export const thisDevice = () =>
  detect({
    ua: navigator.userAgent,
    platform: navigator.platform,
    touch: navigator.maxTouchPoints,
    standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
  });

// A phone or tablet must install first: on iPhone the installed app has its own storage, so what is
// unlocked in the browser would stay in the browser. A laptop can carry on where it is.
export const mustInstall = (kind) => kind !== 'standalone' && kind !== 'desktop';
