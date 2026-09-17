package com.worm.machinallm.ssh

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

class SshProfileRepository(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun loadProfiles(): List<SshHostProfile> {
        val raw = prefs.getString(KEY_PROFILES, null) ?: return emptyList()
        val array = JSONArray(raw)
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                add(
                    SshHostProfile(
                        id = item.getString("id"),
                        name = item.getString("name"),
                        hostname = item.getString("hostname"),
                        port = item.getInt("port"),
                        username = item.getString("username"),
                        authType = AuthType.valueOf(item.getString("authType")),
                    ),
                )
            }
        }
    }

    fun saveProfile(profile: SshHostProfile) {
        val next = loadProfiles().filterNot { it.id == profile.id } + profile
        saveProfiles(next)
    }

    private fun saveProfiles(profiles: List<SshHostProfile>) {
        val array = JSONArray()
        profiles.forEach { profile ->
            array.put(
                JSONObject()
                    .put("id", profile.id)
                    .put("name", profile.name)
                    .put("hostname", profile.hostname)
                    .put("port", profile.port)
                    .put("username", profile.username)
                    .put("authType", profile.authType.name),
            )
        }
        prefs.edit().putString(KEY_PROFILES, array.toString()).apply()
    }

    private companion object {
        const val PREFS = "machinallm_ssh_profiles"
        const val KEY_PROFILES = "profiles"
    }
}
