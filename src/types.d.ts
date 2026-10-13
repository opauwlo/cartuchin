/* Ambient types for the few globals the app relies on (EmulatorJS, Google Identity,
   browser APIs TypeScript's DOM lib does not know yet). Type checking only: nothing
   here reaches the bundle. */
interface Window {
  __dsEmu: any;
  __jit: any;
  __dsProf: any;
  VideoEncoder: any;
  VideoDecoder: any;
  EncodedVideoChunk: any;
  __cartucho: any;
  __diag: any;
  EJS_Runtime: any;
  EmulatorJS: any;
  EJS_GameManager: any;
  EJS_player: string;
  qrcode: any;
  google: any;
  CARTUCHIN_CONFIG: { googleClientId?: string };
  webkitAudioContext: typeof AudioContext;
  MediaStreamTrackProcessor: any;
  ImageCapture: any;
  __cast: any;
  __tvScreen: any;
  __castOpts: any;
  __castCap: number;
  __audioTaps: { ctx: AudioContext; local: GainNode; out: MediaStreamAudioDestinationNode | null }[];
  __CARTUCHO_LANG: any;
}
declare var google: any;
declare var EmulatorJS: any;
declare class MediaStreamTrackProcessor { constructor(init: { track: MediaStreamTrack }); readable: ReadableStream<any>; }
declare class ImageCapture { constructor(track: MediaStreamTrack); grabFrame(): Promise<ImageBitmap>; }
interface RTCRtpEncodingParameters { scalabilityMode?: string }
interface RTCRtpReceiver { jitterBufferTarget?: number; playoutDelayHint?: number }
interface RTCRtpTransceiver { getHeaderExtensionsToNegotiate?: () => { uri: string; direction: string }[]; setHeaderExtensionsToNegotiate?: (x: { uri: string; direction: string }[]) => void }
interface HTMLVideoElement { requestVideoFrameCallback?: (cb: () => void) => number }
interface MediaStreamTrack { contentHint?: string }
interface BaseAudioContext { createMediaStreamDestination?(): MediaStreamAudioDestinationNode }
interface ResizeObserver { __cartucho?: boolean }
interface Document { currentScript: HTMLScriptElement | null }
