import { describe, it, expect, vi, afterEach } from 'vitest';
import { startRecording } from './audio';

/**
 * The microphone has to be handed back on every path.
 *
 * A live capture is not a quiet leak on iOS: the audio session stays in record
 * mode for as long as any track is live, so everything played afterwards goes
 * to the earpiece or nowhere, and stays that way until the app is relaunched.
 * The recording itself saves perfectly, which is what makes it hard to find.
 */
class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
}

function install(state: 'recording' | 'inactive') {
  const track = new FakeTrack();
  const stream = new FakeStream([track]);

  class FakeRecorder {
    state = state;
    mimeType = 'audio/mp4';
    onstop: (() => void) | null = null;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    start() {}
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
    static isTypeSupported(t: string) {
      return t === 'audio/mp4';
    }
  }

  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
  return track;
}

afterEach(() => vi.unstubAllGlobals());

describe('handing the microphone back', () => {
  it('releases it on a normal stop', async () => {
    const track = install('recording');
    const rec = await startRecording({ keep: true });
    await rec.stop();
    expect(track.stopped).toBe(true);
  });

  it('releases it when the recorder has ALREADY stopped by itself', async () => {
    // A call, Siri, another app taking the mic, or iOS suspending a
    // backgrounded PWA all end the track and stop the recorder underneath us.
    // This branch used to resolve the blob and leave the capture running.
    const track = install('inactive');
    const rec = await startRecording({ keep: true });
    await rec.stop();
    expect(track.stopped).toBe(true);
  });

  it('releases it on cancel', async () => {
    const track = install('recording');
    const rec = await startRecording({ keep: true });
    rec.cancel();
    expect(track.stopped).toBe(true);
  });

  it('keeps a recording that is meant to survive in a container everything plays', async () => {
    // mp4 is the one container every browser on every platform will play; a
    // memo recorded as WebM on a laptop is a silent row on the phone.
    install('recording');
    const rec = await startRecording({ keep: true });
    expect(rec.mimeType).toBe('audio/mp4');
  });
});
