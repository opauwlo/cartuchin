/* Constants of the console mode, shared by the phone, the controller and the TV. */
const STREAM_W = 240, STREAM_H = 160;
const KEYCODES = { 10009: "B", 415: "START", 19: "START", 403: "L", 404: "R", 405: "SELECT", 406: "START" };
const KEYMAP = { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT", Enter: "A", " ": "A", Backspace: "B", Escape: "B",
  GoBack: "B", BrowserBack: "B", MediaPlayPause: "START", ColorF0Red: "L", ColorF1Green: "R", ColorF2Yellow: "SELECT", ColorF3Blue: "START" };
/* TV remotes send arrow keys, Enter and Back: they work as a controller too */
const keysDown = new Set();
const PAD_BITS = ["B", "SELECT", "START", "UP", "DOWN", "LEFT", "RIGHT", "A", "L", "R"];
/* RetroPad indexes EmulatorJS understands, and how a standard controller maps onto them */
const PAD = { B: 0, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, L: 10, R: 11 };
const RTC_CONFIG = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

export { STREAM_W, STREAM_H, KEYCODES, KEYMAP, keysDown, PAD_BITS, PAD, RTC_CONFIG };
