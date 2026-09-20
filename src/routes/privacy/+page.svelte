<script lang="ts">
  import { base } from '$app/paths';

  /**
   * The privacy policy, as a page of the app.
   *
   * WHY IT EXISTS: Google will not move an OAuth consent screen out of Testing
   * mode without a home page and a privacy policy URL, and Testing mode is
   * what expires the grant every seven days and keeps asking for a fresh
   * sign-in. So this page is the price of not being signed out weekly.
   *
   * It is deliberately written as FACTS ABOUT THIS APP rather than boilerplate:
   * every claim below is checkable in the code it names, and if the app ever
   * starts doing something else, this is wrong and has to change with it. A
   * privacy policy that describes a different app is worse than none.
   */

  // Stamped at build time, like Settings → Version, so the date cannot drift
  // from the code it describes.
  const built = new Date(__APP_VERSION__).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
</script>

<svelte:head>
  <title>FreeTime — Privacy</title>
  <meta
    name="description"
    content="FreeTime keeps everything on your own device. It collects nothing, has no analytics, and syncs only to your own Google Drive."
  />
</svelte:head>

<div class="px-4 pt-safe pb-16">
  <header class="pt-3 pb-4">
    <a href={base || '/'} class="press footnote inline-block">‹ FreeTime</a>
    <h1 class="large-title mt-1">Privacy</h1>
    <p class="footnote mt-2">Last updated {built}.</p>
  </header>

  <div class="space-y-6 text-[15px] leading-relaxed">
    <p class="card p-4">
      FreeTime is a personal organiser that runs entirely in your browser. It has no
      server of its own, no account, no analytics and no advertising. Nothing you
      write in it is collected by anyone, and nothing is ever sold or shared.
    </p>

    <section>
      <h2 class="title-2 mb-2">Where your data lives</h2>
      <p>
        Everything you put into FreeTime — projects, to-dos, ideas, notes, shopping
        lists, habits and voice recordings — is stored by your own browser, on the
        device you typed it on, using IndexedDB. It is not uploaded anywhere unless
        you connect Google Drive yourself.
      </p>
      <p class="mt-2">
        The app is served as static files from GitHub Pages. Like any website, GitHub
        can see the ordinary requests your browser makes for those files.
      </p>
    </section>

    <section>
      <h2 class="title-2 mb-2">Google Drive, if you connect it</h2>
      <p>
        Connecting Google is optional and exists only so your own devices can share
        one copy of your data. FreeTime asks for two permissions:
      </p>
      <ul class="mt-2 list-disc space-y-2 pl-5">
        <li>
          <strong>Drive — files this app creates</strong> (<code class="text-[13px]">drive.file</code>).
          This grants access only to the files FreeTime itself makes, in a folder
          called FreeTime in your own Drive. It cannot see, read or touch anything
          else in your Drive.
        </li>
        <li>
          <strong>Calendar — read only</strong> (<code class="text-[13px]">calendar.readonly</code>).
          Used to show today's events on the Today screen. Those events are read on
          your device and displayed; they are never written down, copied into your
          data, or sent anywhere.
        </li>
      </ul>
      <p class="mt-2">
        Your sign-in token is kept on the device and nowhere else. You can disconnect
        at any time in Settings, and revoke the permission entirely at
        <a class="text-accent" href="https://myaccount.google.com/permissions" rel="noreferrer">
          myaccount.google.com/permissions</a>.
      </p>
    </section>

    <section>
      <h2 class="title-2 mb-2">The assistant, if you set it up</h2>
      <p>
        The optional assistant and voice capture use Google's Gemini API, and only
        work if you enter your own API key in Settings. The key is stored on your
        device alone — never in the app's code and never in Drive. When you use those
        features, the words or audio you give them are sent to Google's API to be
        answered. If you enter no key, those features are hidden and nothing is sent.
      </p>
    </section>

    <section>
      <h2 class="title-2 mb-2">The map, if you open it</h2>
      <p>
        Voice recordings can keep the coordinates of where they were made, on your
        device. Opening the map of recordings requests map images from OpenStreetMap,
        which means their servers see your IP address and roughly which area is being
        looked at. Your coordinates themselves are never uploaded, and no address
        lookup is ever performed. If you never open the map, nothing is requested.
      </p>
    </section>

    <section>
      <h2 class="title-2 mb-2">Removing everything</h2>
      <p>
        Deleting the app's site data in your browser removes every trace of it from
        that device. If you used Drive sync, deleting the FreeTime folder in your
        Drive removes the synced copy. There is nowhere else to ask, because there is
        nowhere else it went.
      </p>
    </section>

    <section>
      <h2 class="title-2 mb-2">Children</h2>
      <p>FreeTime is a personal tool and is not directed at children.</p>
    </section>

    <section>
      <h2 class="title-2 mb-2">Changes, and how to ask</h2>
      <p>
        If this ever changes, the page changes with it and the date above moves. The
        app is open source: you can read exactly what it does, or raise a question,
        at
        <a class="text-accent" href="https://github.com/Sadonnodas/FreeTime" rel="noreferrer">
          github.com/Sadonnodas/FreeTime</a>.
      </p>
    </section>
  </div>
</div>
