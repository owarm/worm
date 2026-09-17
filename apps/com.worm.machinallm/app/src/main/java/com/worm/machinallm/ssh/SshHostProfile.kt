package com.worm.machinallm.ssh

import java.util.UUID

enum class AuthType {
    PASSWORD,
    PRIVATE_KEY,
}

data class SshHostProfile(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val hostname: String,
    val port: Int = 22,
    val username: String,
    val authType: AuthType,
)

enum class SshConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    ERROR,
}

data class PendingHostKey(
    val hostId: String,
    val hostname: String,
    val port: Int,
    val algorithm: String,
    val fingerprint: String,
)

data class TerminalUiState(
    val connectionState: SshConnectionState = SshConnectionState.DISCONNECTED,
    val statusMessage: String = "Disconnected",
    val output: String = "",
    val pendingHostKey: PendingHostKey? = null,
)
