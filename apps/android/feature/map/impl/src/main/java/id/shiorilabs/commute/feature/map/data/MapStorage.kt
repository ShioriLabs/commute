package id.shiorilabs.commute.feature.map.data

import android.content.Context
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.io.FileNotFoundException
import javax.inject.Inject
import javax.inject.Singleton

/** Where the map's files live on the device: the copies built into the app, and the tile cache. */
interface MapStorage {

    /** The bundled copy of [name] (`manifest.json`, `points.json`, `label-points.json`), as text. */
    fun bundled(name: String): String

    /** Tile build [build]'s cached file [name], or null when it was never fetched. */
    fun readTile(build: String, name: String): ByteArray?

    fun writeTile(build: String, name: String, bytes: ByteArray)

    /** Drops every tile build's cache but [build]'s: the files of a re-tiled map are never asked for again. */
    fun keepOnlyBuild(build: String)
}

/**
 * [MapStorage] on the app's assets (filled by the module's `bundleMapData` task) and its cache
 * directory, which the system may clear: a cleared tile is fetched again.
 */
@Singleton
class AndroidMapStorage @Inject constructor(@ApplicationContext private val context: Context) : MapStorage {

    private val root: File get() = File(context.cacheDir, "map/fdtj")

    override fun bundled(name: String): String =
        context.assets.open("map/$name").bufferedReader().use { it.readText() }

    override fun readTile(build: String, name: String): ByteArray? = try {
        AtomicFile(File(File(root, build), name)).readFully()
    } catch (_: FileNotFoundException) {
        null
    }

    override fun writeTile(build: String, name: String, bytes: ByteArray) {
        val dir = File(root, build).apply { mkdirs() }
        val file = AtomicFile(File(dir, name))
        val out = file.startWrite()
        try {
            out.write(bytes)
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
            throw e
        }
    }

    override fun keepOnlyBuild(build: String) {
        root.listFiles()?.filter { it.name != build }?.forEach { it.deleteRecursively() }
    }
}
