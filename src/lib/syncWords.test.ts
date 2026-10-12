import { describe, it, expect } from 'vitest';
import { syncWords } from './syncWords';

describe('what Today says about syncing', () => {
  it('says it is syncing', () => {
    expect(syncWords({ status: 'syncing' })).toBe('Syncing…');
  });

  it('SAYS SO WHEN IT FAILED', () => {
    // The half that was actually asked for: "sometimes I think it didn't sync
    // all the way". Silence after a failure leaves exactly that doubt.
    expect(syncWords({ status: 'error', message: 'nope' })).toContain('not finish');
  });

  it('says nothing at all when there is nothing to report', () => {
    expect(syncWords({ status: 'idle' })).toBeNull();
    expect(syncWords({ status: 'idle', lastSyncAt: new Date().toISOString() })).toBeNull();
  });

  it('STAYS SILENT ON A TRAIN, AND WHEN SIGNED OUT', () => {
    // Offline is not an event in an app that works offline by design, and a
    // missing token is the ReconnectNotice's job on every screen — two voices
    // for one problem is worse than one.
    expect(syncWords({ status: 'paused', reason: 'offline' })).toBeNull();
    expect(syncWords({ status: 'paused', reason: 'no-token' })).toBeNull();
    expect(syncWords({ status: 'paused', reason: 'signed-out' })).toBeNull();
    expect(syncWords({ status: 'paused', reason: 'not-configured' })).toBeNull();
  });
});
