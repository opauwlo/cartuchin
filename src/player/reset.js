import { resetEmulatorSettings } from "../diag.js";
import { ls } from "../util.js";

/* one-time reset requested after the emulator menu got changed by accident */
if (ls.get("cartucho.reset.v1") !== "done") {
  resetEmulatorSettings();
  ls.set("cartucho.reset.v1", "done");
}
