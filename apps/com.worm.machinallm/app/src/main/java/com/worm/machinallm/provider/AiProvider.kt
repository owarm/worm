package com.worm.machinallm.provider

import com.worm.machinallm.core.AiResult
import com.worm.machinallm.model.Message

interface AiProvider {
    suspend fun sendMessage(messages: List<Message>): AiResult
}
