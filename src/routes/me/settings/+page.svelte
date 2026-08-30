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

  let sync = $state<SyncState>({ status: 'idle' });
  let connected = $state(false);
  let authError = $state<string | undefined>(undefined);
  let apiKey = $state('');
  let keySaved = $state(false);
  let queued = $state(0);
  let stop: (() => void) | undefined;


  const conflictsQ = liveQuery(async () =>
    (await db.conflicts.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  onMount(async () => {
    stop = onSyncState((s) => (sync = s));
    connected = await isConnected();
    authError = (await db.settings.get('settings'))?.lastAuthError;
    apiKey = (await getApiKey()) ?? '';
    queued = await pendingAudioCount();
  });
  onDestroy(() => stop?.());


  const configured = isGoogleConfigured();

  const statusLine = $derived.by(() => {
    if (sync.status === 'syncing') return 'Syncing…';
    if (sync.status === 'error') return `Last attempt failed: ${sync.message}`;
    if (sync.status === 'paused') {
      if (sync.reason === 'offline') return 'Offline — will catch up.';
      if (sync.reason === 'no-token') return 'Signed out of Google — will reconnect on next open.';
      return 'Not set up.';
    }
    return sync.lastSyncAt ? `Last synced ${ago(sync.lastSyncAt)}.` : 'Not synced yet.';
  });
</script>

<div class="px-4 pt-safe pb-8">
  <header class="py-4">
    <a href="{base}/me" class="press footnote inline-block">‹ Me</a>
    <h1 class="large-title mt-1">Settings</h1>
  </header>

  <section class="mb-8">
    <h2 class="section-label mb-2">Google Drive</h2>

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
          <p class="footnote mt-1">
            Your data lives in a visible <b>{DRIVE_FOLDER}/</b> folder in your Drive. Notes are
            real .md files — readable without this app.
          </p>
          <div class="mt-3 flex gap-2">
            <button
              class="press tap rounded-xl bg-white/8 px-4 text-sm text-ink-200"
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
          <p class="footnote mt-1">
            Google will warn that this app is unverified. That is expected — it is your own
            app, in testing mode, and it can only see files it created itself.
          </p>
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
    <h2 class="section-label mb-2">Gemini</h2>
    <div class="card p-4">
      <p class="footnote mb-3">
        Turns on voice capture. Get a key from
        <a class="text-accent underline" href="https://aistudio.google.com/apikey"
          target="_blank" rel="noreferrer">Google AI Studio</a>. It is stored in this
        browser only — never in the repo, never in the build. Everything else in the app
        works without it.
      </p>
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
      <p class="footnote mt-3">
        Worth doing once in Google Cloud Console: restrict the key by HTTP referrer to
        this site, so a copied key is useless anywhere else.
      </p>

      {#if queued > 0}
        <div class="mt-4 border-t border-ink-800 pt-3">
          <p class="text-sm">
            {queued} recording{queued === 1 ? '' : 's'} waiting to be processed.
          </p>
          <button
            class="press tap mt-2 rounded-xl bg-white/8 px-4 text-sm text-ink-200"
            onclick={async () => {
              await processQueue();
              queued = await pendingAudioCount();
            }}>Process now</button
          >
        </div>
      {/if}
    </div>
  </section>
</div>
