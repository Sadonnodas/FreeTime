import { describe, it, expect, vi, afterEach } from 'vitest';
import { startRecording, isRecording, onRecordingChange } from './audio';

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
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => stream },
    mediaSession
  });
  return track;
}

/** The remote-control buttons: a car's, the lock screen's, AirPods'. */
const handlers = new Map<string, (() => void) | null>();
const mediaSession = {
  setActionHandler(action: string, fn: (() => void) | null) {
    handlers.set(action, fn);
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  handlers.clear();
});

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
    rec.cancel();
  });
});

/**
 * Found in a car: an old memo started playing over a new recording. Opening
 * the microphone over Bluetooth switches the car to its call profile, the car
 * answers with PLAY, and iOS resumes whatever this app last played. The app
 * has to be able to say "a recording is starting" so players can empty
 * themselves, and it has to hold the remote buttons while the mic is live.
 */
describe('recording as a signal', () => {
  it('announces the start before the microphone opens, and the end on stop', async () => {
    install('recording');
    const heard: boolean[] = [];
    const stop = onRecordingChange((live) => heard.push(live));
    const rec = await startRecording({ keep: true });
    expect(isRecording()).toBe(true);
    await rec.stop();
    expect(heard).toEqual([true, false]);
    expect(isRecording()).toBe(false);
    stop();
  });

  it('never stays "recording" when the microphone is refused', async () => {
    // Stuck on true, the lock screen's buttons would be swallowed for good.
    install('recording');
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        }
      },
      mediaSession
    });
    await expect(startRecording()).rejects.toThrow();
    expect(isRecording()).toBe(false);
  });

  it('hands the microphone back when the recorder cannot be built', async () => {
    const track = install('recording');
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor() {
          throw new Error('NotSupportedError');
        }
        static isTypeSupported() {
          return false;
        }
      }
    );
    await expect(startRecording()).rejects.toThrow();
    expect(track.stopped).toBe(true);
    expect(isRecording()).toBe(false);
  });

  it('swallows the remote buttons while live, and a little past the end', async () => {
    vi.useFakeTimers();
    install('recording');
    const rec = await startRecording({ keep: true });
    // Claimed, and claimed by something that does nothing.
    expect(typeof handlers.get('play')).toBe('function');
    await rec.stop();
    // The switch back to the music profile sends PLAY too, just after release.
    expect(typeof handlers.get('play')).toBe('function');
    vi.advanceTimersByTime(5000);
    expect(handlers.get('play')).toBeNull();
  });
});
