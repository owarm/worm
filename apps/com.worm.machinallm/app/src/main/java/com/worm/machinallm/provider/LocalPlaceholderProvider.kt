package com.worm.machinallm.provider

import com.worm.machinallm.core.AiResult
import com.worm.machinallm.model.Message

class LocalPlaceholderProvider : AiProvider {
    override suspend fun sendMessage(messages: List<Message>): AiResult {
        if (messages.isEmpty()) {
            return AiResult.Error(message = "No message to process.")
        }

        return AiResult.Success(text = "MachinaLLM backend is not configured yet.")
    }
}
