package com.worm.machinallm.service

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import com.worm.machinallm.core.MachinaCore
import com.worm.machinallm.core.ProviderType
import com.worm.machinallm.repository.MachinaRepository

class MachinaLlmService : Service() {
    private val binder = LocalBinder()

    private val activeProviderType: ProviderType = ProviderType.LOCAL_PLACEHOLDER
    private val repository: MachinaRepository = MachinaCore.createRepository(activeProviderType)

    override fun onBind(intent: Intent?): IBinder {
        return binder
    }

    fun activeRepository(): MachinaRepository {
        return repository
    }

    fun activeProvider(): ProviderType {
        return activeProviderType
    }

    inner class LocalBinder : Binder() {
        fun service(): MachinaLlmService {
            return this@MachinaLlmService
        }
    }
}
