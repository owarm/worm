#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
SRC="$PROJECT_DIR/app/src/main/java/com/worm/machinallm"
MAIN="$SRC/MainActivity.kt"
ROOT_MODEL="$SRC/Message.kt"
STRINGS="$PROJECT_DIR/app/src/main/res/values/strings.xml"

cat > "$MAIN" <<'EOF_MAIN'
package com.worm.machinallm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.worm.machinallm.ui.theme.MachinaLLMTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            MachinaLLMTheme {
                MachinaLLMScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MachinaLLMScreen() {
    val messages = remember { mutableStateListOf<Message>() }
    var inputText by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current

    fun sendMessage() {
        val text = inputText.trim()
        if (text.isEmpty()) return

        messages += Message(text = text, role = MessageRole.USER)
        inputText = ""
        messages += Message(
            text = "MachinaLLM backend is not configured yet.",
            role = MessageRole.ASSISTANT,
        )
        focusManager.clearFocus()
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
                verticalArrangement = Arrangement.spacedBy(12.dp),
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
        Surface(
            modifier = Modifier.fillMaxWidth(0.82f),
            shape = RoundedCornerShape(14.dp),
            color = if (isUser) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
            tonalElevation = 0.dp,
        ) {
            Text(
                text = message.text,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = if (isUser) {
                    MaterialTheme.colorScheme.onPrimary
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
        }
    }
}

@Composable
private fun MessageInput(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
) {
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
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp)
                    .semantics {
                        contentDescription = "Message input"
                    },
                placeholder = {
                    Text(text = stringResource(id = R.string.message_input_placeholder))
                },
                shape = RoundedCornerShape(18.dp),
                minLines = 1,
                maxLines = 5,
                keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
            )
            Button(
                onClick = onSend,
                enabled = value.isNotBlank(),
                modifier = Modifier
                    .heightIn(min = 56.dp)
                    .semantics {
                        contentDescription = "Send message"
                    },
            ) {
                Text(text = stringResource(id = R.string.send_message))
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun MachinaLLMScreenPreview() {
    MachinaLLMTheme {
        MachinaLLMScreen()
    }
}
EOF_MAIN

cat > "$ROOT_MODEL" <<'EOF_MODEL'
package com.worm.machinallm

data class Message(
    val text: String,
    val role: MessageRole,
)

enum class MessageRole {
    USER,
    ASSISTANT,
}
EOF_MODEL

cat > "$STRINGS" <<'EOF_STRINGS'
<resources>
    <string name="app_name">MachinaLLM</string>
    <string name="app_subtitle">System AI for Worm OS</string>
    <string name="empty_chat_prompt">How can I help?</string>
    <string name="message_input_placeholder">Message MachinaLLM</string>
    <string name="send_message">Send</string>
</resources>
EOF_STRINGS

rm -rf "$SRC/core" "$SRC/model" "$SRC/provider" "$SRC/repository"
echo "[OK] reverted worm-machinallm-v003-core"
