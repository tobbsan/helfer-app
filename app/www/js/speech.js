// Dual-mode speech: uses native Capacitor plugins (real Android
// permission prompts) when running inside the installed app, and falls
// back to the browser's Web Speech API when opened as a normal web page
// or installed PWA (where native plugins aren't present).

function nativePlugins() {
  return (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    ? window.Capacitor.Plugins
    : null;
}

export function isNative() {
  return !!nativePlugins();
}

export function isSpeechRecognitionSupported() {
  if (nativePlugins()) return !!nativePlugins().SpeechRecognition;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isSpeechSynthesisSupported() {
  if (nativePlugins()) return !!nativePlugins().TextToSpeech;
  return 'speechSynthesis' in window;
}

export async function requestVoicePermissions() {
  const plugins = nativePlugins();
  if (!plugins || !plugins.SpeechRecognition) return true;
  try {
    const status = await plugins.SpeechRecognition.requestPermissions();
    return status.speechRecognition === 'granted' || status.speechRecognition === undefined;
  } catch {
    return false;
  }
}

// --- Speaking ---
let webVoice = null;
function pickWebVoice(lang) {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find(v => v.lang === lang) ||
    voices.find(v => v.lang && v.lang.startsWith(lang.split('-')[0])) ||
    voices[0]
  );
}
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { webVoice = null; };
}

export async function speakText(text, { rate = 0.9, pitch = 1, lang = 'en-US' } = {}) {
  if (!text) return false;
  const plugins = nativePlugins();
  if (plugins && plugins.TextToSpeech) {
    try {
      await plugins.TextToSpeech.speak({ text, lang, rate, pitch, volume: 1.0 });
      return true;
    } catch {
      return false;
    }
  }
  if (!('speechSynthesis' in window)) return false;
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    utter.pitch = pitch;
    utter.lang = lang;
    if (!webVoice) webVoice = pickWebVoice(lang);
    if (webVoice) utter.voice = webVoice;
    utter.onend = () => resolve(true);
    utter.onerror = () => resolve(false);
    window.speechSynthesis.speak(utter);
  });
}

export async function stopSpeaking() {
  const plugins = nativePlugins();
  if (plugins && plugins.TextToSpeech) {
    try { await plugins.TextToSpeech.stop(); } catch { /* ignore */ }
    return;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// --- Listening ---
// Returns a controller object: { start(), stop(), listening() }
// onResult(text) fires once with the recognized transcript.
export function createRecognizer({ lang = 'en-US', onResult, onError, onStart, onEnd } = {}) {
  const plugins = nativePlugins();

  if (plugins && plugins.SpeechRecognition) {
    const SpeechRecognition = plugins.SpeechRecognition;
    let listening = false;
    let partialListener = null;
    let stateListener = null;

    return {
      lang,
      async start() {
        if (listening) return;
        const status = await SpeechRecognition.requestPermissions().catch(() => null);
        if (status && status.speechRecognition && status.speechRecognition !== 'granted') {
          onError && onError({ error: 'permission-denied' });
          return;
        }
        listening = true;
        onStart && onStart();
        partialListener = await SpeechRecognition.addListener('partialResults', (data) => {
          const text = data && data.matches && data.matches[0];
          if (text) {
            listening = false;
            onResult && onResult(text);
          }
        });
        stateListener = await SpeechRecognition.addListener('listeningState', (data) => {
          if (data.status === 'stopped') {
            listening = false;
            onEnd && onEnd();
          }
        });
        try {
          await SpeechRecognition.start({ language: this.lang, maxResults: 1, partialResults: true, popup: false });
        } catch (err) {
          listening = false;
          onError && onError(err);
          onEnd && onEnd();
        }
      },
      async stop() {
        listening = false;
        try { await SpeechRecognition.stop(); } catch { /* ignore */ }
        if (partialListener) partialListener.remove();
        if (stateListener) stateListener.remove();
        onEnd && onEnd();
      },
      listening() {
        return listening;
      },
    };
  }

  // Web fallback
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const recognizer = new SR();
  recognizer.lang = lang;
  recognizer.continuous = false;
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
  let listening = false;
  recognizer.onstart = () => { listening = true; onStart && onStart(); };
  recognizer.onend = () => { listening = false; onEnd && onEnd(); };
  recognizer.onerror = (e) => { listening = false; onError && onError(e); };
  recognizer.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    onResult && onResult(transcript);
  };
  return {
    lang,
    start() { recognizer.lang = this.lang; try { recognizer.start(); } catch { /* already started */ } },
    stop() { recognizer.stop(); },
    listening() { return listening; },
  };
}
