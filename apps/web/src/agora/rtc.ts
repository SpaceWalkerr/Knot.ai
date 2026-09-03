import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";
import { parseStreamMessage, type LiveCaption } from "./transcript.js";

AgoraRTC.setLogLevel(2); // warn

export interface RtcHandle {
  client: IAgoraRTCClient;
  leave: () => Promise<void>;
  setMuted: (m: boolean) => void;
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

  client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "audio") {
      user.audioTrack?.play();
      args.onAgentAudioState?.(true);
    }
  });
  client.on("user-unpublished", (_u, mediaType) => {
    if (mediaType === "audio") args.onAgentAudioState?.(false);
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

  await client.join(args.appId, args.channel, args.token || null, args.uid);

  let micTrack: IMicrophoneAudioTrack | null = null;
  try {
    micTrack = await AgoraRTC.createMicrophoneAudioTrack({
      AEC: true,
      ANS: true,
      AGC: true,
    });
    await client.publish(micTrack);
  } catch (e) {
    args.onError?.(e);
  }

  return {
    client,
    setMuted: (m: boolean) => {
      void micTrack?.setEnabled(!m);
    },
    leave: async () => {
      micTrack?.stop();
      micTrack?.close();
      await client.leave();
    },
  };
}
