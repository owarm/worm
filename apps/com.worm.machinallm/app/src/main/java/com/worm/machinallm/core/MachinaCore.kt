package com.worm.machinallm.core

import com.worm.machinallm.provider.AiProvider
import com.worm.machinallm.provider.LocalPlaceholderProvider
import com.worm.machinallm.repository.MachinaRepository

object MachinaCore {
    fun createRepository(
        providerType: ProviderType = ProviderType.LOCAL_PLACEHOLDER,
    ): MachinaRepository {
        return MachinaRepository(provider = createProvider(providerType))
    }

    private fun createProvider(providerType: ProviderType): AiProvider {
        return when (providerType) {
            ProviderType.LOCAL_PLACEHOLDER -> LocalPlaceholderProvider()
            ProviderType.OPENAI,
            ProviderType.TERMLLM,
            -> LocalPlaceholderProvider()
        }
    }
}
