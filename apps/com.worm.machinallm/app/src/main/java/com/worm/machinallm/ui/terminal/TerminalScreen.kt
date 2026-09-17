package com.worm.machinallm.ui.terminal

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.worm.machinallm.ssh.AuthType
import com.worm.machinallm.ssh.AiContextDraft
import com.worm.machinallm.ssh.SecureSecretStore
import com.worm.machinallm.ssh.SshConnectionManager
import com.worm.machinallm.ssh.SshConnectionState
import com.worm.machinallm.ssh.SshHostProfile
import com.worm.machinallm.ssh.SshProfileRepository
import com.worm.machinallm.ui.ai.AiScreen
import com.worm.machinallm.ui.sftp.SftpScreen
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen() {
    val context = LocalContext.current
    val manager = remember { SshConnectionManager(context) }
    val profilesRepository = remember { SshProfileRepository(context) }
    val secretStore = remember { SecureSecretStore(context) }
    val state by manager.state.collectAsState()
    val scope = rememberCoroutineScope()
    val profiles = remember { mutableStateListOf<SshHostProfile>().apply { addAll(profilesRepository.loadProfiles()) } }
    val history = remember { mutableStateListOf<String>() }

    var selectedProfileId by rememberSaveable { mutableStateOf(profiles.firstOrNull()?.id.orEmpty()) }
    var name by rememberSaveable { mutableStateOf("") }
    var hostname by rememberSaveable { mutableStateOf("") }
    var portText by rememberSaveable { mutableStateOf("22") }
    var username by rememberSaveable { mutableStateOf("") }
    var authType by rememberSaveable { mutableStateOf(AuthType.PASSWORD) }
    var secret by rememberSaveable { mutableStateOf("") }
    var command by rememberSaveable { mutableStateOf("") }
    var selectedTab by rememberSaveable { mutableStateOf(MainTab.TERMINAL) }
    var pendingAiContext by remember { mutableStateOf<AiContextDraft?>(null) }

    val selectedProfile = profiles.firstOrNull { it.id == selectedProfileId } ?: profiles.firstOrNull()

    DisposableEffect(Unit) {
        onDispose { scope.launch { manager.disconnect() } }
    }

    LaunchedEffect(selectedProfile?.id) {
        selectedProfile?.let {
            selectedProfileId = it.id
            name = it.name
            hostname = it.hostname
            portText = it.port.toString()
            username = it.username
            authType = it.authType
            secret = ""
        }
    }

    fun saveProfile(): SshHostProfile? {
        val port = portText.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
        val profile = SshHostProfile(
            id = selectedProfile?.id ?: java.util.UUID.randomUUID().toString(),
            name = name.ifBlank { hostname },
            hostname = hostname.trim(),
            port = port,
            username = username.trim(),
            authType = authType,
        )
        if (profile.hostname.isBlank() || profile.username.isBlank()) return null
        profilesRepository.saveProfile(profile)
        if (secret.isNotBlank()) {
            when (authType) {
                AuthType.PASSWORD -> secretStore.savePassword(profile.id, secret)
                AuthType.PRIVATE_KEY -> secretStore.savePrivateKey(profile.id, secret)
            }
        }
        profiles.removeAll { it.id == profile.id }
        profiles.add(profile)
        selectedProfileId = profile.id
        secret = ""
        return profile
    }

    fun sendCommand() {
        val text = command
        if (text.isBlank()) return
        history.add(text)
        manager.send(text)
        command = ""
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(text = selectedProfile?.name ?: "MachinaLLM SSH")
                        Text(
                            text = state.statusMessage,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    if (state.connectionState == SshConnectionState.CONNECTED) {
                        TextButton(onClick = { scope.launch { manager.disconnect() } }) {
                            Text("Disconnect")
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (selectedTab == MainTab.TERMINAL) {
                TerminalInput(
                    value = command,
                    enabled = state.connectionState == SshConnectionState.CONNECTED,
                    onValueChange = { command = it },
                    onSend = ::sendCommand,
                )
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            ProfileEditor(
                profiles = profiles,
                selectedProfileId = selectedProfileId,
                name = name,
                hostname = hostname,
                portText = portText,
                username = username,
                authType = authType,
                secret = secret,
                onSelectedProfile = { selectedProfileId = it },
                onNameChange = { name = it },
                onHostnameChange = { hostname = it },
                onPortChange = { portText = it.filter(Char::isDigit).take(5) },
                onUsernameChange = { username = it },
                onAuthTypeChange = { authType = it },
                onSecretChange = { secret = it },
                onNew = {
                    selectedProfileId = ""
                    name = ""
                    hostname = ""
                    portText = "22"
                    username = ""
                    authType = AuthType.PASSWORD
                    secret = ""
                },
                onSave = { saveProfile() },
                onConnect = {
                    val profile = saveProfile()
                    if (profile != null) {
                        scope.launch { manager.connect(profile) }
                    }
                },
                connecting = state.connectionState == SshConnectionState.CONNECTING,
            )

            TabRow(selectedTabIndex = selectedTab.ordinal) {
                MainTab.entries.forEach { tab ->
                    Tab(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        text = { Text(tab.label) },
                    )
                }
            }

            if (state.connectionState == SshConnectionState.DISCONNECTED || state.connectionState == SshConnectionState.ERROR) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = if (state.connectionState == SshConnectionState.ERROR) state.statusMessage else "Disconnected",
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (selectedProfile != null) {
                        OutlinedButton(onClick = { scope.launch { manager.reconnect() } }) {
                            Text("Reconnect")
                        }
                    }
                }
            }

            when (selectedTab) {
                MainTab.TERMINAL -> Column(modifier = Modifier.weight(1f)) {
                    TerminalAiActions(
                        enabled = state.output.isNotBlank(),
                        onAskLast = { count ->
                            pendingAiContext = AiContextDraft(
                                title = "Terminal context preview",
                                body = "Explain this terminal output. Only use the selected excerpt.\n\n" +
                                    state.output.takeLast(count),
                            )
                            selectedTab = MainTab.AI
                        },
                    )
                    TerminalOutput(
                        output = state.output,
                        modifier = Modifier.weight(1f),
                    )
                }

                MainTab.FILES -> SftpScreen(
                    connectionManager = manager,
                    onAskAi = { action, fileName, content ->
                        pendingAiContext = AiContextDraft(
                            title = "$action $fileName",
                            body = "$action this file content. Do not assume hidden context.\n\n$content",
                        )
                        selectedTab = MainTab.AI
                    },
                    modifier = Modifier.weight(1f),
                )

                MainTab.AI -> AiScreen(
                    connectionManager = manager,
                    pendingContext = pendingAiContext,
                    onContextConsumed = { pendingAiContext = null },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }

    state.pendingHostKey?.let { pending ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Confirm SSH host key") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${pending.hostname}:${pending.port}")
                    Text(pending.algorithm)
                    Text(
                        text = pending.fingerprint,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            },
            confirmButton = {
                Button(onClick = { scope.launch { manager.confirmHostKey(pending) } }) {
                    Text("Trust")
                }
            },
            dismissButton = {
                TextButton(onClick = { scope.launch { manager.disconnect() } }) {
                    Text("Cancel")
                }
            },
        )
    }
}

private enum class MainTab(val label: String) {
    TERMINAL("Terminal"),
    FILES("Files"),
    AI("AI"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProfileEditor(
    profiles: List<SshHostProfile>,
    selectedProfileId: String,
    name: String,
    hostname: String,
    portText: String,
    username: String,
    authType: AuthType,
    secret: String,
    onSelectedProfile: (String) -> Unit,
    onNameChange: (String) -> Unit,
    onHostnameChange: (String) -> Unit,
    onPortChange: (String) -> Unit,
    onUsernameChange: (String) -> Unit,
    onAuthTypeChange: (AuthType) -> Unit,
    onSecretChange: (String) -> Unit,
    onNew: () -> Unit,
    onSave: () -> SshHostProfile?,
    onConnect: () -> Unit,
    connecting: Boolean,
) {
    var expanded by remember { mutableStateOf(false) }

    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it },
                    modifier = Modifier.weight(1f),
                ) {
                    OutlinedTextField(
                        value = profiles.firstOrNull { it.id == selectedProfileId }?.name ?: "New host",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Profile") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        modifier = Modifier.menuAnchor().fillMaxWidth(),
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false },
                    ) {
                        profiles.forEach { profile ->
                            DropdownMenuItem(
                                text = { Text(profile.name) },
                                onClick = {
                                    onSelectedProfile(profile.id)
                                    expanded = false
                                },
                            )
                        }
                    }
                }
                OutlinedButton(onClick = onNew) { Text("New") }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = onNameChange,
                    label = { Text("Name") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = portText,
                    onValueChange = onPortChange,
                    label = { Text("Port") },
                    modifier = Modifier.width(96.dp),
                    singleLine = true,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = hostname,
                    onValueChange = onHostnameChange,
                    label = { Text("Hostname") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = username,
                    onValueChange = onUsernameChange,
                    label = { Text("User") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                AuthType.entries.forEach { type ->
                    OutlinedButton(
                        onClick = { onAuthTypeChange(type) },
                        enabled = authType != type,
                    ) {
                        Text(if (type == AuthType.PASSWORD) "Password" else "Private key")
                    }
                }
            }
            OutlinedTextField(
                value = secret,
                onValueChange = onSecretChange,
                label = { Text(if (authType == AuthType.PASSWORD) "Password" else "Private key") },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp),
                minLines = if (authType == AuthType.PRIVATE_KEY) 3 else 1,
                maxLines = if (authType == AuthType.PRIVATE_KEY) 6 else 1,
                visualTransformation = if (authType == AuthType.PASSWORD) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onSave() }) { Text("Save") }
                Button(
                    onClick = onConnect,
                    enabled = !connecting && hostname.isNotBlank() && username.isNotBlank(),
                ) {
                    Text(if (connecting) "Connecting" else "Connect")
                }
            }
        }
    }
}

@Composable
private fun TerminalAiActions(
    enabled: Boolean,
    onAskLast: (Int) -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Ask AI",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(
                onClick = { onAskLast(1_000) },
                enabled = enabled,
            ) {
                Text("Last 1K")
            }
            OutlinedButton(
                onClick = { onAskLast(4_000) },
                enabled = enabled,
            ) {
                Text("Last 4K")
            }
        }
    }
}

@Composable
private fun TerminalOutput(output: String, modifier: Modifier = Modifier) {
    val listState = rememberLazyListState()
    val lines = remember(output) {
        if (output.isBlank()) listOf("Ready.") else output.replace("\r", "").lines()
    }

    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) listState.animateScrollToItem(lines.lastIndex)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(12.dp),
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 12.dp),
        ) {
            items(lines) { line ->
                Text(
                    text = line.ifEmpty { " " },
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

@Composable
private fun TerminalInput(
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
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                modifier = Modifier.weight(1f),
                label = { Text("Command") },
                singleLine = true,
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
