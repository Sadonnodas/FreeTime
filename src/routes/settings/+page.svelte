<script lang="ts">
  import { liveQuery } from 'dexie';
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import { db } from '$lib/db';
  import type { ConflictLog } from '$lib/types';
  import { isGoogleConfigured, redirectUri, DRIVE_FOLDER } from '$lib/config';
  import { beginSignIn, signOut, isConnected } from '$lib/google/auth';
  import { clearCalendarCache } from '$lib/google/calendar';
  import { onSyncState, syncNow, type SyncState } from '$lib/sync';
  import { ago } from '$lib/format';
  import { getApiKey, setApiKey } from '$lib/gemini/client';
  import { pendingAudioCount, processQueue } from '$lib/gemini/commit';
  import ThemePicker from '$lib/components/ThemePicker.svelte';
  import InfoDot from '$lib/components/InfoDot.svelte';
  import { buildLabel, onUpdateStatus, checkAndApply, type UpdateStatus } from '$lib/pwa';

  let sync = $state<SyncState>({ status: 'idle' });
  let connected = $state(false);
  let authError = $state<string | undefined>(undefined);
  let silentFailed = $state(false);
  let apiKey = $state('');
  let keySaved = $state(false);
  let queued = $state(0);
  let stop: (() => void) | undefined;

  /**
   * Which build is running. It briefly lived on Me, because Settings used to be
   * a screen about connecting Google and it read as sync configuration in
   * there. Now that Settings is a destination of its own it belongs here — but
   * high up, not under two account sections, which is how it got missed the
   * first time.
   */
  let updateStatus = $state<UpdateStatus>('idle');
  let stopUpdate: (() => void) | undefined;

  const busyChecking = $derived(updateStatus === 'checking' || updateStatus === 'updating');

  const updateLine = $derived.by(() => {
    switch (updateStatus) {
      case 'checking':
        return 'Looking…';
      case 'current':
        return 'This is the latest version.';
      case 'ready':
        return 'A newer version is ready.';
      case 'updating':
        return 'Updating…';
      case 'failed':
        return "Couldn't check just now — you may be offline.";
      default:
        // Nothing to say before it has been asked. The button below says it.
        return '';
    }
  });


  const conflictsQ = liveQuery(async () =>
    (await db.conflicts.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  onMount(async () => {
    stop = onSyncState((s) => (sync = s));
    stopUpdate = onUpdateStatus((s) => (updateStatus = s));
    connected = await isConnected();
    const st = await db.settings.get('settings');
    authError = st?.lastAuthError;
    // Set only when a silent renewal FAILED, and cleared the moment one
    // succeeds — so it is a reliable "Google will not do this quietly".
    silentFailed = !!st?.lastSilentAuthAt;
    apiKey = (await getApiKey()) ?? '';
    queued = await pendingAudioCount();
  });
  onDestroy(() => {
    stop?.();
    stopUpdate?.();
  });


  const configured = isGoogleConfigured();

  /**
   * Say which of these it is, and never promise a recovery that cannot happen.
   *
   * All three of the first cases have no token, and the old copy treated them
   * as one — "Signed out of Google, will reconnect on next open" — which was
   * true only in the middle case. A laptop that had never been connected was
   * told to wait for something that would never come, and sat for days without
   * any of the projects made on the phone. Same rule as the update check: a
   * thing that could not happen reports that it did not happen.
   */
  const statusLine = $derived.by(() => {
    if (sync.status === 'syncing') return 'Syncing…';
    if (sync.status === 'error') return `Last attempt failed: ${sync.message}`;
    if (sync.status === 'paused') {
      if (sync.reason === 'offline') return 'Offline — will catch up.';
      if (sync.reason === 'signed-out')
        return 'Not signed in on this device, so nothing is syncing to it.';
      if (sync.reason === 'no-token')
        return silentFailed
          ? 'Google wants a fresh sign-in — it would not renew quietly.'
          : 'Google session expired. It renews itself next time the app opens.';
      return 'Not set up.';
    }
    return sync.lastSyncAt ? `Last synced ${ago(sync.lastSyncAt)}.` : 'Not synced yet.';
  });
</script>

<div class="px-4 pt-safe pb-8">
  <header class="pt-3 pb-5">
    <h1 class="large-title">Settings</h1>
  </header>

  <!-- First, because it is the one setting anybody actually goes looking for. -->
  <section class="mb-8">
    <h2 class="section-label mb-2">
      Appearance
      <InfoDot title="Light and dark">
        <p>
          Tap the sun or the moon and the dinosaur walks over to it.
        </p>
        <p>
          <b>Automatic</b> follows your Mac or iPhone instead, including their own switch
          at sunset — which already knows where in the world you are, so it gets the time
          right when you travel.
        </p>
      </InfoDot>
    </h2>
    <ThemePicker />
  </section>

  <section class="mb-8">
    <h2 class="section-label mb-2">Version</h2>
    <div class="card p-4">
      <p class="text-sm">Built {buildLabel()}</p>
      {#if updateLine}
        <p class="footnote mt-1">{updateLine}</p>
      {/if}
      <!-- A button that looks like one. This was a tappable row, and a row that
           happens to be tappable does not tell you it is the way to check. -->
      <button
        class="btn btn-secondary press mt-3 w-full text-sm"
        onclick={checkAndApply}
        disabled={busyChecking}
      >
        {busyChecking ? 'Checking…' : 'Check for updates'}
      </button>
    </div>
  </section>

  <section class="mb-8">
    <h2 class="section-label mb-2">
      Google Drive
      <InfoDot title="Google Drive">
        <p>
          Sync keeps this app the same on your laptop and your phone. Your data lives in
          a visible <b>{DRIVE_FOLDER}/</b> folder in your Drive, and era notes are
          real .md files — readable and editable without this app, so nothing is trapped
          in here.
        </p>
        <p>
          Google will warn that the app is unverified when you connect. That is expected:
          it is your own app, in testing mode, and the permission it asks for only lets it
          see files it created itself. It cannot read the rest of your Drive.
        </p>
      </InfoDot>
    </h2>

    {#if !configured}
      <!-- Sign-in is hidden rather than broken when there is no client ID.
           Everything else in the app works without it. -->
      <div class="card space-y-2 p-4 text-sm text-ink-400">
        <p class="text-ink-200">Not set up yet.</p>
        <p>
          Add an OAuth client ID to <code class="text-ink-200">src/lib/config.ts</code> to turn
          on sync. See the README for the walkthrough.
        </p>
        <p>
          The redirect URI to register is
          <code class="break-all text-ink-200">{redirectUri()}</code>
        </p>
      </div>
    {:else}
      <div class="card p-4">
        <p class="text-sm">{statusLine}</p>
        {#if connected}
          <div class="mt-3 flex gap-2">
            <button
              class="press tap rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
              onclick={() => syncNow()}
              disabled={sync.status === 'syncing'}>Sync now</button
            >
            <button
              class="press tap rounded-xl px-4 text-sm text-ink-400"
              onclick={async () => {
                await signOut();
                clearCalendarCache();
                connected = false;
              }}>Disconnect</button
            >
          </div>
        {:else}
          <button
            class="btn btn-primary press mt-3 text-sm"
            onclick={() => beginSignIn(false)}>Connect Google</button
          >
          {#if authError}
            <!-- Shown verbatim. redirect_uri_mismatch and access_denied say
                 exactly what went wrong; anything else is worth reading too. -->
            <p class="card-flat mt-3 p-3 text-xs text-ink-200">
              Google refused the last sign-in: <b>{authError}</b>
              {#if authError === 'unsupported_response_type' || authError === 'invalid_request'}
                <br /><br />
                This most likely means the OAuth client will not allow the implicit flow.
                If so, sync needs the small token backend instead — see the README.
              {:else if authError === 'redirect_uri_mismatch'}
                <br /><br />
                The redirect URI registered in Google Cloud Console must be exactly
                <code class="break-all">{redirectUri()}</code>, trailing slash included.
              {/if}
            </p>
          {/if}
        {/if}
      </div>
    {/if}
  </section>

  {#if (($conflictsQ as ConflictLog[] | undefined) ?? []).length}
    <section class="mb-8">
      <h2 class="section-label mb-2">
        Overwritten edits
      </h2>
      <!-- Cheap insurance, quiet by default (spec 8.3). Only appears when there
           is genuinely something here. -->
      <p class="footnote mb-2">
        Two devices changed the same thing at nearly the same moment. The newer edit won;
        the older one is kept here in case it mattered.
      </p>
      <ul class="space-y-1">
        {#each ($conflictsQ as ConflictLog[]) as c (c.id)}
          <li class="card-flat px-4 py-3 text-xs">
            <p class="text-ink-400">{c.table} · {ago(c.createdAt)}</p>
            <pre class="mt-1 overflow-x-auto text-ink-200">{c.overwrittenJson}</pre>
          </li>
        {/each}
      </ul>
      <button
        class="press tap mt-2 rounded-xl px-4 text-sm text-ink-400"
        onclick={() => db.conflicts.clear()}>Clear</button
      >
    </section>
  {/if}

  <section>
    <h2 class="section-label mb-2">
      Gemini
      <InfoDot title="Gemini">
        <p>
          A key turns on voice capture and the assistant. Everything else in the app works
          without one, which is why they stay hidden until you add it rather than sitting
          there broken.
        </p>
        <p>
          Get one from
          <a class="text-accent underline" href="https://aistudio.google.com/apikey"
            target="_blank" rel="noreferrer">Google AI Studio</a>. It is stored in this
          browser only — never in the repo, never in the build, never in Drive.
        </p>
        <p>
          Worth doing once in the Cloud Console: restrict the key to the
          <b>Generative Language API</b>, so a copied key can do nothing else.
        </p>
      </InfoDot>
    </h2>
    <div class="card p-4">
      <form
        class="flex gap-2"
        onsubmit={async (e) => {
          e.preventDefault();
          await setApiKey(apiKey);
          keySaved = true;
          setTimeout(() => (keySaved = false), 1500);
        }}
      >
        <!-- type=password so the key is not readable over a shoulder or in a
             screenshot. It is not a secret from the user, only from the room. -->
        <input
          bind:value={apiKey}
          type="password"
          autocomplete="off"
          placeholder="AIza…"
          class="field min-w-0 flex-1 "
        />
        <button class="tap rounded-xl bg-accent px-4 text-sm font-medium text-ink-950">
          Save
        </button>
      </form>
      {#if keySaved}<p class="mt-2 text-xs text-good">Saved.</p>{/if}

      {#if queued > 0}
        <div class="mt-4 border-t border-ink-800 pt-3">
          <p class="text-sm">
            {queued} recording{queued === 1 ? '' : 's'} waiting to be processed.
          </p>
          <button
            class="press tap mt-2 rounded-xl bg-surface-2 px-4 text-sm text-ink-200"
            onclick={async () => {
              await processQueue();
              queued = await pendingAudioCount();
            }}>Process now</button
          >
        </div>
      {/if}
    </div>
  </section>

  <section class="mb-8">
    <h2 class="section-label mb-2">Data</h2>
    <a href="{base}/settings/import" class="list-group list-row press">
      <span class="flex-1">Import from Notion</span>
      <span class="text-ink-400">›</span>
    </a>
  </section>
</div>
