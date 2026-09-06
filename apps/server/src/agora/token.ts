import pkg from "agora-token";
import { config } from "../config.js";

const { RtcTokenBuilder, RtcRole } = pkg;

const TOKEN_TTL_SECONDS = 3600;

/** String-uid (user account) RTC token — Agora Convo AI examples all use these. */
export function buildRtcTokenStringUid(channel: string, account: string): string {
  if (!config.agora.appId || !config.agora.appCertificate) return "";
  const now = Math.floor(Date.now() / 1000);
  return RtcTokenBuilder.buildTokenWithUserAccount(
    config.agora.appId,
    config.agora.appCertificate,
    channel,
    account,
    RtcRole.PUBLISHER,
    now + TOKEN_TTL_SECONDS,
    now + TOKEN_TTL_SECONDS
  );
}

export function buildRtcToken(channel: string, uid: number): string {
  if (!config.agora.appId || !config.agora.appCertificate) {
    // In MOCK mode / before creds are set, hand back an empty string; the web
    // client can still join a testing project that has no certificate.
    return "";
  }
  const now = Math.floor(Date.now() / 1000);
  return RtcTokenBuilder.buildTokenWithUid(
    config.agora.appId,
    config.agora.appCertificate,
    channel,
    uid,
    RtcRole.PUBLISHER,
    now + TOKEN_TTL_SECONDS,
    now + TOKEN_TTL_SECONDS
  );
}
