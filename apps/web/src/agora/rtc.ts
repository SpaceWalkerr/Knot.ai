import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type IRemoteAudioTrack,
  type IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";
import { parseStreamMessage, type LiveCaption } from "./transcript.js";

AgoraRTC.setLogLevel(2); // warn

/** Normalised amplitude for the voice instrument, 0..1 per channel. */
export interface VoiceLevels {
  ai?: number;
  you?: number;
}

export interface RtcHandle {
  client: IAgoraRTCClient;
  leave: () => Promise<void>;
  setMuted: (m: boolean) => void;
  /**
   * Pulled by the voice instrument at ~20Hz rather than pushed into React
   * state — a store write per frame would re-render the whole live screen.
   */
  getLevels: () => VoiceLevels;
}

export interface JoinArgs {
  appId: string;
  channel: string;
  token: string;
  uid: number;
  onCaption?: (c: LiveCaption) => void;
  onAgentAudioState?: (speaking: boolean) => void;
  onError?: (e: unknown) => void;
}

const JOIN_TIMEOUT_MS = 15_000;

/**
 * `client.join()` never settles when the network can't reach Agora's edge
 * servers — it retries internally, forever. Without a deadline the consent
 * screen sits on "connecting…" with no error and no way back, which is exactly
 * what a blocked network or a wrong App ID looks like to a candidate.
 */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function describe(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

/**
 * Agora reports volume on roughly a 0–1 scale but speech rarely clears ~0.3, so
 * a raw value would draw an almost-flat waveform. Lift it with a gentle curve
 * and clamp, which is what a level meter does anyway.
 */
function shape(v: number | undefined): number | undefined {
  if (v === undefined || Number.isNaN(v)) return undefined;
  return Math.max(0, Math.min(1, Math.pow(v, 0.6) * 1.65));
}

/**
 * Join the interview channel: publish the candidate's mic, play the cloud
 * agent's audio, and surface live captions from Agora's data stream.
 *
 * Note: Agora's caption stream is best-effort and can be partial — the server's
 * proxy log is the source of truth for the final report. These captions are
 * only for the live transcript panel.
 */
export async function joinInterview(args: JoinArgs): Promise<RtcHandle> {
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

  let agentTrack: IRemoteAudioTrack | null = null;

  // Audio watchdog. The Agora agent joins and reports RUNNING even when TTS is
  // misconfigured — it simply never publishes an audio track, and nothing
  // reports why. If we never hear the interviewer, say so loudly (and once)
  // instead of letting the candidate sit through a silent interview. The window
  // starts at join; the agent is asked to join a moment later (api.start), so a
  // generous timeout avoids false alarms on a slow cold start.
  let sawAgentAudio = false;
  let audioWatch: ReturnType<typeof setTimeout> | undefined;

  client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "audio") {
      user.audioTrack?.play();
      agentTrack = user.audioTrack ?? null;
      sawAgentAudio = true;
      if (audioWatch) clearTimeout(audioWatch);
      args.onAgentAudioState?.(true);
    }
  });
  client.on("user-unpublished", (_u, mediaType) => {
    if (mediaType === "audio") {
      agentTrack = null;
      args.onAgentAudioState?.(false);
    }
  });

  // Live transcription arrives as data-stream messages from the agent.
  client.on("stream-message", (_uid: number, payload: Uint8Array) => {
    try {
      const caption = parseStreamMessage(payload);
      if (caption) args.onCaption?.(caption);
    } catch (e) {
      args.onError?.(e);
    }
  });

  try {
    await withTimeout(
      client.join(args.appId, args.channel, args.token || null, args.uid),
      JOIN_TIMEOUT_MS,
      "Connecting to the interview channel"
    );
  } catch (e) {
    await client.leave().catch(() => {});
    throw new Error(
      "Couldn't connect to the voice channel. Check the Agora App ID and certificate, " +
        "and that this network allows WebSocket traffic to Agora's edge servers. " +
        `(${describe(e)})`
    );
  }

  let micTrack: IMicrophoneAudioTrack | null = null;
  let muted = false;
  try {
    micTrack = await AgoraRTC.createMicrophoneAudioTrack({
      AEC: true,
      ANS: true,
      AGC: true,
    });
    await client.publish(micTrack);
  } catch (e) {
    // This used to be swallowed into onError, which meant a denied or missing
    // mic produced a session that looked live, heard nothing, and ended in an
    // empty report. There is no useful interview without a microphone, so fail
    // loudly and let the candidate fix it and retry.
    args.onError?.(e);
    await client.leave().catch(() => {});
    throw new Error(
      "Couldn't use your microphone, so there's no way to run the interview. " +
        "Allow microphone access for this site and try again. " +
        `(${describe(e)})`
    );
  }

  // Arm the watchdog now that we're in the channel and the agent is being spun up.
  const AGENT_AUDIO_TIMEOUT_MS = 18_000;
  audioWatch = setTimeout(() => {
    if (sawAgentAudio) return;
    const msg =
      "No interviewer audio after 18s — the agent joined but isn't publishing " +
      "an audio track. TTS is almost certainly misconfigured on the server " +
      "(check GET /health/tts). The interview will be silent until it's fixed.";
    console.warn("[knot] " + msg);
    args.onError?.(new Error(msg));
  }, AGENT_AUDIO_TIMEOUT_MS);

  return {
    client,
    getLevels: () => ({
      ai: shape(agentTrack?.getVolumeLevel()),
      you: muted ? 0 : shape(micTrack?.getVolumeLevel()),
    }),
    setMuted: (m: boolean) => {
      muted = m;
      void micTrack?.setEnabled(!m);
    },
    leave: async () => {
      if (audioWatch) clearTimeout(audioWatch);
      micTrack?.stop();
      micTrack?.close();
      await client.leave();
    },
  };
}
