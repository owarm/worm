package com.worm.machinallm.ssh

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.schmizz.sshj.sftp.FileAttributes
import net.schmizz.sshj.sftp.FileMode
import net.schmizz.sshj.xfer.LocalDestFile
import net.schmizz.sshj.xfer.LocalFileFilter
import net.schmizz.sshj.xfer.LocalSourceFile
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

class SftpManager(
    private val context: Context,
    private val connectionManager: SshConnectionManager,
) {
    private val cacheDir = File(context.cacheDir, "sftp").apply { mkdirs() }

    suspend fun listDirectory(path: String): List<SftpEntry> {
        return runSftp {
            connectionManager.withSftpClient { client ->
                client.ls(path)
                    .filterNot { it.name == "." || it.name == ".." }
                    .map { info ->
                        SftpEntry(
                            name = info.name,
                            path = info.path,
                            type = info.attributes.toEntryType(info.isDirectory, info.isRegularFile),
                            size = info.attributes.getSize(),
                            modifiedTime = info.attributes.getMtime(),
                        )
                    }
                    .sortedWith(compareBy<SftpEntry> { it.type != SftpEntryType.DIRECTORY }.thenBy { it.name.lowercase() })
            }
        }
    }

    suspend fun stat(path: String): SftpEntry {
        return runSftp {
            connectionManager.withSftpClient { client ->
                val attributes = client.stat(path)
                SftpEntry(
                    name = path.substringAfterLast('/').ifBlank { path },
                    path = path,
                    type = attributes.toEntryType(
                        isDirectory = attributes.getType() == FileMode.Type.DIRECTORY,
                        isRegularFile = attributes.getType() == FileMode.Type.REGULAR,
                    ),
                    size = attributes.getSize(),
                    modifiedTime = attributes.getMtime(),
                )
            }
        }
    }

    suspend fun download(remotePath: String, resolver: ContentResolver, destination: Uri) {
        runSftp {
            connectionManager.withSftpClient { client ->
                resolver.openOutputStream(destination, "wt")?.use { output ->
                    client.get(remotePath, StreamDestFile(output))
                } ?: throw IOException("Cannot open selected destination.")
            }
        }
    }

    suspend fun upload(resolver: ContentResolver, source: Uri, remotePath: String) {
        runSftp {
            val length = resolver.openAssetFileDescriptor(source, "r")?.use { it.length } ?: -1L
            connectionManager.withSftpClient { client ->
                resolver.openInputStream(source)?.use { input ->
                    client.put(StreamSourceFile(name = remotePath.substringAfterLast('/'), length = length, input = input), remotePath)
                } ?: throw IOException("Cannot open selected file.")
            }
        }
    }

    suspend fun rename(from: String, to: String) {
        runSftp {
            connectionManager.withSftpClient { client -> client.rename(from, to) }
        }
    }

    suspend fun mkdir(path: String) {
        runSftp {
            connectionManager.withSftpClient { client -> client.mkdir(path) }
        }
    }

    suspend fun deleteFile(path: String) {
        runSftp {
            connectionManager.withSftpClient { client -> client.rm(path) }
        }
    }

    suspend fun deleteDirectory(path: String) {
        runSftp {
            connectionManager.withSftpClient { client -> client.rmdir(path) }
        }
    }

    suspend fun openTextFile(path: String): SftpTextDocument {
        return runSftp {
            val info = stat(path)
            if (!isSupportedTextFile(path)) throw SftpUserException("This file type is not supported by the beta viewer.")
            if (info.size > TEXT_FILE_LIMIT_BYTES) throw SftpUserException("File is too large for the beta text viewer.")

            val temp = File(cacheDir, "edit-${System.nanoTime()}.tmp")
            try {
                connectionManager.withSftpClient { client -> client.get(path, FileDestFile(temp)) }
                val content = temp.readText(Charsets.UTF_8)
                SftpTextDocument(
                    path = path,
                    content = content,
                    size = info.size,
                    modifiedTime = info.modifiedTime,
                )
            } finally {
                temp.delete()
            }
        }
    }

    suspend fun saveTextFile(document: SftpTextDocument, content: String): SftpSaveResult {
        return runSftp {
            connectionManager.withSftpClient { client ->
                val current = client.stat(document.path)
                if (current.getMtime() != document.modifiedTime) {
                    return@withSftpClient SftpSaveResult.Conflict
                }
                val bytes = content.toByteArray(Charsets.UTF_8)
                client.put(ByteArraySourceFile(document.path.substringAfterLast('/'), bytes), document.path)
                SftpSaveResult.Saved
            }
        }
    }

    fun clearTemp() {
        cacheDir.listFiles()?.forEach { it.delete() }
    }

    private suspend fun <T> runSftp(block: suspend () -> T): T {
        return try {
            withContext(Dispatchers.IO) { block() }
        } catch (error: SftpUserException) {
            throw error
        } catch (error: Exception) {
            throw SftpUserException(error.toUserMessage())
        }
    }

    private fun FileAttributes.toEntryType(isDirectory: Boolean, isRegularFile: Boolean): SftpEntryType {
        return when {
            isDirectory -> SftpEntryType.DIRECTORY
            isRegularFile -> SftpEntryType.FILE
            getType() == FileMode.Type.SYMLINK -> SftpEntryType.SYMLINK
            else -> SftpEntryType.OTHER
        }
    }

    private fun Exception.toUserMessage(): String {
        val text = message.orEmpty()
        return when {
            text.contains("Permission denied", ignoreCase = true) -> "Permission denied."
            text.contains("No such file", ignoreCase = true) -> "File not found."
            text.contains("not active", ignoreCase = true) -> "Connection lost. Reconnect SSH and retry."
            text.contains("No space", ignoreCase = true) || text.contains("disk", ignoreCase = true) -> "Remote disk is full."
            text.contains("interrupted", ignoreCase = true) -> "Transfer interrupted."
            else -> text.take(180).ifBlank { "SFTP operation failed." }
        }
    }

    private class StreamDestFile(private val output: OutputStream) : LocalDestFile {
        override fun getLength(): Long = 0L
        override fun getOutputStream(): OutputStream = output
        override fun getOutputStream(append: Boolean): OutputStream = output
        override fun getChild(name: String): LocalDestFile = this
        override fun getTargetFile(filename: String): LocalDestFile = this
        override fun getTargetDirectory(dirname: String): LocalDestFile = this
        override fun setPermissions(perms: Int) = Unit
        override fun setLastAccessedTime(t: Long) = Unit
        override fun setLastModifiedTime(t: Long) = Unit
    }

    private class FileDestFile(private val file: File) : LocalDestFile {
        override fun getLength(): Long = file.length()
        override fun getOutputStream(): OutputStream = file.outputStream()
        override fun getOutputStream(append: Boolean): OutputStream = file.outputStream().buffered()
        override fun getChild(name: String): LocalDestFile = FileDestFile(File(file, name))
        override fun getTargetFile(filename: String): LocalDestFile = FileDestFile(file)
        override fun getTargetDirectory(dirname: String): LocalDestFile = FileDestFile(file)
        override fun setPermissions(perms: Int) = Unit
        override fun setLastAccessedTime(t: Long) {
            file.setLastModified(t * 1000)
        }

        override fun setLastModifiedTime(t: Long) {
            file.setLastModified(t * 1000)
        }
    }

    private class StreamSourceFile(
        private val name: String,
        private val length: Long,
        private val input: InputStream,
    ) : LocalSourceFile {
        override fun getName(): String = name
        override fun getLength(): Long = length
        override fun getInputStream(): InputStream = input
        override fun getPermissions(): Int = 0b110_100_100
        override fun isFile(): Boolean = true
        override fun isDirectory(): Boolean = false
        override fun getChildren(filter: LocalFileFilter): Iterable<LocalSourceFile> = emptyList()
        override fun providesAtimeMtime(): Boolean = false
        override fun getLastAccessTime(): Long = 0L
        override fun getLastModifiedTime(): Long = 0L
    }

    private class ByteArraySourceFile(
        private val name: String,
        private val bytes: ByteArray,
    ) : LocalSourceFile {
        override fun getName(): String = name
        override fun getLength(): Long = bytes.size.toLong()
        override fun getInputStream(): InputStream = ByteArrayInputStream(bytes)
        override fun getPermissions(): Int = 0b110_100_100
        override fun isFile(): Boolean = true
        override fun isDirectory(): Boolean = false
        override fun getChildren(filter: LocalFileFilter): Iterable<LocalSourceFile> = emptyList()
        override fun providesAtimeMtime(): Boolean = false
        override fun getLastAccessTime(): Long = 0L
        override fun getLastModifiedTime(): Long = 0L
    }

    companion object {
        const val TEXT_FILE_LIMIT_BYTES = 256 * 1024L

        fun isSupportedTextFile(path: String): Boolean {
            val extension = path.substringAfterLast('.', missingDelimiterValue = "").lowercase()
            return extension in setOf(
                "txt",
                "md",
                "log",
                "json",
                "yaml",
                "yml",
                "xml",
                "kt",
                "java",
                "py",
                "sh",
                "conf",
                "ini",
            )
        }
    }
}

data class SftpEntry(
    val name: String,
    val path: String,
    val type: SftpEntryType,
    val size: Long,
    val modifiedTime: Long,
)

enum class SftpEntryType {
    FILE,
    DIRECTORY,
    SYMLINK,
    OTHER,
}

data class SftpTextDocument(
    val path: String,
    val content: String,
    val size: Long,
    val modifiedTime: Long,
)

sealed interface SftpSaveResult {
    data object Saved : SftpSaveResult
    data object Conflict : SftpSaveResult
}

class SftpUserException(message: String) : Exception(message)
