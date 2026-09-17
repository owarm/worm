package com.worm.machinallm.ssh

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import java.security.MessageDigest
import java.security.PublicKey

class KnownHostsStore(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun lookup(hostname: String, port: Int): KnownHost? {
        val raw = prefs.getString(key(hostname, port), null) ?: return null
        val item = org.json.JSONObject(raw)
        return KnownHost(
            hostname = hostname,
            port = port,
            algorithm = item.getString("algorithm"),
            fingerprint = item.getString("fingerprint"),
        )
    }

    fun save(hostname: String, port: Int, algorithm: String, fingerprint: String) {
        val item = org.json.JSONObject()
            .put("algorithm", algorithm)
            .put("fingerprint", fingerprint)
        prefs.edit().putString(key(hostname, port), item.toString()).apply()
    }

    fun fingerprint(publicKey: PublicKey): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(publicKey.encoded)
        return "SHA256:" + Base64.encodeToString(digest, Base64.NO_WRAP).trimEnd('=')
    }

    private fun key(hostname: String, port: Int): String = "${hostname.lowercase()}:$port"

    private companion object {
        const val PREFS = "machinallm_ssh_known_hosts"
    }
}

data class KnownHost(
    val hostname: String,
    val port: Int,
    val algorithm: String,
    val fingerprint: String,
)
