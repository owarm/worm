package com.worm.machinallm.ssh

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSecretStore(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    fun savePassword(profileId: String, password: String) {
        saveEncrypted(secretKey(profileId, "password"), password)
    }

    fun loadPassword(profileId: String): String? {
        return loadEncrypted(secretKey(profileId, "password"))
    }

    fun savePrivateKey(profileId: String, privateKey: String) {
        saveEncrypted(secretKey(profileId, "private_key"), privateKey)
    }

    fun loadPrivateKey(profileId: String): String? {
        return loadEncrypted(secretKey(profileId, "private_key"))
    }

    fun clear(profileId: String) {
        prefs.edit()
            .remove(secretKey(profileId, "password"))
            .remove(secretKey(profileId, "private_key"))
            .apply()
    }

    private fun saveEncrypted(name: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val payload = JSONObjectCompat.encode(
            mapOf(
                "iv" to Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
                "data" to Base64.encodeToString(encrypted, Base64.NO_WRAP),
            ),
        )
        prefs.edit().putString(name, payload).apply()
    }

    private fun loadEncrypted(name: String): String? {
        val payload = prefs.getString(name, null) ?: return null
        val values = JSONObjectCompat.decode(payload)
        val iv = Base64.decode(values["iv"], Base64.NO_WRAP)
        val encrypted = Base64.decode(values["data"], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        keyStore.getKey(KEY_ALIAS, null)?.let { return it as SecretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private fun secretKey(profileId: String, kind: String): String = "$kind:$profileId"

    private object JSONObjectCompat {
        fun encode(values: Map<String, String>): String {
            val objectValue = org.json.JSONObject()
            values.forEach { (key, value) -> objectValue.put(key, value) }
            return objectValue.toString()
        }

        fun decode(value: String): Map<String, String> {
            val objectValue = org.json.JSONObject(value)
            return objectValue.keys().asSequence().associateWith { objectValue.getString(it) }
        }
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "machinallm_ssh_secret_key"
        const val PREFS = "machinallm_ssh_secrets"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
