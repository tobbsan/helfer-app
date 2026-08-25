# Helper - a voice companion app for retired people

A native Android app (installed from a direct download link, no app store)
that talks with a retired person, calls people from their contact list, and
reminds them out loud to take their pills - even when the app is closed.

## How it's built (and why)

- **`server/`** - a small Node.js/Express backend that runs on your
  cultamu.com server. It serves the web app and proxies calls to Claude
  (so the API key lives only on the server, never on anyone's phone).
- **`app/`** - a [Capacitor](https://capacitorjs.com) project that wraps
  that same web app in a real Android shell. The installed app loads its
  pages **live from your server** (`server.url` in
  `app/capacitor.config.json`), so **you update the app by deploying to
  the server** - nobody needs to reinstall anything for UI or behavior
  changes. The Android shell itself only needs rebuilding when you add a
  new native capability (a new plugin/permission).
- Because the shell is native, the OS shows **real Android permission
  dialogs** for microphone access and notifications - not the flakier
  browser prompts a plain installable web page would show.
- **`.github/workflows/build-android.yml`** - compiles the Android app in
  GitHub's free cloud build runners (your dev machine and the server
  don't have the Android SDK/Java needed to compile it), and publishes
  the result as a GitHub Release asset called `helper.apk`.

## What it does

- **Talk**: tap the big microphone button and speak. Helper answers out
  loud using Claude, in short, simple sentences.
- **Call people**: say "Call Mary" (or any saved contact's name) and
  Helper opens the phone's dialer for that contact - one more tap places
  the call. A starred "Call for Help" contact gets a dedicated one-tap
  button on the home screen.
- **Pill reminders**: add pills and times in the Pills tab. Helper
  schedules a real Android notification for each time, which fires even
  if the app is closed or the phone was restarted, with "I took it" and
  "Remind me in 10 minutes" buttons right on the notification. While the
  app is open it also speaks the reminder out loud.
- Everything above works by voice. Adding contacts, pills, and turning on
  permissions is done once via simple large-button screens (typically by
  a family member helping set the phone up).

## One-time setup

### 1. Push this project to GitHub

This `helper/` folder is meant to be its own GitHub repository (keep it
separate from the cultamu.com PHP site).

In VS Code: open the `helper` folder, go to the Source Control panel,
click **Initialize Repository**, stage and commit everything, then click
**Publish to GitHub** (use your existing GitHub sign-in). Note the
`owner/repo` name it publishes as - you'll need it below.

Pushing to the `main` branch automatically triggers the GitHub Actions
build, which compiles the app and publishes `helper.apk` as a release
(check the repo's **Actions** tab for progress, usually 5-10 minutes).

### 2. Deploy the backend to your server

The server needs Node.js (already installed on your VM), and to be
reachable at the URL configured in `app/capacitor.config.json`
(`https://www.cultamu.com/helper/` by default - change both if you'd
rather use a subdomain or different path).

On the server:

```bash
cd /var/www/cultamu.com/helper-server
npm install
cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY, and APK_REPO to your GitHub owner/repo
npm start   # or run it under pm2 / systemd - see "Keeping it running" below
```

Apache needs to reverse-proxy `/helper/` (the web app + `/api/chat`) and
`/download` to the Node process's port (`3010` by default). This needs
`mod_proxy` and `mod_proxy_http` enabled and a block added to the
cultamu.com vhost - ask your assistant to do this for you, since it's a
shared production server change worth confirming first.

### 3. Set the API key

Get a Claude API key from [console.anthropic.com](https://console.anthropic.com)
and put it in the server's `.env` file as `ANTHROPIC_API_KEY`. Calling
contacts and pill reminders work even without it; open-ended conversation
needs it.

### 4. Install the app on the phone

Once step 1 has produced a release, the app is downloadable from:

```
https://github.com/<owner>/<repo>/releases/latest/download/helper.apk
```

or, once the server is deployed, the friendlier branded link:

```
https://www.cultamu.com/helper/download
```

On the Android phone: open that link, allow "install unknown apps" for
the browser when prompted (a one-time Android setting, not a security
compromise specific to this app), and install. Open the app, go to
**Settings -> Turn On Voice & Reminders**, and allow the microphone and
notification permissions when asked.

## Keeping the server running

Use `pm2` (already installed on the VM) or a systemd service so the
Node process survives reboots and restarts if it crashes:

```bash
pm2 start server.js --name helper-server --cwd /var/www/cultamu.com/helper-server
pm2 save
```

(A systemd unit is more robust long-term since it doesn't depend on a
user session - ask your assistant to set one up if you'd like.)

## Updating the app later

- **Change a reply, add a command, tweak the UI, fix a bug in
  `app/www/js/*.js` or `server/server.js`**: just redeploy `server/` and
  `app/www/` to the VM and restart the Node process. Every installed
  phone picks up the change immediately - no reinstall.
- **Add a new native permission or plugin** (e.g. a new sensor, a new
  kind of notification): change `app/package.json`/`app/www` as needed
  and push to GitHub - Actions rebuilds `helper.apk` automatically.
  People need to redownload and reinstall only in this case.

## Important limitations (please read)

- **Calling isn't fully silent.** Browsers/WebViews can't dial a real
  phone call by themselves without a special "phone" permission Helper
  doesn't request (to keep the permission list minimal and trustworthy).
  Saying "call Mary" opens the phone's native dialer with her number
  ready - one more tap places the call.
- **The Android shell loading a remote URL (`server.url`) is how
  Capacitor's own live-reload works during development; Capacitor's docs
  describe it as intended for that, not as an officially endorsed
  production pattern.** It works reliably for exactly this "thin native
  shell, real app lives on the server" design many teams use for
  internal/sideloaded tools, but there's no built-in offline fallback -
  if the server is down or the phone has no signal, the app will show a
  normal browser connection-error screen rather than a custom offline
  page. If reliability here becomes a problem, the fix is a small bit of
  native code to show a friendlier retry screen.
- **This app is sideloaded, not from the Play Store.** That's normal for
  a personal/family tool, but Android will ask the installer to confirm
  "install from unknown sources" once.
- **Voice input still depends on the phone having Google's on-device
  speech recognition available** (true for essentially all Android
  phones with Google Play Services, which is nearly all of them).
- Helper cannot look up live information (weather, news, etc.) - it says
  so plainly when asked.
- The debug-signed APK built by the workflow is fine for personal
  sideloading. If you ever want a "polished" release build, that needs a
  proper release keystore - ask your assistant to set that up when
  you're ready.

## Folder structure

```
helper/
  server/                    Node.js/Express backend
    server.js                 Serves the web app + POST /api/chat (Claude proxy) + GET /download
    package.json
    .env.example                Copy to .env on the server; never commit the real one
  app/                        Capacitor Android project (source only - android/ is generated by CI)
    package.json                Capacitor + plugin dependencies
    capacitor.config.json        appId, appName, and the server.url the app loads
    www/                         The actual web app (same content the server hosts)
      index.html
      css/style.css
      js/
        app.js                    Wires up the UI, mic button, views, reminders
        speech.js                  Native-plugin-first speech, with browser fallback
        commands.js                  Turns spoken text into an intent (call/time/etc.)
        contacts.js                   Contact storage (on-device localStorage)
        medications.js                 Pill schedule + native OS reminder scheduling
        ai.js                            Calls the server's /api/chat (no key on-device)
  .github/workflows/build-android.yml   Builds helper.apk on every push and publishes a Release
```

All personal data (contacts, pills, chat history) is stored locally on
the phone (`localStorage` inside the app's WebView) - nothing is synced
to the server except the text of a conversation turn while getting an
AI reply.
