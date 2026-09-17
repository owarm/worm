package com.worm.machinallm.model

data class Message(
    val text: String,
    val role: MessageRole,
)

enum class MessageRole {
    USER,
    ASSISTANT,
}
