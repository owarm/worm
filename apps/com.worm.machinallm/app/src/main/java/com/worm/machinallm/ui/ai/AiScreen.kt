package com.worm.machinallm.ui.ai

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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.worm.machinallm.ssh.AiContextDraft
import com.worm.machinallm.ssh.AiPrivacyFilter
import com.worm.machinallm.ssh.AiRemoteManager
import com.worm.machinallm.ssh.AiRemoteResult
import com.worm.machinallm.ssh.SshConnectionManager
import kotlinx.coroutines.launch

@Composable
fun AiScreen(
    connectionManager: SshConnectionManager,
    pendingContext: AiContextDraft?,
    onContextConsumed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val aiManager = remember(connectionManager) { AiRemoteManager(connectionManager) }
    val messages = remember { mutableStateListOf<AiChatMessage>() }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var input by rememberSaveable { mutableStateOf("") }
    var status by remember { mutableStateOf("AI uses term-llm on the connected host.") }
    var sending by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<AiContextDraft?>(null) }
    var blockedMarkers by remember { mutableStateOf<List<String>>(emptyList()) }

    fun submit(text: String) {
        val prompt = text.trim()
        if (prompt.isBlank() || sending) return

        val markers = AiPrivacyFilter.findSensitiveMarkers(prompt)
        if (markers.isNotEmpty()) {
            blockedMarkers = markers
            status = "Sensitive content detected. Remove it before sending."
            return
        }

        messages += AiChatMessage(AiRole.USER, prompt)
        messages += AiChatMessage(AiRole.ASSISTANT, "")
        val assistantIndex = messages.lastIndex
        input = ""
        sending = true
        status = "Checking term-llm..."

        scope.launch {
            val result = aiManager.ask(prompt) { chunk ->
                val current = messages[assistantIndex]
                messages[assistantIndex] = current.copy(text = current.text + chunk)
                status = "Receiving..."
            }
            when (result) {
                is AiRemoteResult.Success -> {
                    if (messages[assistantIndex].text.isBlank()) {
                        messages[assistantIndex] = messages[assistantIndex].copy(text = result.text)
                    }
                    status = "Done"
                }

                is AiRemoteResult.Error -> {
                    messages[assistantIndex] = messages[assistantIndex].copy(text = result.message)
                    status = result.message
                }
            }
            sending = false
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    LaunchedEffect(pendingContext) {
        pendingContext?.let {
            preview = it
            onContextConsumed()
        }
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
                    text = "Remote AI",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = status,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "Content you send is passed to term-llm on the remote host and may be sent to the AI provider configured there.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(messages) { message ->
                AiMessageRow(message)
            }
        }

        AiInput(
            value = input,
            enabled = !sending,
            onValueChange = { input = it },
            onSend = { submit(input) },
        )
    }

    preview?.let { draft ->
        val markers = AiPrivacyFilter.findSensitiveMarkers(draft.body)
        AlertDialog(
            onDismissRequest = { preview = null },
            title = { Text("Send context to AI?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(draft.title)
                    if (markers.isNotEmpty()) {
                        Text(
                            text = "Sensitive markers found: ${markers.joinToString()}. Remove them before sending.",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    OutlinedTextField(
                        value = draft.body.take(CONTEXT_PREVIEW_LIMIT),
                        onValueChange = {},
                        readOnly = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 180.dp, max = 320.dp),
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        input = draft.body.take(CONTEXT_SEND_LIMIT)
                        preview = null
                    },
                    enabled = markers.isEmpty(),
                ) {
                    Text("Use")
                }
            },
            dismissButton = {
                TextButton(onClick = { preview = null }) { Text("Cancel") }
            },
        )
    }

    if (blockedMarkers.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { blockedMarkers = emptyList() },
            title = { Text("Sensitive content blocked") },
            text = {
                Text("Remove these markers before sending: ${blockedMarkers.joinToString()}")
            },
            confirmButton = {
                TextButton(onClick = { blockedMarkers = emptyList() }) {
                    Text("OK")
                }
            },
        )
    }
}

@Composable
private fun AiMessageRow(message: AiChatMessage) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = if (message.role == AiRole.USER) "USER" else "ASSISTANT",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
        )
        Text(
            text = message.text.ifBlank { "..." },
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = if (message.role == AiRole.ASSISTANT) FontFamily.Monospace else FontFamily.Default,
        )
    }
}

@Composable
private fun AiInput(
    value: String,
    enabled: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp),
                minLines = 1,
                maxLines = 6,
                label = { Text("Prompt") },
                keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
            )
            Button(
                onClick = onSend,
                enabled = enabled && value.isNotBlank(),
            ) {
                Text("Send")
            }
        }
    }
}

private data class AiChatMessage(
    val role: AiRole,
    val text: String,
)

private enum class AiRole {
    USER,
    ASSISTANT,
}

private const val CONTEXT_PREVIEW_LIMIT = 8_000
private const val CONTEXT_SEND_LIMIT = 12_000
