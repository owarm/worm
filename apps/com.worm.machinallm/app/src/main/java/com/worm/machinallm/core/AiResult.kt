package com.worm.machinallm.core

sealed interface AiResult {
    data class Success(val text: String) : AiResult
    data class Error(val message: String) : AiResult
}
