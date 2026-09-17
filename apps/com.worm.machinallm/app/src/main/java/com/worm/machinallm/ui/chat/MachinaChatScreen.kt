package com.worm.machinallm.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.worm.machinallm.R
import com.worm.machinallm.core.AiResult
import com.worm.machinallm.core.MachinaCore
import com.worm.machinallm.model.Message
import com.worm.machinallm.model.MessageRole
import com.worm.machinallm.repository.MachinaRepository
import com.worm.machinallm.ui.theme.MachinaLLMTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MachinaChatScreen(
    repository: MachinaRepository = remember { MachinaCore.createRepository() },
) {
    val messages = rememberSaveable(saver = MessagesSaver) {
        mutableStateListOf<Message>()
    }
    var inputText by rememberSaveable { mutableStateOf("") }
    var isSending by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current
    val coroutineScope = rememberCoroutineScope()

    fun sendMessage() {
        val text = inputText.trim()
        if (text.isEmpty() || isSending) return

        messages += Message(text = text, role = MessageRole.USER)
        inputText = ""
        isSending = true
        focusManager.clearFocus()

        coroutineScope.launch {
            val result = repository.sendMessage(messages.toList())
            val assistantText = when (result) {
                is AiResult.Success -> result.text
                is AiResult.Error -> result.message
            }

            messages += Message(
                text = assistantText,
                role = MessageRole.ASSISTANT,
            )
            isSending = false
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = { Text(text = stringResource(id = R.string.app_name)) },
            )
        },
        bottomBar = {
            MessageInput(
                value = inputText,
                onValueChange = { inputText = it },
                onSend = ::sendMessage,
                isSending = isSending,
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->
        if (messages.isEmpty()) {
            EmptyState(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
            )
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                verticalArrangement = Arrangement.spacedBy(18.dp),
                contentPadding = PaddingValues(16.dp),
            ) {
                items(messages) { message ->
                    MessageRow(message = message)
                }
            }
        }
    }
}

@Composable
private fun EmptyState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = stringResource(id = R.string.empty_chat_prompt),
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun MessageRow(message: Message) {
    val isUser = message.role == MessageRole.USER

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(0.86f),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = if (isUser) "You" else stringResource(id = R.string.app_name),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = message.text,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun MessageInput(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    isSending: Boolean,
) {
    val inputContentDescription = stringResource(id = R.string.message_input_content_description)
    val sendContentDescription = stringResource(id = R.string.send_message_content_description)

    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        tonalElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = !isSending,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp)
                    .semantics {
                        contentDescription = inputContentDescription
                    },
                placeholder = {
                    Text(text = stringResource(id = R.string.message_input_placeholder))
                },
                minLines = 1,
                maxLines = 5,
                keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
            )
            Button(
                onClick = onSend,
                enabled = value.isNotBlank() && !isSending,
                modifier = Modifier
                    .heightIn(min = 56.dp)
                    .semantics {
                        contentDescription = sendContentDescription
                    },
            ) {
                Text(
                    text = if (isSending) {
                        stringResource(id = R.string.send_message_loading)
                    } else {
                        stringResource(id = R.string.send_message)
                    },
                )
            }
        }
    }
}

private val MessagesSaver = Saver<androidx.compose.runtime.snapshots.SnapshotStateList<Message>, List<String>>(
    save = { messages ->
        messages.flatMap { message ->
            listOf(message.role.name, message.text)
        }
    },
    restore = { saved ->
        mutableStateListOf<Message>().apply {
            saved.chunked(2).forEach { item ->
                if (item.size == 2) {
                    add(Message(text = item[1], role = MessageRole.valueOf(item[0])))
                }
            }
        }
    },
)

@Preview(showBackground = true)
@Composable
private fun MachinaChatScreenPreview() {
    MachinaLLMTheme {
        MachinaChatScreen()
    }
}
