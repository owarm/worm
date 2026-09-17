package com.worm.machinallm.ui.sftp

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.worm.machinallm.ssh.SftpEntry
import com.worm.machinallm.ssh.SftpEntryType
import com.worm.machinallm.ssh.SftpManager
import com.worm.machinallm.ssh.SftpSaveResult
import com.worm.machinallm.ssh.SftpTextDocument
import com.worm.machinallm.ssh.SshConnectionManager
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun SftpScreen(
    connectionManager: SshConnectionManager,
    onAskAi: (action: String, fileName: String, content: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val manager = remember(connectionManager) { SftpManager(context.applicationContext, connectionManager) }

    var currentPath by rememberSaveable { mutableStateOf(".") }
    var entries by remember { mutableStateOf<List<SftpEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("Connect SSH, then refresh files.") }
    var viewer by remember { mutableStateOf<SftpTextDocument?>(null) }
    var editText by rememberSaveable { mutableStateOf("") }
    var renameEntry by remember { mutableStateOf<SftpEntry?>(null) }
    var renameTarget by rememberSaveable { mutableStateOf("") }
    var mkdirDialog by remember { mutableStateOf(false) }
    var mkdirName by rememberSaveable { mutableStateOf("") }
    var deleteEntry by remember { mutableStateOf<SftpEntry?>(null) }
    var pendingDownload by remember { mutableStateOf<SftpEntry?>(null) }

    fun refresh(path: String = currentPath) {
        scope.launch {
            loading = true
            try {
                entries = manager.listDirectory(path)
                currentPath = path
                message = "${entries.size} items"
            } catch (error: Exception) {
                message = error.message ?: "SFTP refresh failed."
            } finally {
                loading = false
            }
        }
    }

    fun openFile(entry: SftpEntry) {
        scope.launch {
            loading = true
            try {
                val document = manager.openTextFile(entry.path)
                viewer = document
                editText = document.content
                message = "Opened ${entry.name}"
            } catch (error: Exception) {
                message = error.message ?: "Cannot open file."
            } finally {
                loading = false
            }
        }
    }

    val downloadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri: Uri? ->
        val entry = pendingDownload
        pendingDownload = null
        if (uri != null && entry != null) {
            scope.launch {
                loading = true
                try {
                    manager.download(entry.path, context.contentResolver, uri)
                    message = "Downloaded ${entry.name}"
                } catch (error: Exception) {
                    message = error.message ?: "Download failed."
                } finally {
                    loading = false
                }
            }
        }
    }

    val uploadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                loading = true
                try {
                    val name = uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { null } ?: "upload.bin"
                    manager.upload(context.contentResolver, uri, joinPath(currentPath, name))
                    message = "Uploaded $name"
                    refresh()
                } catch (error: Exception) {
                    message = error.message ?: "Upload failed."
                } finally {
                    loading = false
                }
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose { manager.clearTemp() }
    }

    LaunchedEffect(Unit) {
        refresh()
    }

    Column(modifier = modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = currentPath,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { refresh(parentPath(currentPath)) },
                        enabled = !loading,
                    ) {
                        Text("Up")
                    }
                    OutlinedButton(onClick = { refresh() }, enabled = !loading) {
                        Text("Refresh")
                    }
                    OutlinedButton(onClick = { mkdirDialog = true }, enabled = !loading) {
                        Text("Mkdir")
                    }
                    Button(onClick = { uploadLauncher.launch(arrayOf("*/*")) }, enabled = !loading) {
                        Text("Upload")
                    }
                }
                Text(
                    text = if (loading) "Working..." else message,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(entries, key = { it.path }) { entry ->
                SftpEntryRow(
                    entry = entry,
                    onOpen = {
                        if (entry.type == SftpEntryType.DIRECTORY) refresh(entry.path) else openFile(entry)
                    },
                    onDownload = {
                        pendingDownload = entry
                        downloadLauncher.launch(entry.name)
                    },
                    onRename = {
                        renameEntry = entry
                        renameTarget = entry.name
                    },
                    onDelete = { deleteEntry = entry },
                )
            }
        }
    }

    viewer?.let { document ->
        TextEditorDialog(
            document = document,
            value = editText,
            onValueChange = { editText = it },
            onAskAi = { action ->
                onAskAi(action, document.path.substringAfterLast('/'), editText)
                viewer = null
            },
            onDismiss = { viewer = null },
            onSave = {
                scope.launch {
                    loading = true
                    try {
                        when (manager.saveTextFile(document, editText)) {
                            SftpSaveResult.Saved -> {
                                message = "Saved ${document.path.substringAfterLast('/')}"
                                viewer = null
                                refresh()
                            }

                            SftpSaveResult.Conflict -> {
                                message = "Remote file changed. Save blocked to avoid overwriting newer content."
                            }
                        }
                    } catch (error: Exception) {
                        message = error.message ?: "Save failed."
                    } finally {
                        loading = false
                    }
                }
            },
        )
    }

    renameEntry?.let { entry ->
        AlertDialog(
            onDismissRequest = { renameEntry = null },
            title = { Text("Rename") },
            text = {
                OutlinedTextField(
                    value = renameTarget,
                    onValueChange = { renameTarget = it },
                    singleLine = true,
                    label = { Text("New name") },
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            try {
                                manager.rename(entry.path, joinPath(parentPath(entry.path), renameTarget))
                                message = "Renamed ${entry.name}"
                                renameEntry = null
                                refresh()
                            } catch (error: Exception) {
                                message = error.message ?: "Rename failed."
                            }
                        }
                    },
                    enabled = renameTarget.isNotBlank(),
                ) {
                    Text("Rename")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameEntry = null }) { Text("Cancel") }
            },
        )
    }

    if (mkdirDialog) {
        AlertDialog(
            onDismissRequest = { mkdirDialog = false },
            title = { Text("New directory") },
            text = {
                OutlinedTextField(
                    value = mkdirName,
                    onValueChange = { mkdirName = it },
                    singleLine = true,
                    label = { Text("Name") },
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            try {
                                manager.mkdir(joinPath(currentPath, mkdirName))
                                message = "Created $mkdirName"
                                mkdirDialog = false
                                mkdirName = ""
                                refresh()
                            } catch (error: Exception) {
                                message = error.message ?: "Create directory failed."
                            }
                        }
                    },
                    enabled = mkdirName.isNotBlank(),
                ) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { mkdirDialog = false }) { Text("Cancel") }
            },
        )
    }

    deleteEntry?.let { entry ->
        AlertDialog(
            onDismissRequest = { deleteEntry = null },
            title = { Text(if (entry.type == SftpEntryType.DIRECTORY) "Delete directory?" else "Delete file?") },
            text = { Text(entry.path) },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            try {
                                if (entry.type == SftpEntryType.DIRECTORY) {
                                    manager.deleteDirectory(entry.path)
                                } else {
                                    manager.deleteFile(entry.path)
                                }
                                message = "Deleted ${entry.name}"
                                deleteEntry = null
                                refresh()
                            } catch (error: Exception) {
                                message = error.message ?: "Delete failed."
                            }
                        }
                    },
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteEntry = null }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun SftpEntryRow(
    entry: SftpEntry,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = entry.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = "${entry.type.label()}  ${entry.size.toDisplaySize()}  ${entry.modifiedTime.toDisplayTime()}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpen) {
                    Text(if (entry.type == SftpEntryType.DIRECTORY) "Open" else "View")
                }
                if (entry.type == SftpEntryType.FILE) {
                    OutlinedButton(onClick = onDownload) { Text("Download") }
                }
                OutlinedButton(onClick = onRename) { Text("Rename") }
                TextButton(onClick = onDelete) { Text("Delete") }
            }
        }
    }
}

@Composable
private fun TextEditorDialog(
    document: SftpTextDocument,
    value: String,
    onValueChange: (String) -> Unit,
    onAskAi: (String) -> Unit,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(document.path.substringAfterLast('/')) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "AI actions send this visible file content to the remote term-llm backend after preview.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onAskAi("Explain") }) { Text("Explain") }
                    OutlinedButton(onClick = { onAskAi("Summarize") }) { Text("Summarize") }
                    OutlinedButton(onClick = { onAskAi("Fix") }) { Text("Fix") }
                }
                OutlinedTextField(
                    value = value,
                    onValueChange = onValueChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 280.dp, max = 480.dp),
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    minLines = 12,
                )
            }
        },
        confirmButton = {
            Button(onClick = onSave) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        },
    )
}

private fun SftpEntryType.label(): String {
    return when (this) {
        SftpEntryType.FILE -> "file"
        SftpEntryType.DIRECTORY -> "dir"
        SftpEntryType.SYMLINK -> "link"
        SftpEntryType.OTHER -> "other"
    }
}

private fun Long.toDisplaySize(): String {
    return when {
        this < 1024L -> "$this B"
        this < 1024L * 1024L -> "${this / 1024L} KB"
        else -> "${this / (1024L * 1024L)} MB"
    }
}

private fun Long.toDisplayTime(): String {
    if (this <= 0L) return "unknown"
    return DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
        .withZone(ZoneId.systemDefault())
        .format(Instant.ofEpochSecond(this))
}

private fun parentPath(path: String): String {
    val clean = path.trimEnd('/')
    if (clean.isBlank() || clean == "." || clean == "/") return "."
    val parent = clean.substringBeforeLast('/', missingDelimiterValue = ".")
    return parent.ifBlank { "/" }
}

private fun joinPath(parent: String, child: String): String {
    val cleanChild = child.trim()
    return when {
        parent == "/" -> "/$cleanChild"
        parent == "." || parent.isBlank() -> cleanChild
        else -> parent.trimEnd('/') + "/" + cleanChild
    }
}
