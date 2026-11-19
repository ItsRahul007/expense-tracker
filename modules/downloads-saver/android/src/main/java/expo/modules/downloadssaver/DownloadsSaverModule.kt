package expo.modules.downloadssaver

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Saves a text file into the public Download folder (in a sub-folder), the way
 * Android 10+ intends: through MediaStore, which needs no permission and shows
 * no prompt. The file belongs to the app and appears in Files → Download.
 */
class DownloadsSaverModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DownloadsSaver")

    /** Returns the file name actually used (MediaStore may add " (1)" etc.). */
    AsyncFunction("saveText") { subfolder: String, fileName: String, mimeType: String, content: String ->
      val context = appContext.reactContext ?: throw CodedException("React context is not available")

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, fileName)
          put(MediaStore.Downloads.MIME_TYPE, mimeType)
          put(
            MediaStore.Downloads.RELATIVE_PATH,
            if (subfolder.isEmpty()) Environment.DIRECTORY_DOWNLOADS else "${Environment.DIRECTORY_DOWNLOADS}/$subfolder",
          )
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw CodedException("Could not create the file in Downloads")
        try {
          resolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
            ?: throw CodedException("Could not open the file for writing")
          resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
          resolver.delete(uri, null, null) // don't leave a half-written file behind
          throw e
        }
        resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) return@AsyncFunction cursor.getString(0)
        }
        return@AsyncFunction fileName
      }

      // Android 9 and older: a plain file (WRITE_EXTERNAL_STORAGE is declared in app.json).
      @Suppress("DEPRECATION")
      val folder = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), subfolder)
      if (!folder.exists() && !folder.mkdirs()) throw CodedException("Could not create Download/$subfolder")
      var file = File(folder, fileName)
      val dot = fileName.lastIndexOf('.')
      val stem = if (dot > 0) fileName.substring(0, dot) else fileName
      val ext = if (dot > 0) fileName.substring(dot) else ""
      var n = 2
      while (file.exists()) file = File(folder, "$stem-${n++}$ext")
      file.writeText(content, Charsets.UTF_8)
      file.name
    }
  }
}
