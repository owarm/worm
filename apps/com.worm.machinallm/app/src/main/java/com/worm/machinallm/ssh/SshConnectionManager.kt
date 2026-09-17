package com.worm.machinallm.ssh

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import java.io.InputStream
import java.io.OutputStream
import java.security.PublicKey
import java.util.concurrent.TimeUnit

class SshConnectionManager(context: Context) {
    private val appContext = context.applicationContext
    private val secrets = SecureSecretStore(appContext)
    private val knownHosts = KnownHostsStore(appContext)
    private val scope = CoroutineScope(Dispatchers.IO)
    private val _state = MutableStateFlow(TerminalUiState())

    val state: StateFlow<TerminalUiState> = _state

    private var client: SSHClient? = null
    private var session: Session? = null
    private var shell: Session.Shell? = null
    private var shellInput: OutputStream? = null
    private var lastProfile: SshHostProfile? = null
    private var stdoutJob: Job? = null
    private var stderrJob: Job? = null

    suspend fun connect(profile: SshHostProfile) {
        lastProfile = profile
        disconnectInternal(announce = false)
        _state.value = TerminalUiState(
            connectionState = SshConnectionState.CONNECTING,
            statusMessage = "Connecting",
        )

        withContext(Dispatchers.IO) {
            try {
                val sshClient = SSHClient()
                sshClient.addHostKeyVerifier(verifier(profile))
                sshClient.connect(profile.hostname, profile.port)
                authenticate(sshClient, profile)
                val sshSession = sshClient.startSession()
                sshSession.allocatePTY("xterm-256color", 80, 24, 0, 0, emptyMap())
                val sshShell = sshSession.startShell()

                client = sshClient
                session = sshSession
                shell = sshShell
                shellInput = sshShell.outputStream

                _state.update {
                    it.copy(
                        connectionState = SshConnectionState.CONNECTED,
                        statusMessage = "Connected",
                        pendingHostKey = null,
                    )
                }
                stdoutJob = readStream(sshShell.inputStream)
                stderrJob = readStream(sshShell.errorStream)
            } catch (pending: PendingHostKeyException) {
                disconnectInternal(announce = false)
                _state.value = TerminalUiState(
                    connectionState = SshConnectionState.ERROR,
                    statusMessage = "Confirm host fingerprint",
                    pendingHostKey = pending.pendingHostKey,
                )
            } catch (changed: HostKeyChangedException) {
                disconnectInternal(announce = false)
                _state.value = TerminalUiState(
                    connectionState = SshConnectionState.ERROR,
                    statusMessage = "Host key changed. Connection blocked.",
                    output = "WARNING: Host key changed for ${profile.hostname}:${profile.port}. Connection blocked.",
                )
            } catch (error: Exception) {
                disconnectInternal(announce = false)
                _state.value = TerminalUiState(
                    connectionState = SshConnectionState.ERROR,
                    statusMessage = "Connection error",
                    output = "Connection failed: ${error.safeMessage()}",
                )
            }
        }
    }

    suspend fun reconnect() {
        val profile = lastProfile ?: return
        connect(profile)
    }

    suspend fun disconnect() {
        disconnectInternal(announce = true)
    }

    suspend fun <T> withSftpClient(block: (SFTPClient) -> T): T {
        return withContext(Dispatchers.IO) {
            val sshClient = client
            if (sshClient == null || !sshClient.isConnected || !sshClient.isAuthenticated) {
                throw IllegalStateException("SSH connection is not active.")
            }
            sshClient.newSFTPClient().use { sftpClient ->
                block(sftpClient)
            }
        }
    }

    suspend fun runRemoteCommand(
        command: String,
        stdin: String? = null,
        timeoutMillis: Long = 120_000L,
        onStdout: suspend (String) -> Unit = {},
    ): RemoteCommandResult {
        return withContext(Dispatchers.IO) {
            val sshClient = client
            if (sshClient == null || !sshClient.isConnected || !sshClient.isAuthenticated) {
                throw IllegalStateException("SSH connection is not active.")
            }
            withTimeout(timeoutMillis) {
                sshClient.startSession().use { execSession ->
                    val remoteCommand = execSession.exec(command)
                    stdin?.let { input ->
                        remoteCommand.outputStream.use { output ->
                            output.write(input.toByteArray(Charsets.UTF_8))
                            output.flush()
                        }
                    } ?: remoteCommand.outputStream.close()

                    val stdout = async {
                        readCommandStream(remoteCommand.inputStream, onStdout)
                    }
                    val stderr = async {
                        readCommandStream(remoteCommand.errorStream)
                    }

                    remoteCommand.join(timeoutMillis, TimeUnit.MILLISECONDS)
                    val stdoutText = stdout.await()
                    val stderrText = stderr.await()
                    RemoteCommandResult(
                        exitStatus = remoteCommand.exitStatus ?: -1,
                        stdout = stdoutText,
                        stderr = stderrText,
                    )
                }
            }
        }
    }

    fun send(command: String) {
        if (command.isBlank()) return
        scope.launch {
            try {
                shellInput?.apply {
                    write(command.toByteArray(Charsets.UTF_8))
                    write('\n'.code)
                    flush()
                }
            } catch (_: Exception) {
                _state.update {
                    it.copy(
                        connectionState = SshConnectionState.ERROR,
                        statusMessage = "Disconnected",
                    )
                }
            }
        }
    }

    fun resize(columns: Int, rows: Int) {
        scope.launch {
            try {
                shell?.changeWindowDimensions(columns, rows, 0, 0)
            } catch (_: Exception) {
                // Resize failures are non-fatal for the beta renderer.
            }
        }
    }

    suspend fun confirmHostKey(pendingHostKey: PendingHostKey) {
        knownHosts.save(
            hostname = pendingHostKey.hostname,
            port = pendingHostKey.port,
            algorithm = pendingHostKey.algorithm,
            fingerprint = pendingHostKey.fingerprint,
        )
        reconnect()
    }

    private fun authenticate(sshClient: SSHClient, profile: SshHostProfile) {
        when (profile.authType) {
            AuthType.PASSWORD -> {
                val password = secrets.loadPassword(profile.id)
                    ?: throw IllegalStateException("Missing password for profile.")
                sshClient.authPassword(profile.username, password)
            }

            AuthType.PRIVATE_KEY -> {
                val privateKey = secrets.loadPrivateKey(profile.id)
                    ?: throw IllegalStateException("Missing private key for profile.")
                val provider = sshClient.loadKeys(privateKey, null, null)
                sshClient.authPublickey(profile.username, provider)
            }
        }
    }

    private fun verifier(profile: SshHostProfile): HostKeyVerifier {
        return object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
                val fingerprint = knownHosts.fingerprint(key)
                val algorithm = key.algorithm
                val known = knownHosts.lookup(hostname, port)
                return when {
                    known == null -> throw PendingHostKeyException(
                        PendingHostKey(
                            hostId = profile.id,
                            hostname = hostname,
                            port = port,
                            algorithm = algorithm,
                            fingerprint = fingerprint,
                        ),
                    )

                    known.fingerprint == fingerprint && known.algorithm == algorithm -> true
                    else -> throw HostKeyChangedException()
                }
            }

            override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> {
                return knownHosts.lookup(hostname, port)
                    ?.let { mutableListOf(it.algorithm) }
                    ?: mutableListOf()
            }
        }
    }

    private fun readStream(stream: InputStream): Job {
        return scope.launch {
            val buffer = ByteArray(4096)
            while (true) {
                val count = try {
                    stream.read(buffer)
                } catch (_: Exception) {
                    -1
                }
                if (count <= 0) break
                val chunk = String(buffer, 0, count, Charsets.UTF_8)
                _state.update { current ->
                    current.copy(output = (current.output + chunk).takeLast(MAX_OUTPUT_CHARS))
                }
            }
            if (_state.value.connectionState == SshConnectionState.CONNECTED) {
                _state.update {
                    it.copy(
                        connectionState = SshConnectionState.DISCONNECTED,
                        statusMessage = "Disconnected",
                    )
                }
            }
        }
    }

    private suspend fun readCommandStream(
        stream: InputStream,
        onChunk: suspend (String) -> Unit = {},
    ): String {
        val buffer = ByteArray(2048)
        val output = StringBuilder()
        while (true) {
            val count = try {
                stream.read(buffer)
            } catch (_: Exception) {
                -1
            }
            if (count <= 0) break
            val chunk = String(buffer, 0, count, Charsets.UTF_8)
            output.append(chunk)
            onChunk(chunk)
        }
        return output.toString()
    }

    private suspend fun disconnectInternal(announce: Boolean) {
        withContext(Dispatchers.IO) {
            stdoutJob?.cancel()
            stderrJob?.cancel()
            stdoutJob = null
            stderrJob = null
            runCatching { shell?.close() }
            runCatching { session?.close() }
            runCatching { client?.disconnect() }
            runCatching { client?.close() }
            shellInput = null
            shell = null
            session = null
            client = null
            if (announce) {
                _state.value = TerminalUiState(
                    connectionState = SshConnectionState.DISCONNECTED,
                    statusMessage = "Disconnected",
                    output = _state.value.output,
                )
            }
        }
    }

    private fun Exception.safeMessage(): String {
        return message?.take(160) ?: this::class.java.simpleName
    }

    private class PendingHostKeyException(val pendingHostKey: PendingHostKey) : RuntimeException()
    private class HostKeyChangedException : RuntimeException()

    private companion object {
        const val MAX_OUTPUT_CHARS = 64_000
    }
}

data class RemoteCommandResult(
    val exitStatus: Int,
    val stdout: String,
    val stderr: String,
)
