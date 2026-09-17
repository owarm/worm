package com.worm.machinallm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import com.worm.machinallm.ui.terminal.TerminalScreen
import com.worm.machinallm.ui.theme.MachinaLLMTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            MachinaLLMTheme {
                MachinaApp()
            }
        }
    }
}

@Composable
fun MachinaApp() {
    TerminalScreen()
}
