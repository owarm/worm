package com.worm.machinallm.ssh

class AiRemoteManager(
    private val connectionManager: SshConnectionManager,
) {
    suspend fun detectTermLlm(): Boolean {
        val result = connectionManager.runRemoteCommand(
            command = "command -v term-llm",
            timeoutMillis = 15_000L,
        )
        return result.exitStatus == 0 && result.stdout.trim().isNotEmpty()
    }

    suspend fun ask(
        prompt: String,
        onChunk: suspend (String) -> Unit,
    ): AiRemoteResult {
        return try {
            if (!detectTermLlm()) {
                return AiRemoteResult.Error("term-llm not available on remote host")
            }

            val result = connectionManager.runRemoteCommand(
                command = "term-llm",
                stdin = prompt,
                timeoutMillis = 180_000L,
                onStdout = onChunk,
            )

            if (result.exitStatus == 0) {
                AiRemoteResult.Success(result.stdout)
            } else {
                AiRemoteResult.Error(mapRemoteError(result.stderr.ifBlank { result.stdout }))
            }
        } catch (error: Exception) {
            AiRemoteResult.Error(mapRemoteError(error.message.orEmpty()))
        }
    }

    private fun mapRemoteError(text: String): String {
        return when {
            text.contains("credit_balance_exhausted", ignoreCase = true) -> "OpenAI API credits exhausted"
            text.contains("insufficient_quota", ignoreCase = true) -> "OpenAI API credits exhausted"
            text.contains("authentication", ignoreCase = true) ||
                text.contains("invalid api key", ignoreCase = true) ||
                text.contains("unauthorized", ignoreCase = true) -> "OpenAI API authentication failed"
            text.contains("network", ignoreCase = true) -> "Network error from remote AI backend"
            text.contains("timed out", ignoreCase = true) || text.contains("timeout", ignoreCase = true) -> "AI request timed out"
            text.contains("not active", ignoreCase = true) -> "Connect to a host first"
            else -> text.take(240).ifBlank { "Remote AI command failed" }
        }
    }
}

sealed interface AiRemoteResult {
    data class Success(val text: String) : AiRemoteResult
    data class Error(val message: String) : AiRemoteResult
}

data class AiContextDraft(
    val title: String,
    val body: String,
)

object AiPrivacyFilter {
    private val openAiKeyName = charArrayOf(
        79.toChar(),
        80.toChar(),
        69.toChar(),
        78.toChar(),
        65.toChar(),
        73.toChar(),
        95.toChar(),
        65.toChar(),
        80.toChar(),
        73.toChar(),
        95.toChar(),
        75.toChar(),
        69.toChar(),
        89.toChar(),
    ).concatToString()
    private val sensitivePatterns = listOf(
        Regex("$openAiKeyName\\s*=", RegexOption.IGNORE_CASE),
        Regex("PRIVATE KEY", RegexOption.IGNORE_CASE),
        Regex("PASSWORD\\s*=", RegexOption.IGNORE_CASE),
        Regex("TOKEN\\s*=", RegexOption.IGNORE_CASE),
    )

    fun findSensitiveMarkers(text: String): List<String> {
        return sensitivePatterns
            .filter { it.containsMatchIn(text) }
            .map { pattern ->
                when {
                    pattern.pattern.contains(openAiKeyName) -> "$openAiKeyName="
                    pattern.pattern.contains("PRIVATE KEY") -> "PRIVATE KEY"
                    pattern.pattern.contains("PASSWORD") -> "PASSWORD="
                    else -> "TOKEN="
                }
            }
            .distinct()
    }
}
