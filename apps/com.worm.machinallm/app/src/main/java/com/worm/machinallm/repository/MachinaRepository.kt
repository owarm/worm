package com.worm.machinallm.repository

import com.worm.machinallm.core.AiResult
import com.worm.machinallm.model.Message
import com.worm.machinallm.provider.AiProvider
import kotlinx.coroutines.CancellationException

class MachinaRepository(
    private val provider: AiProvider,
) {
    suspend fun sendMessage(messages: List<Message>): AiResult {
        return try {
            provider.sendMessage(messages)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            AiResult.Error(message = "MachinaLLM backend is not available.")
        }
    }
}
