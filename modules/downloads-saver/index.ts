import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type DownloadsSaverModule = {
  saveText(subfolder: string, fileName: string, mimeType: string, content: string): Promise<string>;
};

/** Null on iOS/web, and on an Android build made before this module existed. */
const native =
  Platform.OS === "android" ? requireOptionalNativeModule<DownloadsSaverModule>("DownloadsSaver") : null;

export const isDownloadsSaverAvailable = () => native !== null;

/**
 * Saves `content` as Download/<subfolder>/<fileName> — no permission, no prompt.
 * Resolves with the name actually used (Android adds " (1)" on a clash).
 */
export async function saveTextToDownloads(
  subfolder: string,
  fileName: string,
  mimeType: string,
  content: string,
): Promise<string> {
  if (!native) throw new Error("Saving to Downloads isn't available in this build.");
  return native.saveText(subfolder, fileName, mimeType, content);
}
